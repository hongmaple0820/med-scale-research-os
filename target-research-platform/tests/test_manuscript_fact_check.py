from __future__ import annotations

import json
from pathlib import Path

from src.output.manuscript_fact_checker import validate_manuscript_facts


def _write_fact_fixture(tmp_path: Path) -> dict:
    manuscript = tmp_path / "CDK4_breast_cancer_manuscript.md"
    meta = tmp_path / "CDK4_breast_cancer_manuscript_meta.json"
    figure = tmp_path / "figure1.png"
    figure.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 256)
    manuscript.write_text(
        "图1 PMID 12345678 2024 Oncogene CDK4 inhibition in breast cancer "
        "0.527 100 56 168 98.4 0.8 投稿前需专家审校。",
        encoding="utf-8",
    )
    meta.write_text(json.dumps({
        "target": "CDK4",
        "disease": "breast cancer",
        "cancer_types": ["BRCA"],
        "target_druggability": 0.527,
        "pubmed_total": 100,
        "clinical_summary": {"total_trials": 100, "active_trials": 56},
        "milestones": {"total_duration": 168, "total_cost": 98.4, "success_rate": "0.8%"},
        "figures": [{"id": "fig1", "path": str(figure), "relative": "figure1.png"}],
        "references": [{
            "pmid": "12345678",
            "citation_zh": "A. CDK4 inhibition in breast cancer[J]. Oncogene, 2024.",
            "citation_en": "A (2024). CDK4 inhibition in breast cancer. Oncogene.",
        }],
        "literature_reviews": [{
            "index": 1,
            "pmid": "12345678",
            "title": "CDK4 inhibition in breast cancer",
            "year": 2024,
            "journal": "Oncogene",
            "study_design": "临床前/体外研究",
            "publication_types": ["Journal Article"],
        }],
        "claim_ledger": [
            {
                "claim_id": "target_druggability",
                "value": 0.527,
                "source_locator": "stage2.target_druggability",
            },
            {
                "claim_id": "pubmed_total",
                "value": 100,
                "source_locator": "stage3.literature.total_count",
            },
            {
                "claim_id": "clinical_total_trials",
                "value": 100,
                "source_locator": "stage3.clinical.total_trials",
            },
            {
                "claim_id": "clinical_active_trials",
                "value": 56,
                "source_locator": "stage3.clinical.active_trials",
            },
            {
                "claim_id": "development_success_rate",
                "value": "0.8%",
                "source_locator": "stage4.milestones.success_rate",
            },
            {
                "claim_id": "development_total_duration",
                "value": 168,
                "source_locator": "stage4.milestones.total_duration",
            },
            {
                "claim_id": "development_total_cost",
                "value": 98.4,
                "source_locator": "stage4.milestones.total_cost",
            },
        ],
    }, ensure_ascii=False), encoding="utf-8")
    return {"paths": {"markdown": str(manuscript), "metadata": str(meta)}}


def test_fact_check_passes_for_traceable_manuscript(tmp_path: Path):
    report = validate_manuscript_facts(_write_fact_fixture(tmp_path))

    assert report["passed"] is True
    assert report["errors"] == 0
    assert report["source_coverage"]["literature_reviews"] == 1
    assert report["source_coverage"]["figures_checked"] == 1


def test_fact_check_does_not_treat_metastatic_as_meta_analysis(tmp_path: Path):
    result = _write_fact_fixture(tmp_path)
    metadata_path = Path(result["paths"]["metadata"])
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    title = "Single-cell RNA sequencing in metastatic breast cancer"
    metadata["references"][0]["citation_zh"] = f"A. {title}[J]. Oncogene, 2024."
    metadata["references"][0]["citation_en"] = f"A (2024). {title}. Oncogene."
    metadata["literature_reviews"][0]["title"] = title
    metadata["literature_reviews"][0]["study_design"] = "bioinformatics/computational study"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    Path(result["paths"]["markdown"]).write_text(
        f"图 1 figure1.png PMID 12345678 2024 Oncogene CDK4 {title} "
        "0.527 100 56 168 98.4 0.8% 投稿前需专家审校。",
        encoding="utf-8",
    )

    report = validate_manuscript_facts(result)

    assert report["passed"] is True
    assert "study_design.systematic_mismatch" not in {issue["id"] for issue in report["issues"]}


def test_fact_check_detects_bad_pmid_year_figure_and_boundary_claim(tmp_path: Path):
    result = _write_fact_fixture(tmp_path)
    metadata_path = Path(result["paths"]["metadata"])
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["literature_reviews"][0]["pmid"] = "bad-pmid"
    metadata["literature_reviews"][0]["year"] = 2023
    metadata["figures"][0]["path"] = str(tmp_path / "missing.png")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    Path(result["paths"]["markdown"]).write_text(
        "本文证实疗效，可直接用于临床。",
        encoding="utf-8",
    )

    report = validate_manuscript_facts(result)

    assert report["passed"] is False
    issue_ids = {issue["id"] for issue in report["issues"]}
    assert "literature.pmid_missing" in issue_ids
    assert "figures.file_missing" in issue_ids
    assert "boundary.unverified_claim" in issue_ids
    assert report["unverified_claims"]


def test_fact_check_detects_target_disease_and_tcga_contamination(tmp_path: Path):
    result = _write_fact_fixture(tmp_path)
    metadata_path = Path(result["paths"]["metadata"])
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["target"] = "KRAS"
    metadata["disease"] = "pancreatic cancer"
    metadata["cancer_types"] = ["PAAD"]
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False),
        encoding="utf-8",
    )
    Path(result["paths"]["markdown"]).write_text(
        "KRAS pancreatic cancer manuscript with CDK4, HR+ breast cancer and TCGA-BRCA claims.",
        encoding="utf-8",
    )

    report = validate_manuscript_facts(result)

    issue_ids = {issue["id"] for issue in report["issues"]}
    assert report["passed"] is False
    assert "contamination.target_template" in issue_ids
    assert "contamination.disease_template" in issue_ids
    assert "contamination.tcga_cohort" in issue_ids


def test_fact_check_requires_source_locator_for_numeric_claims(tmp_path: Path):
    result = _write_fact_fixture(tmp_path)
    metadata_path = Path(result["paths"]["metadata"])
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["claim_ledger"][0]["source_locator"] = ""
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False),
        encoding="utf-8",
    )

    report = validate_manuscript_facts(result)

    assert report["passed"] is False
    assert "claim_ledger.source_missing" in {
        issue["id"] for issue in report["issues"]
    }
