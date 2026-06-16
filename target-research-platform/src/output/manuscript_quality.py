"""
Quality gate for generated manuscript deliverables.

The gate is intentionally evidence-based: it checks files that were actually
written to disk and flags unverifiable submission claims before the draft is
shown as delivery-ready.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .usage_envelope import collect_usage_envelopes, summarize_usage_envelopes


REQUIRED_MARKDOWN_SECTIONS = (
    "## 摘要",
    "## 1 引言",
    "## 2 材料与方法",
    "## 3 结果",
    "### 3.6.1 逐篇文献深度解读",
    "## 4 讨论",
    "## 5 结论",
    "## 参考文献",
)

PROHIBITED_MARKDOWN_PHRASES = (
    "LLM：None",
    "LLM: None",
)

PROHIBITED_JOURNAL_CLAIMS = (
    "国家自然科学基金",
    "不存在利益冲突",
    "免予伦理审查",
)

PROHIBITED_SUBMISSION_READY_CLAIMS = (
    "可直接投稿",
    "投稿级终稿",
    "无需人工审校",
    "无需专家审稿",
    "submission-ready",
)


def _read_text(path: str | None) -> str:
    if not path:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8")
    except Exception:
        return ""


def _path_exists(path: str | None) -> bool:
    return bool(path) and Path(path).exists()


def _file_nonempty(path: str | None, min_bytes: int = 1) -> bool:
    return bool(path) and Path(path).is_file() and Path(path).stat().st_size >= min_bytes


def _read_json(path: str | None) -> dict[str, Any]:
    if not path or not Path(path).is_file():
        return {}
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _add_check(
    checks: list[dict[str, Any]],
    check_id: str,
    passed: bool,
    *,
    severity: str = "error",
    message: str,
    evidence: Any = None,
) -> None:
    checks.append(
        {
            "id": check_id,
            "passed": bool(passed),
            "severity": severity,
            "message": message,
            "evidence": evidence,
        }
    )


def validate_manuscript_delivery(result: dict[str, Any]) -> dict[str, Any]:
    """Validate a generated manuscript result and return a machine-readable gate."""
    paths = result.get("paths") or {}
    markdown_path = paths.get("markdown")
    zhongliu_path = paths.get("zhongliu")
    metadata_path = paths.get("metadata")
    fact_check_path = paths.get("fact_check")
    delivery_manifest_path = paths.get("delivery_manifest")
    docx_path = paths.get("docx")
    figures_dir = paths.get("figures_dir")
    figures = result.get("figures") or []
    reviews = result.get("literature_reviews") or {}

    markdown = _read_text(markdown_path)
    zhongliu = _read_text(zhongliu_path)
    metadata = _read_json(metadata_path)
    fact_check = result.get("fact_check") if isinstance(result.get("fact_check"), dict) else _read_json(fact_check_path)
    delivery_manifest = _read_json(delivery_manifest_path)
    usage_envelopes = collect_usage_envelopes(metadata)
    checks: list[dict[str, Any]] = []

    _add_check(
        checks,
        "result.success",
        bool(result.get("success")),
        message="Manuscript generator reported success.",
        evidence=result.get("success"),
    )
    _add_check(
        checks,
        "artifact.markdown_exists",
        _file_nonempty(markdown_path, 1024),
        message="Chinese IMRaD markdown exists and is non-empty.",
        evidence=markdown_path,
    )
    _add_check(
        checks,
        "artifact.zhongliu_exists",
        _file_nonempty(zhongliu_path, 1024),
        message="Zhonghua Oncology formatted markdown exists and is non-empty.",
        evidence=zhongliu_path,
    )
    _add_check(
        checks,
        "artifact.metadata_exists",
        _file_nonempty(metadata_path, 16),
        message="Manuscript metadata JSON exists.",
        evidence=metadata_path,
    )
    _add_check(
        checks,
        "artifact.fact_check_exists",
        _file_nonempty(fact_check_path, 16),
        message="Manuscript fact-check report exists.",
        evidence=fact_check_path,
    )
    _add_check(
        checks,
        "delivery.manifest_exists",
        _file_nonempty(delivery_manifest_path, 16),
        message="Delivery manifest exists for the researcher package.",
        evidence=delivery_manifest_path,
    )
    _add_check(
        checks,
        "artifact.docx_exists",
        _file_nonempty(docx_path, 1024),
        severity="warning",
        message="Word draft exists; warning only because DOCX rendering is optional in minimal environments.",
        evidence=docx_path,
    )
    _add_check(
        checks,
        "artifact.figures_dir_exists",
        _path_exists(figures_dir) and Path(figures_dir).is_dir(),
        message="Figures directory exists.",
        evidence=figures_dir,
    )

    missing_sections = [section for section in REQUIRED_MARKDOWN_SECTIONS if section not in markdown]
    _add_check(
        checks,
        "structure.required_sections",
        not missing_sections,
        message="Markdown contains the required journal manuscript sections.",
        evidence={"missing": missing_sections},
    )

    char_count = int(result.get("char_count") or len(markdown))
    _add_check(
        checks,
        "content.minimum_length",
        char_count >= 3000,
        message="Manuscript has enough body text for a substantive draft.",
        evidence={"char_count": char_count, "minimum": 3000},
    )
    bad_markdown = [phrase for phrase in PROHIBITED_MARKDOWN_PHRASES if phrase in markdown]
    _add_check(
        checks,
        "content.no_llm_none",
        not bad_markdown,
        message="Markdown must not expose internal placeholder values such as LLM: None.",
        evidence={"found": bad_markdown},
    )

    bad_claims = [phrase for phrase in PROHIBITED_JOURNAL_CLAIMS if phrase in zhongliu]
    _add_check(
        checks,
        "journal.no_unverified_claims",
        not bad_claims,
        message="Journal template must not assert unverified fund, conflict, or ethics claims.",
        evidence={"found": bad_claims},
    )
    submission_ready_claims = [
        phrase for phrase in PROHIBITED_SUBMISSION_READY_CLAIMS
        if phrase.lower() in markdown.lower() or phrase.lower() in zhongliu.lower()
    ]
    _add_check(
        checks,
        "journal.no_submission_ready_claim",
        not submission_ready_claims,
        message="Draft must not claim it is submission-ready or expert-reviewed.",
        evidence={"found": submission_ready_claims},
    )
    _add_check(
        checks,
        "journal.zhongliu_format",
        "中华肿瘤杂志" in zhongliu and "【摘要】" in zhongliu,
        message="Zhonghua Oncology wrapper contains journal marker and structured abstract marker.",
        evidence=zhongliu_path,
    )

    review_count = int(reviews.get("count") or 0)
    source_counts = reviews.get("source_counts") or {}
    _add_check(
        checks,
        "literature.review_sources",
        review_count > 0 and bool(source_counts),
        message="Literature reviews include source accounting for traceability.",
        evidence={"count": review_count, "source_counts": source_counts},
    )
    expert_like_reviews = (
        int(source_counts.get("agent_cache") or 0)
        + int(source_counts.get("openai") or 0)
        + int(source_counts.get("scale_local") or 0)
    )
    expert_like_ratio = expert_like_reviews / review_count if review_count else 0
    _add_check(
        checks,
        "literature.agent_or_llm_ratio",
        review_count > 0 and expert_like_ratio >= 0.5,
        severity="warning",
        message="At least half of literature reviews should come from Agent cache or an LLM provider for Beta delivery.",
        evidence={"ratio": round(expert_like_ratio, 3), "source_counts": source_counts},
    )
    llm_provider_reviews = int(source_counts.get("openai") or 0) + int(source_counts.get("scale_local") or 0)
    _add_check(
        checks,
        "token_usage.envelope_present",
        llm_provider_reviews == 0 or len(usage_envelopes) >= llm_provider_reviews,
        severity="warning",
        message="LLM-backed literature reviews should expose MedSCALE usage envelopes for token/cost accounting.",
        evidence={"llm_provider_reviews": llm_provider_reviews, "usage_envelopes": len(usage_envelopes)},
    )
    references = metadata.get("references") if isinstance(metadata, dict) else []
    reference_count = len(references) if isinstance(references, list) else int(result.get("reference_count") or 0)
    _add_check(
        checks,
        "references.minimum_count",
        reference_count >= 5,
        severity="warning",
        message="Researcher-facing manuscripts should include at least five traceable references.",
        evidence={"reference_count": reference_count, "minimum": 5},
    )

    figure_files = []
    missing_figures = []
    for figure in figures:
        path = figure.get("path")
        if _file_nonempty(path, 128):
            figure_files.append(path)
        else:
            missing_figures.append(path)
    _add_check(
        checks,
        "figures.files_exist",
        len(figure_files) == len(figures) and len(figures) > 0,
        message="All registered figure files exist and are non-empty.",
        evidence={"figures": len(figures), "missing": missing_figures},
    )
    figure_refs_missing = []
    for idx, figure in enumerate(figures, start=1):
        tokens = [f"图{idx}", f"图 {idx}", f"Figure {idx}", str(figure.get("relative") or "")]
        if not any(token and token in markdown for token in tokens):
            figure_refs_missing.append(figure.get("id") or idx)
    _add_check(
        checks,
        "figures.referenced_in_text",
        len(figures) > 0 and not figure_refs_missing,
        severity="warning",
        message="Registered figures should be referenced in the manuscript body.",
        evidence={"missing": figure_refs_missing},
    )
    _add_check(
        checks,
        "figures.publication_set",
        len(figures) >= 4,
        severity="warning",
        message="A full publication draft should include at least four manuscript figures.",
        evidence={"figures": len(figures), "minimum": 4},
    )

    metadata_ok = bool(metadata.get("target") and metadata.get("disease"))
    _add_check(
        checks,
        "metadata.readable",
        metadata_ok,
        message="Metadata JSON is readable and includes target/disease.",
        evidence=metadata_path,
    )
    trace_sources = []
    if isinstance(metadata.get("data_sources"), list):
        trace_sources.extend(metadata.get("data_sources") or [])
    enrichment = metadata.get("literature_enrichment") if isinstance(metadata, dict) else {}
    if isinstance(enrichment, dict):
        trace_sources.extend(enrichment.get("sources") or [])
    has_literature_enrichment = False
    if isinstance(enrichment, dict):
        has_literature_enrichment = bool(enrichment.get("sources")) or any(
            [
                enrichment.get("pubmed_efetch"),
                enrichment.get("openalex_used"),
                enrichment.get("aminer_used"),
                int(enrichment.get("mesh_count") or 0) > 0,
                int(enrichment.get("citation_count_available") or 0) > 0,
            ]
        )
    _add_check(
        checks,
        "metadata.source_traceability",
        bool(trace_sources) and reference_count > 0,
        message="Metadata includes data sources and references for traceability.",
        evidence={"data_sources": trace_sources, "reference_count": reference_count},
    )
    _add_check(
        checks,
        "literature.enrichment_coverage",
        has_literature_enrichment,
        severity="warning",
        message="Literature metadata should include PubMed MeSH or citation enrichment for Beta delivery.",
        evidence=enrichment,
    )
    _add_check(
        checks,
        "fact_check.passed",
        bool(fact_check.get("passed")),
        message="Manuscript fact-check report passed without hard errors.",
        evidence={
            "score": fact_check.get("score"),
            "errors": fact_check.get("errors"),
            "warnings": fact_check.get("warnings"),
        },
    )
    _add_check(
        checks,
        "delivery.manifest_files",
        bool(delivery_manifest.get("files")),
        severity="warning",
        message="Delivery manifest should list package files with hashes.",
        evidence={"file_count": len(delivery_manifest.get("files") or [])},
    )
    disclaimer = str(result.get("disclaimer") or "")
    boundary_text = markdown + "\n" + zhongliu + "\n" + disclaimer
    _add_check(
        checks,
        "review.boundary_statement_present",
        any(token in boundary_text for token in ("投稿前", "专家", "伦理", "not a submission-ready", "does not replace")),
        message="Draft includes visible boundaries requiring human review before submission.",
        evidence={"disclaimer": bool(disclaimer)},
    )

    error_failures = [
        check for check in checks
        if check["severity"] == "error" and not check["passed"]
    ]
    warning_failures = [
        check for check in checks
        if check["severity"] == "warning" and not check["passed"]
    ]
    score = max(0, 100 - len(error_failures) * 20 - len(warning_failures) * 5)
    if error_failures:
        grade = "D"
    elif len(warning_failures) >= 3:
        grade = "C"
    elif warning_failures:
        grade = "B"
    else:
        grade = "A"
    return {
        "passed": len(error_failures) == 0,
        "score": score,
        "grade": grade,
        "errors": len(error_failures),
        "warnings": len(warning_failures),
        "usage_summary": summarize_usage_envelopes(usage_envelopes),
        "checks": checks,
    }
