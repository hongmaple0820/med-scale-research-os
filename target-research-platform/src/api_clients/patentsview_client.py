"""USPTO PatentsView / ODP patent evidence client."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

import requests

from .base_client import APIResponse, BaseAPIClient


class PatentsViewClient(BaseAPIClient):
    """Client for traceable patent evidence.

    USPTO ODP search APIs require an API key. Missing credentials are reported as
    a blocked evidence condition instead of falling back to untraceable scraping.
    """

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        super().__init__(cache_dir=cache_dir, rate_limit=1.0)
        self.api_key = (
            api_key
            or os.environ.get("PATENTSVIEW_API_KEY")
            or os.environ.get("USPTO_API_KEY")
        )

    @property
    def source_name(self) -> str:
        return "USPTO PatentsView"

    @property
    def base_url(self) -> str:
        return "https://api.uspto.gov/api/v1"

    def health_check(self) -> bool:
        if not self.api_key:
            return False
        response = self.search_patents("CDK4", max_results=1)
        return response.success

    def search_patents(
        self,
        target_name: str,
        disease: Optional[str] = None,
        max_results: int = 25,
    ) -> APIResponse:
        if not self.api_key:
            return APIResponse(
                success=False,
                data={
                    "target": target_name,
                    "disease": disease,
                    "patents": [],
                    "required_env": ["PATENTSVIEW_API_KEY", "USPTO_API_KEY"],
                },
                source=self.source_name,
                endpoint="/patent/applications/search",
                params={"target": target_name, "disease": disease, "limit": max_results},
                timestamp=datetime.now().isoformat(),
                error="missing_patentsview_api_key",
            )

        query_terms = [target_name]
        if disease:
            query_terms.append(disease)
        search_text = " ".join(query_terms)
        params = {
            "searchText": search_text,
            "rows": min(max_results, 100),
        }
        endpoint = "/patent/applications/search"

        cache_key = self._get_cache_key(endpoint, params)
        cached = self._get_from_cache(cache_key)
        if cached:
            return APIResponse(**cached)

        self._wait_for_rate_limit()
        url = f"{self.base_url}{endpoint}"
        try:
            response = self._session.get(
                url,
                params=params,
                headers={"X-Api-Key": self.api_key},
                timeout=30,
            )
            response.raise_for_status()
            raw_data = response.json() if response.content else {}
        except requests.exceptions.RequestException as exc:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=endpoint,
                params=params,
                timestamp=datetime.now().isoformat(),
                error=str(exc),
            )

        patents = self._parse_patent_records(raw_data)
        api_response = APIResponse(
            success=True,
            data={
                "target": target_name,
                "disease": disease,
                "query": search_text,
                "total_patents": len(patents),
                "patents": patents,
                "data_sources": [self.source_name],
                "source_url": response.url,
                "raw_count": self._raw_count(raw_data),
            },
            source=self.source_name,
            endpoint=endpoint,
            params=params,
            timestamp=datetime.now().isoformat(),
            raw_response=response.text[:1000],
        )
        self._save_to_cache(cache_key, api_response)
        return api_response

    def _parse_patent_records(self, raw_data: dict) -> list[dict]:
        records = (
            raw_data.get("results")
            or raw_data.get("patents")
            or raw_data.get("applications")
            or raw_data.get("data")
            or []
        )
        if isinstance(records, dict):
            records = records.get("results") or records.get("data") or []

        patents = []
        for item in records if isinstance(records, list) else []:
            if not isinstance(item, dict):
                continue
            patent_id = (
                item.get("patentNumber")
                or item.get("patent_id")
                or item.get("publicationNumber")
                or item.get("applicationNumberText")
                or item.get("application_number")
                or ""
            )
            title = (
                item.get("inventionTitle")
                or item.get("patent_title")
                or item.get("title")
                or ""
            )
            date = (
                item.get("filingDate")
                or item.get("patent_date")
                or item.get("publicationDate")
                or item.get("grantDate")
                or ""
            )
            applicant = self._applicant_name(item)
            year = str(date)[:4] if date else ""
            patents.append(
                {
                    "id": str(patent_id),
                    "title": str(title),
                    "applicant": applicant,
                    "year": year,
                    "date": str(date),
                    "source": self.source_name,
                    "source_url": (
                        f"https://patents.justia.com/patent/{patent_id}"
                        if patent_id
                        else ""
                    ),
                }
            )
        return patents

    def _applicant_name(self, item: dict) -> str:
        applicant = item.get("applicantName") or item.get("assignee_organization")
        if applicant:
            return str(applicant)
        assignees = item.get("assignees") or item.get("applicants") or []
        if isinstance(assignees, list) and assignees:
            first = assignees[0]
            if isinstance(first, dict):
                return str(
                    first.get("name")
                    or first.get("organization")
                    or first.get("assignee_organization")
                    or ""
                )
            return str(first)
        return ""

    def _raw_count(self, raw_data: dict) -> int:
        total = raw_data.get("count") or raw_data.get("total") or raw_data.get("totalCount")
        try:
            return int(total)
        except (TypeError, ValueError):
            return 0
