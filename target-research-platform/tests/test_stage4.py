"""
阶段4测试
"""
import pytest
import sys
from pathlib import Path

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.analysis.stage4_business.milestone_planner import MilestonePlanner
from src.analysis.stage4_business.business_plan import BusinessPlanGenerator


class TestMilestonePlanner:
    """测试里程碑规划器"""

    def test_planner_initialization(self):
        """测试规划器初始化"""
        planner = MilestonePlanner()
        assert len(planner.milestones) == 0

    def test_phase_durations(self):
        """测试阶段时间"""
        assert "phase1" in MilestonePlanner.PHASE_DURATIONS
        assert "typical" in MilestonePlanner.PHASE_DURATIONS["phase1"]

    def test_phase_costs(self):
        """测试阶段成本"""
        assert "phase1" in MilestonePlanner.PHASE_COSTS
        assert "typical" in MilestonePlanner.PHASE_COSTS["phase1"]

    def test_generate_milestones(self):
        """测试生成里程碑"""
        planner = MilestonePlanner()

        result = planner.generate_milestones(
            target_name="CDK4",
            disease="breast cancer",
            modality="small_molecule",
            risk_level="medium"
        )

        assert result["success"] is True
        assert result["target"] == "CDK4"
        assert result["disease"] == "breast cancer"
        assert len(result["milestones"]) == 10
        assert result["total_duration_months"] > 0
        assert result["total_cost_estimate"] > 0

    def test_generate_milestones_with_start_date(self):
        """测试带开始日期的里程碑"""
        planner = MilestonePlanner()

        result = planner.generate_milestones(
            target_name="CDK4",
            start_date="2024-01-01",
            modality="small_molecule",
            risk_level="medium"
        )

        assert result["success"] is True
        assert result["start_date"] == "2024-01-01"

    def test_duration_multiplier(self):
        """测试时间系数"""
        planner = MilestonePlanner()

        assert planner._get_duration_multiplier("small_molecule") == 1.0
        assert planner._get_duration_multiplier("antibody") == 1.2
        assert planner._get_duration_multiplier("cell_therapy") == 1.5

    def test_risk_multiplier(self):
        """测试风险系数"""
        planner = MilestonePlanner()

        assert planner._get_risk_multiplier("low") == 0.9
        assert planner._get_risk_multiplier("medium") == 1.0
        assert planner._get_risk_multiplier("high") == 1.2

    def test_get_deliverables(self):
        """测试获取交付物"""
        planner = MilestonePlanner()

        deliverables = planner._get_deliverables("phase1")
        assert len(deliverables) > 0
        assert "安全性数据" in deliverables

    def test_get_key_risks(self):
        """测试获取关键风险"""
        planner = MilestonePlanner()

        risks = planner._get_key_risks("phase1")
        assert len(risks) > 0
        assert any("安全性" in risk for risk in risks)

    def test_adjust_milestones(self):
        """测试调整里程碑"""
        planner = MilestonePlanner()

        base = planner.generate_milestones(
            target_name="CDK4",
            disease="breast cancer"
        )

        adjustments = {
            "phase1": {
                "duration_factor": 1.5,
                "cost_factor": 1.2,
                "notes": "需要更多时间"
            }
        }

        adjusted = planner.adjust_milestones(base, adjustments)
        assert adjusted["adjusted"] is True

    def test_get_summary(self):
        """测试获取摘要"""
        planner = MilestonePlanner()

        # 未规划
        summary = planner.get_summary("CDK4", "breast cancer")
        assert summary["status"] == "not_planned"

        # 已规划
        planner.generate_milestones("CDK4", "breast cancer")
        summary = planner.get_summary("CDK4", "breast cancer")
        assert summary["status"] == "planned"


class TestBusinessPlanGenerator:
    """测试商业计划书生成器"""

    def test_generator_initialization(self):
        """测试生成器初始化"""
        generator = BusinessPlanGenerator()
        assert len(generator.plans) == 0

    def test_generate_basic(self):
        """测试基本生成"""
        generator = BusinessPlanGenerator()

        result = generator.generate(
            target_name="CDK4",
            disease="breast cancer"
        )

        assert result["success"] is True
        assert result["target"] == "CDK4"
        assert result["disease"] == "breast cancer"
        assert "sections" in result

    def test_generate_with_data(self):
        """测试带数据生成"""
        generator = BusinessPlanGenerator()

        # 模拟stage3数据
        stage3_data = {
            "summary": {
                "developability": {
                    "score": 75,
                    "level": "high"
                },
                "key_findings": ["全球共有50个相关临床试验"]
            },
            "stages": {
                "clinical_pipeline": {
                    "data": {
                        "total_trials": 50,
                        "active_trials": 20
                    }
                },
                "market_analysis": {
                    "data": {
                        "maturity": "growing",
                        "opportunity": "high"
                    }
                }
            }
        }

        milestone_data = {
            "success": True,
            "total_duration_months": 120,
            "total_cost_estimate": 150.0,
            "overall_success_rate": 0.05,
            "milestones": [
                {
                    "phase_name": "I期临床",
                    "duration_months": 18,
                    "cost_estimate": {"typical": 10.0},
                    "deliverables": ["安全性数据"]
                }
            ]
        }

        result = generator.generate(
            target_name="CDK4",
            disease="breast cancer",
            stage3_data=stage3_data,
            milestone_data=milestone_data
        )

        assert result["success"] is True
        assert "executive_summary" in result["sections"]
        assert "scientific_rationale" in result["sections"]

    def test_to_markdown(self):
        """测试转换为Markdown"""
        generator = BusinessPlanGenerator()

        plan = generator.generate(
            target_name="CDK4",
            disease="breast cancer"
        )

        markdown = generator.to_markdown(plan)
        assert "CDK4" in markdown
        assert "商业计划书" in markdown

    def test_validate_plan_valid(self):
        """测试有效计划验证"""
        generator = BusinessPlanGenerator()

        plan = generator.generate(
            target_name="CDK4",
            disease="breast cancer"
        )

        is_valid, issues = generator.validate_plan(plan)
        assert is_valid is True

    def test_get_summary(self):
        """测试获取摘要"""
        generator = BusinessPlanGenerator()

        # 未生成
        summary = generator.get_summary("CDK4", "breast cancer")
        assert summary["status"] == "not_generated"

        # 已生成
        generator.generate("CDK4", "breast cancer")
        summary = generator.get_summary("CDK4", "breast cancer")
        assert summary["status"] == "generated"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
