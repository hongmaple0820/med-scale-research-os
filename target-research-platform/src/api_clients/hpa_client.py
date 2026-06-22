"""
Human Protein Atlas (HPA) API client.
"""

from .base_client import BaseAPIClient, APIResponse


class HPAClient(BaseAPIClient):
    """Human Protein Atlas API client."""

    @property
    def source_name(self) -> str:
        return "HPA"

    @property
    def base_url(self) -> str:
        return "https://www.proteinatlas.org"

    def health_check(self) -> bool:
        response = self._make_request(
            "GET",
            "/ENSG00000146648.json",
            use_cache=False,
        )
        return response.success

    def get_protein_expression(self, ensg_id: str) -> APIResponse:
        response = self._make_request("GET", f"/{ensg_id}.json")
        if not response.success:
            return response
        return self._parse_protein_data(response, ensg_id)

    def _parse_protein_data(self, response: APIResponse, ensg_id: str) -> APIResponse:
        try:
            raw_data = response.data
            if not raw_data:
                return response

            protein_data = raw_data[0] if isinstance(raw_data, list) else raw_data

            return APIResponse(
                success=True,
                data={
                    "ensg_id": ensg_id,
                    "gene_name": protein_data.get("Gene", ""),
                    "protein_name": protein_data.get("Gene description", ""),
                    "tissue_expression": self._extract_tissue_expression(protein_data),
                    "cell_type_expression": self._extract_cell_type_expression(protein_data),
                    "subcellular_location": self._extract_subcellular_locations(protein_data),
                    "antibody": protein_data.get("Antibody", []),
                    "protein_tissue_specificity": protein_data.get("Protein tissue specificity", ""),
                    "protein_tissue_distribution": protein_data.get("Protein tissue distribution", ""),
                    "protein_cell_type_specificity": protein_data.get("Protein cell type specificity", ""),
                    "protein_cell_type_distribution": protein_data.get("Protein cell type distribution", ""),
                    "ih_reliability": protein_data.get("Reliability (IH)", ""),
                    "if_reliability": protein_data.get("Reliability (IF)", ""),
                },
                source=self.source_name,
                endpoint=f"/{ensg_id}.json",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp,
            )
        except (KeyError, TypeError, ValueError) as exc:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=f"/{ensg_id}.json",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp,
                error=f"Data parse error: {exc}",
            )

    def _extract_tissue_expression(self, protein_data: dict) -> list[dict]:
        entries: list[dict] = []
        intensities = protein_data.get("Protein tissue specific Intensity")
        reliability = protein_data.get("Reliability (IH)", "")
        distribution = protein_data.get("Protein tissue distribution", "")
        specificity = protein_data.get("Protein tissue specificity", "")

        if isinstance(intensities, dict):
            for tissue, intensity in intensities.items():
                entries.append({
                    "tissue": str(tissue),
                    "intensity": self._coerce_float(intensity),
                    "level": distribution,
                    "specificity": specificity,
                    "reliability": reliability,
                })

        if not entries and (distribution or specificity):
            entries.append({
                "tissue": "summary",
                "intensity": None,
                "level": distribution,
                "specificity": specificity,
                "reliability": reliability,
            })

        return entries

    def _extract_cell_type_expression(self, protein_data: dict) -> list[dict]:
        entries: list[dict] = []
        intensities = protein_data.get("Protein cell type specific Intensity")
        reliability = protein_data.get("Reliability (IH)", "")
        distribution = protein_data.get("Protein cell type distribution", "")
        specificity = protein_data.get("Protein cell type specificity", "")

        if isinstance(intensities, dict):
            for cell_type, intensity in intensities.items():
                entries.append({
                    "cell_type": str(cell_type),
                    "intensity": self._coerce_float(intensity),
                    "level": distribution,
                    "specificity": specificity,
                    "reliability": reliability,
                })

        return entries

    def _extract_subcellular_locations(self, protein_data: dict) -> list[dict]:
        seen: set[str] = set()
        locations: list[dict] = []
        reliability = protein_data.get("Reliability (IF)", "")
        raw_values = (
            protein_data.get("Subcellular location"),
            protein_data.get("Subcellular main location"),
            protein_data.get("Subcellular additional location"),
        )

        for raw in raw_values:
            for value in self._iter_values(raw):
                location = str(value).strip()
                if location and location not in seen:
                    seen.add(location)
                    locations.append({
                        "location": location,
                        "reliability": reliability,
                    })

        return locations

    def _iter_values(self, raw) -> list[str]:
        if isinstance(raw, list):
            return [str(item) for item in raw if str(item).strip()]
        if isinstance(raw, str) and raw.strip():
            return [raw]
        return []

    def _coerce_float(self, value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def get_subcellular_location(self, ensg_id: str) -> APIResponse:
        response = self.get_protein_expression(ensg_id)
        if not response.success:
            return response

        return APIResponse(
            success=True,
            data={
                "ensg_id": ensg_id,
                "subcellular_location": response.data.get("subcellular_location", []),
            },
            source=self.source_name,
            endpoint=f"/{ensg_id}.json",
            params={"ensg_id": ensg_id},
            timestamp=response.timestamp,
        )

    def validate_protein_data(self, data: dict) -> tuple[bool, list[str]]:
        issues = []

        if not data:
            return False, ["Missing protein data"]

        has_tissue_signal = bool(
            data.get("tissue_expression")
            or data.get("protein_tissue_distribution")
            or data.get("protein_tissue_specificity")
            or data.get("cell_type_expression")
            or data.get("protein_cell_type_distribution")
            or data.get("protein_cell_type_specificity")
        )
        if not has_tissue_signal:
            issues.append("Missing protein expression signal")

        if not data.get("subcellular_location"):
            issues.append("Missing subcellular localization data")

        return len(issues) == 0, issues

    def search_gene_by_symbol(self, gene_symbol: str) -> APIResponse:
        return APIResponse(
            success=False,
            data=None,
            source=self.source_name,
            endpoint="/search",
            params={"gene_symbol": gene_symbol},
            timestamp="",
            error="HPA API requires an Ensembl identifier.",
        )
