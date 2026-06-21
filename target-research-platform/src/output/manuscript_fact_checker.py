"""Fact checks for generated manuscript drafts.

This layer is deliberately conservative. It does not claim expert medical
review; it checks whether manuscript claims are traceable to the generated
metadata, references, figures, and declared evidence boundaries.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .usage_envelope import collect_usage_envelopes, summarize_usage_envelopes


PROHIBITED_BOUNDARY_PHRASES = (
    "可直接用于临床",
    "直接用于临床",
    "已证明优于标准治疗",
    "证实优于标准治疗",
    "证实疗效",
    "无需伦理审批",
    "免予伦理审查",
    "不存在利益冲突",
    "国家自然科学基金",
)

REVIEW_TERMS = ("review", "综述")
SYSTEMATIC_TERMS = ("systematic review", "meta-analysis", "meta analysis", "meta分析", "meta 分析", "系统综述", "Meta")
CLINICAL_TERMS = ("clinical trial", "randomized", "phase", "患者", "临床")
PRECLINICAL_TERMS = ("cell", "mouse", "mice", "xenograft", "体外", "小鼠", "临床前")
KNOWN_DISEASE_MARKERS = {
    "breast cancer": ("breast cancer", "乳腺癌", "hr+"),
    "lung cancer": ("lung cancer", "肺癌"),
    "colorectal cancer": ("colorectal cancer", "结直肠癌"),
    "prostate cancer": ("prostate cancer", "前列腺癌"),
    "pancreatic cancer": ("pancreatic cancer", "胰腺癌"),
}


def _read_text(path: str | None) -> str:
    if not path:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8")
    except Exception:
        return ""


def _read_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(term.lower() in lowered for term in terms)


def _contains_study_marker(text: str, terms: tuple[str, ...]) -> bool:
    lowered = text.lower()
    for term in terms:
        marker = term.lower()
        if marker == "meta":
            if re.search(r"(?<![a-z0-9])meta(?![a-z0-9])", lowered):
                return True
            continue
        if re.fullmatch(r"[a-z]+", marker):
            if re.search(rf"(?<![a-z0-9]){re.escape(marker)}(?![a-z0-9])", lowered):
                return True
            continue
        if marker in lowered:
            return True
    return False


def _looks_like_pmid(value: Any) -> bool:
    return bool(re.fullmatch(r"\d{1,9}", str(value or "").strip()))


def _add_issue(
    issues: list[dict[str, Any]],
    issue_id: str,
    severity: str,
    message: str,
    *,
    evidence: Any = None,
) -> None:
    issues.append({
        "id": issue_id,
        "severity": severity,
        "message": message,
        "evidence": evidence,
    })


def _reference_by_pmid(references: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for ref in references:
        pmid = str(ref.get("pmid") or "").strip()
        if pmid:
            out[pmid] = ref
    return out


def _expected_numeric_claims(metadata: dict[str, Any]) -> list[tuple[str, Any]]:
    clinical = metadata.get("clinical_summary") or {}
    milestones = metadata.get("milestones") or {}
    claims = [
        ("target_druggability", metadata.get("target_druggability")),
        ("pubmed_total", metadata.get("pubmed_total")),
        ("clinical_total_trials", clinical.get("total_trials")),
        ("clinical_active_trials", clinical.get("active_trials")),
        ("development_success_rate", milestones.get("success_rate")),
        ("development_total_duration", milestones.get("total_duration")),
        ("development_total_cost", milestones.get("total_cost")),
    ]
    return [(name, value) for name, value in claims if value not in (None, "", [])]


def _number_tokens(value: Any) -> set[str]:
    tokens: set[str] = set()
    if isinstance(value, float):
        tokens.add(f"{value:.3f}".rstrip("0").rstrip("."))
        tokens.add(str(round(value, 3)))
        tokens.add(str(value))
        if 0 < value < 1:
            tokens.add(f"{value * 100:.1f}".rstrip("0").rstrip("."))
    else:
        tokens.add(str(value))
    return {token for token in tokens if token and token != "None"}


def _check_literature(
    metadata: dict[str, Any],
    issues: list[dict[str, Any]],
) -> tuple[int, int]:
    reviews = metadata.get("literature_reviews") or []
    references = metadata.get("references") or []
    if not isinstance(reviews, list):
        reviews = []
    if not isinstance(references, list):
        references = []

    refs_by_pmid = _reference_by_pmid(references)
    checked = 0
    supported = 0
    for review in reviews:
        if not isinstance(review, dict):
            continue
        checked += 1
        pmid = str(review.get("pmid") or "").strip()
        title = str(review.get("title") or "").strip()
        year = str(review.get("year") or "").strip()
        journal = str(review.get("journal") or "").strip()
        design = str(review.get("study_design") or "")
        publication_types = " ".join(str(item) for item in (review.get("publication_types") or []))
        evidence_text = " ".join([title, publication_types])

        if not _looks_like_pmid(pmid):
            _add_issue(issues, "literature.pmid_missing", "error", "Literature review has missing or invalid PMID.", evidence=review.get("index"))
            continue
        if pmid not in refs_by_pmid:
            _add_issue(issues, "literature.reference_missing", "error", "Reviewed PMID is missing from references.", evidence=pmid)
        else:
            ref_text = _norm(refs_by_pmid[pmid].get("citation_zh")) + " " + _norm(refs_by_pmid[pmid].get("citation_en"))
            if title and _norm(title)[:40] not in ref_text:
                _add_issue(issues, "literature.title_mismatch", "warning", "Reviewed title is not traceable in reference text.", evidence=pmid)
            if year and year not in ref_text:
                _add_issue(issues, "literature.year_mismatch", "warning", "Reviewed year is not traceable in reference text.", evidence=pmid)
            if journal and _norm(journal)[:24] not in ref_text:
                _add_issue(issues, "literature.journal_mismatch", "warning", "Reviewed journal is not traceable in reference text.", evidence=pmid)
            supported += 1

        if _contains_study_marker(evidence_text, SYSTEMATIC_TERMS) and not _contains_study_marker(design, ("系统", "Meta", "meta", "综述")):
            _add_issue(issues, "study_design.systematic_mismatch", "error", "Systematic review/meta-analysis is not labeled as such.", evidence=pmid)
        elif _contains_any(evidence_text, REVIEW_TERMS) and not _contains_any(design, ("综述", "review", "Meta", "系统")):
            _add_issue(issues, "study_design.review_mismatch", "warning", "Review article is not labeled as a review.", evidence=pmid)
        elif _contains_any(evidence_text, CLINICAL_TERMS) and _contains_any(design, PRECLINICAL_TERMS):
            _add_issue(issues, "study_design.clinical_preclinical_mismatch", "error", "Clinical evidence appears mislabeled as preclinical.", evidence=pmid)

    if checked == 0:
        _add_issue(issues, "literature.none_checked", "error", "No literature reviews available for fact checking.")
    return checked, supported


def _check_figures(
    metadata: dict[str, Any],
    markdown: str,
    issues: list[dict[str, Any]],
) -> int:
    figures = metadata.get("figures") or []
    if not isinstance(figures, list):
        figures = []
    checked = 0
    for index, figure in enumerate(figures, start=1):
        if not isinstance(figure, dict):
            continue
        checked += 1
        path = figure.get("path")
        relative = str(figure.get("relative") or "")
        if not path or not Path(path).is_file() or Path(path).stat().st_size <= 128:
            _add_issue(issues, "figures.file_missing", "error", "Registered figure file is missing or empty.", evidence=path)
        label_variants = (f"图{index}", f"图 {index}", f"Figure {index}", relative)
        if not any(token and token in markdown for token in label_variants):
            _add_issue(issues, "figures.not_referenced", "warning", "Registered figure is not referenced in manuscript text.", evidence=figure.get("id") or index)
    if checked == 0:
        _add_issue(issues, "figures.none_checked", "error", "No figures available for fact checking.")
    return checked


def _check_contamination(
    metadata: dict[str, Any],
    markdown: str,
    issues: list[dict[str, Any]],
) -> None:
    target = str(metadata.get("target") or "").strip()
    disease = str(metadata.get("disease") or "").strip().lower()
    lowered = markdown.lower()

    if target and target.lower() not in lowered:
        _add_issue(
            issues,
            "contamination.target_missing",
            "error",
            "Requested target is not visible in the manuscript.",
            evidence=target,
        )
    if target.upper() != "CDK4" and re.search(r"(?<![A-Z0-9])CDK4(?:/6)?(?![A-Z0-9])", markdown, re.I):
        _add_issue(
            issues,
            "contamination.target_template",
            "error",
            "Unexpected CDK4/CDK4-6 template content is present for another target.",
            evidence=target,
        )

    for known_disease, markers in KNOWN_DISEASE_MARKERS.items():
        if known_disease == disease:
            continue
        found = [marker for marker in markers if marker.lower() in lowered]
        if found:
            _add_issue(
                issues,
                "contamination.disease_template",
                "error",
                "Manuscript contains disease-template content unrelated to the requested disease.",
                evidence={"requested": disease, "unexpected": known_disease, "markers": found},
            )

    expected_cohorts = {
        str(code).strip().upper()
        for code in (metadata.get("cancer_types") or [])
        if str(code).strip()
    }
    observed_cohorts = {
        match.upper()
        for match in re.findall(r"\bTCGA-([A-Z0-9]+)\b", markdown, flags=re.I)
    }
    unexpected = sorted(observed_cohorts - expected_cohorts) if expected_cohorts else []
    if unexpected:
        _add_issue(
            issues,
            "contamination.tcga_cohort",
            "error",
            "Manuscript cites TCGA cohorts not declared by upstream evidence.",
            evidence={
                "expected": sorted(expected_cohorts),
                "unexpected": unexpected,
            },
        )


def _check_claim_ledger(
    metadata: dict[str, Any],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    ledger = metadata.get("claim_ledger") or []
    if not isinstance(ledger, list):
        ledger = []
    by_id = {
        str(item.get("claim_id")): item
        for item in ledger
        if isinstance(item, dict) and item.get("claim_id")
    }
    for claim_id, value in _expected_numeric_claims(metadata):
        entry = by_id.get(claim_id)
        if not entry:
            _add_issue(
                issues,
                "claim_ledger.missing",
                "error",
                "Quantitative claim is missing from the claim ledger.",
                evidence={"claim": claim_id, "value": value},
            )
            continue
        if not str(entry.get("source_locator") or "").strip():
            _add_issue(
                issues,
                "claim_ledger.source_missing",
                "error",
                "Quantitative claim lacks a source locator.",
                evidence=claim_id,
            )
    return ledger


def validate_manuscript_facts(result: dict[str, Any]) -> dict[str, Any]:
    """Return a machine-readable fact-check report for a manuscript result."""
    paths = result.get("paths") or {}
    markdown = _read_text(paths.get("markdown"))
    metadata = _read_json(paths.get("metadata"))
    issues: list[dict[str, Any]] = []
    claims_checked = 0

    if not markdown:
        _add_issue(issues, "manuscript.markdown_missing", "error", "Markdown manuscript is missing or unreadable.")
    if not metadata:
        _add_issue(issues, "metadata.missing", "error", "Manuscript metadata is missing or unreadable.")

    checked_lit, supported_lit = _check_literature(metadata, issues)
    checked_figures = _check_figures(metadata, markdown, issues)
    _check_contamination(metadata, markdown, issues)
    claim_ledger = _check_claim_ledger(metadata, issues)
    claims_checked += checked_lit + checked_figures

    numeric_mismatches: list[dict[str, Any]] = []
    for name, value in _expected_numeric_claims(metadata):
        claims_checked += 1
        tokens = _number_tokens(value)
        if not any(token in markdown for token in tokens):
            mismatch = {"claim": name, "expected": value}
            numeric_mismatches.append(mismatch)
            _add_issue(issues, "numeric.not_traceable", "warning", "Expected numeric value is not visible in manuscript text.", evidence=mismatch)

    unverified_claims = []
    for phrase in PROHIBITED_BOUNDARY_PHRASES:
        if phrase in markdown:
            item = {"phrase": phrase}
            unverified_claims.append(item)
            _add_issue(issues, "boundary.unverified_claim", "error", "Manuscript contains an unverifiable or over-strong boundary claim.", evidence=item)

    references = metadata.get("references") or []
    usage_envelopes = collect_usage_envelopes(metadata)
    if isinstance(references, list) and references:
        pmids = [str(ref.get("pmid") or "") for ref in references if isinstance(ref, dict)]
        missing_in_text = [pmid for pmid in pmids if pmid and pmid not in markdown]
        if len(missing_in_text) == len(pmids):
            _add_issue(issues, "references.not_cited", "warning", "Reference PMIDs are not visible in manuscript text.", evidence=missing_in_text[:5])

    source_coverage = {
        "literature_reviews": checked_lit,
        "literature_reviews_supported_by_references": supported_lit,
        "figures_checked": checked_figures,
        "numeric_claims_checked": len(_expected_numeric_claims(metadata)),
        "references": len(references) if isinstance(references, list) else 0,
        "model_usage_envelopes": len(usage_envelopes),
        "claim_ledger_entries": len(claim_ledger),
    }

    errors = sum(1 for issue in issues if issue["severity"] == "error")
    warnings = sum(1 for issue in issues if issue["severity"] == "warning")
    score = max(0, 100 - errors * 20 - warnings * 5)
    return {
        "passed": errors == 0,
        "score": score,
        "errors": errors,
        "warnings": warnings,
        "claims_checked": claims_checked,
        "source_coverage": source_coverage,
        "unverified_claims": unverified_claims,
        "numeric_mismatches": numeric_mismatches,
        "claim_ledger": claim_ledger,
        "usage_summary": summarize_usage_envelopes(usage_envelopes),
        "issues": issues,
    }
