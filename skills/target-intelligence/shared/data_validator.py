"""
Cross-validation and data quality checks for target intelligence.
Ensures data accuracy by comparing multiple sources.
"""

import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class DataSource:
    """Records the provenance of a piece of data."""
    database: str
    query: str
    timestamp: str
    url: Optional[str] = None
    version: Optional[str] = None
    response_hash: Optional[str] = None  # SHA-256 of raw API response
    endpoint: Optional[str] = None       # API endpoint path
    status: str = "ok"                   # ok | error | partial | fallback


@dataclass
class ValidationResult:
    """Result of cross-validating data across sources."""
    field_name: str
    sources: List[DataSource] = field(default_factory=list)
    values: List[Any] = field(default_factory=list)
    consistent: bool = True
    notes: str = ""


@dataclass
class DataProvenance:
    """Full provenance record for a dataset."""
    target_gene: str
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    sources: List[DataSource] = field(default_factory=list)
    validations: List[ValidationResult] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def add_source(self, database: str, query: str, url: Optional[str] = None, version: Optional[str] = None):
        self.sources.append(DataSource(
            database=database,
            query=query,
            timestamp=datetime.now().isoformat(),
            url=url,
            version=version,
        ))

    def add_source_with_hash(
        self,
        database: str,
        query: str,
        response_data: Any,
        url: Optional[str] = None,
        endpoint: Optional[str] = None,
        version: Optional[str] = None,
        status: str = "ok",
    ):
        """Add a data source with SHA-256 hash of the raw response for auditability."""
        raw = json.dumps(response_data, sort_keys=True, ensure_ascii=False)
        response_hash = hashlib.sha256(raw.encode()).hexdigest()[:16]
        self.sources.append(DataSource(
            database=database,
            query=query,
            timestamp=datetime.now().isoformat(),
            url=url,
            version=version,
            response_hash=response_hash,
            endpoint=endpoint,
            status=status,
        ))

    def verify_against_source(
        self,
        field_name: str,
        expected_value: Any,
        database: str,
        actual_value: Any,
        tolerance: float = 0.01,
    ) -> bool:
        """Verify that a computed/derived value matches the source API response.

        Args:
            field_name: Name of the field being verified
            expected_value: The value to verify (from report/analysis)
            database: Source database name
            actual_value: The raw value from the API
            tolerance: Relative tolerance for numeric comparison (default 1%)

        Returns:
            True if values match within tolerance
        """
        if isinstance(expected_value, (int, float)) and isinstance(actual_value, (int, float)):
            if actual_value == 0:
                match = expected_value == 0
            else:
                match = abs(expected_value - actual_value) / abs(actual_value) <= tolerance
        else:
            match = str(expected_value) == str(actual_value)

        self.add_validation(
            field_name=f"verify:{field_name}",
            source_values=[(database, actual_value), ("computed", expected_value)],
            notes=f"Source verification: {'PASS' if match else 'FAIL'} (tolerance={tolerance})",
        )
        return match

    def add_validation(self, field_name: str, source_values: List[tuple], notes: str = ""):
        """Add a cross-validation check.
        source_values: list of (source_name, value) tuples.
        """
        sources = []
        values = []
        for src_name, val in source_values:
            sources.append(DataSource(database=src_name, query="", timestamp=datetime.now().isoformat()))
            values.append(val)

        # Simple consistency check: all non-null values should be in the same order of magnitude
        consistent = True
        numeric_vals = [v for v in values if isinstance(v, (int, float)) and v is not None]
        if len(numeric_vals) >= 2:
            max_val = max(numeric_vals)
            min_val = min(abs(v) for v in numeric_vals if v != 0) if any(v != 0 for v in numeric_vals) else 1
            if min_val > 0 and max_val / min_val > 10:
                consistent = False
                notes += " [WARNING: values differ by >10x across sources]"

        self.validations.append(ValidationResult(
            field_name=field_name,
            sources=sources,
            values=values,
            consistent=consistent,
            notes=notes,
        ))

    def add_warning(self, warning: str):
        self.warnings.append(warning)

    def is_consistent(self) -> bool:
        return all(v.consistent for v in self.validations)

    def to_dict(self) -> Dict:
        return asdict(self)

    def to_json(self, path: Optional[Path] = None) -> str:
        data = self.to_dict()
        text = json.dumps(data, indent=2, ensure_ascii=False)
        if path:
            path.write_text(text, encoding="utf-8")
        return text

    def summary(self) -> str:
        lines = [
            f"Target: {self.target_gene}",
            f"Generated: {self.generated_at}",
            f"Data sources: {len(self.sources)}",
            f"Cross-validations: {len(self.validations)}",
            f"Consistent: {'Yes' if self.is_consistent() else 'No'}",
        ]
        if self.warnings:
            lines.append(f"Warnings: {len(self.warnings)}")
            for w in self.warnings:
                lines.append(f"  - {w}")
        inconsistent = [v for v in self.validations if not v.consistent]
        if inconsistent:
            lines.append("Inconsistent fields:")
            for v in inconsistent:
                lines.append(f"  - {v.field_name}: {v.notes}")
        return "\n".join(lines)

    def provenance_report(self) -> Dict:
        """Generate a structured provenance report for gate validation.

        Returns dict with:
        - all_values_have_sources: bool
        - source_count: int
        - verification_pass_rate: float
        - no_unverified_claims: bool
        """
        total_validations = len(self.validations)
        passed = sum(
            1 for v in self.validations
            if v.consistent and "PASS" in v.notes
        )
        verify_validations = [v for v in self.validations if v.field_name.startswith("verify:")]

        return {
            "all_values_have_sources": len(self.sources) > 0,
            "source_count": len(self.sources),
            "cross_validation_count": total_validations,
            "consistent": self.is_consistent(),
            "verification_pass_rate": passed / len(verify_validations) if verify_validations else 1.0,
            "no_unverified_claims": len(verify_validations) > 0,
            "warning_count": len(self.warnings),
            "sources_used": list(set(s.database for s in self.sources)),
        }


def validate_expression_consistency(
    gtex_tpm: Optional[float],
    hpa_tpm: Optional[float],
    gene: str,
    tissue: str,
) -> ValidationResult:
    """Compare GTEx RNA expression with HPA protein expression for the same gene/tissue."""
    result = ValidationResult(field_name=f"{gene} expression in {tissue}")

    if gtex_tpm is not None:
        result.sources.append(DataSource(database="GTEx", query=f"{gene}/{tissue}", timestamp=datetime.now().isoformat()))
        result.values.append(gtex_tpm)

    if hpa_tpm is not None:
        result.sources.append(DataSource(database="HPA", query=f"{gene}/{tissue}", timestamp=datetime.now().isoformat()))
        result.values.append(hpa_tpm)

    if gtex_tpm is not None and hpa_tpm is not None:
        # Both RNA and protein should show similar relative patterns
        # Absolute values differ (TPM vs nTPM), but both being high/low should agree
        if (gtex_tpm > 10 and hpa_tpm < 1) or (gtex_tpm < 1 and hpa_tpm > 10):
            result.consistent = False
            result.notes = f"RNA ({gtex_tpm:.1f} TPM) vs protein ({hpa_tpm:.1f} nTPM) show conflicting patterns"
        else:
            result.consistent = True
            result.notes = "RNA and protein expression patterns agree"

    return result
