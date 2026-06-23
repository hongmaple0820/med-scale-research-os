"""
分析模块测试
"""
import pytest
import sys
from pathlib import Path

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.analysis.stage2_screening.differential_expression import DifferentialExpressionAnalyzer
from src.analysis.stage1_expression.survival_analysis import SurvivalAnalyzer
from src.analysis.stage1_expression.immune_correlation import ImmuneCorrelationAnalyzer
from src.analysis.stage3_deep_research.competitive_landscape import CompetitiveAnalyzer


class TestSurvivalAnalyzer:
    """测试生存分析器"""

    def test_analyzer_initialization(self):
        """测试分析器初始化"""
        analyzer = SurvivalAnalyzer()
        assert len(analyzer.results) == 0

    def test_merge_data(self):
        """测试数据合并"""
        analyzer = SurvivalAnalyzer()

        expression_data = {
            "sample1": 10.0,
            "sample2": 20.0,
            "sample3": 30.0
        }

        clinical_data = {
            "sample1": {"survival_months": 24, "event": 1},
            "sample2": {"survival_months": 36, "event": 0},
            "sample3": {"survival_months": 12, "event": 1}
        }

        merged = analyzer._merge_data(expression_data, clinical_data)
        assert len(merged) == 3
        assert "expression" in merged.columns
        assert "survival_months" in merged.columns

    def test_split_by_median(self):
        """测试中位数分组"""
        import pandas as pd

        analyzer = SurvivalAnalyzer()

        data = pd.DataFrame({
            "expression": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            "survival_months": [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
            "event": [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
        })

        groups = analyzer._split_by_median(data)

        assert "high" in groups
        assert "low" in groups
        assert groups["high"]["n"] + groups["low"]["n"] == 10

    def test_interpret_p_value(self):
        """测试p值解释"""
        analyzer = SurvivalAnalyzer()

        assert "极显著" in analyzer._interpret_p_value(0.0001)
        assert "高度显著" in analyzer._interpret_p_value(0.005)
        assert "显著" in analyzer._interpret_p_value(0.03)
        assert "无显著" in analyzer._interpret_p_value(0.1)

    def test_interpret_hr(self):
        """测试风险比解释"""
        analyzer = SurvivalAnalyzer()

        assert "风险因子" in analyzer._interpret_hr(1.5)
        assert "保护因子" in analyzer._interpret_hr(0.6)
        assert "无影响" in analyzer._interpret_hr(1.0)
        assert "无法计算" in analyzer._interpret_hr(None)

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        analyzer = SurvivalAnalyzer()

        result = {
            "success": True,
            "sample_count": 100,
            "logrank_test": {"p_value": 0.01},
            "cox_regression": {"hazard_ratio": 1.5}
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is True

    def test_validate_result_insufficient_samples(self):
        """测试样本量不足"""
        analyzer = SurvivalAnalyzer()

        result = {
            "success": True,
            "sample_count": 20,
            "logrank_test": {"p_value": 0.01},
            "cox_regression": {"hazard_ratio": 1.5}
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is False
        assert any("样本量不足" in issue for issue in issues)


class TestImmuneCorrelationAnalyzer:
    """测试免疫相关性分析器"""

    def test_analyzer_initialization(self):
        """测试分析器初始化"""
        analyzer = ImmuneCorrelationAnalyzer()
        assert len(analyzer.results) == 0

    def test_immune_cells_list(self):
        """测试免疫细胞列表"""
        assert "CD8_T_cell" in ImmuneCorrelationAnalyzer.IMMUNE_CELLS
        assert "Macrophage" in ImmuneCorrelationAnalyzer.IMMUNE_CELLS

    def test_merge_data(self):
        """测试数据合并"""
        analyzer = ImmuneCorrelationAnalyzer()

        gene_expression = {
            "sample1": 10.0,
            "sample2": 20.0
        }

        immune_infiltration = {
            "sample1": {"CD8_T_cell": 0.3, "Macrophage": 0.2},
            "sample2": {"CD8_T_cell": 0.5, "Macrophage": 0.1}
        }

        merged = analyzer._merge_data(gene_expression, immune_infiltration)
        assert len(merged) == 2
        assert "expression" in merged.columns
        assert "CD8_T_cell" in merged.columns

    def test_classify_correlation_strength(self):
        """测试相关性强度分类"""
        analyzer = ImmuneCorrelationAnalyzer()

        assert analyzer._classify_correlation_strength(0.8) == "strong"
        assert analyzer._classify_correlation_strength(0.5) == "moderate"
        assert analyzer._classify_correlation_strength(0.3) == "weak"
        assert analyzer._classify_correlation_strength(0.1) == "negligible"

    def test_interpret_correlation(self):
        """测试相关性解释"""
        analyzer = ImmuneCorrelationAnalyzer()

        # 显著正相关
        interpretation = analyzer._interpret_correlation(0.6, 0.001)
        assert "正相关" in interpretation

        # 显著负相关
        interpretation = analyzer._interpret_correlation(-0.5, 0.01)
        assert "负相关" in interpretation

        # 不显著
        interpretation = analyzer._interpret_correlation(0.2, 0.1)
        assert "无显著" in interpretation

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        analyzer = ImmuneCorrelationAnalyzer()

        result = {
            "success": True,
            "sample_count": 50,
            "correlations": {
                "CD8_T_cell": {"correlation": 0.5, "p_value": 0.01},
                "Macrophage": {"correlation": -0.3, "p_value": 0.05},
                "B_cell": {"correlation": 0.2, "p_value": 0.03}
            }
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is True

    def test_validate_result_insufficient_samples(self):
        """测试样本量不足"""
        analyzer = ImmuneCorrelationAnalyzer()

        result = {
            "success": True,
            "sample_count": 10,
            "correlations": {}
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is False


class TestDifferentialExpressionAnalyzer:
    def test_compute_log2_effect_uses_mean_difference_for_log_scale(self):
        analyzer = DifferentialExpressionAnalyzer()
        effect = analyzer._compute_log2_effect(3.0, -1.0, value_scale="log")
        assert effect == pytest.approx(4.0)

    def test_screen_new_targets_keeps_finite_effects_for_log_scaled_matrix(self):
        import pandas as pd

        analyzer = DifferentialExpressionAnalyzer()
        expression_matrix = pd.DataFrame(
            {
                "tumor_1": [9.0, 8.0, 7.5, 1.0],
                "tumor_2": [9.2, 8.1, 7.3, 1.1],
                "tumor_3": [8.8, 7.9, 7.4, 1.2],
                "control_1": [6.0, 9.5, 6.5, -0.5],
                "control_2": [6.1, 9.3, 6.4, -0.4],
                "control_3": [5.9, 9.4, 6.6, -0.6],
            },
            index=["CDK1", "FGFR1", "PARP1", "NOISE"],
        )

        result = analyzer.screen_new_targets(
            disease="breast cancer",
            expression_matrix=expression_matrix,
            sample_groups={
                "disease": ["tumor_1", "tumor_2", "tumor_3"],
                "control": ["control_1", "control_2", "control_3"],
            },
            known_targets=["CDK4"],
            top_n=10,
            value_scale="log",
        )

        assert result["success"] is True
        returned = {item["gene_symbol"]: item for item in result["top_targets"]}
        assert {"CDK1", "FGFR1"} <= set(returned)
        assert all(returned[gene]["log2fc"] != float("inf") for gene in ("CDK1", "FGFR1"))


class TestCompetitiveAnalyzer:
    def test_analyze_uses_authoritative_clinical_rollups(self):
        analyzer = CompetitiveAnalyzer()
        clinical_data = {
            "total_trials": 100,
            "active_trials": 58,
            "phase_distribution": {"Phase 2": 31, "Phase 3": 20},
            "top_players": [
                {"sponsor": "Fudan University", "trial_count": 10},
                {"sponsor": "Pfizer", "trial_count": 8},
            ],
            "studies": [
                {"sponsor": "Local Hospital", "phase": "Phase 2", "status_chinese": "招募中"}
                for _ in range(13)
            ]
            + [
                {"sponsor": "Local Hospital", "phase": "Phase 1", "status_chinese": "已完成"}
                for _ in range(7)
            ],
        }

        result = analyzer.analyze(
            target_name="CDK4",
            disease="breast cancer",
            clinical_data=clinical_data,
            drug_data={},
            patent_data={},
        )

        assert result["sections"]["clinical_pipeline"]["active_trials"] == 58
        findings = result["executive_summary"]["key_findings"]
        assert any("58" in item for item in findings)
        assert any("Fudan University" in item for item in findings)

    def test_analyze_carries_traceable_market_evidence(self):
        analyzer = CompetitiveAnalyzer()

        result = analyzer.analyze(
            target_name="CDK4",
            disease="breast cancer",
            clinical_data={"total_trials": 3, "active_trials": 1, "studies": []},
            market_data={
                "total_records": 1,
                "returned_records": 1,
                "data_sources": ["openFDA Drug Label"],
                "source_urls": ["https://api.fda.gov/drug/label.json"],
                "records": [
                    {
                        "brand_names": ["IBRANCE"],
                        "generic_names": ["PALBOCICLIB"],
                        "manufacturers": ["Pfizer"],
                    }
                ],
                "limitations": ["openFDA labels are not sales data."],
            },
        )

        market = result["sections"]["market_analysis"]
        assert market["data_sources"] == ["openFDA Drug Label"]
        assert market["returned_records"] == 1
        assert market["evidence_records"][0]["brand_names"] == ["IBRANCE"]
        assert market["indicators"]["regulatory_label_records"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
