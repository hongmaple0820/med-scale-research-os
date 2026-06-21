"""Immutable artifact manifests and local three-layer storage."""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass, replace
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

from .governance import (
    LicenseViolationError,
    LicenseScope,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    ReviewStatus,
    SourceRegistry,
    utc_now,
)


class ArtifactError(RuntimeError):
    """Base class for artifact storage failures."""


class ArtifactIntegrityError(ArtifactError):
    """Raised when bytes do not match their manifest."""


class PathBoundaryError(ArtifactError):
    """Raised when a requested path escapes the project workspace."""


class ArtifactLayer(str, Enum):
    RAW = "raw"
    NORMALIZED = "normalized"
    ANALYSIS = "analysis"


_SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9._ -]+$")


def _validate_component(value: str, *, label: str) -> str:
    if (
        not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or not _SAFE_COMPONENT.fullmatch(value)
    ):
        raise PathBoundaryError(f"Unsafe {label}: {value!r}")
    return value


@dataclass(frozen=True)
class ArtifactManifest:
    schema: str
    artifact_id: str
    project_id: str
    layer: ArtifactLayer
    source_id: str
    source_ids: tuple[str, ...]
    stable_record_ids: tuple[str, ...]
    retrieval: dict[str, Any]
    license: dict[str, Any]
    sha256: str
    size_bytes: int
    media_type: str
    producer: dict[str, Any]
    parent_artifact_ids: tuple[str, ...]
    method_card_id: str | None
    relative_path: str
    absolute_path: str
    manifest_path: str
    created_at: str
    review_status: ReviewStatus

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["layer"] = self.layer.value
        payload["review_status"] = self.review_status.value
        payload["source_ids"] = list(self.source_ids)
        payload["stable_record_ids"] = list(self.stable_record_ids)
        payload["parent_artifact_ids"] = list(self.parent_artifact_ids)
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ArtifactManifest":
        return cls(
            schema=payload["schema"],
            artifact_id=payload["artifact_id"],
            project_id=payload["project_id"],
            layer=ArtifactLayer(payload["layer"]),
            source_id=payload["source_id"],
            source_ids=tuple(payload.get("source_ids") or (payload["source_id"],)),
            stable_record_ids=tuple(payload.get("stable_record_ids") or ()),
            retrieval=dict(payload.get("retrieval") or {}),
            license=dict(payload.get("license") or {}),
            sha256=payload["sha256"],
            size_bytes=int(payload["size_bytes"]),
            media_type=payload["media_type"],
            producer=dict(payload.get("producer") or {}),
            parent_artifact_ids=tuple(payload.get("parent_artifact_ids") or ()),
            method_card_id=payload.get("method_card_id"),
            relative_path=payload["relative_path"],
            absolute_path=payload["absolute_path"],
            manifest_path=payload["manifest_path"],
            created_at=payload["created_at"],
            review_status=ReviewStatus(payload["review_status"]),
        )


class ThreeLayerArtifactStore:
    """Local raw/normalized/analysis store with lineage and review enforcement."""

    _LAYER_STAGE = {
        ArtifactLayer.RAW: ReviewStage.ACQUISITION,
        ArtifactLayer.NORMALIZED: ReviewStage.NORMALIZATION,
        ArtifactLayer.ANALYSIS: ReviewStage.SCREENING,
    }

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
        self._manifests: dict[str, ArtifactManifest] = {}
        self._load_manifests()

    @staticmethod
    def sha256_bytes(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    @staticmethod
    def manifest_hash(payload: dict[str, Any]) -> str:
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    def _load_manifests(self) -> None:
        for path in self.root.glob("*/manifests/*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                manifest = ArtifactManifest.from_dict(payload)
                project_root = self._project_root(manifest.project_id)
                artifact_path = (project_root / manifest.relative_path).resolve()
                if (
                    artifact_path != project_root
                    and project_root not in artifact_path.parents
                ):
                    raise PathBoundaryError(
                        f"Manifest path escapes project: {manifest.relative_path}"
                    )
                manifest = replace(
                    manifest,
                    absolute_path=str(artifact_path),
                    manifest_path=str(path.resolve()),
                )
            except (
                OSError,
                KeyError,
                TypeError,
                ValueError,
                json.JSONDecodeError,
                PathBoundaryError,
            ):
                continue
            self._manifests[manifest.artifact_id] = manifest

    def _project_root(self, project_id: str) -> Path:
        safe_project = _validate_component(project_id, label="project_id")
        return self._inside_root(self.root / safe_project)

    def _inside_root(self, path: Path) -> Path:
        resolved = path.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise PathBoundaryError(f"Path escapes workspace: {path}")
        return resolved

    @staticmethod
    def _artifact_id(
        *,
        project_id: str,
        layer: ArtifactLayer,
        content_hash: str,
        source_ids: Iterable[str],
        parents: Iterable[str],
        method_card_id: str | None,
        producer: dict[str, Any],
        stable_record_ids: Iterable[str],
    ) -> str:
        canonical = json.dumps({
            "project_id": project_id,
            "layer": layer.value,
            "sha256": content_hash,
            "source_ids": sorted(source_ids),
            "parents": sorted(parents),
            "method_card_id": method_card_id,
            "producer": producer,
            "stable_record_ids": sorted(stable_record_ids),
        }, sort_keys=True, separators=(",", ":"))
        return f"msa-{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}"

    @staticmethod
    def _input_hash(parents: Iterable[ArtifactManifest]) -> str:
        joined = ":".join(sorted(parent.sha256 for parent in parents))
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def _write(
        self,
        *,
        project_id: str,
        layer: ArtifactLayer,
        filename: str,
        content: bytes,
        source_id: str,
        source_ids: tuple[str, ...],
        stable_record_ids: tuple[str, ...],
        retrieval: dict[str, Any],
        license_payload: dict[str, Any],
        media_type: str,
        producer: dict[str, Any],
        parent_artifact_ids: tuple[str, ...],
        method_card_id: str | None,
        stage: ReviewStage,
        input_hash: str,
        rule_version: str,
    ) -> ArtifactManifest:
        safe_filename = _validate_component(filename, label="filename")
        project_root = self._project_root(project_id)
        content_hash = self.sha256_bytes(content)
        artifact_id = self._artifact_id(
            project_id=project_id,
            layer=layer,
            content_hash=content_hash,
            source_ids=source_ids,
            parents=parent_artifact_ids,
            method_card_id=method_card_id,
            producer=producer,
            stable_record_ids=stable_record_ids,
        )
        existing = self._manifests.get(artifact_id)
        if existing:
            if not self.verify(artifact_id):
                raise ArtifactIntegrityError(
                    f"Existing artifact {artifact_id} failed integrity verification."
                )
            return existing

        layer_dir = self._inside_root(project_root / layer.value)
        manifest_dir = self._inside_root(project_root / "manifests")
        layer_dir.mkdir(parents=True, exist_ok=True)
        manifest_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = self._inside_root(layer_dir / f"{artifact_id}-{safe_filename}")
        manifest_path = self._inside_root(manifest_dir / f"{artifact_id}.json")

        tmp_path = self._inside_root(layer_dir / f".{artifact_id}.tmp")
        tmp_path.write_bytes(content)
        if self.sha256_bytes(tmp_path.read_bytes()) != content_hash:
            tmp_path.unlink(missing_ok=True)
            raise ArtifactIntegrityError("Written bytes do not match the computed hash.")
        os.replace(tmp_path, artifact_path)

        manifest = ArtifactManifest(
            schema="medscale.artifact_manifest.v1",
            artifact_id=artifact_id,
            project_id=project_id,
            layer=layer,
            source_id=source_id,
            source_ids=source_ids,
            stable_record_ids=stable_record_ids,
            retrieval=retrieval,
            license=license_payload,
            sha256=content_hash,
            size_bytes=len(content),
            media_type=media_type,
            producer=producer,
            parent_artifact_ids=parent_artifact_ids,
            method_card_id=method_card_id,
            relative_path=artifact_path.relative_to(project_root).as_posix(),
            absolute_path=str(artifact_path),
            manifest_path=str(manifest_path),
            created_at=utc_now(),
            review_status=ReviewStatus.REVIEW_REQUIRED,
        )
        manifest_payload = manifest.to_dict()
        manifest_digest = self.manifest_hash(manifest_payload)
        manifest_tmp_path = self._inside_root(
            manifest_dir / f".{artifact_id}.manifest.tmp"
        )
        manifest_tmp_path.write_text(
            json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(manifest_tmp_path, manifest_path)
        self._manifests[artifact_id] = manifest
        try:
            self.reviews.require_review(
                artifact_id,
                stage=stage,
                input_hash=input_hash,
                output_hash=content_hash,
                manifest_hash=manifest_digest,
                rule_version=rule_version,
            )
        except Exception:
            self._manifests.pop(artifact_id, None)
            manifest_path.unlink(missing_ok=True)
            artifact_path.unlink(missing_ok=True)
            raise
        return manifest

    def ingest_raw(
        self,
        *,
        project_id: str,
        source_id: str,
        filename: str,
        content: bytes,
        stable_record_ids: tuple[str, ...],
        retrieval: dict[str, Any],
        media_type: str,
    ) -> ArtifactManifest:
        source = self.registry.require_approved(source_id, use="research")
        license_payload = {
            "scope": source.license_scope.value,
            "allowed_uses": list(source.allowed_uses),
            "public_export_allowed": (
                source.license_scope is LicenseScope.PUBLIC
                and "public_export" in source.allowed_uses
            ),
        }
        content_hash = self.sha256_bytes(content)
        return self._write(
            project_id=project_id,
            layer=ArtifactLayer.RAW,
            filename=filename,
            content=content,
            source_id=source_id,
            source_ids=(source_id,),
            stable_record_ids=tuple(stable_record_ids),
            retrieval=dict(retrieval),
            license_payload=license_payload,
            media_type=media_type,
            producer={
                "name": source.adapter_id,
                "version": source.version,
                "parameters": {},
            },
            parent_artifact_ids=(),
            method_card_id=None,
            stage=ReviewStage.ACQUISITION,
            input_hash=content_hash,
            rule_version=f"source-admission:{source.version}",
        )

    def derive(
        self,
        *,
        project_id: str,
        layer: ArtifactLayer,
        filename: str,
        content: bytes,
        parent_artifact_ids: tuple[str, ...],
        producer: dict[str, Any],
        method_card_id: str,
        media_type: str,
        review_stage: ReviewStage | None = None,
    ) -> ArtifactManifest:
        if layer is ArtifactLayer.RAW:
            raise ArtifactError("Use ingest_raw() for raw artifacts.")
        if not parent_artifact_ids:
            raise ArtifactError("Derived artifacts require at least one parent.")
        parents = tuple(self.get(artifact_id) for artifact_id in parent_artifact_ids)
        for parent in parents:
            self.reviews.require_approved(parent.artifact_id)
            if not self.verify(parent.artifact_id):
                raise ArtifactIntegrityError(
                    f"Parent artifact {parent.artifact_id} failed integrity verification."
                )

        source_ids = tuple(sorted({
            source_id
            for parent in parents
            for source_id in parent.source_ids
        }))
        stable_record_ids = tuple(sorted({
            record_id
            for parent in parents
            for record_id in parent.stable_record_ids
        }))
        restricted = any(
            parent.license.get("scope") == LicenseScope.RESTRICTED.value
            for parent in parents
        )
        public_export_allowed = all(
            bool(parent.license.get("public_export_allowed"))
            for parent in parents
        )
        stage = review_stage or self._LAYER_STAGE[layer]
        return self._write(
            project_id=project_id,
            layer=layer,
            filename=filename,
            content=content,
            source_id=source_ids[0] if len(source_ids) == 1 else "multiple",
            source_ids=source_ids,
            stable_record_ids=stable_record_ids,
            retrieval={"derived_from": list(parent_artifact_ids)},
            license_payload={
                "scope": (
                    LicenseScope.RESTRICTED.value
                    if restricted
                    else LicenseScope.PUBLIC.value
                ),
                "public_export_allowed": public_export_allowed,
            },
            media_type=media_type,
            producer=dict(producer),
            parent_artifact_ids=tuple(parent_artifact_ids),
            method_card_id=method_card_id,
            stage=stage,
            input_hash=self._input_hash(parents),
            rule_version=method_card_id,
        )

    def get(self, artifact_id: str) -> ArtifactManifest:
        try:
            return self._manifests[artifact_id]
        except KeyError as exc:
            raise ArtifactError(f"Unknown artifact: {artifact_id}") from exc

    def read_bytes(self, artifact_id: str) -> bytes:
        manifest = self.get(artifact_id)
        content = Path(manifest.absolute_path).read_bytes()
        if self.sha256_bytes(content) != manifest.sha256:
            raise ArtifactIntegrityError(
                f"Artifact {artifact_id} bytes do not match its manifest."
            )
        return content

    def verify(self, artifact_id: str) -> bool:
        manifest = self.get(artifact_id)
        path = Path(manifest.absolute_path)
        if not path.is_file() or path.stat().st_size != manifest.size_bytes:
            return False
        content_hash = self.sha256_bytes(path.read_bytes())
        if content_hash != manifest.sha256:
            return False
        try:
            manifest_path = Path(manifest.manifest_path)
            if not manifest_path.is_file():
                return False
            manifest_payload = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            return (
                self.reviews.output_hash(artifact_id) == manifest.sha256
                and self.reviews.manifest_hash(artifact_id)
                == self.manifest_hash(manifest_payload)
            )
        except (OSError, TypeError, ValueError, ReviewRequiredError):
            return False

    def reopen_review(self, artifact_id: str, *, actor: str, note: str) -> None:
        if not self.verify(artifact_id):
            raise ArtifactIntegrityError(
                f"Artifact {artifact_id} cannot be reopened because integrity failed."
            )
        self.reviews.reopen(artifact_id, actor=actor, note=note)

    def require_public_export(self, artifact_id: str) -> None:
        manifest = self.get(artifact_id)
        if not manifest.license.get("public_export_allowed", False):
            raise LicenseViolationError(
                f"Artifact {artifact_id} is not allowed in public exports."
            )
        for source_id in manifest.source_ids:
            self.registry.require_public_export(source_id)

    def invalidate_from(
        self,
        artifact_id: str,
        *,
        actor: str,
        reason: str,
    ) -> list[str]:
        self.get(artifact_id)
        descendants: dict[str, set[str]] = {}
        for manifest in self._manifests.values():
            for parent_id in manifest.parent_artifact_ids:
                descendants.setdefault(parent_id, set()).add(manifest.artifact_id)

        ordered: list[str] = []
        queue = [artifact_id]
        seen: set[str] = set()
        while queue:
            current = queue.pop(0)
            if current in seen:
                continue
            seen.add(current)
            ordered.append(current)
            queue.extend(sorted(descendants.get(current, ())))

        for current in ordered:
            self.reviews.invalidate(current, actor=actor, reason=reason)
        return ordered
