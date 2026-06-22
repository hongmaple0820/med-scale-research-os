from pathlib import Path
from unittest.mock import patch

from src.output.journal_templates import render_zhonghua_oncology
from src.output.literature_reviewer import LiteratureReviewer, review_literature_for_manuscript
from src.output.manuscript_generator import ManuscriptGenerator


def _pipeline_with_tissues():
    return {
        "stages": {
            "stage1": {
                "success": True,
                "summary": {"confidence_level": "high", "decision_eligible": True, "key_findings": ["高表达"], "data_sources": ["GTEx"], "cancer_types": ["BRCA"]},
                "stages": {
                    "tissue_expression": {"gtex": {"data": {"tissues": {"Breast": 5.0, "Ovary": 12.0, "Lung": 3.0}}}},
                    "tumor_expression": {
                        "cancer_results": {
                            "BRCA": {
                                "success": True,
                                "data": {"samples": [{"expression_value": 100}, {"expression_value": 200}, {"expression_value": 150}]},
                            }
                        }
                    },
                    "survival_analysis": {"cancer_results": {}},
                },
            },
            "stage2": {
                "success": True,
                "summary": {"decision_eligible": True, "top_candidates": [{"gene": "CDK4", "score": 0.72, "druggability_score": 0.53, "class": "druggable"}]},
                "stages": {
                    "source_validation": {
                        "decision_eligible": True,
                        "independent_sources": ["GSE12345", "TCGA-BRCA"],
                    },
                    "differential_expression": {"fallback_source": "TCGA", "method": "limma"},
                    "druggability": {"targets": {"CDK4": {"composite_score": 0.527, "druggability_class": "potentially_druggable", "evidence": ["ChEMBL"]}}},
                },
            },
            "stage3": {
                "success": True,
                "summary": {"developability": {"score": 65, "level": "medium"}, "key_findings": ["100 trials"]},
                "stages": {
                    "literature": {
                        "data": {
                            "search_results": {"total_count": 100},
                            "papers": [{
                                "pmid": "123",
                                "title": "CDK4/6 inhibitor resistance in breast cancer",
                                "authors": ["Zhang L"],
                                "year": 2024,
                                "journal": "Oncogene",
                                "doi": "10.1/example",
                            }],
                        }
                    },
                    "clinical_pipeline": {
                        "data": {
                            "total_trials": 10,
                            "active_trials": 5,
                            "phase_distribution": {"Phase 2": 6, "Phase 3": 4},
                            "status_distribution": {"招募中": 3, "已完成": 2},
                        }
                    },
                    "competitive_landscape": {"data": {"sections": {"competitive_analysis": {"competition_intensity": "high"}}}},
                    "target_function": {"data": {"sections": {"basic_info": {"uniprot_id": "P11802"}, "function": {"function_description": "Cell cycle kinase"}}}},
                    "assessment": {"data": {"pain_points": [{"type": "competition", "severity": "high", "description": "竞争激烈"}]}},
                },
            },
            "stage4": {
                "success": True,
                "modality": "small_molecule",
                "risk_level": "medium",
                "summary": {"milestones": {"total_duration": 120, "total_cost": 80, "success_rate": 0.02}},
                "stages": {"milestones": {"data": {"total_duration_months": 120, "total_cost_estimate": 80, "overall_success_rate": 0.02, "milestones": []}}},
            },
        }
    }


def test_literature_reviewer_rule_based(tmp_path: Path):
    reviewer = LiteratureReviewer(api_key=None)
    reviews = reviewer.review_papers(
        [{"title": "Resistance to CDK4/6 inhibitors", "journal": "Nat Commun", "year": 2024, "pmid": "1", "authors": ["A"]}],
        target="CDK4",
        disease_zh="乳腺癌",
    )
    assert reviews[0]["source"] == "rule_based"
    assert "耐药" in reviews[0]["commentary_zh"] or "CDK4/6" in reviews[0]["commentary_zh"]


@patch("src.output.literature_reviewer.call_chat_completion")
def test_literature_reviewer_emits_medscale_usage_envelope(mock_chat, tmp_path: Path):
    mock_chat.return_value = (
        "This is a sufficiently long medical literature review commentary for the model path.",
        {
            "source": "openai",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "usage": {"prompt_tokens": 900, "completion_tokens": 120, "cache_read_input_tokens": 300},
        },
    )
    reviewer = LiteratureReviewer(api_key="test-key", model="gpt-4o-mini")
    reviews = reviewer.review_papers(
        [{"title": "CDK4 literature", "journal": "Oncogene", "year": 2024, "pmid": "12345678"}],
        target="CDK4",
        disease_zh="breast cancer",
    )

    envelope = reviews[0]["usage_envelope"]
    assert envelope["schema"] == "medscale.usage_envelope.v1"
    assert envelope["usage_id"].startswith("MSU-")
    assert envelope["provider"] == "openai"
    assert envelope["medical_lane"] == "literature"
    assert envelope["usage"]["input_tokens"] == 900
    assert envelope["usage"]["output_tokens"] == 120


@patch("src.output.literature_reviewer.call_chat_completion")
def test_literature_review_result_summarizes_usage_envelopes(mock_chat, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MANUSCRIPT_LLM_API_KEY", "test-key")
    monkeypatch.setenv("MANUSCRIPT_LLM_PROBE", "0")
    mock_chat.return_value = (
        "This is a sufficiently long medical literature review commentary for the model path.",
        {
            "source": "openai",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "usage": {"prompt_tokens": 300, "completion_tokens": 50},
        },
    )

    result = review_literature_for_manuscript(
        [{"title": "CDK4 literature", "journal": "Oncogene", "year": 2024, "pmid": "12345678"}],
        target="CDK4",
        disease_zh="breast cancer",
    )

    assert result["usage_summary"]["total_records"] == 1
    assert result["usage_summary"]["total_tokens"] == 350
    assert result["usage_envelopes"][0]["usage_id"].startswith("MSU-")


@patch("src.output.manuscript_generator.enrich_papers_for_manuscript")
def test_manuscript_generates_figures_and_zhongliu(mock_enrich, tmp_path: Path):
    mock_enrich.return_value = {
        "papers": [{
            "pmid": "123",
            "title": "CDK4/6 inhibitor resistance in breast cancer",
            "authors": ["Zhang L"],
            "year": 2024,
            "journal": "Oncogene",
            "doi": "10.1/example",
            "mesh_terms": ["Breast Neoplasms"],
            "study_design": "机制与转化研究",
            "enrichment_sources": ["pubmed_efetch"],
        }],
        "enrichment": {"pubmed_efetch": True, "aminer_used": False, "mesh_count": 1, "sources": ["pubmed_efetch"]},
    }
    gen = ManuscriptGenerator(str(tmp_path))
    result = gen.generate(_pipeline_with_tissues(), "CDK4", "breast cancer", language="zh")
    assert result["success"]
    assert result["quality_gate"]["passed"] is True
    assert Path(result["paths"]["quality"]).exists()
    assert result["figures"]
    assert Path(result["paths"]["zhongliu"]).exists()
    assert (tmp_path / "figures").exists()
    markdown = Path(result["paths"]["markdown"]).read_text(encoding="utf-8")
    zhongliu = Path(result["paths"]["zhongliu"]).read_text(encoding="utf-8")
    assert "LLM：None" not in markdown
    assert "国家自然科学基金" not in zhongliu
    assert "不存在利益冲突" not in zhongliu
    assert "免予伦理审查" not in zhongliu
    assert "中华肿瘤杂志" in zhongliu
    assert "逐篇文献深度解读" in Path(result["paths"]["markdown"]).read_text(encoding="utf-8")


def test_zhonghua_template_wrapper():
    ctx = {"target": "CDK4", "disease_zh": "乳腺癌", "disease": "breast cancer", "title_zh": "测试题目", "title_en": "Test"}
    out = render_zhonghua_oncology(ctx, "## 1 前言\n\n正文测试。", figures=[{"relative": "figures/a.png", "title_zh": "热图", "title_en": "Heatmap"}])
    assert "【摘要】" in out
    assert "基金项目" in out
