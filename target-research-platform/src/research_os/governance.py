"""Governance primitives for the local-first MedSCALE research platform."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GovernanceError(RuntimeError):
    """Base class for fail-closed governance errors."""


class SourceUnavailableError(GovernanceError):
    """Raised when a source is unknown, unapproved, or not allowed for a use."""


class LicenseViolationError(GovernanceError):
    """Raised when an operation would violate the registered source license."""


class ReviewRequiredError(GovernanceError):
    """Raised when downstream work is attempted before human approval."""


class InvalidReviewTransitionError(GovernanceError):
    """Raised when an audit state transition is not allowed."""


class SourceStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    SUSPENDED = "suspended"
    EXPIRED = "expired"


class LicenseScope(str, Enum):
    PUBLIC = "public"
    RESTRICTED = "restricted"


class ReviewStage(str, Enum):
    ACQUISITION = "acquisition"
    NORMALIZATION = "normalization"
    SCREENING = "screening"
    INTELLIGENCE = "intelligence"


class ReviewStatus(str, Enum):
    REVIEW_REQUIRED = "review_required"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVISION_REQUIRED = "revision_required"
    INVALIDATED = "invalidated"


@dataclass(frozen=True)
class SourceDefinition:
    source_id: str
    name: str
    authority: str
    version: str
    adapter_id: str
    base_urls: tuple[str, ...]
    license_scope: LicenseScope
    allowed_uses: tuple[str, ...]
    status: SourceStatus = SourceStatus.PENDING

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["base_urls"] = list(self.base_urls)
        payload["allowed_uses"] = list(self.allowed_uses)
        payload["license_scope"] = self.license_scope.value
        payload["status"] = self.status.value
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SourceDefinition":
        return cls(
            source_id=payload["source_id"],
            name=payload["name"],
            authority=payload["authority"],
            version=payload["version"],
            adapter_id=payload["adapter_id"],
            base_urls=tuple(payload.get("base_urls") or ()),
            license_scope=LicenseScope(payload["license_scope"]),
            allowed_uses=tuple(payload.get("allowed_uses") or ()),
            status=SourceStatus(payload["status"]),
        )


class SourceRegistry:
    """In-memory source admission registry with hard licensing gates."""

    def __init__(self) -> None:
        self._sources: dict[str, SourceDefinition] = {}

    def register(self, source: SourceDefinition) -> None:
        current = self._sources.get(source.source_id)
        if current and current != source:
            raise SourceUnavailableError(
                f"Source {source.source_id!r} is already registered with different metadata."
            )
        self._sources[source.source_id] = source

    def save(self, path: str | Path) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "medscale.source_registry.v1",
            "sources": [
                self._sources[source_id].to_dict()
                for source_id in sorted(self._sources)
            ],
        }
        output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return output

    @classmethod
    def load(cls, path: str | Path) -> "SourceRegistry":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("schema") != "medscale.source_registry.v1":
            raise SourceUnavailableError("Unsupported source registry schema.")
        registry = cls()
        for source_payload in payload.get("sources") or []:
            registry.register(SourceDefinition.from_dict(source_payload))
        return registry

    def get(self, source_id: str) -> SourceDefinition:
        try:
            return self._sources[source_id]
        except KeyError as exc:
            raise SourceUnavailableError(f"Unknown source: {source_id}") from exc

    def require_approved(self, source_id: str, *, use: str) -> SourceDefinition:
        source = self.get(source_id)
        if source.status is not SourceStatus.APPROVED:
            raise SourceUnavailableError(
                f"Source {source_id} is {source.status.value}, not approved."
            )
        if use not in source.allowed_uses:
            raise LicenseViolationError(
                f"Source {source_id} does not allow use {use!r}."
            )
        return source

    def require_public_export(self, source_id: str) -> SourceDefinition:
        source = self.require_approved(source_id, use="research")
        if (
            source.license_scope is not LicenseScope.PUBLIC
            or "public_export" not in source.allowed_uses
        ):
            raise LicenseViolationError(
                f"Source {source_id} is not permitted in public exports."
            )
        return source

    def require_url(self, source_id: str, url: str) -> SourceDefinition:
        source = self.require_approved(source_id, use="research")
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise SourceUnavailableError(f"Unsupported download URL: {url}")
        allowed = False
        for base_url in source.base_urls:
            base = urlparse(base_url)
            if (
                parsed.scheme == base.scheme
                and parsed.netloc.lower() == base.netloc.lower()
                and parsed.path.startswith(base.path or "/")
            ):
                allowed = True
                break
        if not allowed:
            raise SourceUnavailableError(
                f"URL {url!r} is outside the approved endpoints for {source_id}."
            )
        return source


@dataclass(frozen=True)
class ReviewEvent:
    schema: str
    event_id: str
    artifact_id: str
    stage: ReviewStage
    action: str
    status: ReviewStatus
    actor: str
    timestamp: str
    input_hash: str
    output_hash: str
    manifest_hash: str
    rule_version: str
    note: str
    signature: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["stage"] = self.stage.value
        payload["status"] = self.status.value
        return payload


class ReviewLedger:
    """Append-only review event ledger with deterministic state reconstruction."""

    _DECISION_STATUSES = {
        ReviewStatus.APPROVED,
        ReviewStatus.REJECTED,
        ReviewStatus.REVISION_REQUIRED,
    }

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._events: list[ReviewEvent] = []
        self._current: dict[str, ReviewEvent] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            data = json.loads(line)
            event = ReviewEvent(
                schema=data["schema"],
                event_id=data["event_id"],
                artifact_id=data["artifact_id"],
                stage=ReviewStage(data["stage"]),
                action=data["action"],
                status=ReviewStatus(data["status"]),
                actor=data["actor"],
                timestamp=data["timestamp"],
                input_hash=data["input_hash"],
                output_hash=data["output_hash"],
                manifest_hash=data.get("manifest_hash", ""),
                rule_version=data["rule_version"],
                note=data.get("note", ""),
                signature=data.get("signature"),
            )
            self._events.append(event)
            self._current[event.artifact_id] = event

    def _append(self, event: ReviewEvent) -> ReviewEvent:
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")
            handle.flush()
        self._events.append(event)
        self._current[event.artifact_id] = event
        return event

    @staticmethod
    def _event_id(artifact_id: str, action: str, timestamp: str) -> str:
        import hashlib

        value = f"{artifact_id}:{action}:{timestamp}".encode("utf-8")
        return f"review-{hashlib.sha256(value).hexdigest()[:20]}"

    def require_review(
        self,
        artifact_id: str,
        *,
        stage: ReviewStage,
        input_hash: str,
        output_hash: str,
        manifest_hash: str,
        rule_version: str,
    ) -> ReviewEvent:
        current = self._current.get(artifact_id)
        if current:
            if (
                current.stage == stage
                and current.input_hash == input_hash
                and current.output_hash == output_hash
                and current.manifest_hash == manifest_hash
                and current.rule_version == rule_version
            ):
                return current
            raise InvalidReviewTransitionError(
                f"Artifact {artifact_id} already has incompatible review metadata."
            )
        timestamp = utc_now()
        return self._append(ReviewEvent(
            schema="medscale.review_event.v1",
            event_id=self._event_id(artifact_id, "require_review", timestamp),
            artifact_id=artifact_id,
            stage=stage,
            action="require_review",
            status=ReviewStatus.REVIEW_REQUIRED,
            actor="system",
            timestamp=timestamp,
            input_hash=input_hash,
            output_hash=output_hash,
            manifest_hash=manifest_hash,
            rule_version=rule_version,
            note="Artifact requires human review before downstream use.",
        ))

    def _decision(
        self,
        artifact_id: str,
        *,
        status: ReviewStatus,
        action: str,
        reviewer: str,
        note: str,
        signature: str,
    ) -> ReviewEvent:
        current = self._require_current(artifact_id)
        if current.status is not ReviewStatus.REVIEW_REQUIRED:
            raise InvalidReviewTransitionError(
                f"Cannot {action} artifact {artifact_id} from {current.status.value}."
            )
        if not reviewer.strip() or not signature.strip():
            raise InvalidReviewTransitionError(
                "Reviewer and signature are required for review decisions."
            )
        timestamp = utc_now()
        return self._append(ReviewEvent(
            schema="medscale.review_event.v1",
            event_id=self._event_id(artifact_id, action, timestamp),
            artifact_id=artifact_id,
            stage=current.stage,
            action=action,
            status=status,
            actor=reviewer,
            timestamp=timestamp,
            input_hash=current.input_hash,
            output_hash=current.output_hash,
            manifest_hash=current.manifest_hash,
            rule_version=current.rule_version,
            note=note,
            signature=signature,
        ))

    def approve(
        self,
        artifact_id: str,
        *,
        reviewer: str,
        note: str,
        signature: str,
    ) -> ReviewEvent:
        return self._decision(
            artifact_id,
            status=ReviewStatus.APPROVED,
            action="approve",
            reviewer=reviewer,
            note=note,
            signature=signature,
        )

    def reject(
        self,
        artifact_id: str,
        *,
        reviewer: str,
        note: str,
        signature: str,
    ) -> ReviewEvent:
        return self._decision(
            artifact_id,
            status=ReviewStatus.REJECTED,
            action="reject",
            reviewer=reviewer,
            note=note,
            signature=signature,
        )

    def request_revision(
        self,
        artifact_id: str,
        *,
        reviewer: str,
        note: str,
        signature: str,
    ) -> ReviewEvent:
        return self._decision(
            artifact_id,
            status=ReviewStatus.REVISION_REQUIRED,
            action="request_revision",
            reviewer=reviewer,
            note=note,
            signature=signature,
        )

    def invalidate(self, artifact_id: str, *, actor: str, reason: str) -> ReviewEvent:
        current = self._require_current(artifact_id)
        if current.status is ReviewStatus.INVALIDATED:
            return current
        timestamp = utc_now()
        return self._append(ReviewEvent(
            schema="medscale.review_event.v1",
            event_id=self._event_id(artifact_id, "invalidate", timestamp),
            artifact_id=artifact_id,
            stage=current.stage,
            action="invalidate",
            status=ReviewStatus.INVALIDATED,
            actor=actor,
            timestamp=timestamp,
            input_hash=current.input_hash,
            output_hash=current.output_hash,
            manifest_hash=current.manifest_hash,
            rule_version=current.rule_version,
            note=reason,
            signature=None,
        ))

    def _require_current(self, artifact_id: str) -> ReviewEvent:
        try:
            return self._current[artifact_id]
        except KeyError as exc:
            raise ReviewRequiredError(
                f"Artifact {artifact_id} has no review record."
            ) from exc

    def status(self, artifact_id: str) -> ReviewStatus:
        return self._require_current(artifact_id).status

    def stage(self, artifact_id: str) -> ReviewStage:
        return self._require_current(artifact_id).stage

    def output_hash(self, artifact_id: str) -> str:
        return self._require_current(artifact_id).output_hash

    def manifest_hash(self, artifact_id: str) -> str:
        return self._require_current(artifact_id).manifest_hash

    def require_approved(self, artifact_id: str) -> None:
        status = self.status(artifact_id)
        if status is not ReviewStatus.APPROVED:
            raise ReviewRequiredError(
                f"Artifact {artifact_id} is {status.value}, not approved."
            )

    def reopen(self, artifact_id: str, *, actor: str, note: str) -> ReviewEvent:
        current = self._require_current(artifact_id)
        if current.status not in {
            ReviewStatus.REJECTED,
            ReviewStatus.REVISION_REQUIRED,
            ReviewStatus.INVALIDATED,
        }:
            raise InvalidReviewTransitionError(
                f"Cannot reopen artifact {artifact_id} from {current.status.value}."
            )
        timestamp = utc_now()
        return self._append(ReviewEvent(
            schema="medscale.review_event.v1",
            event_id=self._event_id(artifact_id, "reopen", timestamp),
            artifact_id=artifact_id,
            stage=current.stage,
            action="reopen",
            status=ReviewStatus.REVIEW_REQUIRED,
            actor=actor,
            timestamp=timestamp,
            input_hash=current.input_hash,
            output_hash=current.output_hash,
            manifest_hash=current.manifest_hash,
            rule_version=current.rule_version,
            note=note,
            signature=None,
        ))
