"""
阶段1 Pipeline：靶点表达全景与预后挖掘
整合GTEx表达、TCGA生存、免疫相关性分析
"""
import json
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Optional

from ...api_clients.gtex_client import GTExClient
from ...api_clients.tcga_client import TCGAClient
from ...api_clients.hpa_client import HPAClient
from ...api_clients.immune_data_manager import ImmuneDataManager
from ...validators.data_provenance import ProvenanceTracker, DataProvenanceValidator
from ...validators.cross_validator import CrossValidator
from ...utils.logger import get_logger
from .survival_analysis import SurvivalAnalyzer
from .immune_correlation import ImmuneCorrelationAnalyzer


def _sanitize_for_json(obj):
    """递归转换 numpy 类型为 Python 原生类型"""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


class Stage1Pipeline:
    """阶段1 Pipeline：靶点表达全景与预后挖掘"""

    logger = get_logger("stage1")

    def __init__(
        self,
        output_dir: str = "./output/stage1",
        cache_dir: str = "./cache"
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 初始化API客户端
        self.gtex_client = GTExClient(cache_dir=cache_dir)
        self.tcga_client = TCGAClient(cache_dir=cache_dir)
        self.hpa_client = HPAClient(cache_dir=cache_dir)
        self.immune_data_manager = ImmuneDataManager(cache_dir=cache_dir)

        # 初始化分析器
        self.survival_analyzer = SurvivalAnalyzer()
        self.immune_analyzer = ImmuneCorrelationAnalyzer()

        # 初始化验证器
        self.provenance_tracker = ProvenanceTracker(log_dir=str(self.output_dir / "provenance"))
        self.cross_validator = CrossValidator()

    def run(
        self,
        gene_symbol: str,
        cancer_types: list[str],
        ensg_id: Optional[str] = None
    ) -> dict:
        """
        执行完整的阶段1分析

        Args:
            gene_symbol: 基因符号，如 "CDK4"
            cancer_types: 癌种列表，如 ["BRCA", "LUAD"]
            ensg_id: Ensembl基因ID（可选，用于HPA查询）

        Returns:
            完整的分析结果
        """
        self.logger.info("=" * 60)
        self.logger.info(f"阶段1 Pipeline: {gene_symbol}")
        self.logger.info(f"癌种: {', '.join(cancer_types)}")
        self.logger.info("=" * 60)

        # 自动解析 ENSG ID
        if not ensg_id:
            self.logger.info("[解析] 自动解析 ENSG ID...")
            resolve_resp = self._resolve_ensg_id(gene_symbol)
            if resolve_resp:
                ensg_id = resolve_resp
                self.logger.info(f"  - 解析成功: {ensg_id}")
            else:
                self.logger.warning("  - 解析失败，跳过 HPA 查询")

        results = {
            "gene": gene_symbol,
            "ensg_id": ensg_id,
            "cancer_types": cancer_types,
            "timestamp": datetime.now().isoformat(),
            "stages": {}
        }

        # 1. 全景表达扫描
        self.logger.info("[1/4] 全景表达扫描...")
        expression_result = self._analyze_tissue_expression(gene_symbol, ensg_id)
        results["stages"]["tissue_expression"] = expression_result

        # 2. 肿瘤表达分析
        self.logger.info("[2/4] 肿瘤表达分析...")
        tumor_result = self._analyze_tumor_expression(gene_symbol, cancer_types)
        results["stages"]["tumor_expression"] = tumor_result

        # 3. 生存分析
        self.logger.info("[3/4] 生存分析...")
        survival_result = self._analyze_survival(gene_symbol, cancer_types)
        results["stages"]["survival_analysis"] = survival_result

        # 4. 免疫相关性分析
        self.logger.info("[4/4] 免疫相关性分析...")
        immune_result = self._analyze_immune_correlation(gene_symbol, cancer_types)
        results["stages"]["immune_correlation"] = immune_result

        # 交叉验证
        self.logger.info("[验证] 交叉验证...")
        validation_result = self._cross_validate(results)
        results["validation"] = validation_result

        # 生成摘要
        results["summary"] = self._generate_summary(results)

        # 保存结果
        self._save_results(gene_symbol, results)

        self.logger.info("=" * 60)
        self.logger.info("阶段1分析完成!")
        self.logger.info(f"结果保存至: {self.output_dir}")
        self.logger.info("=" * 60)

        return results

    def _resolve_ensg_id(self, gene_symbol: str) -> Optional[str]:
        """通过 OpenTargets 解析基因符号到 ENSG ID"""
        try:
            from ...api_clients.opentargets_client import OpenTargetsClient
            ot_client = OpenTargetsClient(cache_dir=str(self.output_dir.parent / "cache"))
            resp = ot_client.resolve_gene_symbol(gene_symbol)
            if resp.success:
                return resp.data.get("ensg_id")
        except Exception:
            pass
        return None

    def _analyze_tissue_expression(
        self,
        gene_symbol: str,
        ensg_id: Optional[str]
    ) -> dict:
        """分析正常组织表达"""
        result = {
            "success": False,
            "gtex": None,
            "hpa": None,
            "cross_validation": None
        }

        # GTEx分析
        self.logger.debug("  - 查询GTEx数据...")
        gtex_response = self.gtex_client.get_gene_expression(gene_symbol)

        if gtex_response.success:
            self.provenance_tracker.track_from_api_response(
                f"tissue_expression.gtex",
                gtex_response.data,
                gtex_response
            )

            # 验证数据
            is_valid, issues = self.gtex_client.validate_expression(gtex_response.data)
            result["gtex"] = {
                "success": True,
                "data": gtex_response.data,
                "valid": is_valid,
                "validation_issues": issues,
                "provenance": gtex_response.get_provenance()
            }
        else:
            result["gtex"] = {
                "success": False,
                "error": gtex_response.error
            }

        # HPA分析（需要ENSG ID）
        if ensg_id:
            self.logger.debug("  - 查询HPA数据...")
            hpa_response = self.hpa_client.get_protein_expression(ensg_id)

            if hpa_response.success:
                self.provenance_tracker.track_from_api_response(
                    f"tissue_expression.hpa",
                    hpa_response.data,
                    hpa_response
                )

                is_valid, issues = self.hpa_client.validate_protein_data(hpa_response.data)
                result["hpa"] = {
                    "success": True,
                    "data": hpa_response.data,
                    "valid": is_valid,
                    "validation_issues": issues,
                    "provenance": hpa_response.get_provenance()
                }
            else:
                result["hpa"] = {
                    "success": False,
                    "error": hpa_response.error
                }

        # 交叉验证
        if result["gtex"]["success"] and (result.get("hpa") or {}).get("success"):
            self.logger.debug("  - 交叉验证GTEx与HPA...")
            validation = self.cross_validator.validate_expression(
                gene_symbol,
                gtex_data=result["gtex"]["data"],
                hpa_data=result["hpa"]["data"]
            )
            result["cross_validation"] = validation.to_dict()

        result["success"] = result["gtex"]["success"]
        return result

    def _analyze_tumor_expression(
        self,
        gene_symbol: str,
        cancer_types: list[str]
    ) -> dict:
        """分析肿瘤表达"""
        result = {
            "success": False,
            "cancer_results": {}
        }

        for cancer_type in cancer_types:
            self.logger.debug(f"  - 查询{cancer_type}表达数据...")
            project_id = f"TCGA-{cancer_type}"

            expr_response = self.tcga_client.get_gene_expression_by_project(
                gene_symbol, project_id
            )

            if expr_response.success:
                self.provenance_tracker.track_from_api_response(
                    f"tumor_expression.{cancer_type}",
                    expr_response.data,
                    expr_response
                )

                is_valid, issues = self.tcga_client.validate_expression_data(expr_response.data)
                result["cancer_results"][cancer_type] = {
                    "success": True,
                    "data": expr_response.data,
                    "valid": is_valid,
                    "validation_issues": issues,
                    "provenance": expr_response.get_provenance()
                }
            else:
                result["cancer_results"][cancer_type] = {
                    "success": False,
                    "error": expr_response.error
                }

        result["success"] = any(
            r["success"] for r in result["cancer_results"].values()
        )

        return result

    def _analyze_survival(
        self,
        gene_symbol: str,
        cancer_types: list[str]
    ) -> dict:
        """执行生存分析（KM + Cox）"""
        result = {
            "success": False,
            "cancer_results": {}
        }

        for cancer_type in cancer_types:
            self.logger.debug(f"  - 分析{cancer_type}生存数据...")

            project_id = f"TCGA-{cancer_type}"

            # 获取合并后的生存数据（已匹配 sample_id → clinical）
            survival_response = self.tcga_client.get_survival_data(
                gene_symbol, project_id
            )

            if not survival_response.success:
                result["cancer_results"][cancer_type] = {
                    "success": False,
                    "error": f"无法获取生存数据: {survival_response.error}"
                }
                continue

            merged = survival_response.data

            # 调用 SurvivalAnalyzer 执行 KM + Cox
            analysis = self.survival_analyzer.analyze(
                gene_symbol=gene_symbol,
                cancer_type=cancer_type,
                expression_data=merged["expression_data"],
                clinical_data=merged["clinical_data"],
                split_method=merged.get("split_method", "median")
            )

            # 记录溯源
            if analysis.get("success"):
                self.provenance_tracker.track(
                    f"survival.{cancer_type}",
                    analysis,
                    "TCGA/GDC",
                    "/cases+/expression/filtered",
                    {"gene": gene_symbol, "project": project_id}
                )

            result["cancer_results"][cancer_type] = {
                "success": analysis.get("success", False),
                "data": analysis,
                "matched_count": merged.get("matched_count", 0)
            }

        result["success"] = any(
            r["success"] for r in result["cancer_results"].values()
        )

        return result

    def _analyze_immune_correlation(
        self,
        gene_symbol: str,
        cancer_types: list[str]
    ) -> dict:
        """分析免疫相关性（使用预计算免疫浸润数据 + Spearman 相关）"""
        result = {
            "success": False,
            "cancer_results": {}
        }

        for cancer_type in cancer_types:
            self.logger.debug(f"  - 分析{cancer_type}免疫相关性...")

            # 1. 获取免疫浸润数据
            immune_response = self.immune_data_manager.get_immune_infiltration(cancer_type)

            if not immune_response.success:
                result["cancer_results"][cancer_type] = {
                    "success": False,
                    "error": f"无法获取免疫浸润数据: {immune_response.error}"
                }
                continue

            # 2. 获取基因表达数据（从已有的肿瘤表达结果复用）
            # 需要重新获取以确保 sample_id 对齐
            project_id = f"TCGA-{cancer_type}"
            expr_response = self.tcga_client.get_gene_expression_by_project(
                gene_symbol, project_id
            )

            if not expr_response.success:
                result["cancer_results"][cancer_type] = {
                    "success": False,
                    "error": f"无法获取表达数据: {expr_response.error}"
                }
                continue

            # 构建 {sample_id: expression_value} 格式
            gene_expression = {}
            for sample in expr_response.data.get("samples", []):
                sid = sample.get("sample_id", "")
                if sid:
                    gene_expression[sid] = sample.get("expression_value", 0)

            # 3. 调用 ImmuneCorrelationAnalyzer
            analysis = self.immune_analyzer.analyze_correlation(
                gene_symbol=gene_symbol,
                cancer_type=cancer_type,
                gene_expression=gene_expression,
                immune_infiltration=immune_response.data
            )

            # 记录溯源
            if analysis.get("success"):
                self.provenance_tracker.track(
                    f"immune_correlation.{cancer_type}",
                    analysis,
                    "ImmuneDataManager",
                    "get_immune_infiltration",
                    {"cancer_type": cancer_type, "gene": gene_symbol}
                )

            result["cancer_results"][cancer_type] = {
                "success": analysis.get("success", False),
                "data": analysis
            }

        result["success"] = any(
            r["success"] for r in result["cancer_results"].values()
        )

        return result

    def _cross_validate(self, results: dict) -> dict:
        """执行交叉验证"""
        validation = {
            "provenance_valid": False,
            "cross_validation": {},
            "overall_confidence": "none",
            "issues": []
        }

        # 验证溯源完整性
        provenance_valid, provenance_issues = self.provenance_tracker.validate_all()
        validation["provenance_valid"] = provenance_valid
        validation["provenance_issues"] = provenance_issues

        # 获取整体置信度
        confidence = self.cross_validator.get_overall_confidence()
        validation["overall_confidence"] = confidence["overall"]

        return validation

    def _generate_summary(self, results: dict) -> dict:
        """生成分析摘要"""
        gene = results["gene"]
        cancer_types = results["cancer_types"]

        summary = {
            "gene": gene,
            "cancer_types": cancer_types,
            "analysis_status": "completed",
            "key_findings": [],
            "data_sources": [],
            "confidence_level": results.get("validation", {}).get("overall_confidence", "none")
        }

        # 收集数据源
        tissue_expr = results["stages"].get("tissue_expression", {})
        if (tissue_expr.get("gtex") or {}).get("success"):
            summary["data_sources"].append("GTEx")
        if (tissue_expr.get("hpa") or {}).get("success"):
            summary["data_sources"].append("HPA")

        tumor_expr = results["stages"].get("tumor_expression", {})
        for cancer_type in cancer_types:
            if tumor_expr.get("cancer_results", {}).get(cancer_type, {}).get("success"):
                summary["data_sources"].append(f"TCGA-{cancer_type}")

        # 关键发现
        if (tissue_expr.get("gtex") or {}).get("success"):
            gtex_data = tissue_expr["gtex"]["data"]
            tissues = gtex_data.get("tissues", {})
            if tissues:
                max_tissue = max(tissues, key=tissues.get)
                summary["key_findings"].append(
                    f"在正常组织中，{max_tissue}表达最高 ({tissues[max_tissue]:.1f} TPM)"
                )

        return summary

    def _save_results(self, gene_symbol: str, results: dict):
        """保存分析结果"""
        # 保存JSON结果
        json_path = self.output_dir / f"{gene_symbol}_stage1_results.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(_sanitize_for_json(results), f, ensure_ascii=False, indent=2)

        # 保存溯源记录
        self.provenance_tracker.save_to_file(f"{gene_symbol}_provenance.json")

        # 保存摘要报告
        report_path = self.output_dir / f"{gene_symbol}_stage1_report.md"
        self._generate_markdown_report(gene_symbol, results, report_path)

    def _generate_markdown_report(
        self,
        gene_symbol: str,
        results: dict,
        output_path: Path
    ):
        """生成Markdown报告"""
        summary = results.get("summary", {})

        report = f"""# 靶点表达全景分析报告: {gene_symbol}

**生成时间:** {results.get('timestamp', '')}
**分析癌种:** {', '.join(results.get('cancer_types', []))}
**置信度:** {summary.get('confidence_level', 'N/A')}

## 1. 数据来源

| 数据源 | 状态 |
|--------|------|
"""

        for source in summary.get("data_sources", []):
            report += f"| {source} | ✓ |\n"

        report += f"""
## 2. 关键发现

"""
        for finding in summary.get("key_findings", []):
            report += f"- {finding}\n"

        report += f"""
## 3. 分析详情

### 3.1 正常组织表达 (GTEx)
"""
        gtex = results["stages"].get("tissue_expression", {}).get("gtex") or {}
        if gtex.get("success"):
            tissues = gtex["data"].get("tissues", {})
            report += f"- 分析组织数: {len(tissues)}\n"

            # Top 5高表达组织
            sorted_tissues = sorted(tissues.items(), key=lambda x: x[1], reverse=True)[:5]
            report += "- 高表达组织:\n"
            for tissue, tpm in sorted_tissues:
                report += f"  - {tissue}: {tpm:.1f} TPM\n"
        else:
            report += f"- 获取失败: {gtex.get('error', '未知错误')}\n"

        report += f"""
### 3.2 肿瘤表达 (TCGA)
"""
        tumor = results["stages"].get("tumor_expression", {})
        for cancer_type, cancer_data in tumor.get("cancer_results", {}).items():
            if cancer_data.get("success"):
                sample_count = cancer_data["data"].get("sample_count", 0)
                report += f"- {cancer_type}: {sample_count}个样本\n"
            else:
                report += f"- {cancer_type}: 获取失败\n"

        report += f"""
### 3.3 数据验证

- 溯源验证: {'✓' if results.get('validation', {}).get('provenance_valid') else '✗'}
- 交叉验证置信度: {summary.get('confidence_level', 'N/A')}

---
*报告由靶点研究平台自动生成*
"""

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(report)

    def validate_inputs(
        self,
        gene_symbol: str,
        cancer_types: list[str]
    ) -> tuple[bool, list[str]]:
        """验证输入参数"""
        issues = []

        if not gene_symbol:
            issues.append("基因符号不能为空")

        if not cancer_types:
            issues.append("癌种列表不能为空")

        # 验证癌种代码
        for cancer_type in cancer_types:
            if cancer_type not in TCGAClient.TCGA_PROJECTS:
                issues.append(f"不支持的癌种: {cancer_type}")

        return len(issues) == 0, issues
