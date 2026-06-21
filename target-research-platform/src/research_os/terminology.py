"""Versioned terminology release admission and candidate resolution."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .artifacts import ArtifactIntegrityError, ArtifactManifest, ThreeLayerArtifactStore
from .transport import RangeDownloadResponse, ResumableHttpDownloader


class TerminologyAdmissionError(ArtifactIntegrityError):
    """Raised when a terminology release or mapping candidate fails admission."""


@dataclass(frozen=True)
class TerminologyReleaseControl:
    schema: str
    control_id: str
    source_id: str
    terminology_id: str
    version: str
    filename: str
    url: str
    expected_size_bytes: int
    expected_sha256: str
    expected_descriptor_count: int
    reference_descriptor: dict[str, Any]
    license: dict[str, Any]
    observed_at: str
    observation_note: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TerminologyReleaseControl":
        if payload.get("schema") != "medscale.terminology_release_control.v1":
            raise TerminologyAdmissionError(
                "Unsupported terminology release control schema."
            )
        return cls(
            schema=payload["schema"],
            control_id=payload["control_id"],
            source_id=payload["source_id"],
            terminology_id=payload["terminology_id"],
            version=payload["version"],
            filename=payload["filename"],
            url=payload["url"],
            expected_size_bytes=int(payload["expected_size_bytes"]),
            expected_sha256=payload["expected_sha256"],
            expected_descriptor_count=int(payload["expected_descriptor_count"]),
            reference_descriptor=dict(payload["reference_descriptor"]),
            license=dict(payload["license"]),
            observed_at=payload["observed_at"],
            observation_note=payload["observation_note"],
        )

    @classmethod
    def load(cls, path: str | Path) -> "TerminologyReleaseControl":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


class MeshDescriptorInspector:
    """Inspect MeSH descriptor XML and return candidates without selecting one."""

    _DEFAULT_REFERENCE_UIS = {"D008545"}

    @staticmethod
    def _iter_descriptors(content: bytes):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(content), mode="rb") as handle:
                for _, element in ET.iterparse(handle, events=("end",)):
                    if element.tag != "DescriptorRecord":
                        continue
                    descriptor_ui = element.findtext("DescriptorUI") or ""
                    preferred_name = (
                        element.findtext("DescriptorName/String") or ""
                    )
                    tree_numbers = tuple(
                        node.text
                        for node in element.findall("TreeNumberList/TreeNumber")
                        if node.text
                    )
                    terms = tuple(
                        node.text
                        for node in element.findall(".//Term/String")
                        if node.text
                    )
                    yield {
                        "descriptor_ui": descriptor_ui,
                        "preferred_name": preferred_name,
                        "tree_numbers": tree_numbers,
                        "terms": terms,
                    }
                    element.clear()
        except (EOFError, OSError, ET.ParseError) as exc:
            raise TerminologyAdmissionError(
                "MeSH descriptor release is not a valid complete gzip XML file."
            ) from exc

    def inspect(
        self,
        content: bytes,
        *,
        reference_uis: set[str] | None = None,
    ) -> dict[str, Any]:
        references = reference_uis or self._DEFAULT_REFERENCE_UIS
        descriptor_count = 0
        reference_descriptors: dict[str, dict[str, Any]] = {}
        for descriptor in self._iter_descriptors(content):
            descriptor_count += 1
            if descriptor["descriptor_ui"] in references:
                reference_descriptors[descriptor["descriptor_ui"]] = {
                    "preferred_name": descriptor["preferred_name"],
                    "tree_numbers": list(descriptor["tree_numbers"]),
                    "term_count": len(descriptor["terms"]),
                }
        if descriptor_count < 1:
            raise TerminologyAdmissionError(
                "MeSH descriptor release contains no descriptor records."
            )
        return {
            "schema": "medscale.terminology_profile.v1",
            "terminology_id": "MeSH",
            "descriptor_count": descriptor_count,
            "reference_descriptors": reference_descriptors,
        }

    def resolve_candidates(self, content: bytes, query: str) -> dict[str, Any]:
        normalized_query = " ".join(query.casefold().split())
        if not normalized_query:
            raise TerminologyAdmissionError("Terminology query cannot be empty.")
        candidates: list[dict[str, Any]] = []
        for descriptor in self._iter_descriptors(content):
            preferred = " ".join(
                descriptor["preferred_name"].casefold().split()
            )
            terms = {
                " ".join(term.casefold().split())
                for term in descriptor["terms"]
            }
            if normalized_query != preferred and normalized_query not in terms:
                continue
            candidates.append({
                "descriptor_ui": descriptor["descriptor_ui"],
                "preferred_name": descriptor["preferred_name"],
                "tree_numbers": list(descriptor["tree_numbers"]),
                "matched_as": (
                    "preferred_name"
                    if normalized_query == preferred
                    else "term"
                ),
            })
        candidates.sort(key=lambda item: item["descriptor_ui"])
        return {
            "schema": "medscale.terminology_resolution.v1",
            "terminology_id": "MeSH",
            "query": query,
            "normalized_query": normalized_query,
            "status": (
                "no_match"
                if not candidates
                else "human_review_required"
            ),
            "selected_id": None,
            "candidates": candidates,
        }


class MeshTerminologyAdapter:
    """Download and admit a controlled official MeSH descriptor release."""

    def __init__(
        self,
        *,
        store: ThreeLayerArtifactStore,
        downloader: ResumableHttpDownloader | None = None,
        inspector: MeshDescriptorInspector | None = None,
    ) -> None:
        self.store = store
        self.downloader = downloader or ResumableHttpDownloader()
        self.inspector = inspector or MeshDescriptorInspector()

    @classmethod
    def from_bytes(
        cls,
        *,
        store: ThreeLayerArtifactStore,
        content: bytes,
        response_headers: dict[str, str] | None = None,
    ) -> "MeshTerminologyAdapter":
        response = RangeDownloadResponse(
            status_code=200,
            content=content,
            headers=response_headers or {},
        )
        return cls(
            store=store,
            downloader=ResumableHttpDownloader(
                fetch=lambda _url, _headers: response
            ),
        )

    def download_control(
        self,
        *,
        project_id: str,
        control: TerminologyReleaseControl,
        download_dir: str | Path,
    ) -> ArtifactManifest:
        if control.terminology_id != "MeSH":
            raise TerminologyAdmissionError(
                f"Unsupported terminology: {control.terminology_id}"
            )
        self.store.registry.require_url(control.source_id, control.url)
        directory = Path(download_dir).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        partial_path = directory / f"{control.filename}.part"
        receipt = self.downloader.download(
            url=control.url,
            destination=partial_path,
            expected_size_bytes=control.expected_size_bytes,
            expected_sha256=control.expected_sha256,
        )
        content = partial_path.read_bytes()
        reference_ui = control.reference_descriptor["descriptor_ui"]
        profile = self.inspector.inspect(
            content,
            reference_uis={reference_ui},
        )
        if profile["descriptor_count"] != control.expected_descriptor_count:
            raise TerminologyAdmissionError(
                "MeSH descriptor count differs from the fixed release control."
            )
        observed_reference = profile["reference_descriptors"].get(reference_ui)
        expected_reference = {
            "preferred_name": control.reference_descriptor["preferred_name"],
            "tree_numbers": control.reference_descriptor["tree_numbers"],
        }
        if not observed_reference or any(
            observed_reference[key] != value
            for key, value in expected_reference.items()
        ):
            raise TerminologyAdmissionError(
                "MeSH fixed reference descriptor differs from the release control."
            )

        artifact = self.store.ingest_raw(
            project_id=project_id,
            source_id=control.source_id,
            filename=control.filename,
            content=content,
            stable_record_ids=(
                f"{control.terminology_id}:{control.version}",
            ),
            retrieval={
                "url": control.url,
                "query": {
                    "terminology_id": control.terminology_id,
                    "version": control.version,
                },
                "download_receipt": receipt.to_dict(),
                "terminology_profile": profile,
                "reference_control": control.to_dict(),
                "license_terms": control.license,
                "control_passed": True,
                "temporary_download_removed_after_ingest": True,
            },
            media_type="application/gzip",
        )
        partial_path.unlink(missing_ok=True)
        return artifact
