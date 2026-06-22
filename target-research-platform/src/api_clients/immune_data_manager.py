"""
Immune infiltration data manager for stage1 analysis.
"""

import csv
import gzip
import math
import warnings
from pathlib import Path
from typing import Optional

from .base_client import APIResponse, BaseAPIClient
from .tcga_client import TCGAClient


class ImmuneDataManager(BaseAPIClient):
    """Provide local or estimated immune infiltration data."""

    IMMUNE_CELLS = [
        "B_cell",
        "CD4_T_cell",
        "CD8_T_cell",
        "Neutrophil",
        "Macrophage",
        "Dendritic_cell",
        "NK_cell",
        "Monocyte",
        "Mast_cell",
        "Eosinophil",
    ]

    TCGA_CANCERS = [
        "ACC", "BLCA", "BRCA", "CESC", "CHOL", "COAD", "DLBC",
        "ESCA", "GBM", "HNSC", "KICH", "KIRC", "KIRP", "LAML",
        "LGG", "LIHC", "LUAD", "LUSC", "MESO", "OV", "PAAD",
        "PCPG", "PRAD", "READ", "SARC", "SKCM", "STAD", "TGCT",
        "THCA", "THYM", "UCEC", "UCS", "UVM",
    ]

    MARKER_GENES = {
        "B_cell": ["CD19", "MS4A1"],
        "CD4_T_cell": ["CD4", "IL7R"],
        "CD8_T_cell": ["CD8A", "CD8B"],
        "Neutrophil": ["FCGR3B", "CSF3R"],
        "Macrophage": ["CD68", "CD163"],
        "Dendritic_cell": ["ITGAX", "HLA-DRA"],
        "NK_cell": ["NCAM1", "KLRD1"],
        "Monocyte": ["CD14", "LILRB1"],
        "Mast_cell": ["KIT", "TPSAB1"],
        "Eosinophil": ["IL5RA", "CLC"],
    }

    def __init__(self, cache_dir: Optional[str] = None, data_dir: Optional[str] = None):
        super().__init__(cache_dir=cache_dir)
        self.data_dir = Path(data_dir) if data_dir else Path("./data/immune_infiltration")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._loaded_data: dict[str, dict] = {}
        self.tcga_client = TCGAClient(cache_dir=cache_dir)

    @property
    def source_name(self) -> str:
        return "ImmuneDataManager"

    @property
    def base_url(self) -> str:
        return ""

    def health_check(self) -> bool:
        return True

    def get_immune_infiltration(self, cancer_type: str, source: str = "auto") -> APIResponse:
        if cancer_type not in self.TCGA_CANCERS:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="get_immune_infiltration",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"Unsupported cancer type: {cancer_type}",
            )

        cache_key = cancer_type if source in ("auto", "local") else f"{cancer_type}:{source}"
        if cache_key in self._loaded_data:
            return APIResponse(
                success=True,
                data=self._loaded_data[cache_key],
                source=self.source_name,
                endpoint="get_immune_infiltration",
                params={"cancer_type": cancer_type, "source": source},
                timestamp="",
            )

        if source == "auto":
            marker_result = self.get_immune_infiltration(cancer_type, source="tcga_marker")
            if marker_result.success:
                return marker_result
            local_result = self._load_local_data(cancer_type)
            if local_result.success:
                self._loaded_data[cancer_type] = local_result.data
                return local_result
            return marker_result

        if source == "local":
            return self._load_local_data(cancer_type)

        if source == "tcga_marker":
            result = self._estimate_from_tcga_expression(cancer_type)
            if result.success:
                self._loaded_data[cache_key] = result.data
            return result

        return APIResponse(
            success=False,
            data=None,
            source=self.source_name,
            endpoint="get_immune_infiltration",
            params={"cancer_type": cancer_type, "source": source},
            timestamp="",
            error=f"Unknown immune source: {source}",
        )

    def _load_local_data(self, cancer_type: str) -> APIResponse:
        for ext in (".csv", ".tsv", ".csv.gz"):
            file_path = self.data_dir / f"{cancer_type}{ext}"
            if file_path.exists():
                return self._parse_immune_file(file_path, cancer_type)

        return APIResponse(
            success=False,
            data=None,
            source=self.source_name,
            endpoint="_load_local_data",
            params={"cancer_type": cancer_type},
            timestamp="",
            error=f"Missing local immune file for {cancer_type}",
        )

    def _parse_immune_file(self, file_path: Path, cancer_type: str) -> APIResponse:
        try:
            open_func = gzip.open if file_path.suffix == ".gz" else open
            mode = "rt" if file_path.suffix == ".gz" else "r"
            delimiter = "\t" if file_path.suffix == ".tsv" else ","
            immune_data: dict[str, dict[str, float]] = {}

            with open_func(file_path, mode, encoding="utf-8") as handle:
                reader = csv.DictReader(handle, delimiter=delimiter)
                for row in reader:
                    sample_id = str(row.get("sample_id", "")).strip()
                    if not sample_id:
                        continue

                    cell_fractions = {}
                    for cell in self.IMMUNE_CELLS:
                        value = row.get(cell, row.get(cell.lower(), ""))
                        if value in ("", None):
                            continue
                        try:
                            cell_fractions[cell] = float(value)
                        except ValueError:
                            continue

                    if cell_fractions:
                        immune_data[sample_id] = cell_fractions

            if not immune_data:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="_parse_immune_file",
                    params={"cancer_type": cancer_type},
                    timestamp="",
                    error="Parsed immune file but found no usable rows",
                )

            self._loaded_data[cancer_type] = immune_data
            return APIResponse(
                success=True,
                data=immune_data,
                source="local_file",
                endpoint=str(file_path),
                params={"cancer_type": cancer_type},
                timestamp="",
            )
        except Exception as exc:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="_parse_immune_file",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"Immune file parse error: {exc}",
            )

    def _estimate_from_tcga_expression(self, cancer_type: str) -> APIResponse:
        warnings.warn(
            f"Using marker-gene fallback immune estimates for {cancer_type}.",
            UserWarning,
        )

        project_id = TCGAClient.TCGA_PROJECTS.get(cancer_type)
        if not project_id:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="_estimate_from_tcga_expression",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"No TCGA project mapping for {cancer_type}",
            )

        sample_gene_values: dict[str, dict[str, float]] = {}
        errors: dict[str, str] = {}
        genes = sorted({gene for markers in self.MARKER_GENES.values() for gene in markers})

        for gene in genes:
            response = self.tcga_client.get_gene_expression_by_project(gene, project_id)
            if not response.success:
                errors[gene] = response.error or "unknown error"
                continue

            for sample in response.data.get("samples", []):
                sample_id = sample.get("sample_id")
                value = sample.get("expression_value")
                if sample_id and value is not None:
                    sample_gene_values.setdefault(sample_id, {})[gene] = float(value)

        if not sample_gene_values:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="_estimate_from_tcga_expression",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"Could not fetch marker genes from TCGA: {errors}",
            )

        normalized_scores = self._normalize_marker_scores(sample_gene_values)
        immune_data: dict[str, dict[str, float]] = {}

        for sample_id, gene_scores in normalized_scores.items():
            cell_scores = {cell: 0.0 for cell in self.IMMUNE_CELLS}
            for cell, markers in self.MARKER_GENES.items():
                values = [gene_scores[gene] for gene in markers if gene in gene_scores]
                if values:
                    cell_scores[cell] = sum(values) / len(values)

            total_score = sum(cell_scores.values())
            if total_score <= 0:
                uniform = round(1.0 / len(self.IMMUNE_CELLS), 6)
                immune_data[sample_id] = {
                    cell: uniform
                    for cell in self.IMMUNE_CELLS
                }
                continue

            immune_data[sample_id] = {
                cell: round(score / total_score, 6)
                for cell, score in cell_scores.items()
            }

        if len(immune_data) < 30:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="_estimate_from_tcga_expression",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"Estimated immune data has too few samples: {len(immune_data)}",
            )

        return APIResponse(
            success=True,
            data=immune_data,
            source=self.source_name,
            endpoint="_estimate_from_tcga_expression",
            params={"cancer_type": cancer_type},
            timestamp="",
        )

    def _normalize_marker_scores(
        self,
        sample_gene_values: dict[str, dict[str, float]],
    ) -> dict[str, dict[str, float]]:
        gene_to_samples: dict[str, list[tuple[str, float]]] = {}

        for sample_id, genes in sample_gene_values.items():
            for gene, value in genes.items():
                gene_to_samples.setdefault(gene, []).append(
                    (sample_id, math.log1p(max(value, 0.0)))
                )

        normalized: dict[str, dict[str, float]] = {}
        for gene, entries in gene_to_samples.items():
            values = [value for _, value in entries]
            min_value = min(values)
            max_value = max(values)
            for sample_id, value in entries:
                if max_value == min_value:
                    score = 0.5
                else:
                    score = (value - min_value) / (max_value - min_value)
                normalized.setdefault(sample_id, {})[gene] = score

        return normalized

    def get_supported_cancers(self) -> list[str]:
        available = []
        for cancer in self.TCGA_CANCERS:
            for ext in (".csv", ".tsv", ".csv.gz"):
                if (self.data_dir / f"{cancer}{ext}").exists():
                    available.append(cancer)
                    break
        return available

    def get_data_status(self) -> dict:
        status = {}
        for cancer in self.TCGA_CANCERS:
            has_local = any(
                (self.data_dir / f"{cancer}{ext}").exists()
                for ext in (".csv", ".tsv", ".csv.gz")
            )
            status[cancer] = {
                "local_data": has_local,
                "in_memory": cancer in self._loaded_data,
            }
        return status
