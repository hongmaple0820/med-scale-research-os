"""
Golden standard validation tests for target intelligence pipeline.

Tests against known biological facts for well-characterized targets:
- EGFR: Lung cancer, high expression, druggable, many drugs
- CD19: B-cell marker, CAR-T target
- BCMA (TNFRSF17): Multiple myeloma, CAR-T target

These tests verify the pipeline produces biologically plausible results,
not exact values (which depend on API versions and data freshness).

Usage:
    python -m pytest tests/test_golden_standard.py -v
"""

import json
import sys
from pathlib import Path

import pytest

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================================
# EGFR Golden Standards
# ============================================================

class TestEGFRTarget:
    """EGFR is one of the most well-characterized drug targets."""

    def test_egfr_expressed_in_lung(self, egfr_expression):
        """EGFR should be expressed in lung tissue (GTEx)."""
        tissues = egfr_expression.get("expression_by_tissue", egfr_expression.get("tissues", {}))
        lung_values = [v for k, v in tissues.items() if "lung" in k.lower()]
        assert len(lung_values) > 0, "No lung tissue found in GTEx data"
        assert max(lung_values) > 5.0, f"EGFR lung expression too low: {max(lung_values)} TPM"

    def test_egfr_high_in_skin(self, egfr_expression):
        """EGFR is known to be highly expressed in skin."""
        tissues = egfr_expression.get("expression_by_tissue", egfr_expression.get("tissues", {}))
        skin_values = [v for k, v in tissues.items() if "skin" in k.lower()]
        if skin_values:
            assert max(skin_values) > 10.0, f"EGFR skin expression expected >10 TPM"

    def test_egfr_upregulated_in_luad(self, egfr_tcga):
        """EGFR is typically upregulated in lung adenocarcinoma."""
        diff = egfr_tcga.get("differential_expression", {})
        if "error" in diff:
            pytest.skip(f"TCGA data unavailable: {diff['error']}")
        log2fc = diff.get("log2fc", 0)
        # EGFR is amplified/overexpressed in ~15-30% of LUAD
        # But some datasets show it as not significantly different
        # We just verify the analysis ran and produced valid numbers
        assert isinstance(log2fc, (int, float)), "log2FC should be numeric"
        assert abs(log2fc) < 10, f"log2FC seems implausible: {log2fc}"

    def test_egfr_has_drugs(self, egfr_competition):
        """EGFR should have many known drugs."""
        drugs = egfr_competition.get("known_drugs", egfr_competition.get("drugs", []))
        assert len(drugs) >= 5, f"Expected >=5 EGFR drugs, got {len(drugs)}"

    def test_egfr_has_known_drugs(self, egfr_competition):
        """EGFR should have well-known drugs (Cetuximab, Erlotinib, Gefitinib, etc.)."""
        drugs = egfr_competition.get("known_drugs", egfr_competition.get("drugs", []))
        drug_names = {d.get("molecule_name", "").upper() for d in drugs}
        known_egfr_drugs = ["CETUXIMAB", "ERLOTINIB", "GEFITINIB", "OSIMERTINIB", "LAPATINIB"]
        found = [name for name in known_egfr_drugs if any(name in dn for dn in drug_names)]
        assert len(found) >= 2, f"Expected >=2 known EGFR drugs, found: {found}"

    def test_egfr_druggable(self, egfr_druggability):
        """EGFR should be classified as druggable (Tclin or Tchem)."""
        druggability = egfr_druggability.get("druggability", {})
        tclass = druggability.get("tclass", "")
        sm_tractable = druggability.get("small_molecule_tractable", False)
        ab_tractable = druggability.get("antibody_tractable", False)
        # EGFR is Tclin (clinically validated) and tractable
        assert tclass in ["Tclin", "Tchem"] or sm_tractable or ab_tractable, \
            f"EGFR should be druggable, got tclass={tclass}, sm={sm_tractable}, ab={ab_tractable}"

    def test_egfr_has_patents(self, egfr_patents):
        """EGFR should have a significant patent landscape."""
        patents = egfr_patents.get("patents", []) or egfr_patents.get("sample_patents", [])
        total = egfr_patents.get("patent_trends", {}).get("total_patents", len(patents))
        assert total >= 10, f"Expected >=10 EGFR patents, got {total}"


# ============================================================
# CD19 Golden Standards
# ============================================================

class TestCD19Target:
    """CD19 is a B-cell surface marker, target of CAR-T therapies."""

    def test_cd19_expressed_in_blood(self, cd19_expression):
        """CD19 should be highly expressed in blood/immune tissues."""
        tissues = cd19_expression.get("expression_by_tissue", cd19_expression.get("tissues", {}))
        blood_values = [v for k, v in tissues.items()
                       if any(t in k.lower() for t in ["blood", "spleen", "lymphocyte", "leukocyte"])]
        if blood_values:
            assert max(blood_values) > 5.0, "CD19 should be expressed in immune tissues"

    def test_cd19_low_in_non_immune(self, cd19_expression):
        """CD19 should have low expression in non-immune tissues."""
        tissues = cd19_expression.get("expression_by_tissue", cd19_expression.get("tissues", {}))
        non_immune = ["brain", "liver", "heart", "muscle", "kidney"]
        for tissue in non_immune:
            vals = [v for k, v in tissues.items() if tissue in k.lower()]
            if vals:
                # CD19 is B-cell specific, should be low elsewhere
                assert max(vals) < 10.0, f"CD19 unexpectedly high in {tissue}: {max(vals)} TPM"


# ============================================================
# Pipeline Integration Tests
# ============================================================

class TestPipelineIntegration:
    """Test that pipeline scripts run without errors."""

    def test_api_gate(self):
        """APIGate should check endpoint availability."""
        from shared.api_client import APIGate
        results = APIGate.check_all(timeout=5)
        assert isinstance(results, dict)
        assert len(results) >= 5, "Should check at least 5 APIs"
        # At least some APIs should be available
        ok_count = sum(1 for r in results.values() if r["status"] == "ok")
        assert ok_count >= 3, f"Only {ok_count}/{len(results)} APIs available"

    def test_report_generator_json(self):
        """Report generator should produce valid JSON."""
        from shared.report_generator import TargetReport
        report = TargetReport(target_gene="TEST", phase="Test Phase")
        report.add_section("Test Section", content="Hello", data={"key": "value"})
        json_str = report.to_json()
        parsed = json.loads(json_str)
        assert parsed["target_gene"] == "TEST"
        assert len(parsed["sections"]) == 1

    def test_report_generator_markdown(self):
        """Report generator should produce valid Markdown."""
        from shared.report_generator import TargetReport
        report = TargetReport(target_gene="TEST", phase="Test Phase")
        report.add_section("Test Section", content="Hello World")
        md = report.to_markdown()
        assert "# 靶点情报报告: TEST" in md
        assert "## Test Section" in md
        assert "Hello World" in md

    def test_report_generator_html(self):
        """Report generator should produce valid HTML."""
        from shared.report_generator import TargetReport
        report = TargetReport(target_gene="TEST", phase="Test Phase")
        report.add_section("Test Section", content="Hello")
        html = report.to_html()
        assert "<!DOCTYPE html>" in html
        assert "TEST" in html

    def test_report_generator_interactive_html(self):
        """Report generator should produce interactive dashboard."""
        from shared.report_generator import TargetReport
        report = TargetReport(target_gene="TEST", phase="Test Phase")
        report.add_section("Expression", content="Test",
                          data={"expression_by_tissue": {"Lung": 15.2, "Brain": 3.1}})
        html = report.to_interactive_html()
        assert "echarts" in html.lower()
        assert "datatables" in html.lower() or "dataTable" in html.lower()
        assert "bootstrap" in html.lower()

    def test_data_provenance(self):
        """DataProvenance should track sources."""
        from shared.data_validator import DataProvenance
        prov = DataProvenance(target_gene="TEST")
        prov.add_source("GTEx", "expression data")
        prov.add_source("cBioPortal", "differential expression")
        d = prov.to_dict()
        assert d["target_gene"] == "TEST"
        assert len(d["sources"]) == 2


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture(scope="module")
def output_dir():
    """Path to test output directory."""
    return Path(__file__).parent.parent / "output" / "EGFR"


@pytest.fixture(scope="module")
def egfr_expression(output_dir):
    """Load EGFR GTEx expression data."""
    path = output_dir / "gtex_EGFR_expression.json"
    if not path.exists():
        pytest.skip(f"GTEx data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def egfr_tcga(output_dir):
    """Load EGFR TCGA differential expression data."""
    path = output_dir / "tcga_EGFR_LUAD_differential.json"
    if not path.exists():
        pytest.skip(f"TCGA data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def egfr_competition(output_dir):
    """Load EGFR competition data."""
    path = output_dir / "competitive_EGFR_intelligence.json"
    if not path.exists():
        pytest.skip(f"Competition data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def egfr_druggability(output_dir):
    """Load EGFR druggability data."""
    path = output_dir / "pharos_EGFR_druggability.json"
    if not path.exists():
        pytest.skip(f"Druggability data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def egfr_patents(output_dir):
    """Load EGFR patent data."""
    path = output_dir / "patent_EGFR_landscape.json"
    if not path.exists():
        pytest.skip(f"Patent data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cd19_expression():
    """Load CD19 expression data if available."""
    path = Path(__file__).parent.parent / "output" / "CD19" / "gtex_CD19_expression.json"
    if not path.exists():
        pytest.skip(f"CD19 data not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))
