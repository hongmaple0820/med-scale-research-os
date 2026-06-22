"""
差异表达分析模块
用于识别疾病相关差异表达基因
"""
import numpy as np
import pandas as pd
from typing import Optional
from datetime import datetime
from scipy import stats


class DifferentialExpressionAnalyzer:
    """差异表达分析器"""

    def __init__(self):
        self.results = {}

    def analyze(
        self,
        gene_symbol: str,
        disease: str,
        expression_matrix: pd.DataFrame,
        sample_groups: dict,
        method: str = "ttest"
    ) -> dict:
        """
        执行差异表达分析

        Args:
            gene_symbol: 基因符号
            disease: 疾病名称
            expression_matrix: 表达矩阵 (genes x samples)
            sample_groups: 样本分组 {"disease": [...], "control": [...]}
            method: 统计方法 ("ttest", "mannwhitney", "deseq2")

        Returns:
            分析结果字典
        """
        # 验证输入
        if gene_symbol not in expression_matrix.index:
            return {
                "success": False,
                "error": f"基因 {gene_symbol} 不在表达矩阵中",
                "gene": gene_symbol,
                "disease": disease
            }

        disease_samples = sample_groups.get("disease", [])
        control_samples = sample_groups.get("control", [])

        # 检查样本是否存在
        available_disease = [s for s in disease_samples if s in expression_matrix.columns]
        available_control = [s for s in control_samples if s in expression_matrix.columns]

        if len(available_disease) < 3 or len(available_control) < 3:
            return {
                "success": False,
                "error": f"样本量不足: 疾病组={len(available_disease)}, 对照组={len(available_control)}",
                "gene": gene_symbol,
                "disease": disease
            }

        # 提取表达数据
        disease_expr = expression_matrix.loc[gene_symbol, available_disease]
        control_expr = expression_matrix.loc[gene_symbol, available_control]

        # 计算差异表达统计量
        de_result = self._calculate_differential_expression(
            disease_expr, control_expr, method
        )

        # 计算效应大小
        effect_size = self._calculate_effect_size(disease_expr, control_expr)

        # 生成可视化数据
        plot_data = self._prepare_plot_data(
            disease_expr, control_expr, gene_symbol
        )

        result = {
            "success": True,
            "gene": gene_symbol,
            "disease": disease,
            "sample_counts": {
                "disease": len(available_disease),
                "control": len(available_control)
            },
            "expression_stats": {
                "disease_mean": round(float(disease_expr.mean()), 3),
                "disease_std": round(float(disease_expr.std()), 3),
                "control_mean": round(float(control_expr.mean()), 3),
                "control_std": round(float(control_expr.std()), 3)
            },
            "differential_expression": de_result,
            "effect_size": effect_size,
            "plot_data": plot_data,
            "interpretation": self._interpret_result(de_result, effect_size),
            "timestamp": datetime.now().isoformat()
        }

        self.results[f"{gene_symbol}_{disease}"] = result
        return result

    def _calculate_differential_expression(
        self,
        disease_expr: pd.Series,
        control_expr: pd.Series,
        method: str
    ) -> dict:
        """计算差异表达统计量"""
        if method == "ttest":
            return self._ttest_analysis(disease_expr, control_expr)
        elif method == "mannwhitney":
            return self._mannwhitney_analysis(disease_expr, control_expr)
        else:
            return self._ttest_analysis(disease_expr, control_expr)

    @staticmethod
    def _compute_log2_effect(
        mean_disease: float,
        mean_control: float,
        value_scale: str = "auto",
    ) -> float:
        if value_scale == "log":
            return float(mean_disease - mean_control)
        if mean_disease <= 0 or mean_control <= 0:
            return float(mean_disease - mean_control)
        return float(np.log2(mean_disease / mean_control))

    def _ttest_analysis(
        self,
        disease_expr: pd.Series,
        control_expr: pd.Series
    ) -> dict:
        """t检验分析"""
        # 方差齐性检验
        levene_stat, levene_p = stats.levene(disease_expr, control_expr)
        equal_var = levene_p > 0.05

        # t检验
        t_stat, p_value = stats.ttest_ind(
            disease_expr, control_expr,
            equal_var=equal_var
        )

        # 计算log2 fold change
        mean_disease = disease_expr.mean()
        mean_control = control_expr.mean()

        scale = "log" if float(pd.concat([disease_expr, control_expr]).min()) < 0 else "auto"
        log2fc = self._compute_log2_effect(mean_disease, mean_control, scale)

        return {
            "method": "t-test",
            "t_statistic": round(float(t_stat), 4),
            "p_value": round(float(p_value), 6),
            "log2_fold_change": round(float(log2fc), 4),
            "significant": p_value < 0.05,
            "equal_variance": equal_var,
            "levene_p_value": round(float(levene_p), 4)
        }

    def _mannwhitney_analysis(
        self,
        disease_expr: pd.Series,
        control_expr: pd.Series
    ) -> dict:
        """Mann-Whitney U检验分析"""
        u_stat, p_value = stats.mannwhitneyu(
            disease_expr, control_expr,
            alternative='two-sided'
        )

        # 计算log2 fold change
        mean_disease = disease_expr.mean()
        mean_control = control_expr.mean()

        scale = "log" if float(pd.concat([disease_expr, control_expr]).min()) < 0 else "auto"
        log2fc = self._compute_log2_effect(mean_disease, mean_control, scale)

        return {
            "method": "Mann-Whitney U",
            "u_statistic": round(float(u_stat), 4),
            "p_value": round(float(p_value), 6),
            "log2_fold_change": round(float(log2fc), 4),
            "significant": p_value < 0.05
        }

    def _calculate_effect_size(
        self,
        disease_expr: pd.Series,
        control_expr: pd.Series
    ) -> dict:
        """计算效应大小"""
        # Cohen's d
        n1, n2 = len(disease_expr), len(control_expr)
        var1, var2 = disease_expr.var(), control_expr.var()

        # 合并标准差
        pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))

        if pooled_std > 0:
            cohens_d = (disease_expr.mean() - control_expr.mean()) / pooled_std
        else:
            cohens_d = 0

        # 解释效应大小
        abs_d = abs(cohens_d)
        if abs_d >= 0.8:
            magnitude = "large"
        elif abs_d >= 0.5:
            magnitude = "medium"
        elif abs_d >= 0.2:
            magnitude = "small"
        else:
            magnitude = "negligible"

        return {
            "cohens_d": round(float(cohens_d), 4),
            "magnitude": magnitude,
            "interpretation": self._interpret_effect_size(cohens_d, magnitude)
        }

    def _interpret_effect_size(self, cohens_d: float, magnitude: str) -> str:
        """解释效应大小"""
        direction = "上调" if cohens_d > 0 else "下调"
        magnitude_map = {
            "large": "大",
            "medium": "中等",
            "small": "小",
            "negligible": "可忽略"
        }
        return f"疾病组相比对照组{direction}，效应大小为{magnitude_map[magnitude]} (d={cohens_d:.2f})"

    def _prepare_plot_data(
        self,
        disease_expr: pd.Series,
        control_expr: pd.Series,
        gene_symbol: str
    ) -> dict:
        """准备可视化数据"""
        return {
            "gene": gene_symbol,
            "disease_values": disease_expr.tolist(),
            "control_values": control_expr.tolist(),
            "disease_label": "Disease",
            "control_label": "Control"
        }

    def _interpret_result(self, de_result: dict, effect_size: dict) -> str:
        """解释分析结果"""
        p_value = de_result.get("p_value", 1)
        log2fc = de_result.get("log2_fold_change", 0)
        magnitude = effect_size.get("magnitude", "negligible")

        if p_value >= 0.05:
            return "该基因在疾病组和对照组之间无显著差异表达"

        direction = "上调" if log2fc > 0 else "下调"
        fold_change = abs(log2fc)

        if fold_change >= 2:
            fc_desc = "显著"
        elif fold_change >= 1:
            fc_desc = "中等"
        else:
            fc_desc = "轻微"

        return f"该基因在疾病组中显著{direction} (log2FC={log2fc:.2f}, p={p_value:.2e})，效应大小为{magnitude}"

    def screen_new_targets(
        self,
        disease: str,
        expression_matrix: pd.DataFrame,
        sample_groups: dict,
        known_targets: Optional[list[str]] = None,
        normal_tissue_expression: Optional[dict] = None,
        top_n: int = 50,
        value_scale: str = "auto",
    ) -> dict:
        """
        筛选新靶点

        Args:
            disease: 疾病名称
            expression_matrix: 表达矩阵
            sample_groups: 样本分组
            known_targets: 已知靶点列表（排除）
            normal_tissue_expression: 正常组织表达数据（用于过滤）
            top_n: 返回前N个候选靶点

        Returns:
            候选靶点列表
        """
        disease_samples = sample_groups.get("disease", [])
        control_samples = sample_groups.get("control", [])

        # 检查样本
        available_disease = [s for s in disease_samples if s in expression_matrix.columns]
        available_control = [s for s in control_samples if s in expression_matrix.columns]

        if len(available_disease) < 3 or len(available_control) < 3:
            return {
                "success": False,
                "error": "样本量不足",
                "disease": disease
            }

        # 计算所有基因的差异表达
        results = []

        for gene in expression_matrix.index:
            # 排除已知靶点
            if known_targets and gene in known_targets:
                continue

            disease_expr = expression_matrix.loc[gene, available_disease]
            control_expr = expression_matrix.loc[gene, available_control]

            # 跳过低表达基因
            if disease_expr.mean() < 1 and control_expr.mean() < 1:
                continue

            # t检验
            try:
                t_stat, p_value = stats.ttest_ind(disease_expr, control_expr)

                # 计算log2FC
                mean_disease = disease_expr.mean()
                mean_control = control_expr.mean()

                log2fc = self._compute_log2_effect(
                    mean_disease,
                    mean_control,
                    value_scale=value_scale,
                )

                # 过滤正常组织高表达基因（阈值 50 TPM — 只过滤极高地表达基因）
                if normal_tissue_expression and gene in normal_tissue_expression:
                    normal_expr = normal_tissue_expression[gene]
                    if normal_expr > 50:
                        continue

                results.append({
                    "gene": gene,
                    "gene_symbol": gene,  # 标准化字段名，便于与成药性结果匹配
                    "log2fc": float(log2fc),
                    "p_value": float(p_value),
                    "disease_mean": float(mean_disease),
                    "control_mean": float(mean_control)
                })

            except Exception:
                continue

        # 转换为DataFrame并排序
        results_df = pd.DataFrame(results)

        if results_df.empty:
            return {
                "success": False,
                "error": "未找到差异表达基因",
                "disease": disease
            }

        # 多重检验校正（Benjamini-Hochberg）
        from statsmodels.stats.multitest import multipletests
        _, adjusted_p_values, _, _ = multipletests(
            results_df['p_value'],
            method='fdr_bh'
        )
        results_df['adjusted_p_value'] = adjusted_p_values

        # 筛选显著差异表达基因 — 严格标准
        significant = results_df[
            (results_df['adjusted_p_value'] < 0.05) &
            (abs(results_df['log2fc']) > 1)
        ]

        # 宽松回退：严格标准无结果时降低阈值
        if len(significant) == 0:
            significant = results_df[
                (results_df['adjusted_p_value'] < 0.2) &
                (abs(results_df['log2fc']) > 0.5)
            ]

        # 最终回退：仅按 p-value 排序（不做多重检验校正）
        if len(significant) == 0:
            significant = results_df[
                (results_df['p_value'] < 0.05) &
                (abs(results_df['log2fc']) > 0.3)
            ]

        # 按log2FC排序
        significant = significant.sort_values(
            'log2fc',
            ascending=False,
            key=abs
        )

        # 标注过滤级别
        filter_level = "strict"
        if len(significant) > 0 and (significant['adjusted_p_value'] > 0.05).any():
            filter_level = "relaxed"
        elif len(significant) > 0 and (significant['p_value'] < 0.05).any() and (significant['adjusted_p_value'] > 0.2).any():
            filter_level = "nominal"

        return {
            "success": True,
            "disease": disease,
            "total_genes_analyzed": len(results),
            "significant_genes_count": len(significant),
            "upregulated_count": len(significant[significant['log2fc'] > 0]),
            "downregulated_count": len(significant[significant['log2fc'] < 0]),
            "top_targets": significant.head(top_n).to_dict('records'),
            "filter_level": filter_level,
            "timestamp": datetime.now().isoformat()
        }

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证分析结果"""
        issues = []

        if not result.get("success"):
            issues.append(result.get("error", "分析失败"))
            return False, issues

        # 检查样本量
        sample_counts = result.get("sample_counts", {})
        if sample_counts.get("disease", 0) < 3:
            issues.append(f"疾病组样本量不足: {sample_counts.get('disease', 0)}")
        if sample_counts.get("control", 0) < 3:
            issues.append(f"对照组样本量不足: {sample_counts.get('control', 0)}")

        # 检查p值
        de_result = result.get("differential_expression", {})
        if de_result.get("p_value") is None:
            issues.append("缺少p值")

        return len(issues) == 0, issues

    def get_summary(self, gene_symbol: str, diseases: list[str]) -> dict:
        """获取多疾病分析摘要"""
        summary = {
            "gene": gene_symbol,
            "disease_count": len(diseases),
            "results": {}
        }

        for disease in diseases:
            key = f"{gene_symbol}_{disease}"
            if key in self.results:
                result = self.results[key]
                summary["results"][disease] = {
                    "success": result.get("success"),
                    "log2fc": result.get("differential_expression", {}).get("log2_fold_change"),
                    "p_value": result.get("differential_expression", {}).get("p_value"),
                    "significant": result.get("differential_expression", {}).get("significant")
                }

        return summary
