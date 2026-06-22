"""Fail-closed research project admission contracts."""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .governance import (
    LicenseViolationError,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    SourceRegistry,
    SourceUnavailableError,
    utc_now,
)


class ProjectAdmissionError(RuntimeError):
    """Raised when a research project is incomplete, invalid, or unapproved."""


_SAFE_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_CANONICAL_ID_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SUPPORTED_OMICS = {
    "transcriptomics",
    "variants",
    "proteomics",
    "dependencies",
    "epigenomics",
    "single_cell",
    "spatial",
}


def _issue(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _is_placeholder(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("REQUIRED_")


def _canonical_term_valid(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    system = payload.get("system")
    identifier = payload.get("id")
    label = payload.get("label")
    return bool(
        isinstance(system, str)
        and isinstance(identifier, str)
        and isinstance(label, str)
        and not _is_placeholder(system)
        and not _is_placeholder(identifier)
        and not _is_placeholder(label)
        and _CANONICAL_ID_PART.fullmatch(system)
        and _CANONICAL_ID_PART.fullmatch(identifier)
        and label.strip()
    )


class ProjectDefinitionValidator:
    """Validate explicit project facts without inferring missing definitions."""

    def __init__(self, registry: SourceRegistry) -> None:
        self.registry = registry

    def validate(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        issues: list[dict[str, str]] = []
        if payload.get("schema") != "medscale.research_project.v1":
            issues.append(_issue(
                "UNSUPPORTED_SCHEMA",
                "schema",
                "Project schema must be medscale.research_project.v1.",
            ))

        self._find_placeholders(payload, "", issues)

        project_id = payload.get("project_id")
        if (
            not isinstance(project_id, str)
            or not _SAFE_PROJECT_ID.fullmatch(project_id)
            or _is_placeholder(project_id)
        ):
            issues.append(_issue(
                "INVALID_PROJECT_ID",
                "project_id",
                "Project ID must be a stable filesystem-safe identifier.",
            ))
        for field in ("title", "research_question", "case_definition", "control_definition"):
            value = payload.get(field)
            if not isinstance(value, str) or not value.strip() or _is_placeholder(value):
                issues.append(_issue(
                    "MISSING_REQUIRED_FIELD",
                    field,
                    f"{field} must be explicitly provided.",
                ))

        for field in ("condition", "organism", "tissue"):
            if not _canonical_term_valid(payload.get(field)):
                issues.append(_issue(
                    "INVALID_CANONICAL_ID",
                    field,
                    f"{field} requires a canonical system, ID, and label.",
                ))

        organism = payload.get("organism")
        if (
            not isinstance(organism, dict)
            or organism.get("system") != "NCBITaxon"
            or organism.get("id") != "9606"
        ):
            issues.append(_issue(
                "UNSUPPORTED_ORGANISM",
                "organism",
                "Human-first V1 requires NCBITaxon:9606.",
            ))

        omics = payload.get("omics_dimension")
        if omics not in _SUPPORTED_OMICS:
            issues.append(_issue(
                "UNSUPPORTED_OMICS_DIMENSION",
                "omics_dimension",
                "Omics dimension is not in the admitted seven-dimension set.",
            ))

        case_definition = payload.get("case_definition")
        control_definition = payload.get("control_definition")
        if (
            isinstance(case_definition, str)
            and isinstance(control_definition, str)
            and case_definition.strip()
            and case_definition.strip().casefold()
            == control_definition.strip().casefold()
        ):
            issues.append(_issue(
                "IDENTICAL_GROUP_DEFINITIONS",
                "case_definition/control_definition",
                "Case and control definitions must be explicitly different.",
            ))

        for field in ("minimum_case_samples", "minimum_control_samples"):
            value = payload.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 5:
                issues.append(_issue(
                    "INSUFFICIENT_MINIMUM_SAMPLES",
                    field,
                    "Minimum case and control sample counts must each be at least five.",
                ))

        controls = payload.get("positive_controls")
        if not isinstance(controls, list) or not controls:
            issues.append(_issue(
                "MISSING_POSITIVE_CONTROL",
                "positive_controls",
                "At least one project positive control is required.",
            ))
        else:
            seen_control_ids: set[str] = set()
            for index, control in enumerate(controls):
                self._validate_control(
                    control,
                    index=index,
                    seen_control_ids=seen_control_ids,
                    issues=issues,
                )
        return issues

    def require_valid(self, payload: dict[str, Any]) -> dict[str, Any]:
        issues = self.validate(payload)
        if issues:
            codes = ", ".join(sorted({issue["code"] for issue in issues}))
            raise ProjectAdmissionError(
                f"Research project failed admission validation: {codes}"
            )
        return json.loads(json.dumps(payload, ensure_ascii=False))

    def _find_placeholders(
        self,
        value: Any,
        path: str,
        issues: list[dict[str, str]],
    ) -> None:
        if _is_placeholder(value):
            issues.append(_issue(
                "PLACEHOLDER_VALUE",
                path or "$",
                "Template placeholders must be replaced by explicit human input.",
            ))
        elif isinstance(value, dict):
            for key, child in value.items():
                self._find_placeholders(
                    child,
                    f"{path}.{key}" if path else key,
                    issues,
                )
        elif isinstance(value, list):
            for index, child in enumerate(value):
                self._find_placeholders(child, f"{path}[{index}]", issues)

    def _validate_control(
        self,
        control: Any,
        *,
        index: int,
        seen_control_ids: set[str],
        issues: list[dict[str, str]],
    ) -> None:
        path = f"positive_controls[{index}]"
        if not isinstance(control, dict):
            issues.append(_issue(
                "INVALID_POSITIVE_CONTROL",
                path,
                "Positive control must be an object.",
            ))
            return
        control_id = control.get("control_id")
        if (
            not isinstance(control_id, str)
            or not _SAFE_PROJECT_ID.fullmatch(control_id)
            or _is_placeholder(control_id)
        ):
            issues.append(_issue(
                "INVALID_POSITIVE_CONTROL",
                f"{path}.control_id",
                "Positive control requires a stable control ID.",
            ))
        elif control_id in seen_control_ids:
            issues.append(_issue(
                "DUPLICATE_POSITIVE_CONTROL",
                f"{path}.control_id",
                "Positive control IDs must be unique.",
            ))
        else:
            seen_control_ids.add(control_id)

        canonical_id = control.get("canonical_id")
        if (
            not isinstance(canonical_id, str)
            or ":" not in canonical_id
            or _is_placeholder(canonical_id)
        ):
            issues.append(_issue(
                "INVALID_CANONICAL_ID",
                f"{path}.canonical_id",
                "Control entity requires a canonical namespace-prefixed ID.",
            ))
        else:
            system, identifier = canonical_id.split(":", 1)
            if (
                not _CANONICAL_ID_PART.fullmatch(system)
                or not _CANONICAL_ID_PART.fullmatch(identifier)
            ):
                issues.append(_issue(
                    "INVALID_CANONICAL_ID",
                    f"{path}.canonical_id",
                    "Control entity requires a canonical namespace-prefixed ID.",
                ))

        for field in ("entity_type", "label", "expected_observation"):
            value = control.get(field)
            if not isinstance(value, str) or not value.strip() or _is_placeholder(value):
                issues.append(_issue(
                    "INVALID_POSITIVE_CONTROL",
                    f"{path}.{field}",
                    f"{field} must be explicitly provided.",
                ))

        citations = control.get("citations")
        if not isinstance(citations, list) or not citations:
            issues.append(_issue(
                "MISSING_CONTROL_CITATION",
                f"{path}.citations",
                "Every positive control requires at least one evidence citation.",
            ))
            return
        for citation_index, citation in enumerate(citations):
            self._validate_citation(
                citation,
                path=f"{path}.citations[{citation_index}]",
                issues=issues,
            )

    def _validate_citation(
        self,
        citation: Any,
        *,
        path: str,
        issues: list[dict[str, str]],
    ) -> None:
        if not isinstance(citation, dict):
            issues.append(_issue(
                "INVALID_EVIDENCE_URL",
                path,
                "Citation must be an object with source, stable record ID, and URL.",
            ))
            return
        source_id = citation.get("source_id")
        stable_record_id = citation.get("stable_record_id")
        url = citation.get("url")
        parsed = urlparse(url) if isinstance(url, str) else None
        if (
            not parsed
            or parsed.scheme != "https"
            or not parsed.netloc
            or _is_placeholder(url)
        ):
            issues.append(_issue(
                "INVALID_EVIDENCE_URL",
                f"{path}.url",
                "Evidence URL must be an explicit approved HTTPS URL.",
            ))
        if (
            not isinstance(stable_record_id, str)
            or not stable_record_id.strip()
            or _is_placeholder(stable_record_id)
        ):
            issues.append(_issue(
                "INVALID_EVIDENCE_RECORD",
                f"{path}.stable_record_id",
                "Evidence requires a stable source record ID.",
            ))
        if not isinstance(source_id, str) or _is_placeholder(source_id):
            issues.append(_issue(
                "UNAPPROVED_EVIDENCE_SOURCE",
                f"{path}.source_id",
                "Evidence source must be registered and approved.",
            ))
            return
        try:
            self.registry.require_approved(source_id, use="research")
        except (SourceUnavailableError, LicenseViolationError):
            issues.append(_issue(
                "UNAPPROVED_EVIDENCE_SOURCE",
                f"{path}.source_id",
                "Evidence source must be registered and approved.",
            ))
            return
        if parsed and parsed.scheme == "https" and parsed.netloc:
            try:
                self.registry.require_url(source_id, url)
            except (SourceUnavailableError, LicenseViolationError):
                issues.append(_issue(
                    "INVALID_EVIDENCE_URL",
                    f"{path}.url",
                    "Evidence URL is outside the source's approved endpoints.",
                ))


@dataclass(frozen=True)
class ProjectAdmissionRecord:
    schema: str
    record_id: str
    project_id: str
    path: str
    sha256: str
    submitted_at: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


class ProjectAdmissionStore:
    """Persist immutable project definitions and bind them to human review."""

    RULE_VERSION = "project-admission:1.0.0"

    def __init__(
        self,
        root: str | Path,
        *,
        registry: SourceRegistry,
        reviews: ReviewLedger,
    ) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.registry = registry
        self.reviews = reviews
        self.validator = ProjectDefinitionValidator(registry)
        self._records: dict[str, ProjectAdmissionRecord] = {}
        self._load()

    @staticmethod
    def _content(payload: dict[str, Any]) -> bytes:
        return (
            json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")

    @staticmethod
    def _record_id(payload: dict[str, Any]) -> str:
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return f"msproj-{hashlib.sha256(canonical).hexdigest()[:24]}"

    @staticmethod
    def _manifest_hash(record: ProjectAdmissionRecord) -> str:
        payload = {
            "schema": record.schema,
            "record_id": record.record_id,
            "project_id": record.project_id,
            "filename": Path(record.path).name,
            "sha256": record.sha256,
        }
        canonical = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    def _inside_root(self, path: Path) -> Path:
        resolved = path.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ProjectAdmissionError(f"Project path escapes admission root: {path}")
        return resolved

    def _project_root(self, project_id: str) -> Path:
        if not _SAFE_PROJECT_ID.fullmatch(project_id):
            raise ProjectAdmissionError(f"Unsafe project ID: {project_id!r}")
        return self._inside_root(self.root / project_id)

    def _load(self) -> None:
        for path in self.root.glob("*/msproj-*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                record_id = self._record_id(payload)
                if path.stem != record_id:
                    continue
                content = path.read_bytes()
                record = ProjectAdmissionRecord(
                    schema="medscale.project_admission_record.v1",
                    record_id=record_id,
                    project_id=payload["project_id"],
                    path=str(path.resolve()),
                    sha256=hashlib.sha256(content).hexdigest(),
                    submitted_at="loaded-from-disk",
                )
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
            self._records[record_id] = record

    def submit(self, payload: dict[str, Any]) -> ProjectAdmissionRecord:
        validated = self.validator.require_valid(payload)
        project_id = validated["project_id"]
        record_id = self._record_id(validated)
        content = self._content(validated)
        content_hash = hashlib.sha256(content).hexdigest()
        project_root = self._project_root(project_id)
        project_root.mkdir(parents=True, exist_ok=True)
        path = self._inside_root(project_root / f"{record_id}.json")
        existing = self._records.get(record_id)
        if existing:
            if not self.verify(record_id):
                raise ProjectAdmissionError(
                    f"Existing project record {record_id} failed integrity verification."
                )
            return existing

        tmp_path = self._inside_root(project_root / f".{record_id}.tmp")
        tmp_path.write_bytes(content)
        os.replace(tmp_path, path)
        record = ProjectAdmissionRecord(
            schema="medscale.project_admission_record.v1",
            record_id=record_id,
            project_id=project_id,
            path=str(path),
            sha256=content_hash,
            submitted_at=utc_now(),
        )
        self._records[record_id] = record
        try:
            self.reviews.require_review(
                record_id,
                stage=ReviewStage.ACQUISITION,
                input_hash=content_hash,
                output_hash=content_hash,
                manifest_hash=self._manifest_hash(record),
                rule_version=self.RULE_VERSION,
            )
        except Exception:
            self._records.pop(record_id, None)
            path.unlink(missing_ok=True)
            raise
        return record

    def get(self, record_id: str) -> ProjectAdmissionRecord:
        try:
            return self._records[record_id]
        except KeyError as exc:
            raise ProjectAdmissionError(
                f"Unknown project admission record: {record_id}"
            ) from exc

    def verify(self, record_id: str) -> bool:
        record = self.get(record_id)
        path = Path(record.path)
        if not path.is_file():
            return False
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != record.sha256:
            return False
        try:
            payload = json.loads(content)
            if self._record_id(payload) != record.record_id:
                return False
            if self.validator.validate(payload):
                return False
            return (
                self.reviews.output_hash(record_id) == record.sha256
                and self.reviews.manifest_hash(record_id)
                == self._manifest_hash(record)
            )
        except (
            OSError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            ReviewRequiredError,
        ):
            return False

    def require_ready_for_acquisition(
        self,
        record_id: str,
    ) -> ProjectAdmissionRecord:
        if not self.verify(record_id):
            raise ProjectAdmissionError(
                f"Project record {record_id} failed integrity verification."
            )
        self.reviews.require_approved(record_id)
        return self.get(record_id)
