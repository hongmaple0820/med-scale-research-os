from __future__ import annotations

import gzip
import io
import json
from pathlib import Path

from src.research_os import (
    ArtifactLayer,
    GeoNormalizationAssessor,
    LicenseScope,
    ReviewLedger,
    ReviewStage,
    ReviewStatus,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    ThreeLayerArtifactStore,
)


def _matrix_bytes() -> bytes:
    lines = [
        '!Series_geo_accession\t"GSE1"',
        '!Series_type\t"Expression profiling by array"',
        '!Series_platform_id\t"GPL7"',
        '!Sample_title\t"Tumor A"\t"Fibroblast control"',
        '!Sample_source_name_ch1\t"melanoma"\t"fibroblast"',
        '!Sample_data_processing\t""\t"quantile normalized"',
        "!series_matrix_table_begin",
        '"ID_REF"\t"GSM1"\t"GSM2"',
        '"probe-1"\t"-0.5"\t"0.5"',
        '"probe-2"\t"0.0"\t"NA"',
        "!series_matrix_table_end",
    ]
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as handle:
        handle.write(("\n".join(lines) + "\n").encode("utf-8"))
    return output.getvalue()


def _store(tmp_path: Path) -> tuple[ThreeLayerArtifactStore, ReviewLedger]:
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
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    return (
        ThreeLayerArtifactStore(
            tmp_path / "workspace",
            registry=registry,
            reviews=reviews,
        ),
        reviews,
    )


def test_assessment_blocks_structural_control_and_prohibits_double_log():
    assessment = GeoNormalizationAssessor().assess(
        _matrix_bytes(),
        artifact_id="raw-1",
        expected_accession="GSE1",
        intended_role="adapter_structural_control",
    )

    assert assessment["decision"]["status"] == "blocked"
    assert assessment["decision"]["normalized_matrix_created"] is False
    assert assessment["scale_assessment"]["classification"] == (
        "centered_processed_values"
    )
    assert "log2_transform" in assessment["prohibited_actions"]
    assert "automatic_case_control_assignment" in assessment["prohibited_actions"]
    assert "gene_level_cross_source_comparison" in assessment["prohibited_actions"]


def test_assessment_records_format_metadata_and_numeric_diagnostics():
    assessment = GeoNormalizationAssessor().assess(
        _matrix_bytes(),
        artifact_id="raw-1",
        expected_accession="GSE1",
        intended_role="adapter_structural_control",
    )

    assert assessment["schema"] == "medscale.normalization_method_card.v1"
    assert assessment["source_format"]["container"] == "gzip"
    assert assessment["source_format"]["matrix_format"] == "GEO Series Matrix"
    assert assessment["source_format"]["identifier_level"] == "platform_probe_id"
    assert assessment["metadata"]["platform_ids"] == ["GPL7"]
    assert assessment["metadata"]["sample_count"] == 2
    assert assessment["metadata"]["unique_sample_sources"] == [
        "fibroblast",
        "melanoma",
    ]
    assert assessment["metadata"]["processing_metadata_nonempty_fraction"] == 0.5
    assert assessment["numeric_diagnostics"]["missing_values"] == 1
    assert assessment["numeric_diagnostics"]["negative_fraction"] == 1 / 3


def test_assessment_is_analysis_artifact_at_normalization_review_gate(
    tmp_path: Path,
):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="GSE1_series_matrix.txt.gz",
        content=_matrix_bytes(),
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://ftp.ncbi.nlm.nih.gov/geo/file.gz"},
        media_type="application/x-gzip",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Acquisition approved.",
        signature="test:acquisition-approved",
    )
    assessor = GeoNormalizationAssessor()
    report = assessor.assess(
        store.read_bytes(raw.artifact_id),
        artifact_id=raw.artifact_id,
        expected_accession="GSE1",
        intended_role="adapter_structural_control",
    )

    artifact = assessor.store_assessment(
        store=store,
        project_id="project-1",
        raw_artifact_id=raw.artifact_id,
        assessment=report,
    )

    assert artifact.layer is ArtifactLayer.ANALYSIS
    assert artifact.method_card_id == "geo-series-matrix-normalization-assessment-v1"
    assert reviews.stage(artifact.artifact_id) is ReviewStage.NORMALIZATION
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED
    assert json.loads(store.read_bytes(artifact.artifact_id))["decision"]["status"] == (
        "blocked"
    )
    assert not list((tmp_path / "workspace").glob("**/normalized/*"))
