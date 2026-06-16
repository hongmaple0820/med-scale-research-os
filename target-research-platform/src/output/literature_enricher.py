"""
文献富化编排 — PubMed efetch + AMiner + 医学 Skills 桥接

在稿件生成前为每篇核心文献补充：
- 完整摘要、MeSH 主题词、发表类型、作者关键词（PubMed E-utilities）
- 引用数、期刊信号、引用链样例（AMiner，可选）
- 研究设计 / 证据等级（AIPOCH 风格规则）
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from src.api_clients.aminer_client import AMinerClient
from src.api_clients.openalex_client import OpenAlexClient
from src.api_clients.pubmed_client import PubMedClient
from .medical_skills_bridge import infer_study_design


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _cache_enabled() -> bool:
    return os.environ.get("MANUSCRIPT_ENRICH_CACHE", "1") != "0"


def _cache_dir() -> Path:
    return Path(os.environ.get("MANUSCRIPT_ENRICH_CACHE_DIR", "./cache/literature_enrichment"))


def _cache_key(paper: dict[str, Any]) -> str:
    pmid = str(paper.get("pmid") or "").strip()
    if pmid:
        return f"pmid_{pmid}"
    title = str(paper.get("title") or "").strip().lower()
    digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:16]
    return f"title_{digest}"


def _has_enrichment_evidence(paper: dict[str, Any]) -> bool:
    sources = set(paper.get("enrichment_sources") or [])
    return bool(
        sources.intersection({"pubmed_efetch", "openalex", "aminer"})
        or paper.get("mesh_terms")
        or paper.get("publication_types")
        or paper.get("citation_count") is not None
        or paper.get("aminer_citation_count") is not None
        or paper.get("openalex_matched")
        or paper.get("aminer_matched")
    )


def _read_cache(papers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not _cache_enabled():
        return {}
    base = _cache_dir()
    cached: dict[str, dict[str, Any]] = {}
    for paper in papers:
        key = _cache_key(paper)
        try:
            payload = json.loads((base / f"{key}.json").read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict) and _has_enrichment_evidence(payload):
            cached[key] = payload
    return cached


def _merge_cached_fields(merged: dict[str, Any], cached: dict[str, Any]) -> bool:
    used = False
    for key, val in cached.items():
        if key in {"enrichment_sources", "cached_at"}:
            continue
        if val not in (None, "", []) and not merged.get(key):
            merged[key] = val
            used = True
    if used:
        merged["enrichment_sources"] = sorted(
            set((merged.get("enrichment_sources") or []) + ["cache"])
        )
        cached_sources = cached.get("enrichment_sources") or []
        if cached_sources:
            merged["cached_enrichment_sources"] = sorted(set(cached_sources))
    return used


def _merge_evidence_pack_fields(merged: dict[str, Any], packed: dict[str, Any]) -> bool:
    used = False
    for key, val in packed.items():
        if key in {"pack_entry_hash", "packed_at", "evidence_pack_path"}:
            continue
        if val not in (None, "", []) and not merged.get(key):
            merged[key] = val
            used = True
    if used:
        merged["enrichment_sources"] = sorted(
            set((merged.get("enrichment_sources") or []) + ["evidence_pack"])
        )
        packed_sources = packed.get("enrichment_sources") or []
        if packed_sources:
            merged["evidence_pack_sources"] = sorted(set(packed_sources))
    return used


def _write_cache(papers: list[dict[str, Any]]) -> int:
    if not _cache_enabled():
        return 0
    base = _cache_dir()
    written = 0
    for paper in papers:
        sources = set(paper.get("enrichment_sources") or [])
        if not (sources.intersection({"pubmed_efetch", "openalex", "aminer"}) or _has_enrichment_evidence(paper)):
            continue
        try:
            base.mkdir(parents=True, exist_ok=True)
            payload = dict(paper)
            payload["cached_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            (base / f"{_cache_key(paper)}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            written += 1
        except Exception:
            continue
    return written


def _resolve_evidence_pack_path(evidence_pack_path: str | Path | None = None) -> Path | None:
    raw = evidence_pack_path or os.environ.get("MANUSCRIPT_EVIDENCE_PACK")
    if not raw:
        return None
    path = Path(raw)
    return path if path.exists() and path.is_file() else None


def _read_evidence_pack(papers: list[dict[str, Any]], pack_path: Path | None) -> dict[str, dict[str, Any]]:
    if not pack_path:
        return {}
    try:
        payload = json.loads(pack_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    entries = payload.get("papers") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return {}
    wanted = {_cache_key(paper) for paper in papers}
    packed: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not _has_enrichment_evidence(entry):
            continue
        key = _cache_key(entry)
        if key not in wanted:
            continue
        item = dict(entry)
        item["evidence_pack_path"] = str(pack_path)
        packed[key] = item
    return packed


def _paper_hash(paper: dict[str, Any]) -> str:
    payload = {
        key: paper.get(key)
        for key in [
            "pmid",
            "doi",
            "title",
            "year",
            "journal",
            "mesh_terms",
            "publication_types",
            "keywords",
            "citation_count",
            "aminer_citation_count",
            "openalex_id",
            "enrichment_sources",
        ]
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def write_literature_evidence_pack(
    papers: list[dict[str, Any]],
    pack_path: str | Path,
    *,
    target: str = "",
    disease: str = "",
    enrichment_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write a portable evidence pack that can seed enrichment in offline runs."""
    path = Path(pack_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []
    for paper in papers:
        if not _has_enrichment_evidence(paper):
            continue
        entry = dict(paper)
        real_sources = set(entry.get("enrichment_sources") or [])
        real_sources.update(entry.get("cached_enrichment_sources") or [])
        real_sources.update(entry.get("evidence_pack_sources") or [])
        real_sources.discard("cache")
        real_sources.discard("evidence_pack")
        if real_sources:
            entry["enrichment_sources"] = sorted(real_sources)
        entry["pack_entry_hash"] = _paper_hash(entry)
        entries.append(entry)

    enrichment_meta = enrichment_meta or {}
    pack = {
        "pack_version": "1.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "target": target,
        "disease": disease,
        "paper_count": len(entries),
        "source_summary": {
            "sources": enrichment_meta.get("sources") or [],
            "mesh_count": enrichment_meta.get("mesh_count", 0),
            "citation_count_available": enrichment_meta.get("citation_count_available", 0),
            "cache_used": enrichment_meta.get("cache_used", False),
        },
        "papers": entries,
    }
    path.write_text(json.dumps(pack, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return pack


def enrich_papers_for_manuscript(
    papers: list[dict],
    *,
    target: str = "",
    disease_zh: str = "",
    max_papers: int = 12,
    use_pubmed: bool | None = None,
    use_aminer: bool | None = None,
    evidence_pack_path: str | Path | None = None,
) -> dict[str, Any]:
    """
    富化文献列表，返回 papers + enrichment 元数据。

    环境变量：
    - MANUSCRIPT_ENRICH_PUBMED=0 可关闭 PubMed efetch（默认开启）
    - AMINER_TOKEN / AMINER_API_TOKEN 开启 AMiner
    - MANUSCRIPT_ENRICH_AMINER=0 可强制关闭 AMiner
    """
    selected = list(papers[:max_papers])
    if not selected:
        return {
            "papers": [],
            "enrichment": {
                "pubmed_efetch": False,
                "aminer_used": False,
                "mesh_count": 0,
                "cache_used": False,
                "cache_hit_count": 0,
                "cache_write_count": 0,
                "cache_dir": str(_cache_dir()) if _cache_enabled() else None,
                "evidence_pack_used": False,
                "evidence_pack_hit_count": 0,
                "evidence_pack_path": None,
                "sources": [],
            },
        }

    if use_pubmed is None:
        use_pubmed = os.environ.get("MANUSCRIPT_ENRICH_PUBMED", "1") != "0"
    if use_aminer is None:
        use_aminer = os.environ.get("MANUSCRIPT_ENRICH_AMINER", "1") != "0"

    enrich_budget_seconds = _env_float("MANUSCRIPT_ENRICH_BUDGET_SECONDS", 45.0)
    deadline = time.monotonic() + enrich_budget_seconds
    deadline_exceeded = False
    cache_map = _read_cache(selected)
    pack_path = _resolve_evidence_pack_path(evidence_pack_path)
    evidence_pack_map = _read_evidence_pack(selected, pack_path)
    cache_hits = 0
    evidence_pack_hits = 0

    pubmed_map: dict[str, dict] = {}
    pubmed_ok = False
    if use_pubmed:
        pmids = [str(p.get("pmid")) for p in selected if p.get("pmid")]
        if pmids:
            client = PubMedClient()
            resp = client.fetch_details(pmids)
            if resp.success and resp.data:
                for item in resp.data.get("papers") or []:
                    if item.get("pmid"):
                        pubmed_map[str(item["pmid"])] = item
                pubmed_ok = bool(pubmed_map)

    aminer = AMinerClient(
        timeout=int(_env_float("MANUSCRIPT_ENRICH_AMINER_TIMEOUT", 8.0)),
        max_retries=int(_env_float("MANUSCRIPT_ENRICH_AMINER_RETRIES", 1.0)),
    ) if use_aminer else None
    openalex = OpenAlexClient(timeout=int(_env_float("MANUSCRIPT_ENRICH_OPENALEX_TIMEOUT", 5.0)))
    aminer_used = False
    openalex_used = False
    enriched: list[dict] = []

    for paper in selected:
        merged = dict(paper)
        pmid = str(paper.get("pmid") or "")
        packed = evidence_pack_map.get(_cache_key(paper))
        if packed and _merge_evidence_pack_fields(merged, packed):
            evidence_pack_hits += 1
        cached = cache_map.get(_cache_key(paper))
        if cached and _merge_cached_fields(merged, cached):
            cache_hits += 1
        if pmid and pmid in pubmed_map:
            # PubMed 字段优先覆盖摘要/MeSH
            for key, val in pubmed_map[pmid].items():
                if val or key not in merged:
                    merged[key] = val
            merged["enrichment_sources"] = list(set((merged.get("enrichment_sources") or []) + ["pubmed_efetch"]))

        if time.monotonic() > deadline:
            deadline_exceeded = True
            merged["enrichment_sources"] = merged.get("enrichment_sources") or []
            merged["enrichment_timeout"] = True
            merged["study_design"] = infer_study_design(merged)
            enriched.append(merged)
            continue

        if aminer and aminer.available:
            extra = aminer.enrich_by_title(merged.get("title") or "")
            if extra.get("aminer_matched"):
                aminer_used = True
                merged.update(extra)
                merged["enrichment_sources"] = list(
                    set((merged.get("enrichment_sources") or []) + ["aminer"])
                )
            time.sleep(0.2)

        if time.monotonic() > deadline:
            deadline_exceeded = True
        elif not merged.get("citation_count") and not merged.get("aminer_citation_count"):
            oa = openalex.enrich_paper(merged)
            if oa.get("openalex_matched"):
                openalex_used = True
                merged.update(oa)
                merged["enrichment_sources"] = list(
                    set((merged.get("enrichment_sources") or []) + ["openalex"])
                )
            time.sleep(0.12)

        merged["study_design"] = infer_study_design(merged)
        enriched.append(merged)

    mesh_count = sum(1 for p in enriched if p.get("mesh_terms"))
    cite_count = sum(1 for p in enriched if p.get("citation_count") is not None or p.get("aminer_citation_count") is not None)
    sources = []
    if pubmed_ok:
        sources.append("pubmed_efetch")
    if aminer_used:
        sources.append("aminer")
    if openalex_used:
        sources.append("openalex")
    if cache_hits:
        sources.append("cache")
    if evidence_pack_hits:
        sources.append("evidence_pack")
    cache_write_count = _write_cache(enriched)

    return {
        "papers": enriched,
        "enrichment": {
            "pubmed_efetch": pubmed_ok,
            "aminer_used": aminer_used,
            "aminer_available": bool(aminer and aminer.available),
            "openalex_used": openalex_used,
            "citation_count_available": cite_count,
            "mesh_count": mesh_count,
            "paper_count": len(enriched),
            "deadline_exceeded": deadline_exceeded,
            "budget_seconds": enrich_budget_seconds,
            "cache_used": cache_hits > 0,
            "cache_hit_count": cache_hits,
            "cache_write_count": cache_write_count,
            "cache_dir": str(_cache_dir()) if _cache_enabled() else None,
            "evidence_pack_used": evidence_pack_hits > 0,
            "evidence_pack_hit_count": evidence_pack_hits,
            "evidence_pack_path": str(pack_path) if pack_path else None,
            "sources": sources,
            "target": target,
            "disease_zh": disease_zh,
        },
    }
