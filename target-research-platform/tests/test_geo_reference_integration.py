from __future__ import annotations

from pathlib import Path

import pytest

from src.research_os import (
    GeoReferenceControl,
    GeoSeriesMatrixAdapter,
    LicenseScope,
    ResumableHttpDownloader,
    ReviewLedger,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    ThreeLayerArtifactStore,
)


@pytest.mark.integration
def test_live_gse1_reference_control(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    control = GeoReferenceControl.load(
        root / "config" / "reference_controls" / "ncbi_geo_gse1_v1.json"
    )
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
    store = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=registry,
        reviews=ReviewLedger(tmp_path / "audit" / "reviews.jsonl"),
    )

    artifact = GeoSeriesMatrixAdapter(
        store=store,
        downloader=ResumableHttpDownloader(),
    ).download_control(
        project_id="live-gse1-reference",
        control=control,
        download_dir=tmp_path / "downloads",
    )

    assert artifact.sha256 == control.expected_sha256
    assert artifact.size_bytes == control.expected_size_bytes
    assert artifact.retrieval["schema_profile"]["schema_fingerprint"] == (
        control.expected_schema_fingerprint
    )
