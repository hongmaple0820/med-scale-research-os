"""
AMiner 开放平台客户端（精简版）

用于论文稿件生成时补充引用链、期刊与学者质量信号。
Token: https://open.aminer.cn/open/board?tab=control
"""
from __future__ import annotations

import json
import os
import random
import time
from typing import Any, Optional

import requests


class AMinerClient:
    """AMiner 学术数据 API — 论文搜索 + 详情 + 引用关系。"""

    BASE_URL = "https://datacenter.aminer.cn/gateway/open_platform"
    RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}

    def __init__(self, token: str | None = None, timeout: int = 30, max_retries: int = 3):
        self.token = token or os.environ.get("AMINER_TOKEN") or os.environ.get("AMINER_API_TOKEN")
        self.timeout = timeout
        self.max_retries = max_retries
        self._session = requests.Session()

    @property
    def available(self) -> bool:
        return bool(self.token)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        body: dict | None = None,
    ) -> dict[str, Any]:
        if not self.token:
            return {"success": False, "error": "missing_aminer_token"}

        url = f"{self.BASE_URL}{path}"
        headers = {
            "Authorization": self.token,
            "Content-Type": "application/json;charset=utf-8",
        }

        for attempt in range(1, self.max_retries + 1):
            try:
                if method.upper() == "GET":
                    resp = self._session.get(url, headers=headers, params=params, timeout=self.timeout)
                else:
                    resp = self._session.post(url, headers=headers, json=body, timeout=self.timeout)
                if resp.status_code in self.RETRYABLE_STATUS and attempt < self.max_retries:
                    time.sleep((2 ** (attempt - 1)) + random.uniform(0, 0.3))
                    continue
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict):
                    data.setdefault("success", True)
                return data if isinstance(data, dict) else {"success": True, "data": data}
            except Exception as exc:
                if attempt < self.max_retries:
                    time.sleep((2 ** (attempt - 1)) + random.uniform(0, 0.3))
                    continue
                return {"success": False, "error": str(exc)}
        return {"success": False, "error": "max_retries_exceeded"}

    def paper_search(self, title: str, *, size: int = 3) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/paper/search",
            params={"title": title, "page": 0, "size": size},
        )

    def paper_detail(self, paper_id: str) -> dict[str, Any]:
        return self._request("GET", "/api/paper/detail", params={"id": paper_id})

    def paper_relation(self, paper_id: str) -> dict[str, Any]:
        return self._request("GET", "/api/paper/relation", params={"id": paper_id})

    def enrich_by_title(self, title: str) -> dict[str, Any]:
        """
        按标题检索论文并提取引用数、期刊、关键词等补充字段。
        失败时返回空 dict，不阻断主流程。
        """
        if not self.available or not title.strip():
            return {}

        search = self.paper_search(title)
        items = self._extract_paper_list(search)
        if not items:
            search = self._request(
                "GET",
                "/api/paper/search/pro",
                params={"title": title, "page": 0, "size": 3, "order": "n_citation"},
            )
            items = self._extract_paper_list(search)
        if not items:
            return {"aminer_matched": False}

        best = items[0]
        paper_id = best.get("id") or best.get("paper_id")
        if not paper_id:
            return {"aminer_matched": False}

        detail = self.paper_detail(str(paper_id))
        relation = self.paper_relation(str(paper_id))
        detail_data = self._unwrap(detail)
        relation_data = self._unwrap(relation)

        cited_by = relation_data.get("cited_by") or relation_data.get("citations") or []
        if isinstance(cited_by, dict):
            cited_by = cited_by.get("data") or cited_by.get("items") or []

        return {
            "aminer_matched": True,
            "aminer_paper_id": str(paper_id),
            "aminer_citation_count": (
                detail_data.get("n_citation")
                or best.get("n_citation")
                or (len(cited_by) if isinstance(cited_by, list) else None)
            ),
            "aminer_venue": detail_data.get("venue") or best.get("venue"),
            "aminer_keywords": (detail_data.get("keywords") or best.get("keywords") or [])[:10],
            "aminer_authors_top": [
                a.get("name") if isinstance(a, dict) else str(a)
                for a in (detail_data.get("authors") or best.get("authors") or [])[:5]
            ],
            "aminer_cited_by_sample": [
                (c.get("title") or "")[:80]
                for c in (cited_by[:3] if isinstance(cited_by, list) else [])
                if isinstance(c, dict)
            ],
        }

    @staticmethod
    def _unwrap(payload: dict) -> dict:
        if not payload:
            return {}
        data = payload.get("data")
        if isinstance(data, list) and data:
            return data[0] if isinstance(data[0], dict) else {}
        if isinstance(data, dict):
            return data
        return payload

    @staticmethod
    def _extract_paper_list(payload: dict) -> list[dict]:
        if not payload or payload.get("success") is False:
            return []
        data = payload.get("data")
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            for key in ("items", "papers", "data", "list"):
                val = data.get(key)
                if isinstance(val, list):
                    return [x for x in val if isinstance(x, dict)]
        return []
