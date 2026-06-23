"""
阶段3测试
"""
import pytest
import sys
from pathlib import Path

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.api_clients.clinicaltrials_client import ClinicalTrialsClient
from src.analysis.stage3_deep_research.target_function import TargetFunctionAnalyzer
from src.analysis.stage3_deep_research.competitive_landscape import CompetitiveAnalyzer


class TestClinicalTrialsClient:
    """测试ClinicalTrials客户端"""

    def test_source_name(self):
        """测试数据源名称"""
        client = ClinicalTrialsClient()
        assert client.source_name == "ClinicalTrials.gov"

    def test_base_url(self):
        """测试基础URL"""
        client = ClinicalTrialsClient()
        assert "clinicaltrials.gov" in client.base_url

    def test_phase_mapping(self):
        """测试阶段映射"""
        assert ClinicalTrialsClient.PHASE_MAPPING["PHASE1"] == "Phase 1"
        assert ClinicalTrialsClient.PHASE_MAPPING["PHASE3"] == "Phase 3"

    def test_status_mapping(self):
        """测试状态映射"""
        assert ClinicalTrialsClient.STATUS_MAPPING["RECRUITING"] == "招募中"
        assert ClinicalTrialsClient.STATUS_MAPPING["COMPLETED"] == "已完成"

    def test_validate_study_valid(self):
        """测试有效试验验证"""
        client = ClinicalTrialsClient()

        study = {
            "nct_id": "NCT12345678",
            "title": "Test Study",
            "status": "RECRUITING"
        }

        is_valid, issues = client.validate_study(study)
        assert is_valid is True

    def test_validate_study_missing_nct(self):
        """测试缺少NCT编号"""
        client = ClinicalTrialsClient()

        study = {
            "title": "Test Study",
            "status": "RECRUITING"
        }

        is_valid, issues = client.validate_study(study)
        assert is_valid is False
        assert any("NCT编号" in issue for issue in issues)


class TestTargetFunctionAnalyzer:
    """测试靶点功能分析器"""

    def test_analyzer_initialization(self):
        """测试分析器初始化"""
        analyzer = TargetFunctionAnalyzer()
        assert len(analyzer.results) == 0

    def test_extract_basic_info(self):
        """测试提取基本信息"""
        analyzer = TargetFunctionAnalyzer()

        uniprot_data = {
            "uniprot_id": "P11309",
            "gene_name": "CDK4",
            "protein_name": "Cyclin-dependent kinase 4",
            "organism": "Homo sapiens",
            "sequence_length": 303,
            "molecular_weight": 33000
        }

        result = analyzer._extract_basic_info(uniprot_data)
        assert result["uniprot_id"] == "P11309"
        assert result["gene_name"] == "CDK4"

    def test_extract_function(self):
        """测试提取功能描述"""
        analyzer = TargetFunctionAnalyzer()

        uniprot_data = {
            "function": [
                "Serine/threonine-protein kinase involved in cell cycle control.",
                "Phosphorylates RB1 resulting in cell cycle progression."
            ]
        }

        result = analyzer._extract_function(uniprot_data)
        assert "Serine/threonine-protein kinase" in result["function_description"]

    def test_extract_domains(self):
        """测试提取结构域"""
        analyzer = TargetFunctionAnalyzer()

        uniprot_data = {
            "domains": [
                {"name": "Protein kinase", "start": 10, "end": 290, "description": "Kinase domain"},
                {"name": "ATP binding", "start": 20, "end": 50, "description": "ATP binding site"}
            ]
        }

        result = analyzer._extract_domains(uniprot_data)
        assert len(result) == 2
        assert result[0]["name"] == "Protein kinase"

    def test_generate_encyclopedia(self):
        """测试生成百科全书摘要"""
        analyzer = TargetFunctionAnalyzer()

        sections = {
            "basic_info": {
                "protein_name": "Cyclin-dependent kinase 4",
                "gene_name": "CDK4"
            },
            "function": {
                "function_summary": "Serine/threonine-protein kinase involved in cell cycle control."
            },
            "domains": [
                {"name": "Protein kinase"}
            ],
            "pathways": [
                {"name": "Cell cycle"}
            ],
            "ppi_network": {
                "top_partners": [
                    {"partner": "CCND1"},
                    {"partner": "CDKN2A"}
                ]
            },
            "literature": {
                "total_papers": 500
            }
        }

        result = analyzer._generate_encyclopedia(sections)
        assert "overview" in result
        assert "key_features" in result
        assert result["research_status"]["research_active"] is True

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        analyzer = TargetFunctionAnalyzer()

        result = {
            "success": True,
            "sections": {
                "basic_info": {"gene_name": "CDK4"},
                "function": {"function_description": "Test function"}
            }
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is True


class TestCompetitiveAnalyzer:
    """测试竞争格局分析器"""

    def test_analyzer_initialization(self):
        """测试分析器初始化"""
        analyzer = CompetitiveAnalyzer()
        assert len(analyzer.results) == 0

    def test_phase_weights(self):
        """测试阶段权重"""
        assert CompetitiveAnalyzer.PHASE_WEIGHTS["Approved"] == 5
        assert CompetitiveAnalyzer.PHASE_WEIGHTS["Phase 3"] == 3
        assert CompetitiveAnalyzer.PHASE_WEIGHTS["Phase 1"] == 1

    def test_analyze_clinical_pipeline(self):
        """测试临床管线分析"""
        analyzer = CompetitiveAnalyzer()

        clinical_data = {
            "studies": [
                {
                    "nct_id": "NCT001",
                    "title": "Study 1",
                    "phase_chinese": "III期临床",
                    "status_chinese": "招募中",
                    "sponsor": "Company A"
                },
                {
                    "nct_id": "NCT002",
                    "title": "Study 2",
                    "phase_chinese": "II期临床",
                    "status_chinese": "已完成",
                    "sponsor": "Company B"
                }
            ],
            "statistics": {
                "phase_distribution": {"III期临床": 1, "II期临床": 1},
                "status_distribution": {"招募中": 1, "已完成": 1},
                "top_sponsors": {"Company A": 1, "Company B": 1}
            },
            "total_count": 2
        }

        result = analyzer._analyze_clinical_pipeline(clinical_data)
        assert result["total_trials"] == 2
        assert result["active_trials"] == 1  # 招募中

    def test_analyze_competition(self):
        """测试竞争分析"""
        analyzer = CompetitiveAnalyzer()

        clinical_data = {
            "studies": [
                {"sponsor": "Company A", "phase": "Phase 3"},
                {"sponsor": "Company A", "phase": "Phase 2"},
                {"sponsor": "Company B", "phase": "Phase 1"}
            ],
            "statistics": {
                "top_sponsors": {"Company A": 2, "Company B": 1}
            },
            "total_count": 3
        }

        drug_data = {
            "drugs": [
                {"name": "Drug A", "company": "Company A"}
            ]
        }

        result = analyzer._analyze_competition(clinical_data, drug_data)
        assert "top_players" in result
        assert "market_concentration" in result
        assert result["top_players"][0]["company"] == "Company A"

    def test_assess_competition_intensity(self):
        """测试竞争强度评估"""
        analyzer = CompetitiveAnalyzer()

        assert analyzer._assess_competition_intensity(150, 20) == "very_high"
        assert analyzer._assess_competition_intensity(60, 15) == "high"
        assert analyzer._assess_competition_intensity(30, 10) == "medium"
        assert analyzer._assess_competition_intensity(10, 5) == "low"
        assert analyzer._assess_competition_intensity(2, 2) == "very_low"

    def test_analyze_market(self):
        """测试市场分析"""
        analyzer = CompetitiveAnalyzer()

        sections = {
            "clinical_pipeline": {
                "total_trials": 50,
                "active_trials": 20
            },
            "approved_drugs": {
                "total_drugs": 3
            },
            "competitive_analysis": {
                "competition_intensity": "medium"
            }
        }

        result = analyzer._analyze_market(sections)
        assert "maturity" in result
        assert "opportunity" in result

    def test_generate_executive_summary(self):
        """测试生成执行摘要"""
        analyzer = CompetitiveAnalyzer()

        sections = {
            "clinical_pipeline": {
                "total_trials": 50,
                "active_trials": 20
            },
            "approved_drugs": {
                "total_drugs": 3
            },
            "competitive_analysis": {
                "top_players": [
                    {"company": "Company A", "trial_count": 10}
                ],
                "competition_intensity": "medium"
            },
            "market_analysis": {
                "maturity": "growing",
                "opportunity": "medium"
            }
        }

        result = analyzer._generate_executive_summary("CDK4", "breast cancer", sections)
        assert "key_findings" in result
        assert "risks" in result
        assert "opportunities" in result
        assert "recommendation" in result

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        analyzer = CompetitiveAnalyzer()

        result = {
            "success": True,
            "sections": {
                "clinical_pipeline": {"total_trials": 10}
            }
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
