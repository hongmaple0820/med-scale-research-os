"""Deterministic evidence gates for medical research stages.

These checks intentionally prefer a blocked result over an unsupported
conclusion. Search hits, heuristic fallbacks, positional sample grouping,
single-source differential expression, and uncited market/patent summaries are
not decision-grade evidence.
"""
from __future__ import annotations

from typing import Any


MIN_GROUP_SAMPLES = 3
MIN_TCGA_CONTROLS = 5
MIN_OVERLAP_GENES = 3
MIN_CONCORDANCE_RATE = 0.60


def _has_rows(value: Any) -> bool:
    return isinstance(value, (dict, list, tuple)) and len(value) > 0


def _stage_success(stage: dict | None) -> bool:
    return bool(isinstance(stage, dict) and stage.get("success"))


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


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


def _normalization_card_valid(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    card = value.get("method_card", value)
    if not isinstance(card, dict):
        return False

    source_methods = (
        card.get("source_methods")
        or card.get("per_source_methods")
        or card.get("source_normalization")
    )
    integration_strategy = (
        card.get("cross_source_strategy")
        or card.get("integration_strategy")
        or card.get("batch_correction")
    )
    return bool(source_methods and integration_strategy)


def _has_traceable_market_source(market: Any) -> bool:
    if not isinstance(market, dict):
        return False
    evidence_keys = ("evidence_records", "reports", "citations")
    if any(_has_rows(market.get(key)) for key in evidence_keys):
        return True
    total_records = market.get("total_records") or market.get("returned_records")
    try:
        return int(total_records) > 0 and _has_rows(market.get("source_urls"))
    except (TypeError, ValueError):
        return False


def evaluate_stage1_evidence(results: dict) -> dict:
    """Evaluate whether Stage 1 expression evidence is decision-grade."""
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
        "stage": "stage1_expression",
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
        "stage": "stage2_screening",
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


def evaluate_stage2_evidence(results: dict) -> dict:
    """Evaluate whether Stage 2 target-screening evidence is decision-grade."""
    stages = results.get("stages", {}) or {}
    geo_search = stages.get("geo_search", {}) or {}
    de_result = stages.get("differential_expression", {}) or {}
    cross_source = (
        de_result.get("cross_source_validation")
        or stages.get("cross_source_validation")
        or results.get("cross_source_validation")
        or {}
    )
    normalization = (
        de_result.get("normalization")
        or de_result.get("normalization_method_card")
        or stages.get("normalization")
        or results.get("normalization")
        or {}
    )

    issues: list[str] = []
    method = str(de_result.get("method") or "").lower()
    fallback_source = str(de_result.get("fallback_source") or "")
    filter_level = de_result.get("filter_level")

    if not _stage_success(de_result):
        issues.append("Differential-expression analysis did not succeed.")
    if not _has_rows(de_result.get("significant_genes")):
        issues.append("Differential-expression analysis produced no significant gene table.")
    if method == "positional":
        issues.append("Case/control groups were inferred by position, not sample metadata.")
    if filter_level not in (None, "strict"):
        issues.append("Differential-expression results use relaxed or nominal thresholds.")
    if "tcga" in method or "TCGA" in fallback_source:
        issues.append(
            "TCGA/FireBrowse fallback is single-source evidence, not independent validation."
        )
    if not _stage_success(geo_search):
        issues.append("GEO dataset discovery did not succeed.")

    cross_ok = bool(cross_source.get("decision_eligible"))
    if not cross_ok:
        issues.append(
            "No verified independent GEO-vs-TCGA replication evidence is attached."
        )
    else:
        issues.extend(cross_source.get("issues", []) or [])

    normalization_ok = _normalization_card_valid(normalization)
    if not normalization_ok:
        issues.append(
            "No normalization/integration method card explains per-source processing "
            "and cross-database comparison."
        )

    provenance = results.get("validation", {})
    if provenance.get("provenance_valid") is False:
        issues.append("Data provenance validation failed.")

    independent_sources = list(cross_source.get("independent_sources") or [])
    accession = de_result.get("accession") or geo_search.get("accession")
    if accession and accession not in independent_sources:
        independent_sources.append(str(accession))
    if fallback_source and fallback_source not in independent_sources:
        independent_sources.append(fallback_source)

    verified = not issues
    return {
        "stage": "stage2_screening",
        "status": "verified" if verified else "blocked",
        "confidence": (
            cross_source.get("confidence", "medium") if verified else "none"
        ),
        "decision_eligible": verified,
        "independent_sources": independent_sources,
        "checks": {
            "differential_expression_success": _stage_success(de_result),
            "strict_thresholds": filter_level in (None, "strict"),
            "metadata_grouping": method != "positional",
            "cross_source_replication": cross_ok,
            "normalization_method_card": normalization_ok,
            "geo_discovery_success": _stage_success(geo_search),
        },
        "issues": issues,
    }


def evaluate_stage3_evidence(results: dict) -> dict:
    """Evaluate whether Stage 3 deep-research evidence is decision-grade."""
    stages = results.get("stages", {}) or {}
    literature = stages.get("literature", {}) or {}
    clinical = stages.get("clinical_pipeline", {}) or {}
    competitive = stages.get("competitive_landscape", {}) or {}

    literature_data = literature.get("data", {}) or {}
    papers = _as_list(literature_data.get("papers"))
    search_results = literature_data.get("search_results", {}) or {}
    literature_traceable = _stage_success(literature) and (
        _has_rows(papers)
        or _has_rows(search_results)
        or bool(search_results.get("query"))
        or bool(search_results.get("total_count"))
    )

    clinical_data = clinical.get("data", {}) or {}
    clinical_traceable = _stage_success(clinical) and (
        "total_trials" in clinical_data
        or _has_rows(clinical_data.get("studies"))
        or _has_rows(clinical_data.get("source_records"))
    )

    competitive_data = competitive.get("data", {}) or {}
    sections = competitive_data.get("sections", {}) or {}
    patents = sections.get("patent_landscape") or competitive_data.get("patent_landscape")
    market = sections.get("market_analysis") or competitive_data.get("market_analysis")
    patent_traceable = isinstance(patents, dict) and (
        int(patents.get("total_patents") or 0) > 0
        or _has_rows(patents.get("recent_patents"))
        or _has_rows(patents.get("patents"))
    )
    market_traceable = _has_traceable_market_source(market)

    issues: list[str] = []
    if not literature_traceable:
        issues.append("PubMed literature evidence is missing or not traceable.")
    if not clinical_traceable:
        issues.append("ClinicalTrials.gov evidence is missing or not traceable.")
    if not patent_traceable:
        issues.append("Patent landscape evidence is missing or not traceable.")
    if not market_traceable:
        issues.append(
            "Market analysis lacks traceable sources such as reports, citations, "
            "source URLs, or evidence records."
        )

    provenance = results.get("validation", {})
    if provenance.get("provenance_valid") is False:
        issues.append("Data provenance validation failed.")

    verified = not issues
    valid_sources = []
    if literature_traceable:
        valid_sources.append("PubMed")
    if clinical_traceable:
        valid_sources.append("ClinicalTrials.gov")
    if patent_traceable:
        valid_sources.append("Patent source")
    if market_traceable:
        valid_sources.append("Market source")

    return {
        "stage": "stage3_deep_research",
        "status": "verified" if verified else "blocked",
        "confidence": "high" if verified else "none",
        "decision_eligible": verified,
        "valid_sources": valid_sources,
        "checks": {
            "literature_traceable": literature_traceable,
            "clinical_traceable": clinical_traceable,
            "patent_traceable": patent_traceable,
            "market_traceable": market_traceable,
        },
        "issues": issues,
    }
