"""
OpenAlex 开放学术 API — 免费引用计数与期刊信号（无需 API Key）

文档：https://docs.openalex.org/
"""
from __future__ import annotations

import time
from typing import Any

import requests


class OpenAlexClient:
    BASE_URL = "https://api.openalex.org"
    MAILTO = "target-research@scale-engine.local"

    def __init__(self, timeout: int = 20, polite_email: str | None = None):
        self.timeout = timeout
        self.mailto = polite_email or self.MAILTO
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": f"TargetResearchPlatform/1.0 (mailto:{self.mailto})"})

    def enrich_by_pmid(self, pmid: str) -> dict[str, Any]:
        if not pmid:
            return {}
        try:
            resp = self._session.get(
                f"{self.BASE_URL}/works/pmid:{pmid}",
                params={"mailto": self.mailto},
                timeout=self.timeout,
            )
            if resp.status_code == 404:
                return {"openalex_matched": False}
            resp.raise_for_status()
            return self._normalize(resp.json())
        except Exception:
            return {"openalex_matched": False}

    def enrich_by_doi(self, doi: str) -> dict[str, Any]:
        if not doi:
            return {}
        clean = doi.replace("https://doi.org/", "").strip()
        try:
            resp = self._session.get(
                f"{self.BASE_URL}/works/https://doi.org/{clean}",
                params={"mailto": self.mailto},
                timeout=self.timeout,
            )
            if resp.status_code == 404:
                return {"openalex_matched": False}
            resp.raise_for_status()
            return self._normalize(resp.json())
        except Exception:
            return {"openalex_matched": False}

    def enrich_paper(self, paper: dict) -> dict[str, Any]:
        pmid = str(paper.get("pmid") or "")
        doi = str(paper.get("doi") or "")
        result = self.enrich_by_pmid(pmid) if pmid else {}
        if not result.get("openalex_matched") and doi:
            time.sleep(0.1)
            result = self.enrich_by_doi(doi)
        return result

    @staticmethod
    def _normalize(work: dict) -> dict[str, Any]:
        if not work:
            return {"openalex_matched": False}
        cited_by = work.get("cited_by_count")
        venue = (work.get("primary_location") or {}).get("source") or {}
        concepts = [
            (c.get("display_name") or "")
            for c in (work.get("concepts") or [])[:5]
            if c.get("display_name")
        ]
        return {
            "openalex_matched": True,
            "openalex_id": work.get("id"),
            "citation_count": cited_by,
            "aminer_citation_count": cited_by,  # 统一字段供下游使用
            "openalex_venue": venue.get("display_name"),
            "aminer_venue": venue.get("display_name"),
            "openalex_concepts": concepts,
            "openalex_is_oa": (work.get("open_access") or {}).get("is_oa"),
        }
