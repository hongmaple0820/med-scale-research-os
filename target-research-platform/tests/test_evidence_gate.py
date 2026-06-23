import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.validators.evidence_gate import (  # noqa: E402
    compare_de_sources,
    evaluate_stage1_evidence,
    evaluate_stage2_evidence,
    evaluate_stage3_evidence,
)
from src.analysis.stage2_screening.pipeline import Stage2Pipeline  # noqa: E402
import main as main_module  # noqa: E402
from main import _evidence_gate_block, run_full_pipeline  # noqa: E402


def _gene(symbol: str, log2fc: float) -> dict:
    return {
        "gene_symbol": symbol,
        "log2fc": log2fc,
        "p_value": 0.001,
        "adjusted_p_value": 0.01,
    }


def test_stage1_blocks_without_hpa_protein_evidence():
    gate = evaluate_stage1_evidence(
        {
            "stages": {
                "tissue_expression": {
                    "gtex": {
                        "success": True,
                        "data": {"tissues": {"lung": {"median": 10}}},
                    },
                    "hpa": {"success": False, "data": {}},
                },
                "tumor_expression": {
                    "cancer_results": {
                        "LUAD": {
                            "success": True,
                            "data": {"samples": [{"sample_id": "S1"}]},
                        }
                    }
                },
                "survival_analysis": {"success": True},
                "immune_correlation": {"success": True},
            }
        }
    )

    assert gate["status"] == "partial"
    assert gate["decision_eligible"] is False
    assert any("HPA" in issue for issue in gate["issues"])


def test_compare_de_sources_verifies_concordant_geo_tcga_results():
    gate = compare_de_sources(
        {
            "success": True,
            "method": "metadata",
            "accession": "GSE12345",
            "disease_samples": 6,
            "control_samples": 6,
            "filter_level": "strict",
            "significant_genes": [
                _gene("A", 1.2),
                _gene("B", -1.5),
                _gene("C", 0.8),
            ],
        },
        {
            "success": True,
            "accession": "TCGA-LUAD",
            "control_samples": 12,
            "significant_genes": [
                _gene("A", 0.7),
                _gene("B", -0.9),
                _gene("C", 1.4),
            ],
        },
    )

    assert gate["decision_eligible"] is True
    assert gate["overlap_count"] == 3
    assert gate["concordance_rate"] == 1.0


def test_compare_de_sources_blocks_positional_or_relaxed_geo_results():
    gate = compare_de_sources(
        {
            "success": True,
            "method": "positional",
            "accession": "GSE12345",
            "disease_samples": 2,
            "control_samples": 2,
            "filter_level": "nominal",
            "significant_genes": [_gene("A", 1.2)],
        },
        {
            "success": True,
            "accession": "TCGA-LUAD",
            "control_samples": 3,
            "significant_genes": [_gene("A", 0.7)],
        },
    )

    assert gate["decision_eligible"] is False
    assert any("position" in issue for issue in gate["issues"])
    assert any("relaxed or nominal" in issue for issue in gate["issues"])


def test_stage2_blocks_tcga_fallback_without_independent_replication_or_method_card():
    gate = evaluate_stage2_evidence(
        {
            "stages": {
                "geo_search": {"success": True, "datasets": [{"accession": "GSE1"}]},
                "differential_expression": {
                    "success": True,
                    "method": "tcga_firebrowse",
                    "fallback_source": "TCGA/FireBrowse",
                    "filter_level": "strict",
                    "significant_genes": [_gene("A", 1.2), _gene("B", -1.0)],
                },
            }
        }
    )

    assert gate["status"] == "blocked"
    assert gate["decision_eligible"] is False
    assert any("single-source" in issue for issue in gate["issues"])
    assert any("GEO-vs-TCGA" in issue for issue in gate["issues"])
    assert any("normalization" in issue for issue in gate["issues"])


def test_stage2_requires_cross_source_replication_and_normalization_method_card():
    cross_source = compare_de_sources(
        {
            "success": True,
            "method": "metadata",
            "accession": "GSE12345",
            "disease_samples": 8,
            "control_samples": 8,
            "filter_level": "strict",
            "significant_genes": [
                _gene("A", 1.0),
                _gene("B", -1.0),
                _gene("C", 1.5),
            ],
        },
        {
            "success": True,
            "accession": "TCGA-LUAD",
            "control_samples": 15,
            "significant_genes": [
                _gene("A", 0.8),
                _gene("B", -0.7),
                _gene("C", 1.2),
            ],
        },
    )

    gate = evaluate_stage2_evidence(
        {
            "stages": {
                "geo_search": {"success": True, "datasets": [{"accession": "GSE12345"}]},
                "differential_expression": {
                    "success": True,
                    "method": "metadata",
                    "filter_level": "strict",
                    "significant_genes": [_gene("A", 1.0), _gene("B", -1.0)],
                    "cross_source_validation": cross_source,
                    "normalization_method_card": {
                        "source_methods": {
                            "GEO": "series-matrix values with metadata grouping",
                            "TCGA": "FireBrowse gene-level RNA-seq differential table",
                        },
                        "cross_source_strategy": "compare effect direction after per-source analysis",
                    },
                },
            }
        }
    )

    assert gate["decision_eligible"] is True
    assert gate["checks"]["cross_source_replication"] is True
    assert gate["checks"]["normalization_method_card"] is True


def test_stage2_pipeline_attaches_tcga_replication_and_validated_genes(tmp_path):
    pipeline = Stage2Pipeline(
        output_dir=str(tmp_path / "stage2"),
        cache_dir=str(tmp_path / "cache"),
    )

    def fake_tcga_de(disease: str, cancer_code: str | None = None) -> dict:
        assert disease == "lung cancer"
        assert cancer_code == "LUAD"
        return {
            "success": True,
            "accession": "TCGA-LUAD",
            "control_samples": 12,
            "significant_genes": [
                _gene("A", 0.8),
                _gene("B", -0.6),
                _gene("C", 1.1),
            ],
        }

    pipeline._run_tcga_differential_expression = fake_tcga_de  # type: ignore[method-assign]
    geo_de = {
        "success": True,
        "method": "metadata",
        "accession": "GSE12345",
        "disease_samples": 6,
        "control_samples": 6,
        "filter_level": "strict",
        "significant_genes": [
            _gene("A", 1.0),
            _gene("B", -1.3),
            _gene("C", 0.7),
            _gene("D", -2.0),
        ],
    }

    result = pipeline._attach_multi_source_validation(
        "lung cancer",
        geo_de,
        "LUAD",
    )

    assert result["cross_source_validation"]["decision_eligible"] is True
    assert result["normalization_method_card"]["schema"] == "medscale.normalization_method_card.v1"
    assert result["multi_source_filter"] == "geo_tcga_concordant_direction"
    assert result["single_source_gene_count"] == 4
    assert result["validated_gene_count"] == 3
    assert [gene["gene_symbol"] for gene in result["significant_genes"]] == ["A", "B", "C"]
    assert set(result["source_significant_genes"]) == {"GEO", "TCGA"}


def test_stage3_blocks_without_patent_and_traceable_market_sources():
    gate = evaluate_stage3_evidence(
        {
            "stages": {
                "literature": {
                    "success": True,
                    "data": {"papers": [{"pmid": "123", "title": "Target study"}]},
                },
                "clinical_pipeline": {
                    "success": True,
                    "data": {"total_trials": 0, "studies": []},
                },
                "competitive_landscape": {
                    "success": True,
                    "data": {"sections": {"market_analysis": {"opportunity": "high"}}},
                },
            }
        }
    )

    assert gate["decision_eligible"] is False
    assert any("Patent" in issue for issue in gate["issues"])
    assert any("Market" in issue for issue in gate["issues"])


def test_stage3_accepts_traceable_literature_clinical_patent_and_market_sources():
    gate = evaluate_stage3_evidence(
        {
            "stages": {
                "literature": {
                    "success": True,
                    "data": {"papers": [{"pmid": "123", "title": "Target study"}]},
                },
                "clinical_pipeline": {
                    "success": True,
                    "data": {"total_trials": 1, "studies": [{"nct_id": "NCT1"}]},
                },
                "competitive_landscape": {
                    "success": True,
                    "data": {
                        "sections": {
                            "patent_landscape": {
                                "total_patents": 1,
                                "recent_patents": [{"publication_number": "US1"}],
                            },
                            "market_analysis": {
                                "data_sources": ["EvaluatePharma"],
                                "source_urls": ["https://example.com/report"],
                                "evidence_records": [{"source_id": "report-1"}],
                            },
                        }
                    },
                },
            }
        }
    )

    assert gate["decision_eligible"] is True
    assert gate["valid_sources"] == [
        "PubMed",
        "ClinicalTrials.gov",
        "Patent source",
        "Market source",
    ]


def test_full_pipeline_strict_evidence_block_payload():
    block = _evidence_gate_block(
        "stage2",
        {
            "validation": {
                "evidence_gate": {
                    "status": "blocked",
                    "confidence": "none",
                    "decision_eligible": False,
                    "independent_sources": ["GSE12345"],
                    "checks": {"cross_source_replication": False},
                    "issues": ["No verified independent GEO-vs-TCGA replication evidence is attached."],
                }
            }
        },
    )

    assert block == {
        "stage": "stage2",
        "status": "blocked",
        "confidence": "none",
        "issues": ["No verified independent GEO-vs-TCGA replication evidence is attached."],
        "checks": {"cross_source_replication": False},
        "valid_sources": ["GSE12345"],
    }


def test_full_pipeline_strict_evidence_stops_before_downstream_stages(monkeypatch, capsys, tmp_path):
    def fake_stage1(args):
        return {
            "success": True,
            "stage": "stage1",
            "ensg_id": "ENSG00000100000",
            "validation": {
                "evidence_gate": {
                    "decision_eligible": True,
                    "status": "verified",
                    "confidence": "high",
                    "issues": [],
                }
            },
        }

    def fake_stage2(args):
        return {
            "success": True,
            "stage": "stage2",
            "validation": {
                "evidence_gate": {
                    "decision_eligible": False,
                    "status": "blocked",
                    "confidence": "none",
                    "independent_sources": ["GSE12345"],
                    "checks": {"cross_source_replication": False},
                    "issues": [
                        "No verified independent GEO-vs-TCGA replication evidence is attached."
                    ],
                }
            },
        }

    def fail_downstream(args):
        raise AssertionError("strict evidence mode should stop before downstream stages")

    monkeypatch.setattr(main_module, "run_stage1", fake_stage1)
    monkeypatch.setattr(main_module, "run_stage2", fake_stage2)
    monkeypatch.setattr(main_module, "run_stage3", fail_downstream)
    monkeypatch.setattr(main_module, "run_stage4", fail_downstream)

    result = run_full_pipeline(
        argparse.Namespace(
            target="CDK4",
            disease="breast cancer",
            cancers=["BRCA"],
            ensg=None,
            modality="small_molecule",
            risk_level="medium",
            output=str(tmp_path),
            cache=str(tmp_path / "cache"),
            json=True,
            strict_evidence=True,
            _tracker=None,
            _run_id="test-run",
        )
    )
    capsys.readouterr()

    assert result["success"] is False
    assert result["blocked_stage"] == "stage2"
    assert "stage3" not in result["stages"]
    assert "stage4" not in result["stages"]
    assert result["evidence_gate"]["issues"] == [
        "No verified independent GEO-vs-TCGA replication evidence is attached."
    ]
