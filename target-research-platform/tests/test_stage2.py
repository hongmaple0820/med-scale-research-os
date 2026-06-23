"""
阶段2测试
"""
import pytest
import sys
from pathlib import Path
import pandas as pd
import numpy as np

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.api_clients.geo_client import GEOClient
from src.analysis.stage2_screening.differential_expression import DifferentialExpressionAnalyzer
from src.analysis.stage2_screening.druggability_score import DruggabilityScorer


class TestGEOClient:
    """测试GEO客户端"""

    def test_source_name(self):
        """测试数据源名称"""
        client = GEOClient()
        assert client.source_name == "GEO"

    def test_base_url(self):
        """测试基础URL"""
        client = GEOClient()
        assert "ncbi.nlm.nih.gov" in client.base_url

    def test_validate_dataset_valid(self):
        """测试有效数据集验证"""
        client = GEOClient()

        dataset = {
            "sample_count": 50,
            "organism": "Homo sapiens",
            "dataset_type": "Expression profiling by RNA-seq"
        }

        is_valid, issues = client.validate_dataset(dataset)
        assert is_valid is True

    def test_validate_dataset_insufficient_samples(self):
        """测试样本量不足"""
        client = GEOClient()

        dataset = {
            "sample_count": 5,
            "organism": "Homo sapiens",
            "dataset_type": "Expression profiling"
        }

        is_valid, issues = client.validate_dataset(dataset)
        assert is_valid is False
        assert any("样本量不足" in issue for issue in issues)

    def test_is_usable_expression_dataset_rejects_superseries(self):
        client = GEOClient()
        dataset = {
            "accession": "GSE276760",
            "title": "Systemic and breast chronic inflammation (All Samples)",
            "summary": "This SuperSeries is composed of the SubSeries listed below.",
            "sample_count": 180,
            "dataset_type": "Expression profiling by high throughput sequencing",
        }
        usable, reason = client.is_usable_expression_dataset(dataset)
        assert usable is False
        assert "SuperSeries" in reason

    def test_series_matrix_has_expression_table_false_for_superseries_file(self, tmp_path: Path):
        client = GEOClient()
        matrix = tmp_path / "GSE276760_series_matrix.txt.gz"
        import gzip
        with gzip.open(matrix, "wt", encoding="utf-8") as handle:
            handle.write("!Series_title\t\"SuperSeries demo\"\n")
            handle.write("!Series_geo_accession\t\"GSE276760\"\n")
        assert client.series_matrix_has_expression_table(str(matrix)) is False

    def test_rank_datasets(self):
        """测试数据集排序"""
        client = GEOClient()

        datasets = [
            {
                "accession": "GSE001",
                "title": "Breast cancer RNA-seq",
                "sample_count": 100,
                "dataset_type": "Expression profiling by high throughput sequencing",
                "pubmed_ids": ["12345"]
            },
            {
                "accession": "GSE002",
                "title": "Normal tissue",
                "sample_count": 20,
                "dataset_type": "Expression profiling by array",
                "pubmed_ids": []
            }
        ]

        ranked = client.rank_datasets(datasets, "breast cancer")
        assert len(ranked) == 2
        assert ranked[0]["accession"] == "GSE001"  # RNA-seq优先


class TestDifferentialExpressionAnalyzer:
    """测试差异表达分析器"""

    def test_analyzer_initialization(self):
        """测试分析器初始化"""
        analyzer = DifferentialExpressionAnalyzer()
        assert len(analyzer.results) == 0

    def test_ttest_analysis(self):
        """测试t检验分析"""
        analyzer = DifferentialExpressionAnalyzer()

        # 创建测试数据
        disease_expr = pd.Series([10, 12, 14, 16, 18])
        control_expr = pd.Series([5, 7, 9, 11, 13])

        result = analyzer._ttest_analysis(disease_expr, control_expr)

        assert "method" in result
        assert result["method"] == "t-test"
        assert "p_value" in result
        assert "log2_fold_change" in result
        assert result["log2_fold_change"] > 0  # 疾病组上调

    def test_mannwhitney_analysis(self):
        """测试Mann-Whitney U检验"""
        analyzer = DifferentialExpressionAnalyzer()

        disease_expr = pd.Series([10, 12, 14, 16, 18])
        control_expr = pd.Series([5, 7, 9, 11, 13])

        result = analyzer._mannwhitney_analysis(disease_expr, control_expr)

        assert result["method"] == "Mann-Whitney U"
        assert "u_statistic" in result
        assert "p_value" in result

    def test_calculate_effect_size(self):
        """测试效应大小计算"""
        analyzer = DifferentialExpressionAnalyzer()

        disease_expr = pd.Series([10, 12, 14, 16, 18])
        control_expr = pd.Series([5, 7, 9, 11, 13])

        result = analyzer._calculate_effect_size(disease_expr, control_expr)

        assert "cohens_d" in result
        assert "magnitude" in result
        assert result["cohens_d"] > 0  # 疾病组均值更高

    def test_interpret_effect_size(self):
        """测试效应大小解释"""
        analyzer = DifferentialExpressionAnalyzer()

        # 大效应
        interpretation = analyzer._interpret_effect_size(0.9, "large")
        assert "上调" in interpretation
        assert "大" in interpretation

        # 小效应
        interpretation = analyzer._interpret_effect_size(-0.3, "small")
        assert "下调" in interpretation
        assert "小" in interpretation

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        analyzer = DifferentialExpressionAnalyzer()

        result = {
            "success": True,
            "sample_counts": {"disease": 50, "control": 50},
            "differential_expression": {"p_value": 0.01}
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is True

    def test_validate_result_insufficient_samples(self):
        """测试样本量不足"""
        analyzer = DifferentialExpressionAnalyzer()

        result = {
            "success": True,
            "sample_counts": {"disease": 2, "control": 50},
            "differential_expression": {"p_value": 0.01}
        }

        is_valid, issues = analyzer.validate_result(result)
        assert is_valid is False


class TestDruggabilityScorer:
    """测试成药性评分器"""

    def test_scorer_initialization(self):
        """测试评分器初始化"""
        scorer = DruggabilityScorer()
        assert len(scorer.results) == 0

    def test_pharos_weights(self):
        """测试Pharos权重"""
        assert DruggabilityScorer.PHAROS_WEIGHTS["Tclin"] == 1.0
        assert DruggabilityScorer.PHAROS_WEIGHTS["Tchem"] == 0.8
        assert DruggabilityScorer.PHAROS_WEIGHTS["Tbio"] == 0.5
        assert DruggabilityScorer.PHAROS_WEIGHTS["Tdark"] == 0.2

    def test_calculate_pharos_score(self):
        """测试Pharos评分计算"""
        scorer = DruggabilityScorer()

        result = scorer._calculate_pharos_score("Tclin")
        assert result["score"] == 1.0
        assert len(result["evidence"]) > 0

    def test_calculate_chembl_score(self):
        """测试ChEMBL评分计算"""
        scorer = DruggabilityScorer()

        data = {
            "active_compounds": 50,
            "max_phase": 3
        }

        result = scorer._calculate_chembl_score(data)
        assert result["score"] > 0
        assert len(result["evidence"]) > 0

    def test_classify_druggability(self):
        """测试成药性分类"""
        scorer = DruggabilityScorer()

        assert scorer._classify_druggability(0.9) == "highly_druggable"
        assert scorer._classify_druggability(0.7) == "druggable"
        assert scorer._classify_druggability(0.5) == "potentially_druggable"
        assert scorer._classify_druggability(0.3) == "challenging"
        assert scorer._classify_druggability(0.1) == "undruggable"

    def test_score_target(self):
        """测试靶点评分"""
        scorer = DruggabilityScorer()

        result = scorer.score_target(
            gene_symbol="CDK4",
            opentargets_data={
                "association_score": 0.8,
                "datatype_scores": {"known_drug": 0.9}
            },
            pharos_class="Tclin",
            chembl_data={
                "active_compounds": 100,
                "max_phase": 4
            }
        )

        assert result["success"] is True
        assert result["gene"] == "CDK4"
        assert result["composite_score"] > 0
        assert result["druggability_class"] in [
            "highly_druggable", "druggable", "potentially_druggable",
            "challenging", "undruggable"
        ]

    def test_validate_result_valid(self):
        """测试有效结果验证"""
        scorer = DruggabilityScorer()

        result = {
            "success": True,
            "composite_score": 0.75,
            "evidence": ["OpenTargets: 0.8", "Pharos: Tclin"]
        }

        is_valid, issues = scorer.validate_result(result)
        assert is_valid is True

    def test_validate_result_invalid_score(self):
        """测试无效评分验证"""
        scorer = DruggabilityScorer()

        result = {
            "success": True,
            "composite_score": 1.5,  # 超出范围
            "evidence": []
        }

        is_valid, issues = scorer.validate_result(result)
        assert is_valid is False

    def test_batch_score(self):
        """测试批量评分"""
        scorer = DruggabilityScorer()

        targets = [
            {
                "gene_symbol": "CDK4",
                "pharos_class": "Tclin"
            },
            {
                "gene_symbol": "EGFR",
                "pharos_class": "Tchem"
            }
        ]

        results = scorer.batch_score(targets)
        assert len(results) == 2
        # 应该按评分排序
        assert results[0]["composite_score"] >= results[1]["composite_score"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
