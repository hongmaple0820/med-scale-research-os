"""
Cross-validation engine for target intelligence.

每个数据声明需要 2+ 独立来源验证。
冲突时取中位数并标注不一致。

Usage:
    from shared.cross_validator import CrossValidator
    cv = CrossValidator(gene="EGFR")
    result = cv.validate_expression("Lung", gtex_tpm=85.3, hpa_tpm=12.0)
"""

import json
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .data_validator import DataProvenance, DataSource


VALIDATION_MATRIX = {
    "expression": {
        "sources": ["gtex", "cbioportal", "timer"],
        "metric": "direction",
        "min_sources": 2,
    },
    "survival": {
        "sources": ["cbioportal"],
        "metric": "hr_direction",
        "min_sources": 1,
    },
    "immune": {
        "sources": ["timer", "cbioportal_marker"],
        "metric": "correlation_direction",
        "min_sources": 2,
    },
    "druggability": {
        "sources": ["open_targets", "pharos"],
        "metric": "tractability_class",
        "min_sources": 1,
    },
}


@dataclass
class ConflictRecord:
    """Records a conflict between data sources."""
    field_name: str
    source_values: List[Tuple[str, Any]]
    resolution: str
    resolved_value: Any
    confidence: str  # "high", "medium", "low"


@dataclass
class CrossValidationResult:
    """Result of cross-validating a single data point."""
    field_name: str
    sources: List[str]
    values: List[Any]
    consistent: bool
    resolved_value: Any
    confidence: str
    notes: str
    conflict: Optional[ConflictRecord] = None


class CrossValidator:
    """Cross-validate data across multiple authoritative sources.

    Rules:
    - Each numerical claim needs 2+ independent sources
    - Conflicts > 10x are flagged as inconsistent
    - Resolution: median of valid values, with confidence rating
    - All validations are recorded in provenance
    """

    def __init__(self, gene: str, provenance: Optional[DataProvenance] = None):
        self.gene = gene
        self.provenance = provenance or DataProvenance(target_gene=gene)
        self.results: List[CrossValidationResult] = []

    def validate_expression(
        self,
        tissue: str,
        gtex_tpm: Optional[float] = None,
        hpa_tpm: Optional[float] = None,
        tcga_tpm: Optional[float] = None,
    ) -> CrossValidationResult:
        """Cross-validate expression data across GTEx, HPA, TCGA.

        Args:
            tissue: Tissue name (e.g., "Lung")
            gtex_tpm: GTEx median TPM
            hpa_tpm: HPA protein expression (nTPM or antibody staining)
            tcga_tpm: TCGA tumor expression (TPM or RSEM)

        Returns:
            CrossValidationResult with resolved value and confidence
        """
        sources = []
        values = []

        if gtex_tpm is not None:
            sources.append("GTEx")
            values.append(gtex_tpm)
        if hpa_tpm is not None:
            sources.append("HPA")
            values.append(hpa_tpm)
        if tcga_tpm is not None:
            sources.append("TCGA")
            values.append(tcga_tpm)

        return self._validate_numeric(
            field_name=f"{self.gene} expression in {tissue}",
            sources=sources,
            values=values,
            tolerance_factor=10.0,  # RNA vs protein can differ significantly
        )

    def validate_survival_hr(
        self,
        cancer_type: str,
        cbioportal_hr: Optional[float] = None,
        literature_hr: Optional[float] = None,
    ) -> CrossValidationResult:
        """Cross-validate survival hazard ratio.

        Args:
            cancer_type: TCGA cancer type
            cbioportal_hr: HR from cBioPortal/Cox regression
            literature_hr: HR from published literature
        """
        sources = []
        values = []

        if cbioportal_hr is not None:
            sources.append("cBioPortal")
            values.append(cbioportal_hr)
        if literature_hr is not None:
            sources.append("Literature")
            values.append(literature_hr)

        return self._validate_numeric(
            field_name=f"{self.gene} survival HR in {cancer_type}",
            sources=sources,
            values=values,
            tolerance_factor=2.0,  # HR should be more consistent
        )

    def validate_target_disease_score(
        self,
        disease: str,
        opentargets_score: Optional[float] = None,
        disgenet_score: Optional[float] = None,
    ) -> CrossValidationResult:
        """Cross-validate target-disease association scores.

        Args:
            disease: Disease name
            opentargets_score: Open Targets association score (0-1)
            disgenet_score: DisGeNET GDA score (0-1)
        """
        sources = []
        values = []

        if opentargets_score is not None:
            sources.append("OpenTargets")
            values.append(opentargets_score)
        if disgenet_score is not None:
            sources.append("DisGeNET")
            values.append(disgenet_score)

        return self._validate_numeric(
            field_name=f"{self.gene}-{disease} association",
            sources=sources,
            values=values,
            tolerance_factor=3.0,
        )

    def validate_druggability(
        self,
        pharos_tdl: Optional[str] = None,
        opentargets_druggability: Optional[float] = None,
        cansar_druggability: Optional[str] = None,
    ) -> CrossValidationResult:
        """Cross-validate druggability classification.

        Args:
            pharos_tdl: Pharos TDL class (Tclin/Tchem/Tbio/Tdark)
            opentargets_druggability: Open Targets druggability score (0-1)
            cansar_druggability: canSAR druggability classification
        """
        sources = []
        values = []

        if pharos_tdl is not None:
            sources.append("Pharos")
            values.append(pharos_tdl)
        if opentargets_druggability is not None:
            sources.append("OpenTargets")
            values.append(opentargets_druggability)
        if cansar_druggability is not None:
            sources.append("canSAR")
            values.append(cansar_druggability)

        # For categorical + numeric mix, check consistency
        consistent = True
        notes = ""
        resolved = None
        confidence = "low"

        if len(sources) < 2:
            notes = f"Only {len(sources)} source(s). Need 2+ for cross-validation."
            confidence = "low"
            resolved = values[0] if values else None
        else:
            # Check if Pharos TDL agrees with Open Targets score
            if pharos_tdl and opentargets_druggability is not None:
                tdl_druggable = pharos_tdl in ("Tclin", "Tchem")
                ot_druggable = opentargets_druggability > 0.5
                if tdl_druggable == ot_druggable:
                    consistent = True
                    confidence = "high"
                    notes = "Pharos TDL and Open Targets druggability agree"
                else:
                    consistent = False
                    confidence = "medium"
                    notes = f"Pharos={pharos_tdl} vs OT={opentargets_druggability:.2f} — partial disagreement"

            # Resolve: prefer Pharos TDL (most established)
            resolved = pharos_tdl or cansar_druggability or opentargets_druggability

        result = CrossValidationResult(
            field_name=f"{self.gene} druggability",
            sources=sources,
            values=values,
            consistent=consistent,
            resolved_value=resolved,
            confidence=confidence,
            notes=notes,
        )
        self.results.append(result)
        self._record_provenance(result)
        return result

    def validate_immune_correlation(
        self,
        cancer_type: str,
        cell_type: str,
        timer_corr: Optional[float] = None,
        tcga_corr: Optional[float] = None,
    ) -> CrossValidationResult:
        """Cross-validate immune cell correlation coefficients."""
        sources = []
        values = []

        if timer_corr is not None:
            sources.append("TIMER")
            values.append(timer_corr)
        if tcga_corr is not None:
            sources.append("TCGA_direct")
            values.append(tcga_corr)

        return self._validate_numeric(
            field_name=f"{self.gene}-{cell_type} correlation in {cancer_type}",
            sources=sources,
            values=values,
            tolerance_factor=2.0,
        )

    def _validate_numeric(
        self,
        field_name: str,
        sources: List[str],
        values: List[Any],
        tolerance_factor: float = 10.0,
    ) -> CrossValidationResult:
        """Generic numeric cross-validation.

        Args:
            field_name: Name of the data field
            sources: List of source names
            values: List of numeric values
            tolerance_factor: Max ratio between values before flagging inconsistency
        """
        if len(sources) == 0:
            result = CrossValidationResult(
                field_name=field_name,
                sources=[],
                values=[],
                consistent=False,
                resolved_value=None,
                confidence="none",
                notes="No data sources provided",
            )
            self.results.append(result)
            return result

        if len(sources) == 1:
            result = CrossValidationResult(
                field_name=field_name,
                sources=sources,
                values=values,
                consistent=True,  # Can't conflict with single source
                resolved_value=values[0],
                confidence="low",
                notes=f"Only 1 source ({sources[0]}). Needs 2+ for cross-validation.",
            )
            self.results.append(result)
            self._record_provenance(result)
            return result

        # Multiple sources: check consistency
        numeric_vals = [v for v in values if isinstance(v, (int, float)) and v is not None]
        consistent = True
        notes = ""
        conflict = None

        if len(numeric_vals) >= 2:
            abs_vals = [abs(v) for v in numeric_vals if v != 0]
            if abs_vals:
                max_val = max(abs_vals)
                min_val = min(abs_vals)
                if min_val > 0 and max_val / min_val > tolerance_factor:
                    consistent = False
                    notes = f"Values differ by {max_val / min_val:.1f}x (tolerance: {tolerance_factor}x)"
                    conflict = ConflictRecord(
                        field_name=field_name,
                        source_values=list(zip(sources, values)),
                        resolution="median",
                        resolved_value=statistics.median(numeric_vals),
                        confidence="low",
                    )

        # Resolve: median of valid values
        if numeric_vals:
            resolved = statistics.median(numeric_vals)
            confidence = "high" if consistent else "medium"
        else:
            resolved = values[0] if values else None
            confidence = "low"

        if consistent:
            notes = f"{len(sources)} sources agree (within {tolerance_factor}x tolerance)"

        result = CrossValidationResult(
            field_name=field_name,
            sources=sources,
            values=values,
            consistent=consistent,
            resolved_value=resolved,
            confidence=confidence,
            notes=notes,
            conflict=conflict,
        )
        self.results.append(result)
        self._record_provenance(result)
        return result

    def _record_provenance(self, result: CrossValidationResult):
        """Record validation result in provenance tracker."""
        source_values = list(zip(result.sources, result.values))
        self.provenance.add_validation(
            field_name=result.field_name,
            source_values=source_values,
            notes=result.notes,
        )

    def get_all_results(self) -> List[CrossValidationResult]:
        return self.results

    def get_conflicts(self) -> List[CrossValidationResult]:
        return [r for r in self.results if not r.consistent]

    def get_confidence_summary(self) -> Dict[str, int]:
        summary = {"high": 0, "medium": 0, "low": 0, "none": 0}
        for r in self.results:
            summary[r.confidence] = summary.get(r.confidence, 0) + 1
        return summary

    def to_dict(self) -> Dict:
        return {
            "gene": self.gene,
            "total_validations": len(self.results),
            "consistent": all(r.consistent for r in self.results),
            "conflicts": len(self.get_conflicts()),
            "confidence_summary": self.get_confidence_summary(),
            "results": [asdict(r) for r in self.results],
        }

    def to_json(self, path: Optional[Path] = None) -> str:
        text = json.dumps(self.to_dict(), indent=2, ensure_ascii=False, default=str)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text

    def validate_with_matrix(self, category: str, results: list) -> dict:
        """
        根据验证矩阵强制检查多源一致性。

        Args:
            category: 验证类别（expression/survival/immune/druggability）
            results: 各数据源返回的结果列表，每项需包含 source 和 data 字段

        Returns:
            dict with keys: confidence, data, warning, sources_checked
        """
        if category not in VALIDATION_MATRIX:
            return {"confidence": "NO_DATA", "data": [], "warning": f"Unknown category: {category}"}

        config = VALIDATION_MATRIX[category]
        valid = [r for r in results if r is not None and r.get("data")]

        if len(valid) == 0:
            return {"confidence": "NO_DATA", "data": [], "warning": "No data from any source"}

        sources_checked = [r["source"] for r in valid]

        if len(valid) >= config["min_sources"]:
            if config["metric"] == "direction":
                directions = set()
                for r in valid:
                    d = r["data"].get("direction", "unknown")
                    directions.add(d)
                if len(directions) == 1:
                    return {"confidence": "HIGH", "data": valid, "warning": None, "sources_checked": sources_checked}
                else:
                    return {
                        "confidence": "CONFLICT",
                        "data": valid,
                        "warning": f"方向不一致: {sources_checked}",
                        "sources_checked": sources_checked,
                    }
            elif config["metric"] == "correlation_direction":
                directions = set()
                for r in valid:
                    corr = r["data"].get("correlation", 0)
                    directions.add("positive" if corr > 0 else "negative")
                if len(directions) == 1:
                    return {"confidence": "HIGH", "data": valid, "warning": None, "sources_checked": sources_checked}
                else:
                    return {
                        "confidence": "CONFLICT",
                        "data": valid,
                        "warning": f"相关性方向不一致: {sources_checked}",
                        "sources_checked": sources_checked,
                    }
            else:
                if len(valid) >= 2:
                    return {"confidence": "HIGH", "data": valid, "warning": None, "sources_checked": sources_checked}
                return {"confidence": "MEDIUM", "data": valid, "warning": None, "sources_checked": sources_checked}

        return {"confidence": "MEDIUM", "data": valid, "warning": None, "sources_checked": sources_checked}

    def summary(self) -> str:
        lines = [
            f"Cross-Validation Report: {self.gene}",
            f"  Total validations: {len(self.results)}",
            f"  Consistent: {sum(1 for r in self.results if r.consistent)}/{len(self.results)}",
            f"  Conflicts: {len(self.get_conflicts())}",
            f"  Confidence: {self.get_confidence_summary()}",
        ]
        for r in self.results:
            status = "OK" if r.consistent else "CONFLICT"
            lines.append(f"  [{status}] {r.field_name}: {r.notes}")
        return "\n".join(lines)
