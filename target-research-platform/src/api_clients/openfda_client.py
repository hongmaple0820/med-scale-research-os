"""openFDA drug label evidence client."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from .base_client import APIResponse, BaseAPIClient


class OpenFDAClient(BaseAPIClient):
    """Client for traceable public regulatory drug-label evidence."""

    @property
    def source_name(self) -> str:
        return "openFDA Drug Label"

    @property
    def base_url(self) -> str:
        return "https://api.fda.gov"

    def health_check(self) -> bool:
        response = self._make_request(
            "GET",
            "/drug/label.json",
            params={"limit": 1},
            use_cache=False,
        )
        return response.success

    def search_market_evidence(
        self,
        target_name: str,
        disease: Optional[str] = None,
        max_results: int = 10,
    ) -> APIResponse:
        query = self._build_query(target_name, disease)
        params = {
            "search": query,
            "limit": min(max_results, 100),
        }
        response = self._make_request("GET", "/drug/label.json", params=params)
        if not response.success:
            return response

        records = self._parse_label_records(response.data or {})
        total = ((response.data or {}).get("meta", {}).get("results", {}) or {}).get("total", 0)
        return APIResponse(
            success=True,
            data={
                "target": target_name,
                "disease": disease,
                "query": query,
                "total_records": total,
                "returned_records": len(records),
                "records": records,
                "data_sources": [self.source_name],
                "source_urls": [
                    "https://open.fda.gov/apis/drug/label/",
                    "https://api.fda.gov/drug/label.json",
                ],
                "evidence_records": records,
                "limitations": [
                    "openFDA labels are public regulatory records, not market-size or sales data.",
                    "Mentions of a target in label text do not prove target-specific mechanism unless supported by the label fields.",
                ],
            },
            source=self.source_name,
            endpoint="/drug/label.json",
            params=params,
            timestamp=datetime.now().isoformat(),
            raw_response=response.raw_response,
        )

    def _build_query(self, target_name: str, disease: Optional[str]) -> str:
        target = self._quote(target_name)
        target_clause = (
            f"mechanism_of_action:{target} OR "
            f"clinical_pharmacology:{target} OR "
            f"pharmacodynamics:{target} OR "
            f"description:{target}"
        )
        if disease:
            return f"({target_clause}) AND indications_and_usage:{self._quote(disease)}"
        return target_clause

    def _quote(self, value: str) -> str:
        escaped = str(value).replace('"', '\\"')
        return f'"{escaped}"'

    def _parse_label_records(self, raw_data: dict) -> list[dict]:
        records = []
        for item in raw_data.get("results", []) or []:
            openfda = item.get("openfda", {}) or {}
            application_numbers = openfda.get("application_number", []) or []
            brand_names = openfda.get("brand_name", []) or []
            generic_names = openfda.get("generic_name", []) or []
            manufacturers = openfda.get("manufacturer_name", []) or []
            product_text = self._first_product_text(item)
            if product_text:
                product_tokens = product_text.split()
                if not brand_names and product_tokens:
                    brand_names = [product_tokens[0]]
                if not generic_names and len(product_tokens) > 1:
                    generic_names = [product_tokens[1]]
                if not manufacturers:
                    fallback_manufacturer = self._manufacturer_from_product_text(product_text)
                    if fallback_manufacturer:
                        manufacturers = [fallback_manufacturer]
            indications = item.get("indications_and_usage", []) or []
            mechanism = (
                item.get("mechanism_of_action", [])
                or item.get("clinical_pharmacology", [])
                or item.get("description", [])
                or []
            )
            records.append(
                {
                    "application_numbers": application_numbers[:3],
                    "brand_names": brand_names[:3],
                    "generic_names": generic_names[:3],
                    "manufacturers": manufacturers[:3],
                    "indications_and_usage": self._clip_list(indications),
                    "mechanism_or_description": self._clip_list(mechanism),
                    "source": self.source_name,
                    "label_url": self._label_url(application_numbers),
                }
            )
        return records

    def _clip_list(self, values: list[str], max_items: int = 2, max_chars: int = 500) -> list[str]:
        clipped = []
        for value in values[:max_items]:
            text = str(value).strip()
            if len(text) > max_chars:
                text = f"{text[:max_chars]}..."
            clipped.append(text)
        return clipped

    def _first_product_text(self, item: dict) -> str:
        values = item.get("spl_product_data_elements", []) or []
        if not values:
            return ""
        return str(values[0]).strip()

    def _manufacturer_from_product_text(self, text: str) -> str:
        parts = text.split(";")
        if len(parts) < 3:
            return ""
        return parts[2].strip().split()[0]

    def _label_url(self, application_numbers: list[str]) -> str:
        if not application_numbers:
            return "https://open.fda.gov/apis/drug/label/"
        app = str(application_numbers[0]).replace("NDA", "").replace("ANDA", "")
        return f"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={app}"
