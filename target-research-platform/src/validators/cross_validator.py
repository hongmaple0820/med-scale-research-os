"""
交叉验证器
用于多源数据比对，确保数据准确性
"""
from typing import Any, Optional
from datetime import datetime


class ValidationResult:
    """验证结果"""

    def __init__(
        self,
        field: str,
        is_consistent: bool,
        confidence: str,  # "high", "medium", "low"
        sources: list[dict],
        discrepancies: list[str],
        recommendation: str
    ):
        self.field = field
        self.is_consistent = is_consistent
        self.confidence = confidence
        self.sources = sources
        self.discrepancies = discrepancies
        self.recommendation = recommendation

    def to_dict(self) -> dict:
        return {
            "field": self.field,
            "is_consistent": self.is_consistent,
            "confidence": self.confidence,
            "sources": self.sources,
            "discrepancies": self.discrepancies,
            "recommendation": self.recommendation
        }


class CrossValidator:
    """交叉验证器"""

    def __init__(self):
        self.validation_results: list[ValidationResult] = []

    def validate_expression(
        self,
        gene_symbol: str,
        gtex_data: Optional[dict] = None,
        hpa_data: Optional[dict] = None
    ) -> ValidationResult:
        """
        验证表达数据的一致性

        Args:
            gene_symbol: 基因符号
            gtex_data: GTEx数据
            hpa_data: HPA数据

        Returns:
            ValidationResult对象
        """
        sources = []
        discrepancies = []
        if not (gtex_data or {}).get("tissues"):
            gtex_data = None
        if not self._extract_hpa_tissues(hpa_data or {}):
            hpa_data = None

        # 收集数据源
        if gtex_data:
            sources.append({
                "source": "GTEx",
                "data_type": "mRNA",
                "tissue_count": len(gtex_data.get("tissues", {}))
            })

        if hpa_data:
            sources.append({
                "source": "HPA",
                "data_type": "protein",
                "tissue_count": len(hpa_data.get("tissue_expression", []))
            })

        # 检查一致性
        if gtex_data and hpa_data:
            # 比较组织表达模式
            gtex_tissues = gtex_data.get("tissues", {})
            hpa_tissues = self._extract_hpa_tissues(hpa_data)

            # 检查高表达组织是否一致
            gtex_high = self._get_high_expression_tissues(gtex_tissues)
            hpa_high = self._get_high_expression_tissues(hpa_tissues)

            overlap = set(gtex_high.keys()) & set(hpa_high.keys())
            if len(overlap) < min(len(gtex_high), len(hpa_high)) * 0.3:
                discrepancies.append(
                    f"GTEx和HPA的高表达组织重叠度低: {len(overlap)}个"
                )

        # 判断置信度
        if len(sources) >= 2 and len(discrepancies) == 0:
            confidence = "high"
            is_consistent = True
        elif len(sources) >= 2 and len(discrepancies) > 0:
            confidence = "medium"
            is_consistent = False
        elif len(sources) == 1:
            confidence = "low"
            is_consistent = True  # 单源默认一致
        else:
            confidence = "none"
            is_consistent = False

        if len(sources) < 2:
            is_consistent = False

        result = ValidationResult(
            field=f"expression_{gene_symbol}",
            is_consistent=is_consistent,
            confidence=confidence,
            sources=sources,
            discrepancies=discrepancies,
            recommendation=self._get_recommendation(confidence, discrepancies)
        )

        self.validation_results.append(result)
        return result

    def _extract_hpa_tissues(self, hpa_data: dict) -> dict:
        """从HPA数据提取组织表达"""
        tissues = {}
        for item in hpa_data.get("tissue_expression", []):
            tissue = item.get("tissue", "")
            level = item.get("level", "")

            # 转换HPA的定性描述为数值
            level_map = {
                "High": 3,
                "Medium": 2,
                "Low": 1,
                "Not detected": 0
            }
            tissues[tissue] = level_map.get(level, 0)

        return tissues

    def _get_high_expression_tissues(self, tissues: dict) -> dict:
        """获取高表达组织"""
        if not tissues:
            return {}

        values = list(tissues.values())
        if not values:
            return {}

        # 使用中位数的2倍作为阈值
        sorted_values = sorted(values)
        median = sorted_values[len(sorted_values) // 2]
        threshold = median * 2

        return {
            tissue: value
            for tissue, value in tissues.items()
            if value > threshold
        }

    def _get_recommendation(self, confidence: str, discrepancies: list[str]) -> str:
        """获取验证建议"""
        if confidence == "high":
            return "数据一致，可直接使用"
        elif confidence == "medium":
            return f"数据存在差异: {'; '.join(discrepancies)}。建议人工审核"
        elif confidence == "low":
            return "仅有单一数据源，建议补充其他来源验证"
        else:
            return "缺少数据，无法验证"

    def validate_survival(
        self,
        gene_symbol: str,
        cancer_type: str,
        tcga_result: Optional[dict] = None,
        geo_result: Optional[dict] = None
    ) -> ValidationResult:
        """
        验证生存分析结果的一致性

        Args:
            gene_symbol: 基因符号
            cancer_type: 癌种
            tcga_result: TCGA分析结果
            geo_result: GEO验证结果

        Returns:
            ValidationResult对象
        """
        sources = []
        discrepancies = []

        if tcga_result:
            sources.append({
                "source": "TCGA",
                "hr": tcga_result.get("hr"),
                "p_value": tcga_result.get("p_value"),
                "n_patients": tcga_result.get("n_patients")
            })

        if geo_result:
            sources.append({
                "source": "GEO",
                "hr": geo_result.get("hr"),
                "p_value": geo_result.get("p_value"),
                "n_patients": geo_result.get("n_patients")
            })

        # 检查HR方向一致性
        if tcga_result and geo_result:
            tcga_hr = tcga_result.get("hr")
            geo_hr = geo_result.get("hr")

            if tcga_hr and geo_hr:
                # HR>1为风险因子，HR<1为保护因子
                tcga_direction = "risk" if tcga_hr > 1 else "protective"
                geo_direction = "risk" if geo_hr > 1 else "protective"

                if tcga_direction != geo_direction:
                    discrepancies.append(
                        f"HR方向不一致: TCGA={tcga_hr:.2f}({tcga_direction}), "
                        f"GEO={geo_hr:.2f}({geo_direction})"
                    )

                # 检查HR差异是否过大
                if abs(tcga_hr - geo_hr) > 0.5:
                    discrepancies.append(
                        f"HR差异过大: TCGA={tcga_hr:.2f}, GEO={geo_hr:.2f}"
                    )

        # 判断置信度
        if len(sources) >= 2 and len(discrepancies) == 0:
            confidence = "high"
            is_consistent = True
        elif len(sources) >= 2 and len(discrepancies) > 0:
            confidence = "low"
            is_consistent = False
        elif len(sources) == 1:
            confidence = "medium"
            is_consistent = True
        else:
            confidence = "none"
            is_consistent = False

        result = ValidationResult(
            field=f"survival_{gene_symbol}_{cancer_type}",
            is_consistent=is_consistent,
            confidence=confidence,
            sources=sources,
            discrepancies=discrepancies,
            recommendation=self._get_survival_recommendation(confidence, discrepancies)
        )

        self.validation_results.append(result)
        return result

    def _get_survival_recommendation(self, confidence: str, discrepancies: list[str]) -> str:
        """获取生存分析验证建议"""
        if confidence == "high":
            return "生存分析结果在多个数据集中一致，可信度高"
        elif confidence == "low":
            return f"生存分析结果不一致: {'; '.join(discrepancies)}。需要进一步验证"
        elif confidence == "medium":
            return "仅有单个数据集结果，建议使用独立数据集验证"
        else:
            return "缺少生存分析数据"

    def validate_druggability(
        self,
        gene_symbol: str,
        opentargets_score: Optional[float] = None,
        pharos_class: Optional[str] = None,
        cansar_druggable: Optional[bool] = None
    ) -> ValidationResult:
        """
        验证成药性评估的一致性

        Args:
            gene_symbol: 基因符号
            opentargets_score: Open Targets关联评分
            pharos_class: Pharos分类
            cansar_druggable: canSAR可成药性

        Returns:
            ValidationResult对象
        """
        sources = []
        discrepancies = []
        druggability_indicators = []

        if opentargets_score is not None:
            sources.append({
                "source": "OpenTargets",
                "score": opentargets_score
            })
            druggability_indicators.append(opentargets_score > 0.5)

        if pharos_class:
            sources.append({
                "source": "Pharos",
                "class": pharos_class
            })
            # Tclin>Tchem>Tbio>Tdark
            pharos_score = {"Tclin": 4, "Tchem": 3, "Tbio": 2, "Tdark": 1}
            druggability_indicators.append(pharos_score.get(pharos_class, 0) >= 2)

        if cansar_druggable is not None:
            sources.append({
                "source": "canSAR",
                "druggable": cansar_druggable
            })
            druggability_indicators.append(cansar_druggable)

        # 检查一致性
        if len(druggability_indicators) >= 2:
            if all(druggability_indicators) or not any(druggability_indicators):
                is_consistent = True
            else:
                is_consistent = False
                discrepancies.append("不同数据库的成药性评估不一致")
        else:
            is_consistent = True

        # 判断置信度
        if len(sources) >= 3:
            confidence = "high"
        elif len(sources) >= 2:
            confidence = "medium"
        elif len(sources) == 1:
            confidence = "low"
        else:
            confidence = "none"

        result = ValidationResult(
            field=f"druggability_{gene_symbol}",
            is_consistent=is_consistent,
            confidence=confidence,
            sources=sources,
            discrepancies=discrepancies,
            recommendation=self._get_druggability_recommendation(
                confidence, discrepancies, druggability_indicators
            )
        )

        self.validation_results.append(result)
        return result

    def _get_druggability_recommendation(
        self,
        confidence: str,
        discrepancies: list[str],
        indicators: list[bool]
    ) -> str:
        """获取成药性验证建议"""
        if confidence == "high":
            if all(indicators):
                return "多源数据一致表明该靶点具有成药性"
            elif not any(indicators):
                return "多源数据一致表明该靶点成药性较低"
            else:
                return f"成药性评估存在分歧: {'; '.join(discrepancies)}"
        elif confidence == "medium":
            return "成药性评估需要更多数据源支持"
        else:
            return "成药性数据不足，建议补充OpenTargets/Pharos/canSAR数据"

    def get_all_validations(self) -> list[dict]:
        """获取所有验证结果"""
        return [v.to_dict() for v in self.validation_results]

    def get_overall_confidence(self) -> dict:
        """获取整体置信度评估"""
        if not self.validation_results:
            return {"overall": "none", "details": []}

        confidence_counts = {"high": 0, "medium": 0, "low": 0, "none": 0}
        for v in self.validation_results:
            confidence_counts[v.confidence] += 1

        # 整体置信度取最低
        if confidence_counts["none"] > 0:
            overall = "none"
        elif confidence_counts["low"] > 0:
            overall = "low"
        elif confidence_counts["medium"] > 0:
            overall = "medium"
        else:
            overall = "high"

        return {
            "overall": overall,
            "distribution": confidence_counts,
            "total_validations": len(self.validation_results)
        }
