"""
Pipeline 集成测试
使用 mock API 响应验证 pipeline 数据流完整性
"""
import pytest
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import numpy as np


class TestStage1PipelineIntegration:
    """Stage1 pipeline 集成测试"""

    def _make_tcga_expr_response(self, gene, project, n=100):
        """构造 mock TCGA 表达响应"""
        from src.api_clients.base_client import APIResponse
        samples = [
            {"sample_id": f"TCGA-AB-{i:04d}-01A", "expression_value": float(np.random.lognormal(3, 1)), "unit": "FPKM"}
            for i in range(n)
        ]
        return APIResponse(
            success=True,
            data={"gene": gene, "project": project, "samples": samples, "sample_count": n},
            source="TCGA/GDC", endpoint="/expression/filtered",
            params={"gene": gene, "project": project}, timestamp=""
        )

    def _make_tcga_clinical_response(self, project, n=100):
        """构造 mock TCGA 临床响应"""
        from src.api_clients.base_client import APIResponse
        patients = [
            {
                "case_id": f"case-{i}",
                "submitter_id": f"TCGA-AB-{i:04d}",
                "survival_days": int(np.random.exponential(500)) + 30,
                "survival_months": round((int(np.random.exponential(500)) + 30) / 30.44, 1),
                "event": int(np.random.random() > 0.6),
                "vital_status": "Dead" if np.random.random() > 0.6 else "Alive"
            }
            for i in range(n)
        ]
        return APIResponse(
            success=True,
            data={"project": project, "patients": patients, "patient_count": n},
            source="TCGA/GDC", endpoint="/cases",
            params={"project": project}, timestamp=""
        )

    def test_survival_analysis_called(self):
        """验证生存分析模块被 pipeline 实际调用"""
        from src.analysis.stage1_expression.pipeline import Stage1Pipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            pipeline = Stage1Pipeline(output_dir=tmpdir, cache_dir=tmpdir)

            # Mock GTEx
            from src.api_clients.base_client import APIResponse as AR
            pipeline.gtex_client.get_gene_expression = MagicMock(return_value=AR(
                success=True,
                data={"gene": "EGFR", "tissues": {f"tissue_{i}": float(i) for i in range(35)}, "unit": "TPM"},
                source="GTEx", endpoint="", params={}, timestamp=""
            ))
            pipeline.gtex_client.validate_expression = MagicMock(return_value=(True, []))

            # Mock TCGA survival data（带正确的 sample→case 匹配）
            expr_resp = self._make_tcga_expr_response("EGFR", "TCGA-LUAD", 80)
            clinical_resp = self._make_tcga_clinical_response("TCGA-LUAD", 80)

            pipeline.tcga_client.get_gene_expression_by_project = MagicMock(return_value=expr_resp)
            pipeline.tcga_client._get_clinical_survival = MagicMock(return_value=clinical_resp)

            # Mock get_survival_data 返回合并后的数据
            matched_expr = {f"TCGA-AB-{i:04d}-01A": float(np.random.lognormal(3, 1)) for i in range(80)}
            matched_clinical = {
                f"TCGA-AB-{i:04d}-01A": {"survival_months": float(np.random.exponential(16)), "event": int(np.random.random() > 0.6)}
                for i in range(80)
            }
            pipeline.tcga_client.get_survival_data = MagicMock(return_value=AR(
                success=True,
                data={
                    "gene": "EGFR", "project": "TCGA-LUAD",
                    "expression_data": matched_expr, "clinical_data": matched_clinical,
                    "matched_count": 80, "split_method": "median"
                },
                source="TCGA/GDC", endpoint="", params={}, timestamp=""
            ))

            # Mock HPA (不测试)
            pipeline.hpa_client.get_protein_expression = MagicMock(return_value=AR(
                success=False, data=None, source="HPA", endpoint="", params={}, timestamp="", error=""
            ))

            # Mock 免疫数据管理器
            pipeline.immune_data_manager.get_immune_infiltration = MagicMock(return_value=AR(
                success=False, data=None, source="ImmuneDataManager", endpoint="", params={}, timestamp="", error="无数据"
            ))

            # 运行
            results = pipeline.run(gene_symbol="EGFR", cancer_types=["LUAD"])

            # 验证
            survival = results["stages"]["survival_analysis"]
            assert survival["success"] is True
            luad_result = survival["cancer_results"]["LUAD"]
            assert luad_result["success"] is True
            assert "km_analysis" in luad_result["data"]
            assert "logrank_test" in luad_result["data"]
            assert "cox_regression" in luad_result["data"]


class TestStage2PipelineIntegration:
    """Stage2 pipeline 集成测试"""

    def test_de_analysis_called(self):
        """验证差异表达分析被 pipeline 实际调用"""
        from src.analysis.stage2_screening.pipeline import Stage2Pipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            pipeline = Stage2Pipeline(output_dir=tmpdir, cache_dir=tmpdir)

            # Mock GEO 下载 + 解析
            from src.api_clients.base_client import APIResponse as AR

            # 构造 mock 表达矩阵（30个基因，EGFR 在 disease 组有强信号）
            genes = ["EGFR", "CDK4", "BRAF", "TP53", "MYC"] + [f"GENE_{i}" for i in range(25)]
            disease_samples = [f"GSM{i}" for i in range(50)]
            control_samples = [f"GSM{i}" for i in range(50, 100)]
            all_samples = disease_samples + control_samples

            # 基线：所有基因均值=5，std=1
            rng = np.random.default_rng(42)
            data = rng.normal(size=(len(genes), len(all_samples))) + 5
            # 3 个基因在 disease 组高表达，满足跨来源最小重叠门槛。
            data[0, :50] += 8.0
            data[1, :50] += 7.5
            data[2, :50] += 7.0
            df = pd.DataFrame(data, index=genes, columns=all_samples)

            pipeline.geo_client.download_series_matrix = MagicMock(return_value=AR(
                success=True, data={"file_path": "/tmp/mock.gz", "accession": "GSE12345"},
                source="GEO", endpoint="", params={}, timestamp=""
            ))
            pipeline.geo_client.parse_series_matrix = MagicMock(return_value=AR(
                success=True,
                data={"expression_matrix": df, "sample_metadata": {}, "platform": "GPL570",
                      "gene_count": len(genes), "sample_count": 100, "accession": "GSE12345",
                      "probe_mapping_stats": {
                          "mapping_applied": True,
                          "platform_id": "GPL570",
                          "mapped_probes": len(genes),
                          "unmapped_probes": 0,
                          "unique_genes": len(genes),
                      }},
                source="GEO", endpoint="", params={}, timestamp=""
            ))
            pipeline.geo_client.infer_sample_groups = MagicMock(return_value={
                "disease": disease_samples, "control": control_samples, "method": "mock"
            })
            pipeline.geo_client.find_differential_expression_datasets = MagicMock(return_value=AR(
                success=True,
                data={"disease": "test", "query": "", "total_count": 1, "returned_count": 1, "dataset_ids": ["12345"]},
                source="GEO", endpoint="", params={}, timestamp=""
            ))
            pipeline.geo_client.get_dataset_details = MagicMock(return_value=AR(
                success=True,
                data={"datasets": [{"accession": "GSE12345", "title": "test", "sample_count": 100,
                                     "dataset_type": "RNA-seq", "pubmed_ids": [], "quality_score": 5}], "count": 1},
                source="GEO", endpoint="", params={}, timestamp=""
            ))
            pipeline.geo_client.rank_datasets = MagicMock(return_value=[
                {"accession": "GSE12345", "title": "test", "sample_count": 100,
                 "dataset_type": "RNA-seq", "pubmed_ids": [], "quality_score": 5}
            ])
            pipeline.geo_client.filter_expression_datasets = MagicMock(
                side_effect=lambda datasets: datasets
            )
            pipeline.geo_client.search_datasets = MagicMock(return_value=AR(
                success=False, data=None, source="GEO", endpoint="", params={}, timestamp="", error="无数据"
            ))

            pipeline._run_tcga_differential_expression = MagicMock(return_value={
                "success": True,
                "accession": "TCGA-TEST",
                "gene_count": 3,
                "sample_count": 30,
                "disease_samples": 20,
                "control_samples": 10,
                "method": "tcga_firebrowse",
                "significant_genes": [
                    {"gene_symbol": "EGFR", "log2fc": 1.2, "p_value": 0.001},
                    {"gene_symbol": "CDK4", "log2fc": 1.1, "p_value": 0.002},
                    {"gene_symbol": "BRAF", "log2fc": 1.0, "p_value": 0.003},
                ],
            })

            # Mock OpenTargets
            pipeline.opentargets_client.resolve_gene_symbol = MagicMock(return_value=AR(
                success=True, data={"ensg_id": "ENSG000001"},
                source="OpenTargets", endpoint="", params={}, timestamp=""
            ))
            pipeline.opentargets_client.get_target_druggability = MagicMock(return_value=AR(
                success=True,
                data={"ensg_id": "ENSG00000146648", "gene_symbol": "EGFR",
                      "druggability": {
                          "total_drug_candidates": 100,
                          "drugs": [{"max_phase_num": 4}],
                      }},
                source="OpenTargets", endpoint="", params={}, timestamp=""
            ))

            # 运行
            results = pipeline.run(disease="test cancer", top_n=5)

            # 验证 DE 分析被调用
            de = results["stages"]["differential_expression"]
            assert de["success"] is True
            assert "significant_genes" in de
            assert len(de["significant_genes"]) > 0
            assert results["stages"]["source_validation"]["decision_eligible"] is True
            assert results["success"] is True

            # 验证排序结果包含 DE 分数
            ranking = results["stages"]["ranking"]
            if ranking["success"]:
                for target in ranking.get("top_targets", []):
                    assert "de_score" in target
                    assert "druggability_score" in target


class TestStageIntegration:
    """跨阶段数据流测试"""

    def test_stage4_receives_stage_data(self):
        """验证 Stage4 能接收并使用前 3 个阶段的数据"""
        from src.analysis.stage4_business.pipeline import Stage4Pipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            pipeline = Stage4Pipeline(output_dir=tmpdir, cache_dir=tmpdir)

            # 构造 mock stage3 数据（含 developability 评分）
            stage3_data = {
                "success": True,
                "summary": {
                    "target": "EGFR",
                    "disease": "lung cancer",
                    "developability": {
                        "score": 75,
                        "level": "high",
                        "interpretation": "高开发潜力"
                    },
                    "key_findings": ["全球共有 500 个相关临床试验"],
                    "recommendations": ["建议推进"]
                },
                "stages": {
                    "clinical_pipeline": {
                        "data": {"total_trials": 500, "active_trials": 200}
                    }
                }
            }

            results = pipeline.run(
                target_name="EGFR",
                disease="lung cancer",
                stage3_data=stage3_data,
                modality="small_molecule",
                risk_level="medium"
            )

            # 验证商业计划书包含了上游数据
            bp = results["stages"]["business_plan"]
            assert bp["success"] is True
            assert bp["data"]["success"] is True


class TestReleaseRegressionCoverage:
    def test_log_scaled_effects_remain_finite(self):
        from src.analysis.stage2_screening.differential_expression import DifferentialExpressionAnalyzer

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

    def test_competitive_summary_prefers_authoritative_rollups(self):
        from src.analysis.stage3_deep_research.competitive_landscape import CompetitiveAnalyzer

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


import tempfile
