"""
验证器测试
"""
import pytest
import sys
from pathlib import Path

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.validators.data_provenance import (
    DataProvenance,
    ProvenanceTracker,
    DataProvenanceValidator,
    UnverifiedDataError
)
from src.validators.cross_validator import CrossValidator, ValidationResult
from src.validators.evidence_gate import evaluate_stage1_evidence, compare_de_sources


class TestDataProvenance:
    """测试数据溯源"""

    def test_provenance_creation(self):
        """测试溯源记录创建"""
        provenance = DataProvenance(
            field="expression.BRCA",
            value={"mean": 10.5},
            source="GTEx",
            endpoint="/expression",
            params={"gene": "CDK4"},
            timestamp="2024-01-01T00:00:00"
        )

        assert provenance.field == "expression.BRCA"
        assert provenance.source == "GTEx"
        assert provenance.hash is not None

    def test_provenance_to_dict(self):
        """测试转换为字典"""
        provenance = DataProvenance(
            field="test",
            value="test_value",
            source="TestSource",
            endpoint="/test",
            params={},
            timestamp="2024-01-01T00:00:00"
        )

        result = provenance.to_dict()
        assert isinstance(result, dict)
        assert "field" in result
        assert "source" in result
        assert "hash" in result


class TestProvenanceTracker:
    """测试溯源追踪器"""

    def test_track(self):
        """测试记录溯源"""
        tracker = ProvenanceTracker()

        provenance = tracker.track(
            field="test_field",
            value="test_value",
            source="TestSource",
            endpoint="/test",
            params={"key": "value"}
        )

        assert len(tracker.provenances) == 1
        assert provenance.field == "test_field"

    def test_get_provenance(self):
        """测试获取溯源记录"""
        tracker = ProvenanceTracker()

        tracker.track(
            field="field1",
            value="value1",
            source="Source1",
            endpoint="/test1",
            params={}
        )

        tracker.track(
            field="field2",
            value="value2",
            source="Source2",
            endpoint="/test2",
            params={}
        )

        provenance = tracker.get_provenance("field1")
        assert provenance is not None
        assert provenance.source == "Source1"

    def test_get_nonexistent_provenance(self):
        """测试获取不存在的溯源记录"""
        tracker = ProvenanceTracker()

        provenance = tracker.get_provenance("nonexistent")
        assert provenance is None

    def test_validate_all(self):
        """测试验证所有记录"""
        tracker = ProvenanceTracker()

        tracker.track(
            field="field1",
            value="value1",
            source="Source1",
            endpoint="/test1",
            params={}
        )

        is_valid, issues = tracker.validate_all()
        assert is_valid is True
        assert len(issues) == 0

    def test_get_summary(self):
        """测试获取摘要"""
        tracker = ProvenanceTracker()

        tracker.track(
            field="field1",
            value="value1",
            source="Source1",
            endpoint="/test1",
            params={}
        )

        tracker.track(
            field="field2",
            value="value2",
            source="Source1",
            endpoint="/test2",
            params={}
        )

        summary = tracker.get_summary()
        assert summary["total_provenances"] == 2
        assert summary["sources"]["Source1"] == 2


class TestDataProvenanceValidator:
    """测试数据溯源验证器"""

    def test_require_provenance_success(self):
        """测试要求溯源记录成功"""
        tracker = ProvenanceTracker()
        tracker.track(
            field="test_field",
            value="test_value",
            source="TestSource",
            endpoint="/test",
            params={}
        )

        validator = DataProvenanceValidator(tracker)
        provenance = validator.require_provenance("test_field")
        assert provenance is not None

    def test_require_provenance_failure(self):
        """测试要求溯源记录失败"""
        tracker = ProvenanceTracker()
        validator = DataProvenanceValidator(tracker)

        with pytest.raises(UnverifiedDataError):
            validator.require_provenance("nonexistent_field")


class TestCrossValidator:
    """测试交叉验证器"""

    def test_validate_expression_consistent(self):
        """测试一致的表达数据验证"""
        validator = CrossValidator()

        gtex_data = {
            "tissues": {
                "Brain": 10.0,
                "Heart": 5.0,
                "Liver": 3.0
            }
        }

        hpa_data = {
            "tissue_expression": [
                {"tissue": "Brain", "level": "High"},
                {"tissue": "Heart", "level": "Medium"},
                {"tissue": "Liver", "level": "Low"}
            ]
        }

        result = validator.validate_expression(
            "CDK4",
            gtex_data=gtex_data,
            hpa_data=hpa_data
        )

        assert isinstance(result, ValidationResult)
        assert result.field == "expression_CDK4"

    def test_validate_expression_no_data(self):
        """测试无数据的表达验证"""
        validator = CrossValidator()

        result = validator.validate_expression("CDK4")
        assert result.confidence == "none"

    def test_validate_survival_consistent(self):
        """测试一致的生存分析验证"""
        validator = CrossValidator()

        tcga_result = {
            "hr": 1.5,
            "p_value": 0.01,
            "n_patients": 500
        }

        geo_result = {
            "hr": 1.4,
            "p_value": 0.02,
            "n_patients": 300
        }

        result = validator.validate_survival(
            "CDK4",
            "BRCA",
            tcga_result=tcga_result,
            geo_result=geo_result
        )

        assert result.is_consistent is True
        assert result.confidence == "high"

    def test_validate_survival_inconsistent(self):
        """测试不一致的生存分析验证"""
        validator = CrossValidator()

        tcga_result = {
            "hr": 1.5,  # 风险因子
            "p_value": 0.01,
            "n_patients": 500
        }

        geo_result = {
            "hr": 0.6,  # 保护因子（方向相反）
            "p_value": 0.02,
            "n_patients": 300
        }

        result = validator.validate_survival(
            "CDK4",
            "BRCA",
            tcga_result=tcga_result,
            geo_result=geo_result
        )

        assert result.is_consistent is False
        assert len(result.discrepancies) > 0

    def test_get_overall_confidence(self):
        """测试获取整体置信度"""
        validator = CrossValidator()

        # 添加一些验证结果
        validator.validate_expression("Gene1")
        validator.validate_expression("Gene2")

        confidence = validator.get_overall_confidence()
        assert "overall" in confidence
        assert "distribution" in confidence


class TestEvidenceGates:
    def test_empty_hpa_cannot_create_high_confidence(self):
        result = evaluate_stage1_evidence({
            "stages": {
                "tissue_expression": {
                    "gtex": {
                        "success": True,
                        "valid": True,
                        "data": {"tissues": {"Breast": 5.0}},
                    },
                    "hpa": {
                        "success": True,
                        "valid": True,
                        "data": {"tissue_expression": []},
                    },
                },
                "tumor_expression": {
                    "cancer_results": {
                        "BRCA": {
                            "success": True,
                            "valid": True,
                            "data": {"samples": [{"expression_value": 1.0}]},
                        }
                    }
                },
                "survival_analysis": {"success": True},
                "immune_correlation": {"success": True},
            }
        })

        assert result["checks"]["hpa_valid"] is False
        assert result["confidence"] != "high"
        assert result["decision_eligible"] is False

    def test_tcga_controls_below_five_block_replication(self):
        geo = {
            "success": True,
            "method": "metadata",
            "filter_level": "strict",
            "disease_samples": 10,
            "control_samples": 10,
            "significant_genes": [
                {"gene_symbol": gene, "log2fc": 1.0}
                for gene in ("EGFR", "CDK4", "BRAF")
            ],
        }
        tcga = {
            "success": True,
            "disease_samples": 20,
            "control_samples": 4,
            "significant_genes": [
                {"gene_symbol": gene, "log2fc": 1.0}
                for gene in ("EGFR", "CDK4", "BRAF")
            ],
        }

        result = compare_de_sources(geo, tcga)

        assert result["decision_eligible"] is False
        assert any("fewer than 5" in issue for issue in result["issues"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
