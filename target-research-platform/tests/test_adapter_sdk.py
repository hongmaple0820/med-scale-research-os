from __future__ import annotations

import gzip
import hashlib
import io
import json
from pathlib import Path

import pytest

from src.research_os import (
    ArtifactIntegrityError,
    GeoReferenceControl,
    GeoSchemaDriftError,
    GeoSeriesMatrixAdapter,
    GeoSeriesMatrixInspector,
    LicenseScope,
    RangeDownloadResponse,
    ResumableHttpDownloader,
    ReviewLedger,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    SourceUnavailableError,
    ThreeLayerArtifactStore,
    geo_series_matrix_url,
)


def _matrix_bytes(
    *,
    accession: str = "GSE1",
    platform: str = "GPL7",
    series_type: str = "Expression profiling by array",
    rows: tuple[tuple[str, str, str], ...] = (
        ("probe-1", "1.0", "2.0"),
        ("probe-2", "3.0", "4.0"),
    ),
    include_end: bool = True,
) -> bytes:
    text = [
        f'!Series_geo_accession\t"{accession}"',
        f'!Series_type\t"{series_type}"',
        f'!Series_platform_id\t"{platform}"',
        "!series_matrix_table_begin",
        '"ID_REF"\t"GSM1"\t"GSM2"',
    ]
    text.extend(f'"{probe}"\t"{a}"\t"{b}"' for probe, a, b in rows)
    if include_end:
        text.append("!series_matrix_table_end")
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as handle:
        handle.write(("\n".join(text) + "\n").encode("utf-8"))
    return output.getvalue()


def _registry() -> SourceRegistry:
    registry = SourceRegistry()
    registry.register(SourceDefinition(
        source_id="ncbi-geo",
        name="NCBI Gene Expression Omnibus",
        authority="NCBI",
        version="2026-06",
        adapter_id="geo-series-matrix-v1",
        base_urls=("https://ftp.ncbi.nlm.nih.gov/geo/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research", "public_export"),
        status=SourceStatus.APPROVED,
    ))
    return registry


def _store(tmp_path: Path) -> ThreeLayerArtifactStore:
    return ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=ReviewLedger(tmp_path / "audit" / "reviews.jsonl"),
    )


def _control(content: bytes) -> GeoReferenceControl:
    profile = GeoSeriesMatrixInspector().inspect(content, expected_accession="GSE1")
    return GeoReferenceControl(
        schema="medscale.reference_control.v1",
        control_id="test-gse1-v1",
        source_id="ncbi-geo",
        accession="GSE1",
        filename="GSE1_series_matrix.txt.gz",
        url=geo_series_matrix_url("GSE1"),
        expected_size_bytes=len(content),
        expected_sha256=hashlib.sha256(content).hexdigest(),
        expected_profile=profile.to_dict(include_fingerprint=False),
        expected_schema_fingerprint=profile.schema_fingerprint,
        observed_at="2026-06-19T00:00:00+08:00",
        observation_note="test control",
        official_documentation=("https://www.ncbi.nlm.nih.gov/geo/info/download.html",),
    )


def test_resumable_download_continues_from_partial_file(tmp_path: Path):
    destination = tmp_path / "download.part"
    destination.write_bytes(b"authoritative ")
    requests: list[dict[str, str]] = []

    def fetch(_url: str, headers: dict[str, str]) -> RangeDownloadResponse:
        requests.append(dict(headers))
        return RangeDownloadResponse(
            status_code=206,
            content=b"bytes",
            headers={
                "Content-Range": "bytes 14-18/19",
                "Content-Length": "5",
            },
        )

    receipt = ResumableHttpDownloader(fetch=fetch).download(
        url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
        destination=destination,
        expected_size_bytes=19,
        expected_sha256=hashlib.sha256(b"authoritative bytes").hexdigest(),
    )

    assert requests == [{"User-Agent": "MedSCALE-Research-OS/1.0", "Range": "bytes=14-"}]
    assert destination.read_bytes() == b"authoritative bytes"
    assert receipt.resumed_from == 14
    assert receipt.response_status == 206


def test_resumable_download_restarts_when_server_ignores_range(tmp_path: Path):
    destination = tmp_path / "download.part"
    destination.write_bytes(b"stale partial")

    response = RangeDownloadResponse(
        status_code=200,
        content=b"complete",
        headers={"Content-Length": "8"},
    )
    receipt = ResumableHttpDownloader(fetch=lambda _url, _headers: response).download(
        url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
        destination=destination,
        expected_size_bytes=8,
        expected_sha256=hashlib.sha256(b"complete").hexdigest(),
    )

    assert destination.read_bytes() == b"complete"
    assert receipt.resumed_from == 0


def test_default_streaming_transport_preserves_bytes_after_interruption(
    tmp_path: Path,
):
    destination = tmp_path / "download.part"

    class InterruptedResponse:
        headers = {"Content-Length": "19"}

        def __init__(self):
            self.read_count = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getcode(self):
            return 200

        def read(self, _size: int):
            self.read_count += 1
            if self.read_count == 1:
                return b"authoritative "
            raise OSError("connection interrupted")

    downloader = ResumableHttpDownloader(
        open_url=lambda _request, timeout: InterruptedResponse()
    )
    with pytest.raises(OSError, match="interrupted"):
        downloader.download(
            url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
            destination=destination,
            expected_size_bytes=19,
            expected_sha256=hashlib.sha256(b"authoritative bytes").hexdigest(),
        )

    assert destination.read_bytes() == b"authoritative "


def test_default_streaming_transport_resumes_after_silent_short_read(
    tmp_path: Path,
):
    destination = tmp_path / "download.part"
    responses = [
        (200, b"authoritative ", {"Content-Length": "19"}),
        (
            206,
            b"bytes",
            {"Content-Range": "bytes 14-18/19", "Content-Length": "5"},
        ),
    ]
    requests = []

    class Response:
        def __init__(self, status, content, headers):
            self.status = status
            self.content = content
            self.headers = headers
            self.sent = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getcode(self):
            return self.status

        def read(self, _size):
            if self.sent:
                return b""
            self.sent = True
            return self.content

    def open_url(request, timeout):
        requests.append(dict(request.header_items()))
        return Response(*responses.pop(0))

    receipt = ResumableHttpDownloader(open_url=open_url).download(
        url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
        destination=destination,
        expected_size_bytes=19,
        expected_sha256=hashlib.sha256(b"authoritative bytes").hexdigest(),
    )

    assert destination.read_bytes() == b"authoritative bytes"
    assert requests[1]["Range"] == "bytes=14-"
    assert receipt.resumed_from == 14
    assert receipt.response_status == 206


@pytest.mark.parametrize(
    ("expected_size", "expected_sha", "message"),
    [
        (9, hashlib.sha256(b"complete").hexdigest(), "byte count"),
        (8, "0" * 64, "checksum"),
    ],
)
def test_resumable_download_blocks_size_or_checksum_mismatch(
    tmp_path: Path,
    expected_size: int,
    expected_sha: str,
    message: str,
):
    destination = tmp_path / "download.part"
    response = RangeDownloadResponse(
        status_code=200,
        content=b"complete",
        headers={"Content-Length": "8"},
    )

    with pytest.raises(ArtifactIntegrityError, match=message):
        ResumableHttpDownloader(fetch=lambda _url, _headers: response).download(
            url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
            destination=destination,
            expected_size_bytes=expected_size,
            expected_sha256=expected_sha,
        )


def test_geo_accession_builds_only_official_series_matrix_url():
    assert geo_series_matrix_url("GSE1") == (
        "https://ftp.ncbi.nlm.nih.gov/geo/series/"
        "GSEnnn/GSE1/matrix/GSE1_series_matrix.txt.gz"
    )
    assert geo_series_matrix_url("GSE12345") == (
        "https://ftp.ncbi.nlm.nih.gov/geo/series/"
        "GSE12nnn/GSE12345/matrix/GSE12345_series_matrix.txt.gz"
    )
    for invalid in ("gse1", "GSE", "GSE1/../../x", "GDS1"):
        with pytest.raises(SourceUnavailableError):
            geo_series_matrix_url(invalid)


def test_series_matrix_inspector_records_deterministic_schema_profile():
    content = _matrix_bytes()
    profile = GeoSeriesMatrixInspector().inspect(content, expected_accession="GSE1")

    assert profile.accession == "GSE1"
    assert profile.series_types == ("Expression profiling by array",)
    assert profile.platform_ids == ("GPL7",)
    assert profile.sample_count == 2
    assert profile.data_row_count == 2
    assert profile.markers == {
        "table_begin": True,
        "table_end": True,
        "id_ref": True,
    }
    assert profile.schema_fingerprint == hashlib.sha256(
        json.dumps(
            profile.to_dict(include_fingerprint=False),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def test_series_matrix_inspector_blocks_invalid_or_mismatched_input():
    inspector = GeoSeriesMatrixInspector()

    with pytest.raises(GeoSchemaDriftError, match="gzip"):
        inspector.inspect(b"not gzip", expected_accession="GSE1")
    with pytest.raises(GeoSchemaDriftError, match="accession"):
        inspector.inspect(_matrix_bytes(accession="GSE2"), expected_accession="GSE1")
    with pytest.raises(GeoSchemaDriftError, match="table_end"):
        inspector.inspect(_matrix_bytes(include_end=False), expected_accession="GSE1")


def test_geo_schema_drift_blocks_ingestion(tmp_path: Path):
    expected = _matrix_bytes()
    changed = _matrix_bytes(platform="GPL999")
    control = _control(expected)
    response = RangeDownloadResponse(
        status_code=200,
        content=changed,
        headers={"Content-Length": str(len(changed)), "Content-Type": "application/x-gzip"},
    )
    adapter = GeoSeriesMatrixAdapter(
        store=_store(tmp_path),
        downloader=ResumableHttpDownloader(fetch=lambda _url, _headers: response),
    )

    drifted_control = GeoReferenceControl(
        **{
            **control.to_dict(),
            "expected_size_bytes": len(changed),
            "expected_sha256": hashlib.sha256(changed).hexdigest(),
        }
    )
    with pytest.raises(GeoSchemaDriftError, match="schema fingerprint"):
        adapter.download_control(
            project_id="project-1",
            control=drifted_control,
            download_dir=tmp_path / "downloads",
        )

    assert not list((tmp_path / "workspace").glob("**/manifests/*.json"))


def test_geo_reference_adapter_ingests_verified_bytes_and_removes_partial(tmp_path: Path):
    content = _matrix_bytes()
    control = _control(content)
    response = RangeDownloadResponse(
        status_code=200,
        content=content,
        headers={
            "Content-Length": str(len(content)),
            "Content-Type": "application/x-gzip",
            "Last-Modified": "Fri, 19 Jun 2026 00:00:00 GMT",
        },
    )
    adapter = GeoSeriesMatrixAdapter(
        store=_store(tmp_path),
        downloader=ResumableHttpDownloader(fetch=lambda _url, _headers: response),
    )

    artifact = adapter.download_control(
        project_id="project-1",
        control=control,
        download_dir=tmp_path / "downloads",
    )

    assert artifact.stable_record_ids == ("GSE1",)
    assert artifact.retrieval["reference_control"]["control_id"] == "test-gse1-v1"
    assert artifact.retrieval["schema_profile"]["accession"] == "GSE1"
    assert artifact.retrieval["schema_profile"]["schema_fingerprint"] == (
        control.expected_schema_fingerprint
    )
    assert artifact.retrieval["temporary_download_removed_after_ingest"] is True
    assert not (tmp_path / "downloads" / "GSE1_series_matrix.txt.gz.part").exists()
