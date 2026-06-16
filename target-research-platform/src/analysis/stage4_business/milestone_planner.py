"""
里程碑规划模块
基于历史数据和行业标准生成药物开发里程碑
"""
from typing import Optional
from datetime import datetime, timedelta


class MilestonePlanner:
    """里程碑规划器"""

    # 药物开发阶段标准时间线（月）
    PHASE_DURATIONS = {
        "target_validation": {"min": 6, "typical": 12, "max": 18},
        "hit_to_lead": {"min": 6, "typical": 12, "max": 18},
        "lead_optimization": {"min": 12, "typical": 18, "max": 24},
        "pcc_nomination": {"min": 3, "typical": 6, "max": 12},
        "ind_enabling": {"min": 12, "typical": 18, "max": 24},
        "phase1": {"min": 12, "typical": 18, "max": 24},
        "phase2": {"min": 18, "typical": 24, "max": 36},
        "phase3": {"min": 24, "typical": 36, "max": 48},
        "nda_submission": {"min": 6, "typical": 12, "max": 18},
        "approval": {"min": 6, "typical": 12, "max": 18}
    }

    # 阶段成功率
    PHASE_SUCCESS_RATES = {
        "target_to_hit": 0.50,
        "hit_to_lead": 0.30,
        "lead_to_pcc": 0.25,
        "ind_to_phase1": 0.80,
        "phase1_to_phase2": 0.60,
        "phase2_to_phase3": 0.35,
        "phase3_to_nda": 0.65,
        "nda_to_approval": 0.85
    }

    # 典型成本估算（百万美元）
    PHASE_COSTS = {
        "target_validation": {"min": 0.5, "typical": 1.0, "max": 2.0},
        "hit_to_lead": {"min": 0.5, "typical": 1.5, "max": 3.0},
        "lead_optimization": {"min": 1.0, "typical": 2.0, "max": 4.0},
        "pcc_nomination": {"min": 0.5, "typical": 1.0, "max": 2.0},
        "ind_enabling": {"min": 2.0, "typical": 4.0, "max": 6.0},
        "phase1": {"min": 5.0, "typical": 10.0, "max": 20.0},
        "phase2": {"min": 10.0, "typical": 20.0, "max": 40.0},
        "phase3": {"min": 20.0, "typical": 50.0, "max": 100.0},
        "nda_submission": {"min": 2.0, "typical": 5.0, "max": 10.0}
    }

    def __init__(self):
        self.milestones = {}

    def generate_milestones(
        self,
        target_name: str,
        disease: Optional[str] = None,
        start_date: Optional[str] = None,
        modality: str = "small_molecule",
        risk_level: str = "medium",
        stage1_data: Optional[dict] = None,
        stage2_data: Optional[dict] = None,
        stage3_data: Optional[dict] = None
    ) -> dict:
        """
        生成里程碑规划

        Args:
            target_name: 靶点名称
            disease: 疾病名称
            start_date: 开始日期（YYYY-MM-DD）
            modality: 药物形式（small_molecule, antibody, cell_therapy, gene_therapy）
            risk_level: 风险等级（low, medium, high）
            stage1_data: 阶段1数据（表达分析）
            stage2_data: 阶段2数据（筛选+成药性评分）
            stage3_data: 阶段3数据（深度研究+竞争格局）

        Returns:
            里程碑规划结果
        """
        # 解析开始日期
        if start_date:
            try:
                start = datetime.strptime(start_date, "%Y-%m-%d")
            except ValueError:
                start = datetime.now()
        else:
            start = datetime.now()

        # 根据药物形式调整时间线
        duration_multiplier = self._get_duration_multiplier(modality)

        # 根据风险等级调整
        risk_multiplier = self._get_risk_multiplier(risk_level)

        # 从 stage 数据提取动态调整因子（需在循环之前计算，供每阶段使用）
        stage_adjustments = self._extract_stage_adjustments(
            target_name, disease, stage1_data, stage2_data, stage3_data
        )

        # 生成里程碑
        milestones = []
        current_date = start
        cumulative_cost = 0

        phases = [
            ("target_validation", "靶点验证"),
            ("hit_to_lead", "Hit-to-Lead"),
            ("lead_optimization", "先导化合物优化"),
            ("pcc_nomination", "PCC提名"),
            ("ind_enabling", "IND申报"),
            ("phase1", "I期临床"),
            ("phase2", "II期临床"),
            ("phase3", "III期临床"),
            ("nda_submission", "NDA/BLA申报"),
            ("approval", "上市批准")
        ]

        for phase_key, phase_name in phases:
            duration_info = self.PHASE_DURATIONS.get(phase_key, {})
            typical_months = duration_info.get("typical", 12)

            # 应用调整系数
            adjusted_months = int(typical_months * duration_multiplier * risk_multiplier)

            # 计算结束日期
            end_date = current_date + timedelta(days=adjusted_months * 30)

            # 计算成本
            cost_info = self.PHASE_COSTS.get(phase_key, {})
            typical_cost = cost_info.get("typical", 1.0)

            # 成本差异化：根据靶点特性调整
            cost_multiplier = self._get_cost_multiplier(
                phase_key, stage_adjustments, modality
            )
            adjusted_cost = typical_cost * duration_multiplier * cost_multiplier
            cumulative_cost += adjusted_cost

            # 成功率
            success_rate = self._get_phase_success_rate(
                phase_key, risk_level, stage_adjustments
            )

            milestone = {
                "phase": phase_key,
                "phase_name": phase_name,
                "start_date": current_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "duration_months": adjusted_months,
                "cost_estimate": {
                    "min": round(cost_info.get("min", 0) * duration_multiplier, 1),
                    "typical": round(adjusted_cost, 1),
                    "max": round(cost_info.get("max", 0) * duration_multiplier, 1)
                },
                "cumulative_cost": round(cumulative_cost, 1),
                "success_rate": success_rate,
                "cost_multiplier": round(cost_multiplier, 3),
                "deliverables": self._get_deliverables(phase_key),
                "key_risks": self._get_key_risks(phase_key)
            }

            milestones.append(milestone)
            current_date = end_date

        # 计算总体统计
        total_duration = (current_date - start).days / 30

        overall_success_rate = self._calculate_overall_success_rate(
            risk_level, stage_adjustments
        )

        result = {
            "success": True,
            "target": target_name,
            "disease": disease,
            "modality": modality,
            "risk_level": risk_level,
            "start_date": start.strftime("%Y-%m-%d"),
            "estimated_completion": current_date.strftime("%Y-%m-%d"),
            "total_duration_months": round(total_duration),
            "total_cost_estimate": round(cumulative_cost, 1),
            "overall_success_rate": overall_success_rate,
            "stage_adjustments": stage_adjustments,
            "milestones": milestones,
            "assumptions": self._get_assumptions(modality, risk_level),
            "timestamp": datetime.now().isoformat()
        }

        self.milestones[f"{target_name}_{disease or 'general'}"] = result
        return result

    def _get_duration_multiplier(self, modality: str) -> float:
        """获取药物形式的时间系数"""
        multipliers = {
            "small_molecule": 1.0,
            "antibody": 1.2,
            "bispecific_antibody": 1.3,
            "adc": 1.25,
            "cell_therapy": 1.5,
            "gene_therapy": 1.6,
            "rna": 1.1
        }
        return multipliers.get(modality, 1.0)

    def _get_risk_multiplier(self, risk_level: str) -> float:
        """获取风险等级系数"""
        multipliers = {
            "low": 0.9,
            "medium": 1.0,
            "high": 1.2
        }
        return multipliers.get(risk_level, 1.0)

    def _get_cost_multiplier(
        self,
        phase_key: str,
        stage_adjustments: dict,
        modality: str
    ) -> float:
        """根据靶点特性计算成本调整系数

        差异化因素:
        1. 成药性评分低 → 早期阶段（靶点验证/H2L）成本增加
        2. 竞争格局拥挤 → 临床阶段成本降低（有参考经验）
        3. 药物形式 → antibody/cell_therapy 成本更高
        """
        multiplier = 1.0

        details = stage_adjustments.get("adjustment_details", {})
        druggability_score = details.get("druggability_score", 0.5)
        competitive = details.get("competitive_landscape", {})

        # 1. 成药性影响早期阶段成本
        early_phases = {"target_validation", "hit_to_lead", "lead_optimization"}
        if phase_key in early_phases:
            # 成药性低 → 需要更多筛选/优化工作 → 成本增加
            if druggability_score < 0.3:
                multiplier *= 1.3  # 低成药性，+30%
            elif druggability_score < 0.5:
                multiplier *= 1.1  # 中等成药性，+10%
            elif druggability_score > 0.7:
                multiplier *= 0.85  # 高成药性，-15%

        # 2. 竞争格局影响临床阶段成本
        clinical_phases = {"phase1", "phase2", "phase3", "ind_enabling"}
        if phase_key in clinical_phases:
            has_approved = competitive.get("has_approved_drugs", False)
            comp_intensity = competitive.get("competition_intensity", "unknown")
            if has_approved:
                # 有上市药物 → 临床试验设计有参考 → 成本略低
                multiplier *= 0.9
            if comp_intensity == "high":
                # 高竞争 → 需要更多差异化数据 → 成本增加
                multiplier *= 1.15
            elif comp_intensity == "low":
                multiplier *= 0.9

        # 3. 药物形式成本修正
        modality_cost_adj = {
            "small_molecule": 1.0,
            "antibody": 1.3,
            "cell_therapy": 2.0,
            "gene_therapy": 2.5
        }
        if phase_key in clinical_phases:
            multiplier *= modality_cost_adj.get(modality, 1.0)

        return round(multiplier, 3)

    def _extract_stage_adjustments(
        self,
        target_name: str,
        disease: Optional[str],
        stage1_data: Optional[dict],
        stage2_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> dict:
        """
        从 Stage 1/2/3 数据提取成功率调整因子

        Returns:
            {
                "target_validation_adj": float,   # target_validation 阶段调整 (0.5~1.5)
                "hit_to_lead_adj": float,          # hit_to_lead 阶段调整
                "clinical_adj": float,             # 临床阶段整体调整
                "data_sources": list[str],         # 数据来源说明
                "adjustment_details": dict         # 详细调整说明
            }
        """
        adjustments = {
            "target_validation_adj": 1.0,
            "hit_to_lead_adj": 1.0,
            "clinical_adj": 1.0,
            "data_sources": [],
            "adjustment_details": {}
        }

        # === Stage 2 数据 → 调整 target_validation 和 hit_to_lead 成功率 ===
        if stage2_data:
            # 提取成药性评分
            druggability_score = self._extract_druggability_score(
                target_name, stage2_data
            )
            if druggability_score is not None:
                # 成药性评分高 → 靶点验证更容易成功
                # 映射: druggability_score 0.0~1.0 → adjustment 0.6~1.4
                tv_adj = 0.6 + druggability_score * 0.8
                adjustments["target_validation_adj"] = round(tv_adj, 3)
                adjustments["hit_to_lead_adj"] = round(0.7 + druggability_score * 0.6, 3)
                adjustments["data_sources"].append("stage2_druggability")
                adjustments["adjustment_details"]["druggability_score"] = druggability_score
                adjustments["adjustment_details"]["target_validation_adj"] = tv_adj

            # 提取 DE 评分强度
            de_strength = self._extract_de_strength(target_name, stage2_data)
            if de_strength is not None:
                # DE 信号强 → 靶点生物学基础更扎实
                de_adj = 0.8 + de_strength * 0.4
                adjustments["target_validation_adj"] *= de_adj
                adjustments["data_sources"].append("stage2_differential_expression")
                adjustments["adjustment_details"]["de_strength"] = de_strength

        # === Stage 3 数据 → 调整临床阶段成功率 ===
        if stage3_data:
            competitive_landscape = self._extract_competitive_landscape(stage3_data)
            if competitive_landscape:
                # 已有上市药物 → 靶点验证充分，临床成功率更高
                # 竞争激烈但机制验证充分 → 调整因子
                has_approved_drugs = competitive_landscape.get("has_approved_drugs", False)
                max_clinical_phase = competitive_landscape.get("max_clinical_phase", 0)

                if has_approved_drugs:
                    # 同靶点已有上市药物，机制验证充分
                    clinical_adj = 1.3
                    adjustments["data_sources"].append("stage3_approved_drugs")
                elif max_clinical_phase >= 3:
                    clinical_adj = 1.2
                    adjustments["data_sources"].append("stage3_phase3_data")
                elif max_clinical_phase >= 2:
                    clinical_adj = 1.1
                    adjustments["data_sources"].append("stage3_phase2_data")
                else:
                    # 无临床数据，保持默认或略降
                    clinical_adj = 0.95
                    adjustments["data_sources"].append("stage3_no_clinical_data")

                adjustments["clinical_adj"] = round(clinical_adj, 3)
                adjustments["adjustment_details"]["competitive_landscape"] = competitive_landscape

        # === Stage 1 数据 → 辅助调整 ===
        if stage1_data:
            expression_confidence = self._extract_expression_confidence(stage1_data)
            if expression_confidence is not None:
                # 表达数据置信度高 → 靶点验证基础好
                expr_adj = 0.9 + expression_confidence * 0.2
                adjustments["target_validation_adj"] *= expr_adj
                adjustments["data_sources"].append("stage1_expression")
                adjustments["adjustment_details"]["expression_confidence"] = expression_confidence

        return adjustments

    def _extract_druggability_score(
        self,
        target_name: str,
        stage2_data: dict
    ) -> Optional[float]:
        """从 Stage 2 数据提取靶点成药性评分

        查找顺序:
        1. ranking.top_targets（按基因名匹配）
        2. druggability.targets（按基因名索引，即使靶点被排除出 ranking 也能找到）
        3. summary.top_candidates
        """
        # 尝试从 ranking 结果获取
        ranking = stage2_data.get("stages", {}).get("ranking", {})
        if ranking.get("success"):
            for t in ranking.get("top_targets", []):
                if t.get("gene", "").upper() == target_name.upper():
                    return t.get("druggability_score", None)

        # 尝试从 druggability 结果获取（基因名索引，不依赖 ranking 排除逻辑）
        druggability = stage2_data.get("stages", {}).get("druggability", {})
        targets = druggability.get("targets", {})
        for gene, data in targets.items():
            if gene.upper() == target_name.upper():
                return data.get("composite_score", None)

        # 尝试从 summary 获取
        summary = stage2_data.get("summary", {})
        for candidate in summary.get("top_candidates", []):
            if candidate.get("gene", "").upper() == target_name.upper():
                return candidate.get("druggability_score", None)

        # 仍然没找到 → 尝试用 ranking 中最高成药性评分作为参考
        # （当主靶点被 --exclude-targets 排除时，用替代靶点估算）
        if ranking.get("success") and ranking.get("top_targets"):
            top = ranking["top_targets"][0]
            return top.get("druggability_score", None)

        return None

    def _extract_de_strength(
        self,
        target_name: str,
        stage2_data: dict
    ) -> Optional[float]:
        """从 Stage 2 数据提取差异表达强度 (0~1 归一化)

        查找顺序:
        1. ranking.top_targets（按基因名匹配）
        2. summary.top_candidates
        3. 从 ranking 整体分布推断（当靶点被排除时）
        """
        # 尝试从 ranking 获取指定靶点
        ranking = stage2_data.get("stages", {}).get("ranking", {})
        if ranking.get("success"):
            for t in ranking.get("top_targets", []):
                if t.get("gene", "").upper() == target_name.upper():
                    return t.get("de_score", None)

        # 尝试从 summary 获取
        summary = stage2_data.get("summary", {})
        for candidate in summary.get("top_candidates", []):
            if candidate.get("gene", "").upper() == target_name.upper():
                return candidate.get("de_score", None)

        # 靶点被排除时，从 ranking 权重信息推断整体 DE 强度
        if ranking.get("success") and ranking.get("top_targets"):
            # 使用 ranking 结果中的 weights_used 推断
            first = ranking["top_targets"][0]
            weights = first.get("weights_used", {})
            if weights.get("de_strength") is not None:
                return weights["de_strength"]

        return None

    def _extract_competitive_landscape(self, stage3_data: dict) -> Optional[dict]:
        """从 Stage 3 数据提取竞争格局信息

        支持两种数据结构:
        1. 扁平格式: competitive_landscape.data.drugs (旧格式 / 直接 API 返回)
        2. 嵌套格式: competitive_landscape.data.sections.clinical_pipeline (pipeline 输出)
        """
        result = {"has_approved_drugs": False, "max_clinical_phase": 0}

        landscape = stage3_data.get("stages", {}).get("competitive_landscape", {})
        if not landscape.get("success"):
            return None

        data = landscape.get("data", {})

        # --- 尝试路径 1: 扁平格式 data.drugs ---
        drugs = data.get("drugs", [])
        if drugs:
            max_phase = max(
                (d.get("max_phase_num", d.get("max_phase", 0)) for d in drugs),
                default=0
            )
            result["max_clinical_phase"] = max_phase
            result["has_approved_drugs"] = max_phase >= 4

        # --- 尝试路径 2: 嵌套格式 data.sections.clinical_pipeline ---
        sections = data.get("sections", {})
        clinical_pipeline = sections.get("clinical_pipeline", {})

        if not drugs and clinical_pipeline:
            # 从 phase_distribution 推断最高临床阶段
            phase_dist = clinical_pipeline.get("phase_distribution", {})
            # 映射: "Phase 4"→4, "Phase 3"→3, "Phase 2"→2, "Phase 1"→1, "Early Phase 1"→0.5
            phase_num_map = {
                "Phase 4": 4, "Phase 3": 3, "Phase 2": 2,
                "Phase 1": 1, "Early Phase 1": 0.5,
                "Not Applicable": 0
            }
            max_phase = 0
            for phase_name, count in phase_dist.items():
                if count > 0:
                    num = phase_num_map.get(phase_name, 0)
                    if isinstance(num, (int, float)) and num > max_phase:
                        max_phase = num
            result["max_clinical_phase"] = int(max_phase)
            result["has_approved_drugs"] = max_phase >= 4

            # 也从 recent_trials 提取精确阶段信息
            recent_trials = clinical_pipeline.get("recent_trials", [])
            for trial in recent_trials:
                phase_str = trial.get("phase", "")
                for pname, pnum in phase_num_map.items():
                    if pname.lower() in phase_str.lower() and pnum > result["max_clinical_phase"]:
                        result["max_clinical_phase"] = int(pnum)

        # --- 尝试路径 3: competitive_analysis.competition_intensity ---
        comp_analysis = sections.get("competitive_analysis", {})
        if comp_analysis:
            result["competition_intensity"] = comp_analysis.get("competition_intensity", "unknown")

        # --- 尝试路径 4: summary.competitive_landscape ---
        summary = stage3_data.get("summary", {})
        comp = summary.get("competitive_landscape", {})
        if comp:
            result["has_approved_drugs"] = comp.get("has_approved_drugs", result["has_approved_drugs"])
            result["max_clinical_phase"] = comp.get("max_clinical_phase", result["max_clinical_phase"])

        return result if (result["has_approved_drugs"] or result["max_clinical_phase"] > 0) else None

    def _extract_expression_confidence(self, stage1_data: dict) -> Optional[float]:
        """从 Stage 1 数据提取表达分析置信度 (0~1)

        支持多种字段:
        1. summary.confidence (直接数值)
        2. summary.confidence_level (high/medium/low → 映射为 0.8/0.5/0.2)
        3. summary.evidence_count (数值/5.0 归一化)
        4. summary.data_sources 数量 (每多一个数据源 +0.25)
        """
        summary = stage1_data.get("summary", {})

        # 优先使用 confidence 数值
        confidence = summary.get("confidence", None)
        if confidence is not None:
            return min(max(confidence, 0), 1)

        # 使用 confidence_level 映射
        level = summary.get("confidence_level", "").lower()
        level_map = {"high": 0.8, "medium": 0.5, "low": 0.2}
        if level in level_map:
            return level_map[level]

        # 基于 evidence_count 推断
        evidence_count = summary.get("evidence_count", 0)
        if evidence_count > 0:
            return min(evidence_count / 5.0, 1.0)

        # 基于 data_sources 数量推断（3个来源 = 0.75，4+ = 1.0）
        data_sources = summary.get("data_sources", [])
        if data_sources:
            return min(len(data_sources) / 4.0, 1.0)

        return None

    def _get_phase_success_rate(
        self,
        phase: str,
        risk_level: str,
        stage_adjustments: Optional[dict] = None
    ) -> float:
        """获取阶段成功率（支持动态调整）"""
        base_rates = {
            "target_validation": 0.70,
            "hit_to_lead": 0.50,
            "lead_optimization": 0.40,
            "pcc_nomination": 0.80,
            "ind_enabling": 0.75,
            "phase1": 0.80,
            "phase2": 0.50,
            "phase3": 0.60,
            "nda_submission": 0.85,
            "approval": 0.90
        }

        base_rate = base_rates.get(phase, 0.5)

        # 风险等级调整
        risk_adjustments = {
            "low": 1.1,
            "medium": 1.0,
            "high": 0.8
        }

        adjusted_rate = base_rate * risk_adjustments.get(risk_level, 1.0)

        # 动态调整（基于 stage 数据）
        if stage_adjustments:
            if phase == "target_validation":
                adjusted_rate *= stage_adjustments.get("target_validation_adj", 1.0)
            elif phase == "hit_to_lead":
                adjusted_rate *= stage_adjustments.get("hit_to_lead_adj", 1.0)
            elif phase in ("phase1", "phase2", "phase3"):
                adjusted_rate *= stage_adjustments.get("clinical_adj", 1.0)

        return min(round(adjusted_rate, 2), 1.0)

    def _calculate_overall_success_rate(
        self,
        risk_level: str,
        stage_adjustments: Optional[dict] = None
    ) -> float:
        """计算整体成功率（支持动态调整）"""
        # 从靶点到上市的累积成功率
        rates = list(self.PHASE_SUCCESS_RATES.values())

        # 风险调整
        risk_adjustments = {
            "low": 1.2,
            "medium": 1.0,
            "high": 0.7
        }

        overall = 1.0
        for rate in rates:
            overall *= rate

        adjusted = overall * risk_adjustments.get(risk_level, 1.0)

        # 动态调整
        if stage_adjustments and stage_adjustments.get("data_sources"):
            # 综合调整因子：基于所有 stage 数据的累积效果
            # target_validation 阶段影响早期成功率
            # clinical_adj 影响后期成功率
            tv_adj = stage_adjustments.get("target_validation_adj", 1.0)
            hl_adj = stage_adjustments.get("hit_to_lead_adj", 1.0)
            clinical_adj = stage_adjustments.get("clinical_adj", 1.0)

            # PHASE_SUCCESS_RATES 顺序:
            # target_to_hit, hit_to_lead, lead_to_pcc, ind_to_phase1,
            # phase1_to_phase2, phase2_to_phase3, phase3_to_nda, nda_to_approval
            stage_multipliers = [
                tv_adj,       # target_to_hit
                hl_adj,       # hit_to_lead
                1.0,          # lead_to_pcc
                1.0,          # ind_to_phase1
                clinical_adj, # phase1_to_phase2
                clinical_adj, # phase2_to_phase3
                clinical_adj, # phase3_to_nda
                1.0,          # nda_to_approval
            ]

            # 重新计算：用调整后的阶段成功率
            adjusted = 1.0
            for rate, multiplier in zip(rates, stage_multipliers):
                adjusted_rate = min(rate * multiplier, 1.0)
                adjusted *= adjusted_rate

            # 风险等级调整
            adjusted *= risk_adjustments.get(risk_level, 1.0)

        return min(round(adjusted, 4), 1.0)

    def _get_deliverables(self, phase: str) -> list:
        """获取阶段交付物"""
        deliverables = {
            "target_validation": [
                "靶点验证报告",
                "生物学机制研究",
                "初步成药性评估"
            ],
            "hit_to_lead": [
                "Hit化合物确认",
                "初步SAR分析",
                "体外活性数据"
            ],
            "lead_optimization": [
                "先导化合物优化",
                "ADMET特性改善",
                "体内药效验证"
            ],
            "pcc_nomination": [
                "PCC候选分子确定",
                "完整ADMET数据",
                "药效学研究"
            ],
            "ind_enabling": [
                "GLP毒理研究",
                "CMC工艺开发",
                "IND申报资料"
            ],
            "phase1": [
                "安全性数据",
                "PK/PD研究",
                "MTD确定"
            ],
            "phase2": [
                "有效性初步验证",
                "剂量探索",
                "生物标志物验证"
            ],
            "phase3": [
                "关键性临床试验",
                "有效性确证",
                "安全性汇总"
            ],
            "nda_submission": [
                "NDA/BLA申报资料",
                "CMC验证",
                "生产现场检查"
            ],
            "approval": [
                "上市批准",
                "商业化生产",
                "市场准入"
            ]
        }
        return deliverables.get(phase, [])

    def _get_key_risks(self, phase: str) -> list:
        """获取阶段关键风险"""
        risks = {
            "target_validation": [
                "靶点生物学验证不充分",
                "种属差异导致转化困难"
            ],
            "hit_to_lead": [
                "Hit化合物活性不足",
                "选择性问题"
            ],
            "lead_optimization": [
                "ADMET特性不达标",
                "药效模型不理想"
            ],
            "pcc_nomination": [
                "PCC特性不满足要求",
                "竞争格局变化"
            ],
            "ind_enabling": [
                "毒理发现安全信号",
                "CMC工艺放大困难"
            ],
            "phase1": [
                "安全性问题",
                "PK特性不理想"
            ],
            "phase2": [
                "有效性不足",
                "治疗窗口窄"
            ],
            "phase3": [
                "关键试验失败",
                "竞争产品上市"
            ],
            "nda_submission": [
                "审评延迟",
                "生产现场检查问题"
            ],
            "approval": [
                "市场准入困难",
                "定价压力"
            ]
        }
        return risks.get(phase, [])

    def _get_assumptions(self, modality: str, risk_level: str) -> list:
        """获取假设条件"""
        assumptions = [
            "时间线基于行业平均数据",
            "成本估算基于典型规模",
            "成功率基于历史统计数据",
            f"药物形式: {modality}",
            f"风险等级: {risk_level}"
        ]

        if modality == "small_molecule":
            assumptions.append("假设为口服小分子药物")
        elif modality == "antibody":
            assumptions.append("假设为单克隆抗体")
        elif modality == "cell_therapy":
            assumptions.append("假设为CAR-T细胞治疗")

        return assumptions

    def adjust_milestones(
        self,
        base_milestones: dict,
        adjustments: dict
    ) -> dict:
        """
        调整里程碑规划

        Args:
            base_milestones: 基础里程碑
            adjustments: 调整参数

        Returns:
            调整后的里程碑
        """
        if not base_milestones.get("success"):
            return base_milestones

        milestones = base_milestones.get("milestones", [])
        adjusted_milestones = []

        for milestone in milestones:
            phase = milestone.get("phase")
            phase_adjustments = adjustments.get(phase, {})

            if phase_adjustments:
                # 调整持续时间
                duration_factor = phase_adjustments.get("duration_factor", 1.0)
                milestone["duration_months"] = int(
                    milestone["duration_months"] * duration_factor
                )

                # 调整成本
                cost_factor = phase_adjustments.get("cost_factor", 1.0)
                milestone["cost_estimate"]["typical"] = round(
                    milestone["cost_estimate"]["typical"] * cost_factor, 1
                )

                # 添加注释
                milestone["adjustment_notes"] = phase_adjustments.get("notes", "")

            adjusted_milestones.append(milestone)

        # 重新计算总成本和总时间
        total_duration = sum(m.get("duration_months", 0) for m in adjusted_milestones)
        total_cost = sum(m.get("cost_estimate", {}).get("typical", 0) for m in adjusted_milestones)

        base_milestones["milestones"] = adjusted_milestones
        base_milestones["total_duration_months"] = total_duration
        base_milestones["total_cost_estimate"] = round(total_cost, 1)
        base_milestones["adjusted"] = True

        return base_milestones

    def get_summary(self, target_name: str, disease: Optional[str] = None) -> dict:
        """获取里程碑摘要"""
        key = f"{target_name}_{disease or 'general'}"

        if key not in self.milestones:
            return {
                "target": target_name,
                "disease": disease,
                "status": "not_planned"
            }

        result = self.milestones[key]
        milestones = result.get("milestones", [])

        return {
            "target": target_name,
            "disease": disease,
            "status": "planned",
            "total_duration": f"{result.get('total_duration_months', 0)}个月",
            "total_cost": f"${result.get('total_cost_estimate', 0)}M",
            "success_rate": f"{result.get('overall_success_rate', 0) * 100:.1f}%",
            "estimated_completion": result.get("estimated_completion", ""),
            "phases": [
                {
                    "name": m.get("phase_name"),
                    "duration": f"{m.get('duration_months')}个月",
                    "cost": f"${m.get('cost_estimate', {}).get('typical', 0)}M"
                }
                for m in milestones
            ]
        }
