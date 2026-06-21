"""NCBI PubMed raw evidence and human-authored claim ledger contracts."""
from __future__ import annotations

import hashlib
import json
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

from .artifacts import ArtifactIntegrityError, ArtifactManifest, ThreeLayerArtifactStore
from .governance import ReviewLedger, ReviewRequiredError, ReviewStage, utc_now
from .transport import ResumableHttpDownloader


class LiteratureAdmissionError(ArtifactIntegrityError):
    """Raised when a literature source record fails admission."""


class ClaimAdmissionError(RuntimeError):
    """Raised when a claim is not bound to approved exact source evidence."""


class NcbiRateLimiter:
    """Enforce NCBI's public/API-key request-rate contract."""

    def __init__(
        self,
        *,
        api_key: str | None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.minimum_interval_seconds = 0.11 if api_key else 0.34
        self.clock = clock
        self.sleep = sleep
        self._last_request_at: float | None = None

    def wait(self) -> None:
        now = self.clock()
        if self._last_request_at is not None:
            remaining = self.minimum_interval_seconds - (
                now - self._last_request_at
            )
            if remaining > 0:
                self.sleep(remaining)
                now = self.clock()
        self._last_request_at = now


@dataclass(frozen=True)
class PubMedRecordControl:
    schema: str
    control_id: str
    source_id: str
    pmid: str
    filename: str
    url: str
    expected_size_bytes: int
    expected_sha256: str
    expected_title: str
    expected_doi: str
    required_mesh: tuple[dict[str, str], ...] | list[dict[str, str]]
    observed_at: str
    observation_note: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["required_mesh"] = list(self.required_mesh)
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PubMedRecordControl":
        if payload.get("schema") != "medscale.pubmed_record_control.v1":
            raise LiteratureAdmissionError(
                "Unsupported PubMed record control schema."
            )
        return cls(
            schema=payload["schema"],
            control_id=payload["control_id"],
            source_id=payload["source_id"],
            pmid=payload["pmid"],
            filename=payload["filename"],
            url=payload["url"],
            expected_size_bytes=int(payload["expected_size_bytes"]),
            expected_sha256=payload["expected_sha256"],
            expected_title=payload["expected_title"],
            expected_doi=payload["expected_doi"],
            required_mesh=tuple(payload.get("required_mesh") or ()),
            observed_at=payload["observed_at"],
            observation_note=payload["observation_note"],
        )

    @classmethod
    def load(cls, path: str | Path) -> "PubMedRecordControl":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


class PubMedRecordInspector:
    """Parse stable PubMed metadata and exact original-text locators."""

    @staticmethod
    def _text(element: ET.Element | None) -> str:
        return "".join(element.itertext()).strip() if element is not None else ""

    def inspect(
        self,
        content: bytes,
        *,
        expected_pmids: tuple[str, ...],
    ) -> dict[str, Any]:
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            raise LiteratureAdmissionError("PubMed response is invalid XML.") from exc
        records: list[dict[str, Any]] = []
        for article in root.findall(".//PubmedArticle"):
            pmid = self._text(article.find(".//MedlineCitation/PMID"))
            title = self._text(article.find(".//ArticleTitle"))
            doi = next(
                (
                    self._text(node)
                    for node in article.findall(".//ArticleId")
                    if node.get("IdType") == "doi"
                ),
                "",
            )
            mesh_headings = [
                {
                    "descriptor_ui": node.get("UI") or "",
                    "descriptor_name": self._text(node),
                    "major_topic": node.get("MajorTopicYN") == "Y",
                }
                for node in article.findall(".//MeshHeading/DescriptorName")
            ]
            publication_types = [
                {
                    "ui": node.get("UI") or "",
                    "name": self._text(node),
                }
                for node in article.findall(".//PublicationType")
            ]
            abstract_sections = []
            for index, node in enumerate(article.findall(".//Abstract/AbstractText")):
                text = self._text(node)
                abstract_sections.append({
                    "section_index": index,
                    "label": node.get("Label"),
                    "locator": f"pubmed:{pmid}:abstract:{index}",
                    "text_sha256": hashlib.sha256(
                        text.encode("utf-8")
                    ).hexdigest(),
                    "text_length": len(text),
                })
            records.append({
                "pmid": pmid,
                "title": title,
                "doi": doi,
                "mesh_headings": mesh_headings,
                "publication_types": publication_types,
                "abstract_sections": abstract_sections,
            })
        observed_pmids = tuple(record["pmid"] for record in records)
        if observed_pmids != expected_pmids:
            raise LiteratureAdmissionError(
                "PubMed response PMIDs differ from the requested stable records."
            )
        return {
            "schema": "medscale.pubmed_profile.v1",
            "record_count": len(records),
            "records": records,
        }

    def locator_hash(
        self,
        content: bytes,
        *,
        locator: str,
    ) -> str:
        parts = locator.split(":")
        if len(parts) != 4 or parts[0] != "pubmed" or parts[2] != "abstract":
            raise ClaimAdmissionError("Unsupported PubMed source locator.")
        pmid = parts[1]
        try:
            section_index = int(parts[3])
        except ValueError as exc:
            raise ClaimAdmissionError("Invalid PubMed source locator.") from exc
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            raise ClaimAdmissionError("PubMed source XML is invalid.") from exc
        for article in root.findall(".//PubmedArticle"):
            observed_pmid = self._text(article.find(".//MedlineCitation/PMID"))
            if observed_pmid != pmid:
                continue
            sections = article.findall(".//Abstract/AbstractText")
            if section_index < 0 or section_index >= len(sections):
                break
            text = self._text(sections[section_index])
            return hashlib.sha256(text.encode("utf-8")).hexdigest()
        raise ClaimAdmissionError("PubMed source locator was not found.")


class PubMedEfetchAdapter:
    """Download one controlled PubMed XML record with NCBI rate limiting."""

    def __init__(
        self,
        *,
        store: ThreeLayerArtifactStore,
        downloader: ResumableHttpDownloader | None = None,
        limiter: NcbiRateLimiter | None = None,
        inspector: PubMedRecordInspector | None = None,
    ) -> None:
        self.store = store
        self.downloader = downloader or ResumableHttpDownloader()
        self.limiter = limiter or NcbiRateLimiter(api_key=None)
        self.inspector = inspector or PubMedRecordInspector()

    def download_control(
        self,
        *,
        project_id: str,
        control: PubMedRecordControl,
        download_dir: str | Path,
    ) -> ArtifactManifest:
        self.store.registry.require_url(control.source_id, control.url)
        directory = Path(download_dir).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        partial_path = directory / f"{control.filename}.part"
        self.limiter.wait()
        receipt = self.downloader.download(
            url=control.url,
            destination=partial_path,
            expected_size_bytes=control.expected_size_bytes,
            expected_sha256=control.expected_sha256,
        )
        content = partial_path.read_bytes()
        profile = self.inspector.inspect(
            content,
            expected_pmids=(control.pmid,),
        )
        record = profile["records"][0]
        if (
            record["title"] != control.expected_title
            or record["doi"] != control.expected_doi
        ):
            raise LiteratureAdmissionError(
                "PubMed title or DOI differs from the fixed control."
            )
        mesh_pairs = {
            (item["descriptor_ui"], item["descriptor_name"])
            for item in record["mesh_headings"]
        }
        required_pairs = {
            (item["descriptor_ui"], item["descriptor_name"])
            for item in control.required_mesh
        }
        if not required_pairs.issubset(mesh_pairs):
            raise LiteratureAdmissionError(
                "PubMed required MeSH headings differ from the fixed control."
            )
        media_type = receipt.response_headers.get(
            "content-type",
            "text/xml",
        ).split(";", 1)[0].strip()
        artifact = self.store.ingest_raw(
            project_id=project_id,
            source_id=control.source_id,
            filename=control.filename,
            content=content,
            stable_record_ids=(f"PMID:{control.pmid}",),
            retrieval={
                "url": control.url,
                "query": {
                    "db": "pubmed",
                    "id": control.pmid,
                    "rettype": "abstract",
                    "retmode": "xml",
                },
                "download_receipt": receipt.to_dict(),
                "pubmed_profile": profile,
                "reference_control": control.to_dict(),
                "ncbi_minimum_interval_seconds": (
                    self.limiter.minimum_interval_seconds
                ),
                "control_passed": True,
                "temporary_download_removed_after_ingest": True,
            },
            media_type=media_type,
        )
        partial_path.unlink(missing_ok=True)
        return artifact


@dataclass(frozen=True)
class ClaimRecord:
    schema: str
    claim_id: str
    claim_text: str
    stance: str
    source_artifact_id: str
    source_record_id: str
    locator: str
    locator_text_sha256: str
    evidence_assessment: dict[str, str]
    path: str
    sha256: str
    created_at: str


class ClaimLedgerStore:
    """Persist human-authored claims bound to approved exact source locators."""

    _ALLOWED_STANCES = {"support", "oppose", "uncertain"}
    _ASSESSMENT_FIELDS = {
        "study_design",
        "risk_of_bias",
        "certainty",
        "applicability",
    }

    def __init__(
        self,
        root: str | Path,
        *,
        artifact_store: ThreeLayerArtifactStore,
        reviews: ReviewLedger,
    ) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.artifact_store = artifact_store
        self.reviews = reviews
        self.inspector = PubMedRecordInspector()
        self._records: dict[str, ClaimRecord] = {}
        self._load()

    @staticmethod
    def _claim_id(payload: dict[str, Any]) -> str:
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return f"msclaim-{hashlib.sha256(canonical).hexdigest()[:24]}"

    @staticmethod
    def _content(payload: dict[str, Any]) -> bytes:
        return (
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2)
            + "\n"
        ).encode("utf-8")

    @staticmethod
    def _manifest_hash(record: ClaimRecord) -> str:
        payload = {
            "schema": record.schema,
            "claim_id": record.claim_id,
            "source_artifact_id": record.source_artifact_id,
            "source_record_id": record.source_record_id,
            "locator": record.locator,
            "sha256": record.sha256,
        }
        return hashlib.sha256(
            json.dumps(
                payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _identity_payload(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema": payload["schema"],
            "claim_text": payload["claim_text"],
            "stance": payload["stance"],
            "source_artifact_id": payload["source_artifact_id"],
            "source_record_id": payload["source_record_id"],
            "locator": payload["locator"],
            "locator_text_sha256": payload["locator_text_sha256"],
            "evidence_assessment": payload["evidence_assessment"],
        }

    def _load(self) -> None:
        for path in self.root.glob("msclaim-*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                identity = self._identity_payload(payload)
                claim_id = self._claim_id(identity)
                if payload.get("claim_id") != claim_id or path.stem != claim_id:
                    continue
                content = path.read_bytes()
                record = ClaimRecord(
                    schema=payload["schema"],
                    claim_id=claim_id,
                    claim_text=payload["claim_text"],
                    stance=payload["stance"],
                    source_artifact_id=payload["source_artifact_id"],
                    source_record_id=payload["source_record_id"],
                    locator=payload["locator"],
                    locator_text_sha256=payload["locator_text_sha256"],
                    evidence_assessment=dict(payload["evidence_assessment"]),
                    path=str(path.resolve()),
                    sha256=hashlib.sha256(content).hexdigest(),
                    created_at=payload["created_at"],
                )
            except (
                OSError,
                KeyError,
                TypeError,
                ValueError,
                json.JSONDecodeError,
            ):
                continue
            self._records[claim_id] = record

    def submit(
        self,
        *,
        claim_text: str,
        stance: str,
        source_artifact_id: str,
        source_record_id: str,
        locator: str,
        locator_text_sha256: str,
        evidence_assessment: dict[str, Any],
    ) -> ClaimRecord:
        if not claim_text.strip():
            raise ClaimAdmissionError("Claim text must be human-authored and non-empty.")
        if stance not in self._ALLOWED_STANCES:
            raise ClaimAdmissionError(f"Unsupported claim stance: {stance}")
        if any(
            "grade" in key.casefold() or "score" in key.casefold()
            for key in evidence_assessment
        ):
            raise ClaimAdmissionError(
                "Numeric or pseudo-GRADE evidence scoring is prohibited."
            )
        if set(evidence_assessment) != self._ASSESSMENT_FIELDS:
            raise ClaimAdmissionError(
                "Evidence assessment fields must remain separated and complete."
            )
        if not all(
            isinstance(evidence_assessment[key], str)
            and evidence_assessment[key].strip()
            for key in self._ASSESSMENT_FIELDS
        ):
            raise ClaimAdmissionError(
                "Evidence assessment values must be explicit strings."
            )
        self.reviews.require_approved(source_artifact_id)
        if not self.artifact_store.verify(source_artifact_id):
            raise ClaimAdmissionError("Source artifact failed integrity verification.")
        manifest = self.artifact_store.get(source_artifact_id)
        if source_record_id not in manifest.stable_record_ids:
            raise ClaimAdmissionError(
                "Claim source record is not present in the source artifact manifest."
            )
        content = self.artifact_store.read_bytes(source_artifact_id)
        observed_locator_hash = self.inspector.locator_hash(
            content,
            locator=locator,
        )
        if observed_locator_hash != locator_text_sha256:
            raise ClaimAdmissionError(
                "Claim locator hash does not match the exact source text locator."
            )

        payload = {
            "schema": "medscale.claim_record.v1",
            "claim_text": claim_text,
            "stance": stance,
            "source_artifact_id": source_artifact_id,
            "source_record_id": source_record_id,
            "locator": locator,
            "locator_text_sha256": locator_text_sha256,
            "evidence_assessment": dict(evidence_assessment),
        }
        claim_id = self._claim_id(payload)
        existing = self._records.get(claim_id)
        if existing:
            if not self.verify(claim_id):
                raise ClaimAdmissionError(
                    f"Existing claim {claim_id} failed integrity verification."
                )
            return existing
        payload["claim_id"] = claim_id
        payload["created_at"] = utc_now()
        content_bytes = self._content(payload)
        content_hash = hashlib.sha256(content_bytes).hexdigest()
        path = self.root / f"{claim_id}.json"
        tmp_path = self.root / f".{claim_id}.tmp"
        tmp_path.write_bytes(content_bytes)
        os.replace(tmp_path, path)
        record = ClaimRecord(
            schema=payload["schema"],
            claim_id=claim_id,
            claim_text=claim_text,
            stance=stance,
            source_artifact_id=source_artifact_id,
            source_record_id=source_record_id,
            locator=locator,
            locator_text_sha256=locator_text_sha256,
            evidence_assessment=dict(evidence_assessment),
            path=str(path.resolve()),
            sha256=content_hash,
            created_at=payload["created_at"],
        )
        self._records[claim_id] = record
        try:
            self.reviews.require_review(
                claim_id,
                stage=ReviewStage.INTELLIGENCE,
                input_hash=manifest.sha256,
                output_hash=content_hash,
                manifest_hash=self._manifest_hash(record),
                rule_version="claim-ledger:1.0.0",
            )
        except Exception:
            self._records.pop(claim_id, None)
            path.unlink(missing_ok=True)
            raise
        return record

    def get(self, claim_id: str) -> ClaimRecord:
        try:
            return self._records[claim_id]
        except KeyError as exc:
            raise ClaimAdmissionError(f"Unknown claim: {claim_id}") from exc

    def verify(self, claim_id: str) -> bool:
        record = self.get(claim_id)
        path = Path(record.path)
        if not path.is_file():
            return False
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != record.sha256:
            return False
        try:
            payload = json.loads(content)
            if self._claim_id(self._identity_payload(payload)) != claim_id:
                return False
            if not self.artifact_store.verify(record.source_artifact_id):
                return False
            if (
                self.inspector.locator_hash(
                    self.artifact_store.read_bytes(record.source_artifact_id),
                    locator=record.locator,
                )
                != record.locator_text_sha256
            ):
                return False
            return (
                self.reviews.output_hash(claim_id) == record.sha256
                and self.reviews.manifest_hash(claim_id)
                == self._manifest_hash(record)
            )
        except (
            OSError,
            KeyError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            ClaimAdmissionError,
            ReviewRequiredError,
        ):
            return False

    def require_approved(self, claim_id: str) -> ClaimRecord:
        if not self.verify(claim_id):
            raise ClaimAdmissionError(
                f"Claim {claim_id} failed integrity verification."
            )
        self.reviews.require_approved(claim_id)
        return self.get(claim_id)
