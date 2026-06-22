"""Deterministic evidence gates for the medical research pipeline.

The checks prefer a blocked result over an unsupported conclusion. Search
hits, empty payloads, positional sample grouping, and single-source fallbacks
are not independent validation evidence.
"""
from __future__ import annotations

from typing import Any


MIN_GROUP_SAMPLES = 3
MIN_TCGA_CONTROLS = 5
MIN_OVERLAP_GENES = 3
MIN_CONCORDANCE_RATE = 0.60


def _has_rows(value: Any) -> bool:
    return isinstance(value, (dict, list, tuple)) and len(value) > 0


def evaluate_stage1_evidence(results: dict) -> dict:
    stages = results.get("stages", {}) or {}
    tissue = stages.get("tissue_expression", {}) or {}
    gtex = tissue.get("gtex", {}) or {}
    hpa = tissue.get("hpa", {}) or {}
    tumor = stages.get("tumor_expression", {}) or {}
    survival = stages.get("survival_analysis", {}) or {}
    immune = stages.get("immune_correlation", {}) or {}

    gtex_data = gtex.get("data", {}) or {}
    hpa_data = hpa.get("data", {}) or {}
    gtex_valid = bool(
        gtex.get("success")
        and gtex.get("valid", True)
        and _has_rows(gtex_data.get("tissues"))
    )
    hpa_valid = bool(
        hpa.get("success")
        and hpa.get("valid", True)
        and _has_rows(hpa_data.get("tissue_expression"))
    )

    valid_tumor_cohorts = []
    for cancer, block in (tumor.get("cancer_results", {}) or {}).items():
        data = (block or {}).get("data", {}) or {}
        if (
            (block or {}).get("success")
            and (block or {}).get("valid", True)
            and _has_rows(data.get("samples"))
        ):
            valid_tumor_cohorts.append(cancer)

    survival_valid = bool(survival.get("success"))
    immune_valid = bool(immune.get("success"))
    issues: list[str] = []

    if not gtex_valid:
        issues.append("GTEx normal-tissue expression is missing, empty, or invalid.")
    if not hpa_valid:
        issues.append("HPA protein-expression evidence is missing, empty, or invalid.")
    if not valid_tumor_cohorts:
        issues.append("No valid disease-matched TCGA tumor-expression cohort is available.")
    if not survival_valid:
        issues.append("Survival analysis did not produce a valid result.")
    if not immune_valid:
        issues.append("Immune-correlation analysis did not produce a valid result.")

    if not gtex_valid or not valid_tumor_cohorts:
        status = "blocked"
        confidence = "none"
    elif gtex_valid and hpa_valid and survival_valid and immune_valid:
        status = "verified"
        confidence = "high"
    elif gtex_valid and hpa_valid:
        status = "partial"
        confidence = "medium"
    else:
        status = "partial"
        confidence = "low"

    valid_sources = []
    if gtex_valid:
        valid_sources.append("GTEx")
    if hpa_valid:
        valid_sources.append("HPA")
    valid_sources.extend(f"TCGA-{code}" for code in valid_tumor_cohorts)

    return {
        "status": status,
        "confidence": confidence,
        "decision_eligible": status == "verified",
        "valid_sources": valid_sources,
        "valid_tumor_cohorts": valid_tumor_cohorts,
        "checks": {
            "gtex_valid": gtex_valid,
            "hpa_valid": hpa_valid,
            "tumor_expression_valid": bool(valid_tumor_cohorts),
            "survival_valid": survival_valid,
            "immune_correlation_valid": immune_valid,
        },
        "issues": issues,
    }


def _gene_key(item: dict) -> str:
    return str(item.get("gene_symbol") or item.get("gene") or "").strip().upper()


def _effect(item: dict) -> float | None:
    value = item.get("log2fc", item.get("log2_fold_change"))
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _gene_map(result: dict) -> dict[str, dict]:
    mapped: dict[str, dict] = {}
    for item in result.get("significant_genes", []) or []:
        if not isinstance(item, dict):
            continue
        gene = _gene_key(item)
        effect = _effect(item)
        if gene and effect is not None:
            mapped[gene] = item
    return mapped


def compare_de_sources(geo_result: dict, tcga_result: dict) -> dict:
    """Compare independently analyzed GEO and TCGA differential expression."""
    issues: list[str] = []

    if not geo_result.get("success"):
        issues.append("GEO differential-expression analysis did not succeed.")
    if geo_result.get("method") == "positional":
        issues.append("GEO case/control groups were inferred by position, not metadata.")
    if int(geo_result.get("disease_samples") or 0) < MIN_GROUP_SAMPLES:
        issues.append(f"GEO disease group has fewer than {MIN_GROUP_SAMPLES} samples.")
    if int(geo_result.get("control_samples") or 0) < MIN_GROUP_SAMPLES:
        issues.append(f"GEO control group has fewer than {MIN_GROUP_SAMPLES} samples.")
    if geo_result.get("filter_level") not in (None, "strict"):
        issues.append("GEO differential-expression results use relaxed or nominal thresholds.")

    if not tcga_result.get("success"):
        issues.append("TCGA differential-expression replication did not succeed.")
    if int(tcga_result.get("control_samples") or 0) < MIN_TCGA_CONTROLS:
        issues.append(f"TCGA control group has fewer than {MIN_TCGA_CONTROLS} samples.")

    geo_genes = _gene_map(geo_result)
    tcga_genes = _gene_map(tcga_result)
    overlap = sorted(set(geo_genes) & set(tcga_genes))
    concordant: list[dict] = []
    discordant: list[dict] = []

    for gene in overlap:
        geo_effect = _effect(geo_genes[gene])
        tcga_effect = _effect(tcga_genes[gene])
        if geo_effect is None or tcga_effect is None:
            continue
        record = {
            "gene": gene,
            "gene_symbol": gene,
            "log2fc": geo_effect,
            "p_value": geo_genes[gene].get("p_value"),
            "adjusted_p_value": geo_genes[gene].get("adjusted_p_value"),
            "replication": {
                "GEO": {
                    "accession": geo_result.get("accession"),
                    "log2fc": geo_effect,
                    "p_value": geo_genes[gene].get("p_value"),
                    "adjusted_p_value": geo_genes[gene].get("adjusted_p_value"),
                },
                "TCGA": {
                    "accession": tcga_result.get("accession"),
                    "log2fc": tcga_effect,
                    "p_value": tcga_genes[gene].get("p_value"),
                    "adjusted_p_value": tcga_genes[gene].get("adjusted_p_value"),
                },
            },
            "source_support": [
                str(geo_result.get("accession") or "GEO"),
                str(tcga_result.get("accession") or "TCGA"),
            ],
        }
        if (geo_effect > 0) == (tcga_effect > 0):
            concordant.append(record)
        else:
            discordant.append(record)

    overlap_count = len(overlap)
    concordance_rate = len(concordant) / overlap_count if overlap_count else 0.0
    if overlap_count < MIN_OVERLAP_GENES:
        issues.append(
            f"Only {overlap_count} overlapping significant genes; at least "
            f"{MIN_OVERLAP_GENES} are required."
        )
    if overlap_count and concordance_rate < MIN_CONCORDANCE_RATE:
        issues.append(
            f"Cross-source direction concordance is {concordance_rate:.1%}; "
            f"at least {MIN_CONCORDANCE_RATE:.0%} is required."
        )

    verified = not issues
    return {
        "status": "verified" if verified else "blocked",
        "confidence": (
            "high"
            if verified and overlap_count >= 10 and concordance_rate >= 0.80
            else "medium"
            if verified
            else "none"
        ),
        "decision_eligible": verified,
        "independent_sources": [
            str(geo_result.get("accession") or "GEO"),
            str(tcga_result.get("accession") or "TCGA"),
        ],
        "overlap_count": overlap_count,
        "concordant_count": len(concordant),
        "discordant_count": len(discordant),
        "concordance_rate": round(concordance_rate, 4),
        "validated_genes": concordant,
        "discordant_genes": discordant,
        "issues": issues,
    }
