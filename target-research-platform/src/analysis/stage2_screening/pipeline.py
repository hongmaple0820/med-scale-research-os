"""
阶段2 Pipeline：多维靶点筛选与优先级排序
整合差异表达分析和成药性评分
"""
import json
import math
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
from typing import Optional

from ...utils.logger import get_logger
from ...api_clients.geo_client import GEOClient
from ...api_clients.opentargets_client import OpenTargetsClient
from ...api_clients.tcga_client import TCGAClient
from ...validators.data_provenance import ProvenanceTracker
from ...validators.cross_validator import CrossValidator
from .differential_expression import DifferentialExpressionAnalyzer
from .druggability_score import DruggabilityScorer


class Stage2Pipeline:
    """阶段2 Pipeline：多维靶点筛选与优先级排序"""
    logger = get_logger("stage2")

    def __init__(
        self,
        output_dir: str = "./output/stage2",
        cache_dir: str = "./cache"
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir = cache_dir

        # 初始化API客户端
        self.geo_client = GEOClient(cache_dir=cache_dir)
        self.opentargets_client = OpenTargetsClient(cache_dir=cache_dir)
        self.tcga_client = TCGAClient(cache_dir=cache_dir)

        # 初始化分析器
        self.de_analyzer = DifferentialExpressionAnalyzer()
        self.druggability_scorer = DruggabilityScorer()

        # 初始化验证器
        self.provenance_tracker = ProvenanceTracker(
            log_dir=str(self.output_dir / "provenance")
        )
        self.cross_validator = CrossValidator()

    def run(
        self,
        disease: str,
        known_targets: Optional[list[str]] = None,
        top_n: int = 20,
        normal_tissue_expression: Optional[dict] = None,
        cancer_code: Optional[str] = None
    ) -> dict:
        """
        执行完整的阶段2分析

        Args:
            disease: 疾病名称
            known_targets: 已知靶点列表（排除）
            top_n: 返回前N个候选靶点
            normal_tissue_expression: 正常组织表达数据（来自 stage1 GTEx），
                用于过滤在正常组织高表达的基因。格式: {gene: tpm_value}
            cancer_code: TCGA cancer code (如 BRCA)，用于 TCGA DE 回退

        Returns:
            完整的分析结果
        """
        self.logger.info("=" * 60)
        self.logger.info(f"阶段2 Pipeline: {disease}")
        self.logger.info("=" * 60)

        results = {
            "disease": disease,
            "known_targets": known_targets or [],
            "timestamp": datetime.now().isoformat(),
            "stages": {}
        }

        # 1. 搜索GEO数据集
        self.logger.info("[1/4] 搜索GEO数据集...")
        geo_result = self._search_geo_datasets(disease)
        results["stages"]["geo_search"] = geo_result

        # 2. 差异表达分析（GEO → TCGA 回退）
        self.logger.info("[2/4] 差异表达分析...")
        de_result = self._run_differential_expression(disease, geo_result, known_targets, normal_tissue_expression)
        results["stages"]["differential_expression"] = de_result

        # 如果 GEO DE 失败或结果不可靠，尝试 TCGA/FireBrowse DE
        if not de_result.get("success") or de_result.get("method") == "positional":
            self.logger.info("  - GEO DE 不可靠，尝试 TCGA/FireBrowse DE...")
            tcga_de = self._run_tcga_differential_expression(disease, cancer_code)
            if tcga_de.get("success"):
                # TCGA 结果替换 GEO 结果
                self.logger.info(f"  - TCGA DE 成功: {tcga_de.get('gene_count', 0)} 基因, "
                                f"{len(tcga_de.get('significant_genes', []))} 显著")
                de_result = tcga_de
                results["stages"]["differential_expression"] = de_result
                results["stages"]["differential_expression"]["fallback_source"] = "TCGA/FireBrowse"
            else:
                self.logger.warning(f"  - TCGA DE 也失败: {tcga_de.get('error', 'unknown')}")

        # 3. 成药性评估
        self.logger.info("[3/4] 成药性评估...")
        # 从 DE 结果获取候选靶点，传给成药性评估
        de_candidates = []
        if de_result.get("success"):
            de_candidates = de_result.get("significant_genes", [])
        druggability_result = self._evaluate_druggability(disease, de_candidates, known_targets)
        results["stages"]["druggability"] = druggability_result

        # 同时评估主靶点（known_targets）的成药性，供 Stage 4 使用
        # 即使主靶点被排除出筛选排名，Stage 4 仍需要其成药性评分
        if known_targets:
            primary_druggability = self._evaluate_druggability(
                disease, [], exclude_targets=None,  # 不过滤主靶点
                extra_genes=list(known_targets)
            )
            # 合并到 druggability 结果
            for gene, data in primary_druggability.get("targets", {}).items():
                if gene not in druggability_result.get("targets", {}):
                    druggability_result.setdefault("targets", {})[gene] = data
                    self.logger.info(f"  - 主靶点 {gene} 成药性已评估（供 Stage 4 使用）")

        # 4. 综合排序
        self.logger.info("[4/4] 综合排序...")
        ranking_result = self._rank_targets(
            disease,
            de_result,
            druggability_result,
            top_n
        )
        results["stages"]["ranking"] = ranking_result

        # 验证
        validation_result = self._validate_results(results)
        results["validation"] = validation_result

        # 生成摘要
        results["summary"] = self._generate_summary(results)

        # 保存结果
        self._save_results(disease, results)

        self.logger.info("=" * 60)
        self.logger.info("阶段2分析完成!")
        self.logger.info(f"结果保存至: {self.output_dir}")
        self.logger.info("=" * 60)

        return results

    def _run_differential_expression(
        self,
        disease: str,
        geo_result: dict,
        known_targets: Optional[list[str]],
        normal_tissue_expression: Optional[dict] = None
    ) -> dict:
        """下载 GEO 数据并执行差异表达分析"""
        # 收集所有可用数据集
        datasets = (
            geo_result.get("rnaseq_datasets", []) +
            geo_result.get("microarray_datasets", [])
        )

        if not datasets:
            return {"success": False, "error": "无可用 GEO 数据集"}

        datasets = self.geo_client.filter_expression_datasets(datasets)
        if not datasets:
            return {"success": False, "error": "无可用 GEO 表达数据集（已过滤 SuperSeries）"}

        # 尝试下载并解析前 5 个数据集
        for dataset in datasets[:5]:
            accession = dataset.get("accession", "")
            if not accession:
                continue

            self.logger.info(f"  - 下载 {accession}...")

            # 下载
            dl_result = self.geo_client.download_series_matrix(
                accession, output_dir=str(self.output_dir / "geo_data")
            )
            if not dl_result.success:
                self.logger.warning(f"下载失败: {dl_result.error}")
                if "SuperSeries" in (dl_result.error or "") or "无表达矩阵" in (dl_result.error or ""):
                    self.logger.info(f"  - 跳过 {accession}，尝试下一个数据集")
                continue

            # 解析（自动应用探针→基因符号映射）
            self.logger.info(f"  - 解析表达矩阵（自动探针ID映射）...")
            parse_result = self.geo_client.parse_series_matrix(
                dl_result.data["file_path"],
                cache_dir=self.cache_dir
            )
            if not parse_result.success:
                self.logger.warning(f"解析失败: {parse_result.error}")
                continue

            # 探针映射验证：如果映射失败（索引全是数字探针ID），DE 结果将无法使用
            probe_stats = parse_result.data.get("probe_mapping_stats", {})
            if not probe_stats.get("mapping_applied", False):
                self.logger.warning(f"探针→基因映射失败 (platform={probe_stats.get('platform_id', '?')})，跳过此数据集")
                self.logger.debug(f"  (mapped={probe_stats.get('mapped_probes', 0)}/{probe_stats.get('total_probes', '?')})")
                continue

            # 推断样本分组
            sample_metadata = parse_result.data.get("sample_metadata", {})
            groups = self.geo_client.infer_sample_groups(sample_metadata, disease)

            if not groups.get("disease") or not groups.get("control"):
                self.logger.warning(f"无法推断样本分组")
                continue

            # 验证分组方法：positional 分组结果不可靠，标记为降级
            group_method = groups.get("method", "unknown")
            if group_method == "positional":
                self.logger.warning(f"样本分组使用位置推断法（结果可能不准确）")

            self.logger.info(f"  - 执行差异表达分析 (disease={len(groups['disease'])}, control={len(groups['control'])}, method={group_method})...")

            expression_matrix = parse_result.data["expression_matrix"]

            # 记录溯源（含探针映射统计）
            probe_stats = parse_result.data.get("probe_mapping_stats", {})
            track_data = {
                "accession": accession,
                "gene_count": parse_result.data["gene_count"],
                "sample_count": parse_result.data["sample_count"],
                "disease_samples": len(groups["disease"]),
                "control_samples": len(groups["control"])
            }
            if probe_stats.get("mapping_applied"):
                track_data["probe_mapping"] = {
                    "platform": probe_stats.get("platform_id", ""),
                    "mapped_probes": probe_stats.get("mapped_probes", 0),
                    "unmapped_probes": probe_stats.get("unmapped_probes", 0),
                    "unique_genes": probe_stats.get("unique_genes", 0)
                }
            self.provenance_tracker.track(
                f"de_expression.{accession}",
                track_data,
                "GEO",
                f"series_matrix/{accession}",
                {"disease": disease, "accession": accession}
            )

            # 全基因筛选
            try:
                screen_result = self.de_analyzer.screen_new_targets(
                    disease=disease,
                    expression_matrix=expression_matrix,
                    sample_groups=groups,
                    known_targets=known_targets,
                    normal_tissue_expression=normal_tissue_expression,
                    top_n=50
                )

                if screen_result.get("success"):
                    result = {
                        "success": True,
                        "accession": accession,
                        "gene_count": parse_result.data["gene_count"],
                        "sample_count": parse_result.data["sample_count"],
                        "disease_samples": len(groups["disease"]),
                        "control_samples": len(groups["control"]),
                        "significant_genes": screen_result.get("top_targets", []),
                        "method": groups.get("method", "unknown"),
                        "probe_mapping_stats": probe_stats,
                        "provenance": self.provenance_tracker.get_summary()
                    }
                    return result
                else:
                    self.logger.warning(f"筛选失败: {screen_result.get('error', '')}")
            except Exception as e:
                self.logger.warning(f"分析异常: {str(e)}")
                continue

        return {
            "success": False,
            "error": "所有 GEO 数据集分析失败"
        }

    def _run_tcga_differential_expression(
        self,
        disease: str,
        cancer_code: Optional[str] = None
    ) -> dict:
        """
        使用 TCGA/FireBrowse 数据进行差异表达分析（GEO 的可靠回退）

        直接查询 FireBrowse API 获取 tumor vs. normal 表达值，
        对一组癌症相关基因做 t-test DE 分析。
        天然使用基因符号，不需要探针映射。

        Args:
            disease: 疾病名称
            cancer_code: TCGA cancer code (如 BRCA)，覆盖 disease 映射
        """
        # 定义一组常见癌症药物靶点基因（用于 DE 筛选）
        CANCER_TARGET_GENES = [
            # 激酶
            "EGFR", "ERBB2", "MET", "ALK", "ROS1", "RET", "FGFR1", "FGFR2", "FGFR3", "FGFR4",
            "KIT", "PDGFRA", "PDGFRB", "VEGFR1", "VEGFR2", "VEGFR3", "FLT3", "AXL", "MER",
            # 细胞周期
            "CDK4", "CDK6", "CDK2", "CDK1", "CDKN1A", "CDKN2A", "CDKN2B", "RB1", "CCND1", "CCNE1",
            # 信号转导
            "BRAF", "RAF1", "ARAF", "KRAS", "NRAS", "HRAS", "MAP2K1", "MAP2K2",
            "PIK3CA", "PIK3CB", "AKT1", "AKT2", "MTOR", "PTEN",
            # 表观遗传
            "EZH2", "HDAC1", "HDAC2", "HDAC3", "BRD4", "EP300", "CREBBP", "DNMT3A", "IDH1", "IDH2",
            # DNA损伤修复
            "PARP1", "ATR", "ATM", "CHEK1", "CHEK2", "BRCA1", "BRCA2", "WRN",
            # 凋亡
            "BCL2", "BCL2L1", "MCL1", "BAX", "BCL2L11",
            # 转录因子
            "MYC", "NOTCH1", "NOTCH2", "JAG1", "JAG2", "HES1",
            "TP53", "MDM2", "MDM4",
            # 免疫靶点
            "CTLA4", "PDCD1", "PDCD1LG2", "CD274", "LAG3", "TIGIT", "HAVCR2",
            "CD47", "SIRPA", "CD40", "CD40LG", "OX40L", "4-1BBL",
            # 其他热门靶点
            "PCSK9", "HMGCR", "SHP2", "SOS1", "STK11", "SMARCA4", "ARID1A",
            "KEAP1", "NRF2", "NFE2L2", "SF3B1", "U2AF1",
            "ABL1", "BCR", "JAK1", "JAK2", "JAK3", "TYK2",
            "SRC", "FYN", "YES1", "LCK",
        ]

        try:
            de_response = self.tcga_client.compute_differential_expression(
                gene_list=CANCER_TARGET_GENES,
                disease=disease,
                cancer_code=cancer_code
            )

            if not de_response.success:
                return {"success": False, "error": f"TCGA DE 失败: {de_response.error}"}

            data = de_response.data
            sig_genes = data.get("significant_genes", [])

            # 格式化为与 GEO DE 结果兼容的格式
            return {
                "success": True,
                "accession": f"TCGA-{data.get('cohort', 'UNKNOWN')}",
                "gene_count": data.get("gene_count", 0),
                "sample_count": data.get("tumor_count", 0) + data.get("normal_count", 0),
                "disease_samples": data.get("tumor_count", 0),
                "control_samples": data.get("normal_count", 0),
                "significant_genes": sig_genes,
                "method": "tcga_firebrowse",
                "probe_mapping_stats": {
                    "mapping_applied": True,
                    "mapping_source": "not_needed",
                    "platform_id": "TCGA_RNAseq",
                    "total_probes": data.get("gene_count", 0),
                    "mapped_probes": data.get("gene_count", 0),
                    "unmapped_probes": 0,
                    "unique_genes": data.get("gene_count", 0)
                }
            }

        except Exception as e:
            return {"success": False, "error": f"TCGA DE 异常: {str(e)}"}

    def _search_geo_datasets(self, disease: str) -> dict:
        """搜索GEO数据集"""
        self.logger.info(f"  - 搜索RNA-seq数据集...")
        rnaseq_response = self.geo_client.find_differential_expression_datasets(
            disease, max_results=10
        )

        if rnaseq_response.success:
            self.provenance_tracker.track_from_api_response(
                "geo_search.rnaseq",
                rnaseq_response.data,
                rnaseq_response
            )

            # 获取数据集详情
            dataset_ids = rnaseq_response.data.get("dataset_ids", [])
            if dataset_ids:
                details_response = self.geo_client.get_dataset_details(dataset_ids)
                if details_response.success:
                    datasets = details_response.data.get("datasets", [])
                    # 排序
                    ranked_datasets = self.geo_client.rank_datasets(datasets, disease)

                    return {
                        "success": True,
                        "rnaseq_datasets": ranked_datasets,
                        "total_count": rnaseq_response.data.get("total_count", 0)
                    }

        # 回退到微阵列数据
        self.logger.info(f"  - 回退到微阵列数据集...")
        microarray_response = self.geo_client.search_datasets(
            disease,
            dataset_type="Expression profiling by array",
            max_results=10
        )

        if microarray_response.success:
            self.provenance_tracker.track_from_api_response(
                "geo_search.microarray",
                microarray_response.data,
                microarray_response
            )

            dataset_ids = microarray_response.data.get("dataset_ids", [])
            if dataset_ids:
                details_response = self.geo_client.get_dataset_details(dataset_ids)
                if details_response.success:
                    datasets = details_response.data.get("datasets", [])
                    ranked_datasets = self.geo_client.rank_datasets(datasets, disease)

                    return {
                        "success": True,
                        "microarray_datasets": ranked_datasets,
                        "total_count": microarray_response.data.get("total_count", 0)
                    }

        return {
            "success": False,
            "error": "未找到合适的GEO数据集"
        }

    def _evaluate_druggability(
        self,
        disease: str,
        de_candidates: list,
        known_targets: Optional[list[str]] = None,
        exclude_targets: Optional[list[str]] = None,
        extra_genes: Optional[list[str]] = None
    ) -> dict:
        """评估成药性（使用真实 OpenTargets 数据）

        Args:
            disease: 疾病名称
            de_candidates: DE 筛选的候选靶点列表
            known_targets: 已知靶点列表（排除，兼容旧接口）
            exclude_targets: 排除的靶点列表（优先于 known_targets）
            extra_genes: 额外需要评估的靶点（不排除）
        """
        result = {
            "success": False,
            "targets": {}
        }

        # 收集候选靶点集合：DE 筛选的 + 固定热门靶点
        candidate_genes = set()
        for cand in de_candidates:
            gene = cand.get("gene_symbol") or cand.get("gene", "")
            if gene:
                candidate_genes.add(gene)

        # 如果 DE 没有结果，使用一组常见药物靶点作为后备
        if not candidate_genes:
            candidate_genes = {"CDK4", "CDK6", "EGFR", "BRAF", "KRAS"}

        # 合并额外靶点（不被排除）
        if extra_genes:
            candidate_genes |= set(extra_genes)

        # 过滤已知靶点（exclude_targets 优先）
        targets_to_exclude = set(exclude_targets or known_targets or [])
        candidate_genes -= targets_to_exclude

        self.logger.info(f"  - 查询 OpenTargets 评估 {len(candidate_genes)} 个靶点...")

        for gene in sorted(candidate_genes):
            self.logger.debug(f"    - 评估 {gene}...")

            # 先解析基因符号为 ENSG ID
            resolve_resp = self.opentargets_client.resolve_gene_symbol(gene)
            if not resolve_resp.success or not resolve_resp.data.get("ensg_id"):
                self.logger.warning(f"无法解析 {gene} 的 ENSG ID，跳过")
                continue
            ensg_id = resolve_resp.data["ensg_id"]

            # 查询 OpenTargets 获取真实成药性数据
            ot_response = self.opentargets_client.get_target_druggability(ensg_id)

            if ot_response.success:
                self.provenance_tracker.track_from_api_response(
                    f"druggability.{gene}",
                    ot_response.data,
                    ot_response
                )

                # 从真实数据提取成药性信息
                druggability = ot_response.data.get("druggability", {})
                total_drug_candidates = druggability.get("total_drug_candidates", 0)
                drugs = druggability.get("drugs", [])
                # 直接从每条 drug 记录中取数字化的 max_phase_num
                max_phase = max(
                    (d.get("max_phase_num", 0) for d in drugs),
                    default=0
                )

                # 计算成药性评分（基于真实数据）
                score_result = self.druggability_scorer.score_target(
                    gene_symbol=gene,
                    opentargets_data={
                        "association_score": min(total_drug_candidates / 100.0, 1.0),
                        "datatype_scores": {
                            "known_drug": min(total_drug_candidates / 50.0, 1.0) if total_drug_candidates else 0,
                            "literature": 0.5
                        }
                    },
                    pharos_class="Tchem" if total_drug_candidates > 0 else "Tbio",
                    chembl_data={
                        "active_compounds": total_drug_candidates,
                        "max_phase": max_phase
                    }
                )

                result["targets"][gene] = score_result

        result["success"] = len(result["targets"]) > 0
        return result

    def _rank_targets(
        self,
        disease: str,
        de_result: dict,
        druggability_result: dict,
        top_n: int
    ) -> dict:
        """
        综合排序（自适应权重）

        DE 信号强时：DE 权重高（0.6）
        DE 信号弱时：成药性权重高（最高 0.8）
        使用 sigmoid 平滑过渡
        """
        targets = druggability_result.get("targets", {})

        if not targets:
            return {
                "success": False,
                "error": "没有可排序的靶点"
            }

        # 构建 DE 评分映射
        de_scores = {}
        if de_result.get("success"):
            for cand in de_result.get("significant_genes", []):
                gene = cand.get("gene_symbol") or cand.get("gene", "")
                if gene:
                    # 用 |log2FC| 归一化为 0-1 分数
                    log2fc = abs(cand.get("log2_fold_change", cand.get("log2fc", 0)))
                    de_scores[gene] = min(log2fc / 5.0, 1.0)

        # DE 回退：无显著基因时，从全量分析结果中取 top 基因
        # 这确保即使宽松过滤也无法找到显著基因时，仍有 DE 信息可用
        if not de_scores and de_result.get("success"):
            all_targets = de_result.get("significant_genes", [])
            if not all_targets:
                # 从 top_targets 取（screen_new_targets 的输出）
                all_targets = de_result.get("top_targets", [])
            for cand in all_targets[:20]:
                gene = cand.get("gene_symbol") or cand.get("gene", "")
                if gene:
                    log2fc = abs(cand.get("log2_fold_change", cand.get("log2fc", 0)))
                    p_value = cand.get("p_value", 1.0)
                    # 用 log2FC 和 p_value 联合打分
                    if log2fc > 0 and p_value < 0.1:
                        score = min(log2fc / 5.0, 1.0) * (1 - p_value)
                        de_scores[gene] = round(score, 4)

        # 计算 DE 信号强度分布（用于自适应权重）
        de_values = list(de_scores.values())
        de_strength = self._estimate_de_strength(de_values) if de_values else 0.0

        # 自适应权重计算
        # de_strength 0~1 → de_weight 0.2~0.6 (sigmoid)
        de_weight = self._sigmoid_weight(de_strength, midpoint=0.3, steepness=10)
        drug_weight = 1.0 - de_weight

        # 综合排序
        ranked = []
        for gene, data in targets.items():
            if data.get("success"):
                druggability_score = data.get("composite_score", 0)
                de_score = de_scores.get(gene, 0)
                composite = de_score * de_weight + druggability_score * drug_weight

                ranked.append({
                    "gene": gene,
                    "composite_score": round(composite, 4),
                    "de_score": round(de_score, 4),
                    "druggability_score": round(druggability_score, 4),
                    "druggability_class": data.get("druggability_class"),
                    "evidence_count": len(data.get("evidence", [])),
                    "interpretation": data.get("interpretation", ""),
                    # 记录使用的权重（用于调试/溯源）
                    "weights_used": {
                        "de_weight": round(de_weight, 3),
                        "drug_weight": round(drug_weight, 3),
                        "de_strength": round(de_strength, 3)
                    }
                })

        ranked.sort(key=lambda x: x["composite_score"], reverse=True)

        return {
            "success": True,
            "disease": disease,
            "total_targets": len(ranked),
            "top_targets": ranked[:top_n],
            "ranking_criteria": {
                "primary": "自适应综合评分 (DE×动态权重 + 成药性×动态权重)",
                "de_weight_range": [0.2, 0.6],
                "drug_weight_range": [0.4, 0.8],
                "adaptive_trigger": "DE 信号强度",
                "current_de_strength": round(de_strength, 3),
                "current_de_weight": round(de_weight, 3),
                "current_drug_weight": round(drug_weight, 3)
            }
        }

    def _estimate_de_strength(self, de_values: list[float]) -> float:
        """
        估算 DE 信号整体强度 (0~1)

        基于 DE 分数分布：
        - 高分靶点占比高 → 信号强
        - 使用 75 分位数作为强度指标
        """
        if not de_values:
            return 0.0
        import numpy as np
        # 使用 75 分位数作为强度指标
        strength = float(np.percentile(de_values, 75))
        return min(strength, 1.0)

    def _sigmoid_weight(
        self,
        strength: float,
        midpoint: float = 0.3,
        steepness: float = 10.0
    ) -> float:
        """
        Sigmoid 权重函数

        strength=0.0 → weight≈0.2 (DE 信号弱时，DE 权重低)
        strength=midpoint → weight=0.4
        strength=1.0 → weight≈0.6 (DE 信号强时，DE 权重高)

        公式: weight = 0.2 + 0.4 / (1 + exp(-steepness * (strength - midpoint)))
        """
        import math
        # 限制输入范围
        s = max(0.0, min(strength, 1.0))
        # Sigmoid: 输出范围 [0.2, 0.6]
        weight = 0.2 + 0.4 / (1.0 + math.exp(-steepness * (s - midpoint)))
        return round(weight, 4)

    def _validate_results(self, results: dict) -> dict:
        """验证结果"""
        validation = {
            "provenance_valid": False,
            "data_completeness": {},
            "issues": []
        }

        # 验证溯源
        provenance_valid, provenance_issues = self.provenance_tracker.validate_all()
        validation["provenance_valid"] = provenance_valid
        validation["provenance_issues"] = provenance_issues

        # 检查数据完整性
        stages = results.get("stages", {})

        if not stages.get("geo_search", {}).get("success"):
            validation["issues"].append("GEO数据集搜索失败")

        if not stages.get("druggability", {}).get("success"):
            validation["issues"].append("成药性评估失败")

        if not stages.get("ranking", {}).get("success"):
            validation["issues"].append("靶点排序失败")

        validation["data_completeness"] = {
            "geo_search": stages.get("geo_search", {}).get("success", False),
            "druggability": stages.get("druggability", {}).get("success", False),
            "ranking": stages.get("ranking", {}).get("success", False)
        }

        return validation

    def _generate_summary(self, results: dict) -> dict:
        """生成摘要"""
        disease = results["disease"]
        stages = results.get("stages", {})

        summary = {
            "disease": disease,
            "analysis_status": "completed",
            "key_findings": [],
            "data_sources": [],
            "top_candidates": []
        }

        # GEO数据集
        geo_search = stages.get("geo_search", {})
        if geo_search.get("success"):
            total_count = geo_search.get("total_count", 0)
            summary["data_sources"].append("GEO")
            summary["key_findings"].append(
                f"找到{total_count}个相关GEO数据集"
            )

        # 成药性评估
        druggability = stages.get("druggability", {})
        if druggability.get("success"):
            targets = druggability.get("targets", {})
            summary["data_sources"].append("OpenTargets")
            summary["key_findings"].append(
                f"评估了{len(targets)}个靶点的成药性"
            )

        # 排序结果
        ranking = stages.get("ranking", {})
        if ranking.get("success"):
            top_targets = ranking.get("top_targets", [])[:5]
            summary["top_candidates"] = [
                {
                    "gene": t["gene"],
                    "score": t["composite_score"],
                    "de_score": t.get("de_score", 0),
                    "druggability_score": t.get("druggability_score", 0),
                    "class": t.get("druggability_class")
                }
                for t in top_targets
            ]

        return summary

    def _save_results(self, disease: str, results: dict):
        """保存结果"""
        # 保存JSON
        json_path = self.output_dir / f"{disease}_stage2_results.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2, default=str)

        # 保存溯源
        self.provenance_tracker.save_to_file(f"{disease}_provenance.json")

        # 保存报告
        report_path = self.output_dir / f"{disease}_stage2_report.md"
        self._generate_markdown_report(disease, results, report_path)

    def _generate_markdown_report(
        self,
        disease: str,
        results: dict,
        output_path: Path
    ):
        """生成Markdown报告"""
        summary = results.get("summary", {})

        report = f"""# 靶点筛选与优先级排序报告: {disease}

**生成时间:** {results.get('timestamp', '')}

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
## 3. 候选靶点排名

| 排名 | 靶点 | 综合评分 | 成药性等级 |
|------|------|----------|------------|
"""

        for i, candidate in enumerate(summary.get("top_candidates", []), 1):
            report += f"| {i} | {candidate['gene']} | {candidate['score']:.3f} | {candidate['class']} |\n"

        report += f"""
## 4. 下一步建议

1. 对排名前5的靶点进行深入文献调研
2. 验证差异表达结果（下载GEO原始数据）
3. 评估靶点的临床转化潜力
4. 分析竞争格局和专利情况

---
*报告由靶点研究平台自动生成*
"""

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(report)

    def validate_inputs(self, disease: str) -> tuple[bool, list[str]]:
        """验证输入"""
        issues = []

        if not disease:
            issues.append("疾病名称不能为空")

        return len(issues) == 0, issues
