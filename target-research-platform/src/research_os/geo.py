"""NCBI GEO Series Matrix reference adapter and deterministic schema inspection."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .artifacts import ArtifactIntegrityError, ArtifactManifest, ThreeLayerArtifactStore
from .governance import SourceUnavailableError
from .transport import ResumableHttpDownloader


class GeoSchemaDriftError(ArtifactIntegrityError):
    """Raised when a GEO file no longer matches the admitted schema/control."""


_GSE_ACCESSION = re.compile(r"^GSE([1-9]\d*)$")


def geo_series_matrix_url(accession: str) -> str:
    """Build the official NCBI HTTPS Series Matrix path for a strict GSE accession."""
    match = _GSE_ACCESSION.fullmatch(accession)
    if not match:
        raise SourceUnavailableError(
            f"Unsupported GEO Series accession: {accession!r}"
        )
    digits = match.group(1)
    series_directory = f"GSE{digits[:-3]}nnn"
    return (
        "https://ftp.ncbi.nlm.nih.gov/geo/series/"
        f"{series_directory}/{accession}/matrix/"
        f"{accession}_series_matrix.txt.gz"
    )


@dataclass(frozen=True)
class GeoSeriesMatrixProfile:
    accession: str
    series_types: tuple[str, ...]
    platform_ids: tuple[str, ...]
    sample_count: int
    data_row_count: int
    markers: dict[str, bool]
    schema_fingerprint: str

    def to_dict(self, *, include_fingerprint: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "accession": self.accession,
            "series_types": list(self.series_types),
            "platform_ids": list(self.platform_ids),
            "sample_count": self.sample_count,
            "data_row_count": self.data_row_count,
            "markers": dict(self.markers),
        }
        if include_fingerprint:
            payload["schema_fingerprint"] = self.schema_fingerprint
        return payload


class GeoSeriesMatrixInspector:
    """Read only structural Series Matrix metadata; perform no biological inference."""

    def inspect(
        self,
        content: bytes,
        *,
        expected_accession: str,
    ) -> GeoSeriesMatrixProfile:
        geo_series_matrix_url(expected_accession)
        metadata: dict[str, list[str]] = {}
        markers = {
            "table_begin": False,
            "table_end": False,
            "id_ref": False,
        }
        in_table = False
        sample_count = 0
        data_row_count = 0
        expected_columns: int | None = None

        try:
            with gzip.GzipFile(fileobj=io.BytesIO(content), mode="rb") as compressed:
                with io.TextIOWrapper(
                    compressed,
                    encoding="utf-8",
                    errors="replace",
                    newline=None,
                ) as handle:
                    for raw_line in handle:
                        line = raw_line.rstrip("\r\n")
                        if line.startswith((
                            "!Series_geo_accession",
                            "!Series_type",
                            "!Series_platform_id",
                        )):
                            key, _, value = line.partition("\t")
                            metadata.setdefault(key, []).append(value.strip('"'))
                            continue
                        if line == "!series_matrix_table_begin":
                            markers["table_begin"] = True
                            in_table = True
                            continue
                        if line == "!series_matrix_table_end":
                            markers["table_end"] = True
                            in_table = False
                            continue
                        if not in_table or not line:
                            continue
                        columns = line.split("\t")
                        first = columns[0].strip('"')
                        if first == "ID_REF":
                            markers["id_ref"] = True
                            sample_count = len(columns) - 1
                            expected_columns = len(columns)
                            continue
                        if line.startswith(("!", "#")):
                            continue
                        if expected_columns is not None and len(columns) != expected_columns:
                            raise GeoSchemaDriftError(
                                "Series Matrix data row width differs from the ID_REF header."
                            )
                        data_row_count += 1
        except GeoSchemaDriftError:
            raise
        except (EOFError, OSError) as exc:
            raise GeoSchemaDriftError(
                "GEO Series Matrix is not a valid complete gzip stream."
            ) from exc

        accessions = tuple(metadata.get("!Series_geo_accession", ()))
        if accessions != (expected_accession,):
            raise GeoSchemaDriftError(
                "GEO Series Matrix accession does not match the requested accession."
            )
        for marker, present in markers.items():
            if not present:
                raise GeoSchemaDriftError(
                    f"GEO Series Matrix is missing required marker {marker}."
                )
        if sample_count < 1 or data_row_count < 1:
            raise GeoSchemaDriftError(
                "GEO Series Matrix contains no usable samples or data rows."
            )

        profile_payload = {
            "accession": expected_accession,
            "series_types": list(metadata.get("!Series_type", ())),
            "platform_ids": list(metadata.get("!Series_platform_id", ())),
            "sample_count": sample_count,
            "data_row_count": data_row_count,
            "markers": markers,
        }
        canonical = json.dumps(
            profile_payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return GeoSeriesMatrixProfile(
            accession=expected_accession,
            series_types=tuple(profile_payload["series_types"]),
            platform_ids=tuple(profile_payload["platform_ids"]),
            sample_count=sample_count,
            data_row_count=data_row_count,
            markers=markers,
            schema_fingerprint=hashlib.sha256(canonical).hexdigest(),
        )


@dataclass(frozen=True)
class GeoReferenceControl:
    schema: str
    control_id: str
    source_id: str
    accession: str
    filename: str
    url: str
    expected_size_bytes: int
    expected_sha256: str
    expected_profile: dict[str, Any]
    expected_schema_fingerprint: str
    observed_at: str
    observation_note: str
    official_documentation: tuple[str, ...] | list[str]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["official_documentation"] = list(self.official_documentation)
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "GeoReferenceControl":
        if payload.get("schema") != "medscale.reference_control.v1":
            raise GeoSchemaDriftError("Unsupported reference control schema.")
        return cls(
            schema=payload["schema"],
            control_id=payload["control_id"],
            source_id=payload["source_id"],
            accession=payload["accession"],
            filename=payload["filename"],
            url=payload["url"],
            expected_size_bytes=int(payload["expected_size_bytes"]),
            expected_sha256=payload["expected_sha256"],
            expected_profile=dict(payload["expected_profile"]),
            expected_schema_fingerprint=payload["expected_schema_fingerprint"],
            observed_at=payload["observed_at"],
            observation_note=payload["observation_note"],
            official_documentation=tuple(payload.get("official_documentation") or ()),
        )

    @classmethod
    def load(cls, path: str | Path) -> "GeoReferenceControl":
        return cls.from_dict(
            json.loads(Path(path).read_text(encoding="utf-8"))
        )


class GeoSeriesMatrixAdapter:
    """Verify one controlled GEO Series Matrix before raw artifact ingestion."""

    def __init__(
        self,
        *,
        store: ThreeLayerArtifactStore,
        downloader: ResumableHttpDownloader,
        inspector: GeoSeriesMatrixInspector | None = None,
    ) -> None:
        self.store = store
        self.downloader = downloader
        self.inspector = inspector or GeoSeriesMatrixInspector()

    def download_control(
        self,
        *,
        project_id: str,
        control: GeoReferenceControl,
        download_dir: str | Path,
    ) -> ArtifactManifest:
        expected_url = geo_series_matrix_url(control.accession)
        expected_filename = f"{control.accession}_series_matrix.txt.gz"
        if control.source_id != "ncbi-geo":
            raise SourceUnavailableError(
                f"Unsupported GEO reference source: {control.source_id}"
            )
        if control.url != expected_url or control.filename != expected_filename:
            raise SourceUnavailableError(
                "GEO reference control does not use the canonical official path."
            )
        self.store.registry.require_url(control.source_id, control.url)

        directory = Path(download_dir).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        partial_path = directory / f"{expected_filename}.part"
        receipt = self.downloader.download(
            url=control.url,
            destination=partial_path,
            expected_size_bytes=control.expected_size_bytes,
            expected_sha256=control.expected_sha256,
        )
        content = partial_path.read_bytes()
        profile = self.inspector.inspect(
            content,
            expected_accession=control.accession,
        )
        if profile.schema_fingerprint != control.expected_schema_fingerprint:
            raise GeoSchemaDriftError(
                "GEO Series Matrix schema fingerprint differs from the fixed control."
            )
        if profile.to_dict(include_fingerprint=False) != control.expected_profile:
            raise GeoSchemaDriftError(
                "GEO Series Matrix schema profile differs from the fixed control."
            )

        media_type = receipt.response_headers.get(
            "content-type",
            "application/x-gzip",
        ).split(";", 1)[0].strip()
        artifact = self.store.ingest_raw(
            project_id=project_id,
            source_id=control.source_id,
            filename=control.filename,
            content=content,
            stable_record_ids=(control.accession,),
            retrieval={
                "url": control.url,
                "query": {"accession": control.accession},
                "download_receipt": receipt.to_dict(),
                "schema_profile": profile.to_dict(),
                "reference_control": control.to_dict(),
                "control_passed": True,
                "temporary_download_removed_after_ingest": True,
            },
            media_type=media_type,
        )
        partial_path.unlink(missing_ok=True)
        return artifact
