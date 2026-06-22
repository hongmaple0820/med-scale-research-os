from pathlib import Path

from src.output.manuscript_generator import ManuscriptGenerator, generate_manuscript_from_stages


def _minimal_pipeline() -> dict:
    return {
        "stages": {
            "stage1": {
                "success": True,
                "summary": {
                    "confidence_level": "medium",
                    "decision_eligible": True,
                    "key_findings": ["High expression in testis"],
                    "data_sources": ["GTEx", "TCGA"],
                    "tissue_expression": {
                        "gtex": {"tissues": {"Testis": 12.5, "Brain": 3.2}}
                    },
                },
                "stages": {
                    "survival": {
                        "cancer_results": {
                            "BRCA": {
                                "success": True,
                                "data": {"hr": 1.42, "p_value": 0.03},
                            }
                        }
                    }
                },
            },
            "stage2": {
                "success": True,
                "summary": {
                    "decision_eligible": True,
                    "top_targets": [
                        {"gene": "TP53", "composite_score": 0.91},
                        {"gene": "CDK4", "composite_score": 0.72},
                    ],
                    "data_sources": ["OpenTargets"],
                },
                "stages": {
                    "source_validation": {
                        "decision_eligible": True,
                        "independent_sources": ["GSE12345", "TCGA-BRCA"],
                    },
                    "differential_expression": {
                        "fallback_source": "TCGA-BRCA",
                        "method": "limma",
                    }
                },
            },
            "stage3": {
                "success": True,
                "summary": {
                    "developability": {"score": 68, "level": "moderate"},
                    "data_sources": ["PubMed", "ClinicalTrials.gov"],
                },
                "stages": {
                    "literature": {
                        "data": {
                            "search_results": {"total_count": 120},
                            "papers": [
                                {
                                    "pmid": "12345678",
                                    "title": "CDK4 inhibition in breast cancer",
                                    "authors": ["Smith J", "Lee K"],
                                    "year": 2022,
                                    "journal": "Oncogene",
                                    "doi": "10.1038/example",
                                }
                            ],
                        }
                    },
                    "clinical_pipeline": {
                        "data": {
                            "sections": {
                                "clinical_pipeline": {
                                    "summary": {
                                        "total_trials": 45,
                                        "active_trials": 12,
                                    }
                                },
                                "competitive_landscape": {
                                    "competition_intensity": "high",
                                },
                            }
                        }
                    },
                },
            },
            "stage4": {
                "success": True,
                "summary": {
                    "milestones": {
                        "total_duration": 168,
                        "total_cost": 98.4,
                        "success_rate": 0.01,
                    }
                },
                "stages": {
                    "milestones": {
                        "data": {
                            "overall_success_rate": 0.01,
                            "total_duration_months": 168,
                            "total_cost_estimate": 98.4,
                        }
                    }
                },
            },
        }
    }


def test_manuscript_generator_writes_chinese_imrad(tmp_path: Path):
    generator = ManuscriptGenerator(str(tmp_path))
    result = generator.generate(_minimal_pipeline(), "CDK4", "breast cancer", language="zh")

    assert result["success"] is True
    assert result["language"] == "zh"
    md_path = Path(result["paths"]["markdown"])
    assert md_path.exists()
    text = md_path.read_text(encoding="utf-8")
    assert "基于多组学与临床注册数据" in text
    assert "## 摘要" in text
    assert "## 1 引言" in text
    assert "乳腺癌" in text
    assert "参考文献" in text
    assert result["reference_count"] >= 1
    assert result["char_count"] > 3000
    assert "disclaimer" in result
    assert Path(result["paths"]["claim_ledger"]).exists()


def test_generate_manuscript_from_stages_on_disk(tmp_path: Path):
    output = tmp_path / "output"
    stages = _minimal_pipeline()["stages"]
    stages["stage1"]["stages"] = {
        "tissue_expression": {
            "gtex": {"data": {"tissues": {"Breast": 5.0, "Ovary": 12.0}, "unit": "TPM"}},
        },
        "tumor_expression": {
            "cancer_results": {
                "BRCA": {
                    "success": True,
                    "data": {"samples": [{"expression_value": 100}, {"expression_value": 200}]},
                }
            }
        },
        "survival_analysis": {"cancer_results": {}},
    }
    stages["stage3"]["stages"]["clinical_pipeline"] = {
        "data": {
            "total_trials": 45,
            "active_trials": 12,
            "phase_distribution": {"Phase 2": 20, "Phase 3": 10},
        }
    }
    (output / "manuscripts").mkdir(parents=True, exist_ok=True)

    result = generate_manuscript_from_stages(
        output,
        "CDK4",
        "breast cancer",
        stages["stage1"],
        stages["stage2"],
        stages["stage3"],
        stages["stage4"],
    )

    assert result["success"] is True
    assert Path(result["paths"]["markdown"]).name == "CDK4_breast_cancer_manuscript.md"


def test_manuscript_generation_blocks_unready_upstream_evidence(tmp_path: Path):
    pipeline = _minimal_pipeline()
    pipeline["stages"]["stage2"]["summary"]["decision_eligible"] = False
    pipeline["stages"]["stage2"]["stages"]["source_validation"]["decision_eligible"] = False

    result = ManuscriptGenerator(str(tmp_path)).generate(
        pipeline,
        "CDK4",
        "breast cancer",
    )

    assert result["success"] is False
    assert result["status"] == "blocked"
    assert "stage2_evidence did not pass" in result["readiness"]["issues"]
    assert result["paths"] == {}
