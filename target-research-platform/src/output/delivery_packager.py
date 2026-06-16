"""Delivery manifest and ZIP packaging for manuscript deliverables."""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from .usage_envelope import collect_usage_envelopes, summarize_usage_envelopes


REVIEW_TODO_ITEMS = [
    "Complete author names, affiliations, and corresponding-author details.",
    "Confirm funding statements with the study sponsor or institution.",
    "Confirm ethics review or exemption requirements with the author's institution.",
    "Have a domain expert verify medical claims, numeric results, and clinical interpretation.",
    "Add original experimental design/results before journal submission when required.",
    "Reformat references and figures against the target journal's latest instructions.",
]

DISCLAIMER = (
    "This package is an automatically generated computational-analysis draft. "
    "It is not a submission-ready manuscript, does not replace expert medical "
    "review, and does not establish clinical efficacy or safety."
)

_MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
_MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
_HTML_REF_RE = re.compile(r"<(img|a)\b[^>]*\b(?:src|href)=['\"]([^'\"]+)['\"]", re.I)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            items.append(text)
    return items


def _review_source_counts(meta: dict[str, Any]) -> dict[str, int]:
    reviews = meta.get("literature_reviews") or []
    derived: dict[str, int] = {}
    if isinstance(reviews, list):
        for review in reviews:
            if not isinstance(review, dict):
                continue
            source = str(review.get("source") or "").strip()
            if not source:
                continue
            derived[source] = derived.get(source, 0) + 1
    if derived:
        return derived

    raw_counts = meta.get("literature_review_sources") or {}
    counts: dict[str, int] = {}
    if isinstance(raw_counts, dict):
        for key, value in raw_counts.items():
            name = str(key).strip()
            if not name:
                continue
            try:
                counts[name] = int(value or 0)
            except (TypeError, ValueError):
                continue
    return counts


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_bytes(payload: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(payload)
    return digest.hexdigest()


def _resolve_existing_path(raw_path: str | Path, base_dir: Path) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path

    candidates = [
        base_dir / path,
        base_dir.parent / path,
        path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _derive_optional_delivery_paths(paths: dict[str, Any]) -> dict[str, str]:
    manifest_raw = paths.get("delivery_manifest") or paths.get("markdown")
    if not manifest_raw:
        return {}

    anchor = Path(str(manifest_raw))
    if anchor.name.endswith("_delivery_manifest.json"):
        slug = anchor.name.replace("_delivery_manifest.json", "")
        manuscripts_dir = anchor.parent
    elif anchor.name.endswith("_manuscript.md"):
        slug = anchor.name.replace("_manuscript.md", "")
        manuscripts_dir = anchor.parent
    else:
        return {}

    return {
        "memory_seed_record": str(manuscripts_dir / f"{slug}_memory_seed.json"),
        "memory_seed_summary": str(manuscripts_dir / f"{slug}_memory_summary.md"),
        "learning_candidate_record": str(manuscripts_dir / f"{slug}_memory_learning_candidate.json"),
        "learning_candidate_summary": str(manuscripts_dir / f"{slug}_memory_learning_candidate.md"),
    }


def _file_entry(path: str | None, role: str, base_dir: Path) -> dict[str, Any] | None:
    if not path:
        return None
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        return None
    try:
        relative = str(file_path.resolve().relative_to(base_dir.resolve())).replace("\\", "/")
    except ValueError:
        relative = file_path.name
    return {
        "role": role,
        "filename": file_path.name,
        "path": str(file_path.resolve()),
        "relative_path": relative,
        "size": None if role == "delivery_manifest" else file_path.stat().st_size,
        "sha256": None if role == "delivery_manifest" else _sha256(file_path),
    }


def _manifest_self_entry(manifest_path: str | Path, base_dir: Path) -> dict[str, Any]:
    path = Path(manifest_path)
    try:
        relative = str(path.resolve().relative_to(base_dir.resolve())).replace("\\", "/")
    except ValueError:
        relative = path.name
    return {
        "role": "delivery_manifest",
        "filename": path.name,
        "path": str(path.resolve()),
        "relative_path": relative,
        "size": None,
        "sha256": None,
    }


def _collect_files(result: dict[str, Any], base_dir: Path) -> list[dict[str, Any]]:
    paths = result.get("paths") or {}
    optional_paths = _derive_optional_delivery_paths(paths)
    roles = {
        "markdown": "manuscript_markdown",
        "zhongliu": "manuscript_zhongliu",
        "docx": "manuscript_docx",
        "metadata": "manuscript_meta",
        "quality": "manuscript_quality",
        "fact_check": "manuscript_fact_check",
        "literature_evidence_pack": "literature_evidence_pack",
        "agent_review_tasks": "agent_review_tasks",
        "agent_reviews": "agent_reviews",
        "delivery_manifest": "delivery_manifest",
        "memory_seed_record": "memory_seed_record",
        "memory_seed_summary": "memory_seed_summary",
        "learning_candidate_record": "learning_candidate_record",
        "learning_candidate_summary": "learning_candidate_summary",
    }
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path_key, role in roles.items():
        entry = _file_entry(paths.get(path_key) or optional_paths.get(path_key), role, base_dir)
        if not entry:
            continue
        if entry["path"] in seen:
            continue
        files.append(entry)
        seen.add(entry["path"])

    registered_figures = result.get("figures") or []
    figure_candidates: list[Path] = []
    if isinstance(registered_figures, list):
        for figure in registered_figures:
            if not isinstance(figure, dict):
                continue
            raw_path = figure.get("path")
            if not raw_path:
                continue
            figure_path = _resolve_existing_path(str(raw_path), base_dir)
            figure_candidates.append(figure_path)
            sibling_svg = figure_path.with_suffix(".svg")
            if sibling_svg != figure_path:
                figure_candidates.append(sibling_svg)

    if not figure_candidates:
        figures_dir = paths.get("figures_dir")
        if figures_dir:
            figure_candidates.extend(sorted(Path(figures_dir).glob("*")))

    for figure_path in figure_candidates:
        if figure_path.suffix.lower() not in {".png", ".svg"}:
            continue
        entry = _file_entry(str(figure_path), "figure", base_dir)
        if entry and entry["path"] not in seen:
            files.append(entry)
            seen.add(entry["path"])
    return files


def _summary_from_gate(value: dict[str, Any] | None) -> dict[str, Any]:
    value = value or {}
    return {
        "passed": value.get("passed"),
        "score": value.get("score"),
        "grade": value.get("grade"),
        "errors": value.get("errors"),
        "warnings": value.get("warnings"),
    }


def _quality_findings(quality_gate: dict[str, Any] | None) -> list[dict[str, Any]]:
    checks = (quality_gate or {}).get("checks") or []
    findings: list[dict[str, Any]] = []
    for check in checks:
        if not isinstance(check, dict) or check.get("passed", True):
            continue
        findings.append({
            "id": check.get("id"),
            "severity": check.get("severity"),
            "message": check.get("message"),
            "evidence": check.get("evidence"),
        })
    return findings


def _combined_data_sources(result: dict[str, Any], enrichment: dict[str, Any]) -> list[str]:
    sources: list[str] = []
    for value in result.get("data_sources") or []:
        if value and value not in sources:
            sources.append(str(value))
    for value in enrichment.get("sources") or []:
        if value and value not in sources:
            sources.append(str(value))
    return sources


def _has_literature_enrichment(enrichment: dict[str, Any]) -> bool:
    if not isinstance(enrichment, dict):
        return False
    return bool(enrichment.get("sources")) or any([
        enrichment.get("pubmed_efetch"),
        enrichment.get("openalex_used"),
        enrichment.get("aminer_used"),
        enrichment.get("cache_used"),
        int(enrichment.get("mesh_count") or 0) > 0,
        int(enrichment.get("citation_count_available") or 0) > 0,
    ])


def _human_review_todo(result: dict[str, Any], quality_findings: list[dict[str, Any]]) -> list[str]:
    items = list(REVIEW_TODO_ITEMS)
    literature = result.get("literature_reviews") or {}
    source_counts = literature.get("source_counts") or {}
    enrichment = literature.get("enrichment") or {}
    fact_check = result.get("fact_check") or {}

    if quality_findings:
        items.append("Review and resolve all quality-gate warnings before sharing outside the research team.")
    if not _has_literature_enrichment(enrichment):
        items.append("Re-run PubMed/OpenAlex enrichment or provide a validated enrichment cache before external review.")
    if int(source_counts.get("rule_based") or 0) > 0:
        items.append("Upgrade rule-based literature reviews with Agent, local LLM, or expert-written review text.")
    if not fact_check.get("passed", False):
        items.append("Resolve fact-check hard errors before sending the package to a medical researcher.")

    unique: list[str] = []
    for item in items:
        if item not in unique:
            unique.append(item)
    return unique


def _readme_from_manifest(manifest: dict[str, Any]) -> str:
    quality = manifest.get("quality_gate") or {}
    fact_check = manifest.get("fact_check") or {}
    literature = manifest.get("literature") or {}
    enrichment = literature.get("enrichment") or {}
    findings = manifest.get("quality_findings") or []
    files = manifest.get("files") or []
    memory_seed = manifest.get("memory_seed") or {}
    learning_candidate = manifest.get("learning_candidate") or {}
    usage = (manifest.get("usage") or {}).get("summary") or {}

    def yes_no(value: Any) -> str:
        return "PASS" if value is True else "FAIL" if value is False else "UNKNOWN"

    lines = [
        "# Medical Research Delivery Package",
        "",
        manifest.get("disclaimer") or DISCLAIMER,
        "",
        "## Study",
        f"- Target: {manifest.get('target') or 'N/A'}",
        f"- Disease: {manifest.get('disease') or 'N/A'}",
        f"- Generated at: {manifest.get('generated_at') or 'N/A'}",
        "",
        "## Gate Summary",
        (
            f"- Quality gate: {yes_no(quality.get('passed'))}; "
            f"grade={quality.get('grade') or 'N/A'}; score={quality.get('score')}; "
            f"errors={quality.get('errors')}; warnings={quality.get('warnings')}"
        ),
        (
            f"- Fact check: {yes_no(fact_check.get('passed'))}; score={fact_check.get('score')}; "
            f"errors={fact_check.get('errors')}; warnings={fact_check.get('warnings')}"
        ),
        "",
        "## Literature Evidence",
        f"- Reviews: {literature.get('count', 0)}",
        f"- Agent cache reviews: {literature.get('agent_cache_count', 0)}",
        f"- LLM reviews: {literature.get('llm_count', 0)}",
        f"- Rule-based reviews: {literature.get('rule_based_count', 0)}",
        f"- Enrichment sources: {', '.join(enrichment.get('sources') or []) or 'none'}",
        f"- MeSH-covered papers: {enrichment.get('mesh_count', 0)}",
        f"- Citation-covered papers: {enrichment.get('citation_count_available', 0)}",
        f"- Enrichment cache used: {bool(enrichment.get('cache_used'))}",
        "",
        "## Model Usage",
        f"- Usage records: {usage.get('total_records', 0)}",
        f"- Total tokens: {usage.get('total_tokens', 0)}",
        f"- Cache savings tokens: {usage.get('cache_savings_tokens', 0)}",
        "",
        "## Memory and Learning",
        f"- Memory seed provider: {memory_seed.get('provider') or 'none'}",
        f"- Memory seed imported: {yes_no(memory_seed.get('import_ok'))}",
        f"- Learning candidate: {learning_candidate.get('candidate_id') or 'none'}",
        f"- Learning recommendation: {learning_candidate.get('recommended_action') or 'none'}",
        f"- Learning promotable: {bool(learning_candidate.get('promotable'))}",
        f"- Memory Brain ingest: {yes_no(learning_candidate.get('brain_ingest_ok'))}",
        "",
    ]
    if findings:
        lines.extend(["## Quality Findings"])
        for finding in findings:
            lines.append(
                f"- [{finding.get('severity') or 'unknown'}] {finding.get('id')}: "
                f"{finding.get('message') or ''}"
            )
        lines.append("")

    lines.extend([
        "## Included Files",
        *[
            f"- {item.get('role')}: {item.get('relative_path')} ({item.get('size')} bytes)"
            for item in files
            if isinstance(item, dict)
        ],
        "",
        "## Required Human Review",
        *[f"- {item}" for item in manifest.get("human_review_todo") or REVIEW_TODO_ITEMS],
        "",
        "## Package Manifest",
        "See the delivery_manifest JSON file for hashes, provenance, quality gate, fact check, and file inventory.",
        "",
    ])
    return "\n".join(lines)


def _memory_seed_summary(paths: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    optional_paths = _derive_optional_delivery_paths(paths)
    record_path = _resolve_existing_path(optional_paths["memory_seed_record"], base_dir)
    summary_path = _resolve_existing_path(optional_paths["memory_seed_summary"], base_dir)
    record = _read_json(record_path)
    return {
        "provider": record.get("provider"),
        "generated_at": record.get("generated_at"),
        "record_path": str(record_path.resolve()) if record_path.exists() else None,
        "summary_path": str(summary_path.resolve()) if summary_path.exists() else None,
        "record_ready": record_path.exists(),
        "summary_ready": summary_path.exists(),
        "import_ok": record.get("import_ok") if isinstance(record.get("import_ok"), bool) else None,
        "source_file_count": len(_string_list(record.get("source_files"))),
        "staged_file_count": len(_string_list(record.get("staged_files"))),
        "missing_roles": _string_list(record.get("missing_roles")),
        "warnings": _string_list(record.get("warnings")),
    }


def _learning_candidate_summary(paths: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    optional_paths = _derive_optional_delivery_paths(paths)
    record_path = _resolve_existing_path(optional_paths["learning_candidate_record"], base_dir)
    summary_path = _resolve_existing_path(optional_paths["learning_candidate_summary"], base_dir)
    record = _read_json(record_path)
    candidate_path = record.get("candidate_path")
    candidate_markdown_path = record.get("candidate_markdown_path")
    return {
        "candidate_id": record.get("candidate_id"),
        "generated_at": record.get("generated_at"),
        "record_path": str(record_path.resolve()) if record_path.exists() else None,
        "summary_path": str(summary_path.resolve()) if summary_path.exists() else None,
        "candidate_path": str(_resolve_existing_path(candidate_path, base_dir).resolve()) if isinstance(candidate_path, str) and candidate_path.strip() else None,
        "candidate_markdown_path": str(_resolve_existing_path(candidate_markdown_path, base_dir).resolve()) if isinstance(candidate_markdown_path, str) and candidate_markdown_path.strip() else None,
        "recommended_action": record.get("recommended_action"),
        "promotable": bool(record.get("promotable")),
        "brain_ingest_ok": record.get("brain_ingest_ok") if isinstance(record.get("brain_ingest_ok"), bool) else None,
        "brain_node_id": record.get("brain_node_id"),
        "record_ready": record_path.exists(),
        "summary_ready": summary_path.exists(),
        "warnings": _string_list(record.get("warnings")),
    }


def build_delivery_manifest(result: dict[str, Any], *, base_dir: str | Path | None = None) -> dict[str, Any]:
    paths = result.get("paths") or {}
    base = Path(base_dir) if base_dir else Path(paths.get("markdown") or ".").resolve().parent
    literature = result.get("literature_reviews") or {}
    source_counts = literature.get("source_counts") or {}
    enrichment = literature.get("enrichment") or {}
    fact_check = result.get("fact_check") or {}
    quality_gate = result.get("quality_gate") or {}
    files = _collect_files(result, base)
    findings = _quality_findings(quality_gate)
    metadata_path = paths.get("metadata")
    metadata = _read_json(Path(metadata_path)) if metadata_path else {}
    usage_envelopes = collect_usage_envelopes({"result": result, "metadata": metadata})
    return {
        "manifest_version": "1.0",
        "generated_at": datetime.now().isoformat(),
        "run_id": result.get("run_id"),
        "target": result.get("target"),
        "disease": result.get("disease"),
        "package_type": "medical_research_manuscript_delivery",
        "files": files,
        "data_sources": _combined_data_sources(result, enrichment),
        "literature": {
            "count": literature.get("count", 0),
            "agent_cache_count": source_counts.get("agent_cache", 0),
            "llm_count": int(source_counts.get("openai", 0) or 0) + int(source_counts.get("scale_local", 0) or 0),
            "rule_based_count": source_counts.get("rule_based", 0),
            "source_counts": source_counts,
            "enrichment": enrichment,
        },
        "figures": result.get("figures") or [],
        "quality_gate": _summary_from_gate(quality_gate),
        "quality_findings": findings,
        "fact_check": _summary_from_gate(fact_check),
        "usage": {
            "summary": summarize_usage_envelopes(usage_envelopes),
            "envelope_count": len(usage_envelopes),
        },
        "memory_seed": _memory_seed_summary(paths, base),
        "learning_candidate": _learning_candidate_summary(paths, base),
        "disclaimer": result.get("disclaimer") or DISCLAIMER,
        "human_review_todo": _human_review_todo(result, findings),
    }


def write_delivery_manifest(
    result: dict[str, Any],
    manifest_path: str | Path,
    *,
    base_dir: str | Path | None = None,
) -> dict[str, Any]:
    manifest = build_delivery_manifest(result, base_dir=base_dir)
    path = Path(manifest_path)
    base = Path(base_dir) if base_dir else path.resolve().parent
    files = [
        item
        for item in manifest.get("files") or []
        if isinstance(item, dict) and item.get("role") != "delivery_manifest"
    ]
    files.append(_manifest_self_entry(path, base))
    manifest["files"] = files
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return manifest


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _archive_path(item: dict[str, Any]) -> str:
    return str(item.get("relative_path") or item.get("filename") or "").replace("\\", "/")


def _extract_markdown_target(raw_value: str) -> str:
    value = raw_value.strip()
    if not value:
        return ""
    if value.startswith("<") and ">" in value:
        return value[1:value.index(">")].strip()
    return value.split(maxsplit=1)[0].strip()


def _is_relative_reference(raw_value: str) -> bool:
    value = raw_value.strip()
    if not value or value.startswith("#") or value.startswith("/"):
        return False
    if value.startswith("//"):
        return False
    return re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value) is None


def _iter_markdown_references(text: str) -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    for match in _MARKDOWN_IMAGE_RE.finditer(text):
        target = _extract_markdown_target(match.group(1))
        if target:
            refs.append(("image", target))
    for match in _MARKDOWN_LINK_RE.finditer(text):
        target = _extract_markdown_target(match.group(1))
        if target:
            refs.append(("link", target))
    for match in _HTML_REF_RE.finditer(text):
        kind = "image" if match.group(1).lower() == "img" else "link"
        target = match.group(2).strip()
        if target:
            refs.append((kind, target))
    return refs


def _resolve_archive_reference(markdown_path: str, raw_reference: str) -> str | None:
    target = raw_reference.split("#", 1)[0].split("?", 1)[0].strip()
    if not _is_relative_reference(target):
        return None
    base_dir = posixpath.dirname(markdown_path)
    resolved = posixpath.normpath(posixpath.join(base_dir, target)).replace("\\", "/")
    if resolved.startswith("../") or resolved == "..":
        return None
    return resolved.lstrip("./")


def _text_char_count(path: str | Path) -> int | None:
    try:
        return len(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def audit_delivery_package(package_path: str | Path, manifest: dict[str, Any]) -> dict[str, Any]:
    package = Path(package_path)
    audit = {
        "passed": False,
        "archive_path": str(package.resolve()),
        "entry_count": 0,
        "readme_present": False,
        "manifest_present": False,
        "files_checked": 0,
        "markdown_refs_checked": 0,
        "image_refs_checked": 0,
        "figure_entries": 0,
        "missing_archive_entries": [],
        "hash_mismatches": [],
        "size_mismatches": [],
        "broken_markdown_refs": [],
        "broken_image_refs": [],
        "errors": 0,
        "warnings": 0,
    }

    if not package.is_file():
        audit["missing_archive_entries"].append({
            "role": "delivery_package",
            "path": str(package),
            "reason": "archive_missing",
        })
        audit["errors"] = 1
        return audit

    files = manifest.get("files") if isinstance(manifest.get("files"), list) else []
    try:
        with ZipFile(package) as zf:
            names = set(zf.namelist())
            audit["entry_count"] = len(names)
            audit["readme_present"] = "README_DELIVERY.md" in names
            audit["manifest_present"] = any(name.endswith("_delivery_manifest.json") for name in names)
            if not audit["readme_present"]:
                audit["missing_archive_entries"].append({
                    "role": "README_DELIVERY",
                    "path": "README_DELIVERY.md",
                    "reason": "readme_missing",
                })

            for item in files:
                if not isinstance(item, dict):
                    continue
                arcname = _archive_path(item)
                if not arcname:
                    continue
                if arcname not in names:
                    audit["missing_archive_entries"].append({
                        "role": item.get("role"),
                        "path": arcname,
                        "reason": "manifest_file_missing",
                    })
                    continue

                payload = zf.read(arcname)
                audit["files_checked"] += 1
                if item.get("role") == "figure":
                    audit["figure_entries"] += 1

                expected_size = item.get("size")
                if isinstance(expected_size, int) and expected_size != len(payload):
                    audit["size_mismatches"].append({
                        "role": item.get("role"),
                        "path": arcname,
                        "expected_size": expected_size,
                        "actual_size": len(payload),
                    })

                expected_hash = str(item.get("sha256") or "").strip()
                if expected_hash and expected_hash != _sha256_bytes(payload):
                    audit["hash_mismatches"].append({
                        "role": item.get("role"),
                        "path": arcname,
                    })

                if arcname.lower().endswith(".md"):
                    text = payload.decode("utf-8", errors="replace")
                    for ref_kind, ref_value in _iter_markdown_references(text):
                        resolved = _resolve_archive_reference(arcname, ref_value)
                        if not resolved:
                            continue
                        if ref_kind == "image":
                            audit["image_refs_checked"] += 1
                            if resolved not in names:
                                audit["broken_image_refs"].append({
                                    "source": arcname,
                                    "reference": ref_value,
                                    "resolved_path": resolved,
                                })
                        else:
                            audit["markdown_refs_checked"] += 1
                            if resolved not in names:
                                audit["broken_markdown_refs"].append({
                                    "source": arcname,
                                    "reference": ref_value,
                                    "resolved_path": resolved,
                                })
    except Exception as exc:
        audit["missing_archive_entries"].append({
            "role": "delivery_package",
            "path": str(package),
            "reason": f"archive_unreadable: {exc}",
        })
        audit["errors"] = len(audit["missing_archive_entries"])
        return audit

    audit["errors"] = (
        len(audit["missing_archive_entries"])
        + len(audit["hash_mismatches"])
        + len(audit["size_mismatches"])
        + len(audit["broken_markdown_refs"])
        + len(audit["broken_image_refs"])
    )
    audit["passed"] = audit["errors"] == 0 and audit["manifest_present"] and audit["readme_present"]
    return audit


def create_delivery_package(
    result: dict[str, Any],
    package_path: str | Path,
    *,
    base_dir: str | Path | None = None,
) -> str:
    paths = result.get("paths") or {}
    manifest_path = paths.get("delivery_manifest")
    if not manifest_path or not Path(manifest_path).is_file():
        raise FileNotFoundError("delivery manifest does not exist")

    base = Path(base_dir) if base_dir else Path(paths.get("markdown") or manifest_path).resolve().parent
    package = Path(package_path)
    package.parent.mkdir(parents=True, exist_ok=True)
    manifest = _read_json(Path(manifest_path))
    files = manifest.get("files") if isinstance(manifest.get("files"), list) else []

    with ZipFile(package, "w", compression=ZIP_DEFLATED) as zf:
        for item in files:
            if not isinstance(item, dict):
                continue
            path = Path(str(item.get("path") or ""))
            if not path.is_file():
                continue
            arcname = str(item.get("relative_path") or path.name).replace("\\", "/")
            zf.write(path, arcname)
        manifest_file = Path(manifest_path)
        try:
            manifest_arcname = str(manifest_file.resolve().relative_to(base.resolve())).replace("\\", "/")
        except ValueError:
            manifest_arcname = manifest_file.name
        if manifest_arcname not in set(zf.namelist()):
            zf.write(manifest_file, manifest_arcname)
        zf.writestr("README_DELIVERY.md", _readme_from_manifest(manifest))

    return str(package.resolve())


def package_existing_delivery(output_root: str | Path, target: str, disease: str) -> dict[str, Any]:
    output = Path(output_root)
    slug = f"{target}_{disease}".replace(" ", "_")
    manuscripts = output / "manuscripts"
    deliveries = output / "deliveries"
    paths = {
        "markdown": str(manuscripts / f"{slug}_manuscript.md"),
        "zhongliu": str(manuscripts / f"{slug}_manuscript_zhongliu.md"),
        "metadata": str(manuscripts / f"{slug}_manuscript_meta.json"),
        "quality": str(manuscripts / f"{slug}_manuscript_quality.json"),
        "fact_check": str(manuscripts / f"{slug}_manuscript_fact_check.json"),
        "literature_evidence_pack": str(manuscripts / f"{slug}_literature_evidence_pack.json"),
        "agent_review_tasks": str(manuscripts / f"{slug}_review_tasks.json"),
        "agent_reviews": str(manuscripts / f"{slug}_agent_reviews.json"),
        "delivery_manifest": str(manuscripts / f"{slug}_delivery_manifest.json"),
        "docx": str(manuscripts / f"{slug}_manuscript.docx"),
        "figures_dir": str(manuscripts / "figures"),
        "memory_seed_record": str(manuscripts / f"{slug}_memory_seed.json"),
        "memory_seed_summary": str(manuscripts / f"{slug}_memory_summary.md"),
        "learning_candidate_record": str(manuscripts / f"{slug}_memory_learning_candidate.json"),
        "learning_candidate_summary": str(manuscripts / f"{slug}_memory_learning_candidate.md"),
    }
    required = ["markdown", "zhongliu", "metadata", "quality", "fact_check"]
    missing = [key for key in required if not Path(paths[key]).is_file()]
    if missing:
        return {
            "success": False,
            "stage": "package",
            "target": target,
            "disease": disease,
            "error": f"Missing delivery artifacts: {', '.join(missing)}",
            "missing": missing,
        }

    meta = _read_json(Path(paths["metadata"]))
    quality = _read_json(Path(paths["quality"]))
    fact_check = _read_json(Path(paths["fact_check"]))
    result = {
        "success": True,
        "stage": "package",
        "target": target,
        "disease": disease,
        "paths": paths,
        "figures": meta.get("figures") or [],
        "data_sources": meta.get("data_sources") or [],
        "reference_count": len(meta.get("references") or []),
        "char_count": _text_char_count(paths["markdown"]),
        "zhongliu_char_count": _text_char_count(paths["zhongliu"]),
        "literature_reviews": {
            "count": len(meta.get("literature_reviews") or []),
            "source_counts": _review_source_counts(meta),
            "enrichment": meta.get("literature_enrichment") or {},
        },
        "quality_gate": quality,
        "fact_check": fact_check,
        "disclaimer": DISCLAIMER,
    }
    write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)
    package_path = deliveries / f"{slug}_delivery.zip"
    result["paths"]["delivery_package"] = create_delivery_package(
        result,
        package_path,
        base_dir=output,
    )
    result["package_audit"] = audit_delivery_package(result["paths"]["delivery_package"], _read_json(Path(paths["delivery_manifest"])))
    if not result["package_audit"].get("passed", False):
        result["success"] = False
        result["error"] = (
            "Delivery package audit failed: "
            f"{result['package_audit'].get('errors', 0)} archive issue(s) detected"
        )
    result["delivery_manifest"] = paths["delivery_manifest"]
    result["delivery_package"] = result["paths"]["delivery_package"]
    return result
