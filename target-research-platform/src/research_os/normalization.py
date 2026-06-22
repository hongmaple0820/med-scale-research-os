"""Deterministic normalization suitability assessments for admitted source files."""
from __future__ import annotations

import gzip
import io
import json
import math
from typing import Any

from .artifacts import ArtifactLayer, ArtifactManifest, ThreeLayerArtifactStore
from .geo import GeoSchemaDriftError, GeoSeriesMatrixInspector
from .governance import ReviewStage


def _percentile(sorted_values: list[float], percentile: float) -> float | None:
    if not sorted_values:
        return None
    position = (len(sorted_values) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    fraction = position - lower
    return (
        sorted_values[lower] * (1 - fraction)
        + sorted_values[upper] * fraction
    )


def _metadata_values(line: str) -> list[str]:
    return [
        value.strip().strip('"')
        for value in line.rstrip("\r\n").split("\t")[1:]
    ]


class GeoNormalizationAssessor:
    """Create a method card without performing biological normalization."""

    METHOD_CARD_ID = "geo-series-matrix-normalization-assessment-v1"

    def __init__(self) -> None:
        self.inspector = GeoSeriesMatrixInspector()

    def assess(
        self,
        content: bytes,
        *,
        artifact_id: str,
        expected_accession: str,
        intended_role: str,
    ) -> dict[str, Any]:
        structural_profile = self.inspector.inspect(
            content,
            expected_accession=expected_accession,
        )
        sample_sources: list[str] = []
        processing_values: list[str] = []
        values: list[float] = []
        missing_values = 0
        in_table = False

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
                        if line.startswith("!Sample_source_name_ch1\t"):
                            sample_sources.extend(_metadata_values(line))
                            continue
                        if line.startswith("!Sample_data_processing\t"):
                            processing_values.extend(_metadata_values(line))
                            continue
                        if line == "!series_matrix_table_begin":
                            in_table = True
                            continue
                        if line == "!series_matrix_table_end":
                            break
                        if not in_table or not line:
                            continue
                        columns = line.split("\t")
                        if columns[0].strip('"') == "ID_REF":
                            continue
                        for raw_value in columns[1:]:
                            text = raw_value.strip().strip('"')
                            try:
                                value = float(text)
                            except ValueError:
                                missing_values += 1
                                continue
                            if math.isfinite(value):
                                values.append(value)
                            else:
                                missing_values += 1
        except (EOFError, OSError) as exc:
            raise GeoSchemaDriftError(
                "GEO Series Matrix became unreadable during normalization assessment."
            ) from exc

        sorted_values = sorted(values)
        finite_count = len(values)
        total_count = finite_count + missing_values
        negative_fraction = (
            sum(value < 0 for value in values) / finite_count
            if finite_count
            else 0.0
        )
        processing_nonempty = sum(bool(value.strip()) for value in processing_values)
        processing_denominator = (
            structural_profile.sample_count
            if structural_profile.sample_count
            else len(processing_values)
        )
        processing_fraction = (
            processing_nonempty / processing_denominator
            if processing_denominator
            else 0.0
        )
        unique_sources = sorted({
            source.strip()
            for source in sample_sources
            if source.strip()
        })
        scale_classification = (
            "centered_processed_values"
            if negative_fraction >= 0.01
            else "nonnegative_values_requires_source_method_review"
        )

        block_reasons: list[dict[str, str]] = []
        if intended_role == "adapter_structural_control":
            block_reasons.append({
                "code": "CONTROL_NOT_RESEARCH_COHORT",
                "message": (
                    "A fixed adapter structural control cannot be promoted into a "
                    "disease-analysis cohort."
                ),
            })
        if negative_fraction >= 0.01:
            block_reasons.append({
                "code": "ALREADY_CENTERED_VALUES",
                "message": (
                    "Material negative values indicate an already processed or "
                    "centered scale; log2 transformation is prohibited."
                ),
            })
        if processing_fraction < 1.0:
            block_reasons.append({
                "code": "INCOMPLETE_PROCESSING_METADATA",
                "message": (
                    "Per-sample processing metadata is incomplete, so the submitted "
                    "normalization cannot be reproduced from this file alone."
                ),
            })
        if len(unique_sources) > 1:
            block_reasons.append({
                "code": "HETEROGENEOUS_SAMPLE_SOURCES",
                "message": (
                    "Multiple source labels are present; automatic case/control "
                    "assignment is prohibited."
                ),
            })
        block_reasons.append({
            "code": "PROBE_MAPPING_NOT_ADMITTED",
            "message": (
                "Matrix rows use platform probe IDs. A versioned GPL annotation "
                "mapping must be admitted before gene-level comparison."
            ),
        })

        return {
            "schema": "medscale.normalization_method_card.v1",
            "method_card_id": self.METHOD_CARD_ID,
            "rule_version": "1.0.0",
            "input": {
                "artifact_id": artifact_id,
                "accession": expected_accession,
                "intended_role": intended_role,
            },
            "source_format": {
                "container": "gzip",
                "matrix_format": "GEO Series Matrix",
                "assay_types": list(structural_profile.series_types),
                "identifier_level": "platform_probe_id",
            },
            "metadata": {
                "platform_ids": list(structural_profile.platform_ids),
                "sample_count": structural_profile.sample_count,
                "data_row_count": structural_profile.data_row_count,
                "unique_sample_sources": unique_sources,
                "processing_metadata_nonempty_count": processing_nonempty,
                "processing_metadata_nonempty_fraction": processing_fraction,
            },
            "numeric_diagnostics": {
                "finite_values": finite_count,
                "missing_values": missing_values,
                "missing_fraction": (
                    missing_values / total_count if total_count else 0.0
                ),
                "minimum": sorted_values[0] if sorted_values else None,
                "p01": _percentile(sorted_values, 0.01),
                "p25": _percentile(sorted_values, 0.25),
                "median": _percentile(sorted_values, 0.50),
                "p75": _percentile(sorted_values, 0.75),
                "p99": _percentile(sorted_values, 0.99),
                "maximum": sorted_values[-1] if sorted_values else None,
                "negative_fraction": negative_fraction,
            },
            "scale_assessment": {
                "classification": scale_classification,
                "proposed_transform": "none",
            },
            "standardization": {
                "within_source": "blocked",
                "cross_source": "blocked",
                "reason": (
                    "No normalized matrix is created until the processing method, "
                    "cohort design, and platform mapping are independently admitted."
                ),
            },
            "decision": {
                "status": "blocked",
                "normalized_matrix_created": False,
                "block_reasons": block_reasons,
            },
            "prohibited_actions": [
                "log2_transform",
                "quantile_normalize_again",
                "automatic_case_control_assignment",
                "gene_level_cross_source_comparison",
                "target_screening",
            ],
            "required_next_inputs": [
                "versioned GPL7 probe-to-gene annotation",
                "complete source processing documentation",
                "project cohort with explicit human-reviewed groups",
                "project-level positive control",
            ],
        }

    def store_assessment(
        self,
        *,
        store: ThreeLayerArtifactStore,
        project_id: str,
        raw_artifact_id: str,
        assessment: dict[str, Any],
    ) -> ArtifactManifest:
        accession = assessment["input"]["accession"]
        content = (
            json.dumps(
                assessment,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        return store.derive(
            project_id=project_id,
            layer=ArtifactLayer.ANALYSIS,
            filename=f"{accession}_normalization_assessment.json",
            content=content,
            parent_artifact_ids=(raw_artifact_id,),
            producer={
                "name": "geo-normalization-assessor",
                "version": "1.0.0",
                "parameters": {
                    "decision_mode": "deterministic-fail-closed",
                    "creates_normalized_matrix": False,
                },
            },
            method_card_id=self.METHOD_CARD_ID,
            media_type="application/json",
            review_stage=ReviewStage.NORMALIZATION,
        )
