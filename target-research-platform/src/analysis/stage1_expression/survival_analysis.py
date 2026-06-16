"""
生存分析模块
使用Kaplan-Meier曲线和Cox回归分析基因表达与预后的关系
"""
import numpy as np
import pandas as pd
from typing import Optional
from datetime import datetime


class SurvivalAnalyzer:
    """生存分析引擎"""

    def __init__(self):
        self.results = {}

    def analyze(
        self,
        gene_symbol: str,
        cancer_type: str,
        expression_data: dict,
        clinical_data: dict,
        split_method: str = "median"
    ) -> dict:
        """
        执行生存分析

        Args:
            gene_symbol: 基因符号
            cancer_type: 癌种
            expression_data: 表达数据 {sample_id: expression_value}
            clinical_data: 临床数据 {sample_id: {survival_months, event}}
            split_method: 分组方法 ("median", "quartile")

        Returns:
            分析结果字典
        """
        # 合并数据
        merged_data = self._merge_data(expression_data, clinical_data)

        if len(merged_data) < 50:
            return {
                "success": False,
                "error": f"样本量不足: {len(merged_data)} < 50",
                "gene": gene_symbol,
                "cancer_type": cancer_type
            }

        # 分组
        if split_method == "median":
            groups = self._split_by_median(merged_data)
        elif split_method == "quartile":
            groups = self._split_by_quartile(merged_data)
        else:
            groups = self._split_by_median(merged_data)

        # KM分析
        km_result = self._kaplan_meier_analysis(groups)

        # Log-rank检验
        logrank_result = self._logrank_test(groups)

        # Cox回归
        cox_result = self._cox_regression(merged_data)

        result = {
            "success": True,
            "gene": gene_symbol,
            "cancer_type": cancer_type,
            "sample_count": len(merged_data),
            "split_method": split_method,
            "km_analysis": km_result,
            "logrank_test": logrank_result,
            "cox_regression": cox_result,
            "timestamp": datetime.now().isoformat()
        }

        self.results[f"{gene_symbol}_{cancer_type}"] = result
        return result

    def _merge_data(self, expression_data: dict, clinical_data: dict) -> pd.DataFrame:
        """合并表达和临床数据"""
        records = []

        for sample_id, expr_value in expression_data.items():
            if sample_id in clinical_data:
                clinical = clinical_data[sample_id]
                records.append({
                    "sample_id": sample_id,
                    "expression": expr_value,
                    "survival_months": clinical.get("survival_months"),
                    "event": clinical.get("event")
                })

        return pd.DataFrame(records)

    def _split_by_median(self, data: pd.DataFrame) -> dict:
        """按中位数分组"""
        median_expr = data["expression"].median()

        high_group = data[data["expression"] >= median_expr]
        low_group = data[data["expression"] < median_expr]

        return {
            "high": {
                "data": high_group,
                "n": len(high_group),
                "threshold": median_expr
            },
            "low": {
                "data": low_group,
                "n": len(low_group),
                "threshold": median_expr
            }
        }

    def _split_by_quartile(self, data: pd.DataFrame) -> dict:
        """按四分位数分组"""
        q75 = data["expression"].quantile(0.75)
        q25 = data["expression"].quantile(0.25)

        high_group = data[data["expression"] >= q75]
        low_group = data[data["expression"] <= q25]

        return {
            "high": {
                "data": high_group,
                "n": len(high_group),
                "threshold": q75
            },
            "low": {
                "data": low_group,
                "n": len(low_group),
                "threshold": q25
            }
        }

    def _kaplan_meier_analysis(self, groups: dict) -> dict:
        """Kaplan-Meier生存分析"""
        try:
            from lifelines import KaplanMeierFitter

            results = {}

            for group_name, group_data in groups.items():
                data = group_data["data"]

                kmf = KaplanMeierFitter()
                kmf.fit(
                    data["survival_months"],
                    event_observed=data["event"]
                )

                # 计算中位生存时间
                median_survival = kmf.median_survival_time_

                # 计算特定时间点的生存率
                survival_at_times = {}
                for time_point in [12, 24, 36, 60]:
                    try:
                        prob = kmf.survival_function_at_times(time_point).values[0]
                        survival_at_times[f"{time_point}m"] = round(prob, 3)
                    except:
                        survival_at_times[f"{time_point}m"] = None

                results[group_name] = {
                    "n": group_data["n"],
                    "median_survival_months": round(median_survival, 1) if not np.isnan(median_survival) else None,
                    "survival_rates": survival_at_times
                }

            return results

        except ImportError:
            # 如果lifelines不可用，返回简化结果
            return self._simplified_km_analysis(groups)

    def _simplified_km_analysis(self, groups: dict) -> dict:
        """简化KM分析（无需lifelines）"""
        results = {}

        for group_name, group_data in groups.items():
            data = group_data["data"]
            events = data[data["event"] == 1]

            if len(events) > 0:
                median_survival = events["survival_months"].median()
            else:
                median_survival = None

            results[group_name] = {
                "n": group_data["n"],
                "events": len(events),
                "median_survival_months": round(median_survival, 1) if median_survival else None,
                "note": "简化分析，建议安装lifelines获取完整结果"
            }

        return results

    def _logrank_test(self, groups: dict) -> dict:
        """Log-rank检验"""
        try:
            from lifelines.statistics import logrank_test

            high_data = groups["high"]["data"]
            low_data = groups["low"]["data"]

            result = logrank_test(
                high_data["survival_months"],
                low_data["survival_months"],
                event_observed_A=high_data["event"],
                event_observed_B=low_data["event"]
            )

            return {
                "test_statistic": round(result.test_statistic, 4),
                "p_value": round(result.p_value, 6),
                "significant": result.p_value < 0.05,
                "interpretation": self._interpret_p_value(result.p_value)
            }

        except ImportError:
            # 简化检验
            return self._simplified_logrank(groups)

    def _simplified_logrank(self, groups: dict) -> dict:
        """简化Log-rank检验"""
        from scipy import stats

        high_data = groups["high"]["data"]
        low_data = groups["low"]["data"]

        # 使用Mann-Whitney U检验作为替代
        try:
            stat, p_value = stats.mannwhitneyu(
                high_data["survival_months"],
                low_data["survival_months"],
                alternative='two-sided'
            )

            return {
                "test_statistic": round(stat, 4),
                "p_value": round(p_value, 6),
                "significant": p_value < 0.05,
                "interpretation": self._interpret_p_value(p_value),
                "note": "使用Mann-Whitney U检验替代"
            }
        except:
            return {
                "p_value": None,
                "significant": None,
                "error": "无法执行统计检验"
            }

    def _cox_regression(self, data: pd.DataFrame) -> dict:
        """Cox比例风险回归"""
        try:
            from lifelines import CoxPHFitter

            # 准备数据
            cox_data = data[["survival_months", "event", "expression"]].copy()
            cox_data = cox_data.dropna()

            cph = CoxPHFitter()
            cph.fit(cox_data, duration_col="survival_months", event_col="event")

            # 提取结果
            summary = cph.summary
            hr = summary.loc["expression", "exp(coef)"]
            hr_lower = summary.loc["expression", "exp(coef) lower 95%"]
            hr_upper = summary.loc["expression", "exp(coef) upper 95%"]
            p_value = summary.loc["expression", "p"]

            return {
                "hazard_ratio": round(hr, 3),
                "hr_ci_lower": round(hr_lower, 3),
                "hr_ci_upper": round(hr_upper, 3),
                "p_value": round(p_value, 6),
                "significant": p_value < 0.05,
                "interpretation": self._interpret_hr(hr),
                "concordance_index": round(cph.concordance_index_, 3)
            }

        except ImportError:
            return self._simplified_cox(data)

    def _simplified_cox(self, data: pd.DataFrame) -> dict:
        """简化Cox回归"""
        # 使用scipy进行简化分析
        from scipy import stats

        high_expr = data[data["expression"] >= data["expression"].median()]
        low_expr = data[data["expression"] < data["expression"].median()]

        # 计算风险比的近似值
        high_events = high_expr[high_expr["event"] == 1]
        low_events = low_expr[low_expr["event"] == 1]

        if len(low_events) > 0 and len(low_expr) > 0:
            high_rate = len(high_events) / len(high_expr)
            low_rate = len(low_events) / len(low_expr)

            if low_rate > 0:
                hr_approx = high_rate / low_rate
            else:
                hr_approx = None
        else:
            hr_approx = None

        return {
            "hazard_ratio": round(hr_approx, 3) if hr_approx else None,
            "interpretation": self._interpret_hr(hr_approx) if hr_approx else "无法计算",
            "note": "简化分析，建议安装lifelines获取完整结果"
        }

    def _interpret_p_value(self, p_value: float) -> str:
        """解释p值"""
        if p_value < 0.001:
            return "极显著差异 (p < 0.001)"
        elif p_value < 0.01:
            return "高度显著差异 (p < 0.01)"
        elif p_value < 0.05:
            return "显著差异 (p < 0.05)"
        else:
            return "无显著差异 (p >= 0.05)"

    def _interpret_hr(self, hr: float) -> str:
        """解释风险比"""
        if hr is None:
            return "无法计算"
        elif hr > 1:
            return f"高表达是风险因子 (HR={hr:.2f}>1)"
        elif hr < 1:
            return f"高表达是保护因子 (HR={hr:.2f}<1)"
        else:
            return "无影响 (HR=1)"

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证分析结果"""
        issues = []

        if not result.get("success"):
            issues.append(result.get("error", "分析失败"))
            return False, issues

        # 检查样本量
        if result.get("sample_count", 0) < 50:
            issues.append(f"样本量不足: {result['sample_count']} < 50")

        # 检查p值
        logrank = result.get("logrank_test", {})
        if logrank.get("p_value") is None:
            issues.append("缺少Log-rank检验结果")

        # 检查HR
        cox = result.get("cox_regression", {})
        if cox.get("hazard_ratio") is None:
            issues.append("缺少Cox回归结果")

        return len(issues) == 0, issues

    def get_summary(self, gene_symbol: str, cancer_types: list[str]) -> dict:
        """获取多癌种分析摘要"""
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
                    "hr": result.get("cox_regression", {}).get("hazard_ratio"),
                    "p_value": result.get("logrank_test", {}).get("p_value"),
                    "significant": result.get("logrank_test", {}).get("significant")
                }

        return summary
