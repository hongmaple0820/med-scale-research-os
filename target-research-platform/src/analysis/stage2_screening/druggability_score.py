"""
成药性评分模块
整合OpenTargets、Pharos、canSAR等数据源进行靶点成药性评估
"""
from typing import Optional
from datetime import datetime


class DruggabilityScorer:
    """成药性评分器"""

    # Pharos分类权重
    PHAROS_WEIGHTS = {
        "Tclin": 1.0,  # 临床验证靶点
        "Tchem": 0.8,  # 化学工具可用
        "Tbio": 0.5,   # 生物学验证
        "Tdark": 0.2   # 未充分研究
    }

    # 数据类型权重
    DATATYPE_WEIGHTS = {
        "genetic_association": 0.3,
        "somatic_mutation": 0.25,
        "known_drug": 0.2,
        "literature": 0.15,
        "animal_model": 0.1
    }

    def __init__(self):
        self.results = {}

    def score_target(
        self,
        gene_symbol: str,
        opentargets_data: Optional[dict] = None,
        pharos_class: Optional[str] = None,
        cansar_data: Optional[dict] = None,
        chembl_data: Optional[dict] = None,
        structure_data: Optional[dict] = None
    ) -> dict:
        """
        计算靶点成药性综合评分

        Args:
            gene_symbol: 基因符号
            opentargets_data: OpenTargets数据
            pharos_class: Pharos分类
            cansar_data: canSAR数据
            chembl_data: ChEMBL数据
            structure_data: 结构数据

        Returns:
            成药性评分结果
        """
        scores = {}
        weights = {}
        evidence = []

        # OpenTargets评分
        if opentargets_data:
            ot_score = self._calculate_opentargets_score(opentargets_data)
            scores["opentargets"] = ot_score["score"]
            weights["opentargets"] = 0.3
            evidence.extend(ot_score["evidence"])

        # Pharos分类评分
        if pharos_class:
            pharos_score = self._calculate_pharos_score(pharos_class)
            scores["pharos"] = pharos_score["score"]
            weights["pharos"] = 0.25
            evidence.extend(pharos_score["evidence"])

        # canSAR评分
        if cansar_data:
            cansar_score = self._calculate_cansar_score(cansar_data)
            scores["cansar"] = cansar_score["score"]
            weights["cansar"] = 0.2
            evidence.extend(cansar_score["evidence"])

        # ChEMBL评分
        if chembl_data:
            chembl_score = self._calculate_chembl_score(chembl_data)
            scores["chembl"] = chembl_score["score"]
            weights["chembl"] = 0.15
            evidence.extend(chembl_score["evidence"])

        # 结构数据评分
        if structure_data:
            struct_score = self._calculate_structure_score(structure_data)
            scores["structure"] = struct_score["score"]
            weights["structure"] = 0.1
            evidence.extend(struct_score["evidence"])

        # 计算综合评分
        composite_score = self._calculate_composite_score(scores, weights)

        # 判断成药性等级
        druggability_class = self._classify_druggability(composite_score)

        result = {
            "success": True,
            "gene": gene_symbol,
            "composite_score": round(composite_score, 3),
            "druggability_class": druggability_class,
            "component_scores": scores,
            "evidence": evidence,
            "interpretation": self._interpret_score(composite_score, druggability_class, evidence),
            "timestamp": datetime.now().isoformat()
        }

        self.results[gene_symbol] = result
        return result

    def _calculate_opentargets_score(self, data: dict) -> dict:
        """计算OpenTargets评分"""
        score = 0
        evidence = []

        # 整体关联评分
        association_score = data.get("association_score", 0)
        if association_score:
            score = min(association_score, 1.0)
            evidence.append(f"OpenTargets关联评分: {association_score:.3f}")

        # 按数据类型加权
        datatype_scores = data.get("datatype_scores", {})
        if datatype_scores:
            weighted_score = 0
            for dt, dt_score in datatype_scores.items():
                weight = self.DATATYPE_WEIGHTS.get(dt, 0.1)
                weighted_score += dt_score * weight
                evidence.append(f"  - {dt}: {dt_score:.3f}")

            # 综合两种评分
            score = (score + weighted_score) / 2

        return {"score": score, "evidence": evidence}

    def _calculate_pharos_score(self, pharos_class: str) -> dict:
        """计算Pharos评分"""
        score = self.PHAROS_WEIGHTS.get(pharos_class, 0)
        evidence = [f"Pharos分类: {pharos_class}"]

        # 添加分类解释
        class_descriptions = {
            "Tclin": "临床验证靶点（有上市药物）",
            "Tchem": "化学工具可用靶点",
            "Tbio": "生物学验证靶点",
            "Tdark": "未充分研究靶点"
        }

        if pharos_class in class_descriptions:
            evidence.append(f"  - {class_descriptions[pharos_class]}")

        return {"score": score, "evidence": evidence}

    def _calculate_cansar_score(self, data: dict) -> dict:
        """计算canSAR评分"""
        score = 0
        evidence = []

        # 可成药性
        druggable = data.get("druggable", False)
        if druggable:
            score += 0.5
            evidence.append("canSAR: 可成药")

        # 结构信息
        has_structure = data.get("has_structure", False)
        if has_structure:
            score += 0.3
            evidence.append("canSAR: 有结构信息")

        # 已知配体
        known_ligands = data.get("known_ligands", 0)
        if known_ligands > 0:
            score += min(0.2, known_ligands * 0.01)
            evidence.append(f"canSAR: {known_ligands}个已知配体")

        return {"score": min(score, 1.0), "evidence": evidence}

    def _calculate_chembl_score(self, data: dict) -> dict:
        """计算ChEMBL评分"""
        score = 0
        evidence = []

        # 活性化合物数量
        active_compounds = data.get("active_compounds", 0)
        if active_compounds > 100:
            score += 0.5
            evidence.append(f"ChEMBL: {active_compounds}个活性化合物")
        elif active_compounds > 10:
            score += 0.3
            evidence.append(f"ChEMBL: {active_compounds}个活性化合物")
        elif active_compounds > 0:
            score += 0.1
            evidence.append(f"ChEMBL: {active_compounds}个活性化合物")

        # 最高临床阶段
        max_phase = data.get("max_phase", 0)
        if max_phase >= 4:
            score += 0.5
            evidence.append(f"ChEMBL: 已上市药物")
        elif max_phase >= 3:
            score += 0.4
            evidence.append(f"ChEMBL: III期临床")
        elif max_phase >= 2:
            score += 0.3
            evidence.append(f"ChEMBL: II期临床")
        elif max_phase >= 1:
            score += 0.2
            evidence.append(f"ChEMBL: I期临床")

        return {"score": min(score, 1.0), "evidence": evidence}

    def _calculate_structure_score(self, data: dict) -> dict:
        """计算结构数据评分"""
        score = 0
        evidence = []

        # AlphaFold结构
        has_alphafold = data.get("alphafold_available", False)
        if has_alphafold:
            score += 0.4
            evidence.append("AlphaFold结构可用")

        # PDB结构
        pdb_structures = data.get("pdb_structures", 0)
        if pdb_structures > 10:
            score += 0.4
            evidence.append(f"PDB: {pdb_structures}个结构")
        elif pdb_structures > 0:
            score += 0.2
            evidence.append(f"PDB: {pdb_structures}个结构")

        # 结合位点信息
        has_binding_site = data.get("binding_site_defined", False)
        if has_binding_site:
            score += 0.2
            evidence.append("结合位点已定义")

        return {"score": min(score, 1.0), "evidence": evidence}

    def _calculate_composite_score(
        self,
        scores: dict,
        weights: dict
    ) -> float:
        """计算综合评分"""
        if not scores:
            return 0

        total_weight = sum(weights.get(k, 0) for k in scores.keys())
        if total_weight == 0:
            return 0

        weighted_sum = sum(
            scores[k] * weights.get(k, 0)
            for k in scores.keys()
        )

        return weighted_sum / total_weight

    def _classify_druggability(self, score: float) -> str:
        """分类成药性等级"""
        if score >= 0.8:
            return "highly_druggable"
        elif score >= 0.6:
            return "druggable"
        elif score >= 0.4:
            return "potentially_druggable"
        elif score >= 0.2:
            return "challenging"
        else:
            return "undruggable"

    def _interpret_score(
        self,
        score: float,
        druggability_class: str,
        evidence: list[str]
    ) -> str:
        """解释评分结果"""
        class_descriptions = {
            "highly_druggable": "高度可成药",
            "druggable": "可成药",
            "potentially_druggable": "潜在可成药",
            "challenging": "具有挑战性",
            "undruggable": "难以成药"
        }

        description = class_descriptions.get(druggability_class, "未知")

        # 找出主要支持证据
        strong_evidence = [e for e in evidence if "已上市" in e or "临床" in e or "Tclin" in e]

        if strong_evidence:
            return f"该靶点{description} (评分={score:.2f})，主要依据: {'; '.join(strong_evidence[:3])}"
        else:
            return f"该靶点{description} (评分={score:.2f})"

    def batch_score(
        self,
        targets: list[dict]
    ) -> list[dict]:
        """
        批量评分

        Args:
            targets: 靶点数据列表，每个包含gene_symbol和各数据源数据

        Returns:
            评分结果列表
        """
        results = []

        for target_data in targets:
            gene_symbol = target_data.get("gene_symbol")
            if not gene_symbol:
                continue

            result = self.score_target(
                gene_symbol=gene_symbol,
                opentargets_data=target_data.get("opentargets"),
                pharos_class=target_data.get("pharos_class"),
                cansar_data=target_data.get("cansar"),
                chembl_data=target_data.get("chembl"),
                structure_data=target_data.get("structure")
            )
            results.append(result)

        # 按评分排序
        results.sort(key=lambda x: x.get("composite_score", 0), reverse=True)

        return results

    def rank_targets(
        self,
        de_results: dict,
        druggability_results: dict,
        de_strength: Optional[float] = None
    ) -> list[dict]:
        """
        综合差异表达和成药性进行靶点排序

        Args:
            de_results: 差异表达分析结果
            druggability_results: 成药性评分结果
            de_strength: DE 信号强度 (0~1)，None 则自动估算

        Returns:
            排序后的靶点列表
        """
        ranked_targets = []

        # 自动估算 DE 强度
        if de_strength is None:
            de_values = []
            for gene, de_data in de_results.items():
                if not de_data.get("success"):
                    continue
                log2fc = abs(de_data.get("differential_expression", {}).get("log2_fold_change", 0))
                de_values.append(min(log2fc / 4, 1.0))
            if de_values:
                import numpy as np
                de_strength = float(np.percentile(de_values, 75))
                de_strength = min(de_strength, 1.0)
            else:
                de_strength = 0.3  # 默认中等

        # 自适应权重（sigmoid 过渡）
        import math
        midpoint = 0.3
        steepness = 10.0
        de_weight = 0.2 + 0.4 / (1.0 + math.exp(-steepness * (de_strength - midpoint)))
        de_weight = round(de_weight, 4)
        drug_weight = round(1.0 - de_weight, 4)

        for gene, de_data in de_results.items():
            if not de_data.get("success"):
                continue

            # 差异表达得分
            log2fc = abs(de_data.get("differential_expression", {}).get("log2_fold_change", 0))
            p_value = de_data.get("differential_expression", {}).get("p_value", 1)

            # 计算DE得分 (0-1)
            de_score = min(log2fc / 4, 1.0)  # log2FC=4时得满分
            if p_value < 0.001:
                de_score *= 1.2
            elif p_value < 0.01:
                de_score *= 1.1
            de_score = min(de_score, 1.0)

            # 成药性得分
            druggability_data = druggability_results.get(gene, {})
            druggability_score = druggability_data.get("composite_score", 0)

            # 综合得分（自适应权重）
            combined_score = de_score * de_weight + druggability_score * drug_weight

            ranked_targets.append({
                "gene": gene,
                "combined_score": round(combined_score, 3),
                "de_score": round(de_score, 3),
                "druggability_score": round(druggability_score, 3),
                "log2fc": de_data.get("differential_expression", {}).get("log2_fold_change"),
                "p_value": p_value,
                "druggability_class": druggability_data.get("druggability_class"),
                "interpretation": self._generate_ranking_interpretation(
                    gene, de_score, druggability_score, combined_score
                ),
                "weights_used": {
                    "de_weight": de_weight,
                    "drug_weight": drug_weight
                }
            })

        # 按综合得分排序
        ranked_targets.sort(key=lambda x: x["combined_score"], reverse=True)

        return ranked_targets

    def _generate_ranking_interpretation(
        self,
        gene: str,
        de_score: float,
        druggability_score: float,
        combined_score: float
    ) -> str:
        """生成排序解释"""
        if combined_score >= 0.8:
            return f"{gene}: 优秀的候选靶点，差异表达显著且成药性高"
        elif combined_score >= 0.6:
            return f"{gene}: 良好的候选靶点，值得进一步研究"
        elif combined_score >= 0.4:
            return f"{gene}: 潜在候选靶点，需要更多验证"
        else:
            return f"{gene}: 优先级较低，建议作为备选"

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证评分结果"""
        issues = []

        if not result.get("success"):
            issues.append("评分失败")
            return False, issues

        # 检查评分范围
        composite_score = result.get("composite_score", 0)
        if composite_score < 0 or composite_score > 1:
            issues.append(f"综合评分超出范围: {composite_score}")

        # 检查是否有证据
        evidence = result.get("evidence", [])
        if not evidence:
            issues.append("缺少评分证据")

        return len(issues) == 0, issues

    def get_summary(self) -> dict:
        """获取评分摘要"""
        if not self.results:
            return {"total": 0}

        scores = [r.get("composite_score", 0) for r in self.results.values()]
        classes = [r.get("druggability_class") for r in self.results.values()]

        return {
            "total": len(self.results),
            "mean_score": round(sum(scores) / len(scores), 3) if scores else 0,
            "max_score": max(scores) if scores else 0,
            "min_score": min(scores) if scores else 0,
            "class_distribution": {
                cls: classes.count(cls) for cls in set(classes)
            }
        }
