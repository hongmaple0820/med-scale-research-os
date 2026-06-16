"""
免疫相关性分析模块
分析基因表达与肿瘤免疫微环境的关系
"""
import numpy as np
import pandas as pd
from typing import Optional
from datetime import datetime
from scipy import stats


class ImmuneCorrelationAnalyzer:
    """免疫相关性分析器"""

    # 常见免疫细胞类型
    IMMUNE_CELLS = [
        "B_cell",
        "CD4_T_cell",
        "CD8_T_cell",
        "Neutrophil",
        "Macrophage",
        "Dendritic_cell",
        "NK_cell",
        "Monocyte",
        "Mast_cell",
        "Eosinophil"
    ]

    def __init__(self):
        self.results = {}

    def analyze_correlation(
        self,
        gene_symbol: str,
        cancer_type: str,
        gene_expression: dict,
        immune_infiltration: dict
    ) -> dict:
        """
        分析基因表达与免疫细胞浸润的相关性

        Args:
            gene_symbol: 基因符号
            cancer_type: 癌种
            gene_expression: 基因表达 {sample_id: expression_value}
            immune_infiltration: 免疫浸润 {sample_id: {cell_type: proportion}}

        Returns:
            分析结果字典
        """
        # 合并数据
        merged_data = self._merge_data(gene_expression, immune_infiltration)

        if len(merged_data) < 30:
            return {
                "success": False,
                "error": f"样本量不足: {len(merged_data)} < 30",
                "gene": gene_symbol,
                "cancer_type": cancer_type
            }

        # 计算相关性
        correlations = {}
        for cell_type in self.IMMUNE_CELLS:
            corr_result = self._calculate_correlation(
                merged_data["expression"],
                merged_data[cell_type]
            )
            correlations[cell_type] = corr_result

        # 可视化数据准备
        plot_data = self._prepare_plot_data(merged_data, correlations)

        result = {
            "success": True,
            "gene": gene_symbol,
            "cancer_type": cancer_type,
            "sample_count": len(merged_data),
            "correlations": correlations,
            "plot_data": plot_data,
            "summary": self._generate_summary(correlations),
            "timestamp": datetime.now().isoformat()
        }

        self.results[f"{gene_symbol}_{cancer_type}"] = result
        return result

    def _merge_data(
        self,
        gene_expression: dict,
        immune_infiltration: dict
    ) -> pd.DataFrame:
        """合并基因表达和免疫浸润数据"""
        records = []

        for sample_id in gene_expression.keys():
            if sample_id in immune_infiltration:
                record = {
                    "sample_id": sample_id,
                    "expression": gene_expression[sample_id]
                }
                record.update(immune_infiltration[sample_id])
                records.append(record)

        return pd.DataFrame(records)

    def _calculate_correlation(
        self,
        expression: pd.Series,
        immune_values: pd.Series
    ) -> dict:
        """计算相关系数"""
        # 移除缺失值
        valid_mask = ~(expression.isna() | immune_values.isna())
        expr_clean = expression[valid_mask]
        immune_clean = immune_values[valid_mask]

        if len(expr_clean) < 10:
            return {
                "correlation": None,
                "p_value": None,
                "significant": None,
                "n_samples": len(expr_clean),
                "error": "样本量不足"
            }

        # Spearman相关系数
        corr, p_value = stats.spearmanr(expr_clean, immune_clean)

        # 判断相关性强度
        strength = self._classify_correlation_strength(abs(corr))

        return {
            "correlation": round(corr, 4),
            "p_value": round(p_value, 6),
            "significant": p_value < 0.05,
            "strength": strength,
            "direction": "positive" if corr > 0 else "negative",
            "n_samples": len(expr_clean),
            "interpretation": self._interpret_correlation(corr, p_value)
        }

    def _classify_correlation_strength(self, abs_corr: float) -> str:
        """分类相关性强度"""
        if abs_corr >= 0.7:
            return "strong"
        elif abs_corr >= 0.4:
            return "moderate"
        elif abs_corr >= 0.2:
            return "weak"
        else:
            return "negligible"

    def _interpret_correlation(self, corr: float, p_value: float) -> str:
        """解释相关性结果"""
        if p_value >= 0.05:
            return "无显著相关性"

        direction = "正相关" if corr > 0 else "负相关"
        strength = self._classify_correlation_strength(abs(corr))

        strength_map = {
            "strong": "强",
            "moderate": "中等",
            "weak": "弱",
            "negligible": "极弱"
        }

        return f"{strength_map[strength]}{direction} (r={corr:.3f}, p={p_value:.2e})"

    def _prepare_plot_data(self, data: pd.DataFrame, correlations: dict) -> dict:
        """准备可视化数据"""
        plot_data = {}

        for cell_type, corr_info in correlations.items():
            if cell_type in data.columns and corr_info.get("correlation") is not None:
                plot_data[cell_type] = {
                    "x": data["expression"].tolist(),
                    "y": data[cell_type].tolist(),
                    "correlation": corr_info["correlation"],
                    "p_value": corr_info["p_value"]
                }

        return plot_data

    def _generate_summary(self, correlations: dict) -> dict:
        """生成分析摘要"""
        significant_cells = []
        positive_cells = []
        negative_cells = []

        for cell_type, corr_info in correlations.items():
            if corr_info.get("significant"):
                significant_cells.append(cell_type)

                if corr_info.get("direction") == "positive":
                    positive_cells.append(cell_type)
                else:
                    negative_cells.append(cell_type)

        return {
            "significant_count": len(significant_cells),
            "significant_cells": significant_cells,
            "positive_correlations": positive_cells,
            "negative_correlations": negative_cells,
            "interpretation": self._generate_interpretation(
                significant_cells, positive_cells, negative_cells
            )
        }

    def _generate_interpretation(
        self,
        significant: list,
        positive: list,
        negative: list
    ) -> str:
        """生成结果解释"""
        if not significant:
            return "该基因表达与主要免疫细胞浸润无显著相关性"

        parts = []

        if positive:
            parts.append(f"与{', '.join(positive)}呈正相关")

        if negative:
            parts.append(f"与{', '.join(negative)}呈负相关")

        return f"该基因表达{'；'.join(parts)}"

    def analyze_immune_subtypes(
        self,
        gene_symbol: str,
        cancer_type: str,
        gene_expression: dict,
        immune_subtypes: dict
    ) -> dict:
        """
        分析基因表达与免疫亚型的关系

        Args:
            gene_symbol: 基因符号
            cancer_type: 癌种
            gene_expression: 基因表达数据
            immune_subtypes: 免疫亚型分类

        Returns:
            分析结果
        """
        # 合并数据
        records = []
        for sample_id, expr in gene_expression.items():
            if sample_id in immune_subtypes:
                records.append({
                    "sample_id": sample_id,
                    "expression": expr,
                    "subtype": immune_subtypes[sample_id]
                })

        if not records:
            return {
                "success": False,
                "error": "缺少匹配的免疫亚型数据"
            }

        df = pd.DataFrame(records)

        # 按亚型分组分析
        subtype_stats = {}
        for subtype in df["subtype"].unique():
            subtype_data = df[df["subtype"] == subtype]
            subtype_stats[subtype] = {
                "n": len(subtype_data),
                "mean_expression": round(subtype_data["expression"].mean(), 3),
                "median_expression": round(subtype_data["expression"].median(), 3),
                "std_expression": round(subtype_data["expression"].std(), 3)
            }

        # ANOVA检验
        groups = [group["expression"].values for _, group in df.groupby("subtype")]
        if len(groups) >= 2:
            f_stat, p_value = stats.f_oneway(*groups)
        else:
            f_stat, p_value = None, None

        return {
            "success": True,
            "gene": gene_symbol,
            "cancer_type": cancer_type,
            "subtype_stats": subtype_stats,
            "anova": {
                "f_statistic": round(f_stat, 4) if f_stat else None,
                "p_value": round(p_value, 6) if p_value else None,
                "significant": p_value < 0.05 if p_value else None
            },
            "interpretation": self._interpret_subtype_analysis(subtype_stats, p_value)
        }

    def _interpret_subtype_analysis(
        self,
        subtype_stats: dict,
        p_value: Optional[float]
    ) -> str:
        """解释亚型分析结果"""
        if p_value is None:
            return "无法执行统计检验"

        if p_value >= 0.05:
            return "该基因在不同免疫亚型间表达无显著差异"

        # 找出表达最高和最低的亚型
        sorted_subtypes = sorted(
            subtype_stats.items(),
            key=lambda x: x[1]["mean_expression"],
            reverse=True
        )

        highest = sorted_subtypes[0][0]
        lowest = sorted_subtypes[-1][0]

        return f"该基因在{highest}亚型中表达最高，在{lowest}亚型中表达最低 (p={p_value:.2e})"

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证分析结果"""
        issues = []

        if not result.get("success"):
            issues.append(result.get("error", "分析失败"))
            return False, issues

        # 检查样本量
        if result.get("sample_count", 0) < 30:
            issues.append(f"样本量不足: {result['sample_count']} < 30")

        # 检查相关性结果
        correlations = result.get("correlations", {})
        valid_correlations = [
            c for c in correlations.values()
            if c.get("correlation") is not None
        ]

        if len(valid_correlations) < 3:
            issues.append("有效相关性计算不足")

        return len(issues) == 0, issues

    def get_summary(self, gene_symbol: str, cancer_types: list[str]) -> dict:
        """获取多癌种免疫相关性摘要"""
        summary = {
            "gene": gene_symbol,
            "cancer_count": len(cancer_types),
            "results": {}
        }

        for cancer_type in cancer_types:
            key = f"{gene_symbol}_{cancer_type}"
            if key in self.results:
                result = self.results[key]
                summary["results"][cancer_type] = {
                    "success": result.get("success"),
                    "sample_count": result.get("sample_count"),
                    "significant_cells": result.get("summary", {}).get("significant_cells", []),
                    "interpretation": result.get("summary", {}).get("interpretation", "")
                }

        return summary
