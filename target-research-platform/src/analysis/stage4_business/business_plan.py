"""
商业计划书生成模块
汇总前三阶段数据，生成投融资方案
"""
from typing import Optional
from datetime import datetime


class BusinessPlanGenerator:
    """商业计划书生成器"""

    def __init__(self):
        self.plans = {}

    def generate(
        self,
        target_name: str,
        disease: Optional[str] = None,
        stage1_data: Optional[dict] = None,
        stage2_data: Optional[dict] = None,
        stage3_data: Optional[dict] = None,
        milestone_data: Optional[dict] = None,
        company_info: Optional[dict] = None
    ) -> dict:
        """
        生成商业计划书

        Args:
            target_name: 靶点名称
            disease: 疾病名称
            stage1_data: 阶段1数据（表达与预后）
            stage2_data: 阶段2数据（筛选与排序）
            stage3_data: 阶段3数据（深度调研）
            milestone_data: 里程碑数据
            company_info: 公司信息

        Returns:
            商业计划书
        """
        plan = {
            "success": True,
            "target": target_name,
            "disease": disease,
            "timestamp": datetime.now().isoformat(),
            "sections": {}
        }

        # 1. 执行摘要
        plan["sections"]["executive_summary"] = self._generate_executive_summary(
            target_name, disease, stage1_data, stage2_data, stage3_data
        )

        # 2. 科学依据
        plan["sections"]["scientific_rationale"] = self._generate_scientific_rationale(
            target_name, disease, stage1_data, stage3_data
        )

        # 3. 市场机会
        plan["sections"]["market_opportunity"] = self._generate_market_opportunity(
            target_name, disease, stage3_data
        )

        # 4. 竞争优势
        plan["sections"]["competitive_advantage"] = self._generate_competitive_advantage(
            target_name, disease, stage3_data
        )

        # 5. 开发计划
        plan["sections"]["development_plan"] = self._generate_development_plan(
            target_name, disease, milestone_data
        )

        # 6. 财务预测
        plan["sections"]["financial_projection"] = self._generate_financial_projection(
            target_name, disease, milestone_data, stage3_data
        )

        # 7. 融资需求
        plan["sections"]["funding_requirements"] = self._generate_funding_requirements(
            target_name, disease, milestone_data
        )

        # 8. 风险评估
        plan["sections"]["risk_assessment"] = self._generate_risk_assessment(
            target_name, disease, stage3_data, milestone_data
        )

        # 9. 团队与资源
        plan["sections"]["team_and_resources"] = self._generate_team_section(
            company_info
        )

        # 10. 里程碑与退出策略
        plan["sections"]["milestones_and_exit"] = self._generate_milestones_exit(
            target_name, disease, milestone_data, stage3_data
        )

        self.plans[f"{target_name}_{disease or 'general'}"] = plan
        return plan

    def _generate_executive_summary(
        self,
        target_name: str,
        disease: Optional[str],
        stage1_data: Optional[dict],
        stage2_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成执行摘要"""
        summary_parts = []

        # 靶点概述
        summary_parts.append(f"本项目聚焦于{target_name}靶点")
        if disease:
            summary_parts.append(f"用于治疗{disease}")

        # 科学依据
        if stage1_data:
            summary1 = stage1_data.get("summary", {})
            if summary1.get("key_findings"):
                summary_parts.append(f"科学验证显示{summary1['key_findings'][0]}")

        # 市场机会
        if stage3_data:
            summary3 = stage3_data.get("summary", {})
            developability = summary3.get("developability", {})
            if developability.get("level") == "high":
                summary_parts.append("具有高开发潜力")

        # 资金需求
        if stage3_data:
            assessment = stage3_data.get("stages", {}).get("assessment", {})
            recommendations = assessment.get("rd_recommendations", [])
            if recommendations:
                summary_parts.append(f"建议: {recommendations[0].get('recommendation', '')}")

        return {
            "title": f"{target_name}{' - ' + disease if disease else ''} 项目商业计划书",
            "summary": "。".join(summary_parts) + "。",
            "key_highlights": self._extract_key_highlights(
                target_name, disease, stage1_data, stage2_data, stage3_data
            )
        }

    def _extract_key_highlights(
        self,
        target_name: str,
        disease: Optional[str],
        stage1_data: Optional[dict],
        stage2_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> list:
        """提取关键亮点"""
        highlights = []

        # 科学验证
        if stage1_data:
            summary1 = stage1_data.get("summary", {})
            confidence = summary1.get("confidence_level", "")
            if confidence in ["high", "medium"]:
                highlights.append(f"科学验证置信度: {confidence}")

        # 成药性
        if stage2_data:
            summary2 = stage2_data.get("summary", {})
            top_candidates = summary2.get("top_candidates", [])
            if top_candidates:
                highlights.append(f"成药性评分: {top_candidates[0].get('score', 0):.2f}")

        # 临床进展
        if stage3_data:
            clinical = stage3_data.get("stages", {}).get("clinical_pipeline", {}).get("data", {})
            if clinical:
                total_trials = clinical.get("total_trials", 0)
                if total_trials > 0:
                    highlights.append(f"全球{total_trials}个临床试验")

        # 可开发性
        if stage3_data:
            developability = stage3_data.get("summary", {}).get("developability", {})
            if developability.get("score", 0) >= 70:
                highlights.append("高开发潜力")

        return highlights

    def _generate_scientific_rationale(
        self,
        target_name: str,
        disease: Optional[str],
        stage1_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成科学依据"""
        rationale = {
            "target_biology": {},
            "expression_data": {},
            "clinical_evidence": {},
            "literature_support": {}
        }

        # 靶点生物学
        if stage3_data:
            function_data = stage3_data.get("stages", {}).get("target_function", {}).get("data", {})
            if function_data:
                encyclopedia = function_data.get("encyclopedia", {})
                rationale["target_biology"] = {
                    "overview": encyclopedia.get("overview", ""),
                    "key_features": encyclopedia.get("key_features", []),
                    "research_status": encyclopedia.get("research_status", {})
                }

        # 表达数据
        if stage1_data:
            tissue_expr = stage1_data.get("stages", {}).get("tissue_expression", {})
            if tissue_expr:
                rationale["expression_data"] = {
                    "gtex_available": tissue_expr.get("gtex", {}).get("success", False),
                    "hpa_available": tissue_expr.get("hpa", {}).get("success", False),
                    "key_findings": stage1_data.get("summary", {}).get("key_findings", [])
                }

        # 临床证据
        if stage3_data:
            clinical = stage3_data.get("stages", {}).get("clinical_pipeline", {}).get("data", {})
            if clinical:
                rationale["clinical_evidence"] = {
                    "total_trials": clinical.get("total_trials", 0),
                    "active_trials": clinical.get("active_trials", 0),
                    "phase_distribution": clinical.get("phase_distribution", {})
                }

        # 文献支持
        if stage3_data:
            literature = stage3_data.get("stages", {}).get("literature", {}).get("data", {})
            if literature:
                rationale["literature_support"] = {
                    "total_papers": literature.get("search_results", {}).get("total_count", 0),
                    "recent_papers": literature.get("papers", [])[:5]
                }

        return rationale

    def _generate_market_opportunity(
        self,
        target_name: str,
        disease: Optional[str],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成市场机会分析"""
        opportunity = {
            "disease_burden": {},
            "market_size": {},
            "unmet_needs": {},
            "growth_drivers": {}
        }

        # 从stage3获取市场数据
        if stage3_data:
            cl_data = stage3_data.get("stages", {}).get("competitive_landscape", {}).get("data", {})
            sections = cl_data.get("sections", {})
            market = sections.get("market_analysis", {})
            if market:
                opportunity["market_size"] = {
                    "maturity": market.get("maturity", ""),
                    "opportunity": market.get("opportunity", ""),
                    "indicators": market.get("indicators", {})
                }

            # 竞争格局
            competition = sections.get("competitive_analysis", {})
            if competition:
                opportunity["competition"] = {
                    "intensity": competition.get("competition_intensity", ""),
                    "top_players": competition.get("top_players", [])[:5]
                }

        # 未满足需求
        opportunity["unmet_needs"] = {
            "description": f"{disease or '该疾病'}领域存在未满足的临床需求" if disease else "存在未满足的临床需求",
            "current_treatments": "需要进一步调研",
            "differentiation": "需要明确差异化优势"
        }

        # 增长驱动因素
        opportunity["growth_drivers"] = [
            "患者人群增长",
            "诊断率提升",
            "新疗法需求"
        ]

        return opportunity

    def _generate_competitive_advantage(
        self,
        target_name: str,
        disease: Optional[str],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成竞争优势分析"""
        advantage = {
            "differentiation": {},
            "barriers_to_entry": {},
            "partnership_opportunities": {}
        }

        # 差异化
        advantage["differentiation"] = {
            "target_rationale": f"{target_name}靶点的独特优势",
            "modality": "需要明确药物形式优势",
            "patient_selection": "需要开发生物标志物"
        }

        # 进入壁垒
        if stage3_data:
            cl_data = stage3_data.get("stages", {}).get("competitive_landscape", {}).get("data", {})
            sections = cl_data.get("sections", {})
            competition = sections.get("competitive_analysis", {})
            intensity = competition.get("competition_intensity", "")

            if intensity in ["high", "very_high"]:
                advantage["barriers_to_entry"]["competition"] = "竞争激烈，需要差异化策略"
            else:
                advantage["barriers_to_entry"]["competition"] = "竞争相对较少，先发优势明显"

        # 合作机会
        advantage["partnership_opportunities"] = {
            "pharma_companies": "寻找大型药企合作",
            "biotech": "考虑Biotech公司合作",
            "academic": "学术机构合作开发"
        }

        return advantage

    def _generate_development_plan(
        self,
        target_name: str,
        disease: Optional[str],
        milestone_data: Optional[dict]
    ) -> dict:
        """生成开发计划"""
        plan = {
            "strategy": {},
            "timeline": {},
            "key_activities": {}
        }

        if milestone_data:
            milestones = milestone_data.get("milestones", [])

            # 开发策略
            plan["strategy"] = {
                "approach": "阶段性开发",
                "go_nogo_criteria": "基于每个阶段的数据决定是否推进",
                "risk_mitigation": "早期验证降低后期风险"
            }

            # 时间线
            plan["timeline"] = {
                "total_duration": f"{milestone_data.get('total_duration_months', 0)}个月",
                "estimated_completion": milestone_data.get("estimated_completion", ""),
                "phases": [
                    {
                        "name": m.get("phase_name"),
                        "duration": f"{m.get('duration_months')}个月",
                        "start": m.get("start_date"),
                        "end": m.get("end_date")
                    }
                    for m in milestones
                ]
            }

            # 关键活动
            for milestone in milestones[:3]:  # 前3个阶段
                phase = milestone.get("phase")
                plan["key_activities"][phase] = {
                    "deliverables": milestone.get("deliverables", []),
                    "key_risks": milestone.get("key_risks", [])
                }

        return plan

    def _generate_financial_projection(
        self,
        target_name: str,
        disease: Optional[str],
        milestone_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成财务预测"""
        projection = {
            "cost_structure": {},
            "revenue_potential": {},
            "key_metrics": {}
        }

        # 成本结构
        if milestone_data:
            milestones = milestone_data.get("milestones", [])
            cost_by_phase = {}
            for m in milestones:
                phase = m.get("phase_name")
                cost = m.get("cost_estimate", {}).get("typical", 0)
                cost_by_phase[phase] = cost

            projection["cost_structure"] = {
                "total_rd_cost": f"${milestone_data.get('total_cost_estimate', 0)}M",
                "by_phase": cost_by_phase
            }

        # 收入潜力（简化估算）
        if stage3_data:
            cl_data = stage3_data.get("stages", {}).get("competitive_landscape", {}).get("data", {})
            sections = cl_data.get("sections", {})
            market = sections.get("market_analysis", {})
            if market:
                projection["revenue_potential"] = {
                    "market_opportunity": market.get("opportunity", ""),
                    "market_maturity": market.get("maturity", ""),
                    "note": "需要更详细的市场规模数据"
                }

        # 关键指标
        projection["key_metrics"] = {
            "npv": "需要现金流预测",
            "irr": "需要收入预测",
            "payback_period": "需要商业化时间线"
        }

        return projection

    def _generate_funding_requirements(
        self,
        target_name: str,
        disease: Optional[str],
        milestone_data: Optional[dict]
    ) -> dict:
        """生成融资需求"""
        funding = {
            "total_requirement": {},
            "funding_rounds": {},
            "use_of_funds": {}
        }

        if milestone_data:
            total_cost = milestone_data.get("total_cost_estimate", 0)

            # 总融资需求
            funding["total_requirement"] = {
                "amount": f"${total_cost}M",
                "timeline": f"{milestone_data.get('total_duration_months', 0)}个月",
                "note": "基于标准开发时间线估算"
            }

            # 融资轮次
            funding["funding_rounds"] = [
                {
                    "round": "种子轮/A轮",
                    "amount": f"${total_cost * 0.15:.1f}M",
                    "purpose": "靶点验证和Hit-to-Lead",
                    "timeline": "0-24个月"
                },
                {
                    "round": "B轮",
                    "amount": f"${total_cost * 0.25:.1f}M",
                    "purpose": "先导化合物优化和PCC",
                    "timeline": "24-48个月"
                },
                {
                    "round": "C轮",
                    "amount": f"${total_cost * 0.35:.1f}M",
                    "purpose": "IND申报和I期临床",
                    "timeline": "48-72个月"
                },
                {
                    "round": "D轮/IPO",
                    "amount": f"${total_cost * 0.25:.1f}M",
                    "purpose": "II/III期临床",
                    "timeline": "72个月以后"
                }
            ]

            # 资金用途
            funding["use_of_funds"] = {
                "rd": "60%",
                "operations": "20%",
                "regulatory": "10%",
                "business_development": "10%"
            }

        return funding

    def _generate_risk_assessment(
        self,
        target_name: str,
        disease: Optional[str],
        stage3_data: Optional[dict],
        milestone_data: Optional[dict]
    ) -> dict:
        """生成风险评估"""
        risks = {
            "scientific_risks": [],
            "regulatory_risks": [],
            "commercial_risks": [],
            "financial_risks": [],
            "mitigation_strategies": []
        }

        # 科学风险
        if stage3_data:
            assessment = stage3_data.get("stages", {}).get("assessment", {})
            pain_points = assessment.get("pain_points", [])
            for pp in pain_points:
                risks["scientific_risks"].append({
                    "risk": pp.get("description", ""),
                    "severity": pp.get("severity", "medium")
                })

        # 监管风险
        risks["regulatory_risks"] = [
            {"risk": "临床试验延迟", "severity": "medium"},
            {"risk": "审评标准变化", "severity": "low"}
        ]

        # 商业风险
        risks["commercial_risks"] = [
            {"risk": "竞争产品上市", "severity": "medium"},
            {"risk": "市场准入困难", "severity": "medium"}
        ]

        # 财务风险
        risks["financial_risks"] = [
            {"risk": "融资困难", "severity": "medium"},
            {"risk": "成本超支", "severity": "medium"}
        ]

        # 缓解策略
        risks["mitigation_strategies"] = [
            "分阶段开发，降低早期风险",
            "建立战略合作，分散风险",
            "灵活调整开发策略",
            "保持充足现金储备"
        ]

        return risks

    def _generate_team_section(self, company_info: Optional[dict]) -> dict:
        """生成团队与资源部分"""
        if not company_info:
            return {
                "note": "需要提供公司信息",
                "key_roles": [
                    "首席科学官（CSO）",
                    "首席医学官（CMO）",
                    "研发副总裁",
                    "商务拓展副总裁"
                ],
                "advisory_board": "需要组建科学顾问委员会"
            }

        return {
            "company_name": company_info.get("name", ""),
            "founded": company_info.get("founded", ""),
            "team_size": company_info.get("team_size", ""),
            "key_personnel": company_info.get("key_personnel", []),
            "capabilities": company_info.get("capabilities", [])
        }

    def _generate_milestones_exit(
        self,
        target_name: str,
        disease: Optional[str],
        milestone_data: Optional[dict],
        stage3_data: Optional[dict]
    ) -> dict:
        """生成里程碑与退出策略"""
        result = {
            "key_milestones": [],
            "exit_strategies": [],
            "partnership_options": []
        }

        # 关键里程碑
        if milestone_data:
            milestones = milestone_data.get("milestones", [])
            for m in milestones[:5]:  # 前5个关键里程碑
                result["key_milestones"].append({
                    "phase": m.get("phase_name"),
                    "target_date": m.get("end_date"),
                    "deliverables": m.get("deliverables", [])[:2]
                })

        # 退出策略
        result["exit_strategies"] = [
            {
                "strategy": "战略合作/授权",
                "timing": "II期临床后",
                "potential_value": "里程碑付款+ royalties"
            },
            {
                "strategy": "并购",
                "timing": "III期临床或上市后",
                "potential_value": "基于管线价值"
            },
            {
                "strategy": "IPO",
                "timing": "II期临床数据后",
                "potential_value": "市场估值"
            }
        ]

        # 合作选项
        result["partnership_options"] = [
            {
                "type": "共同开发",
                "description": "与大型药企合作开发",
                "pros": "分担风险和成本",
                "cons": "分享收益"
            },
            {
                "type": "授权-out",
                "description": "将权益授权给合作伙伴",
                "pros": "早期获得收入",
                "cons": "失去控制权"
            },
            {
                "type": "自主开发",
                "description": "独立完成开发",
                "pros": "保留全部权益",
                "cons": "承担全部风险"
            }
        ]

        return result

    def to_markdown(self, plan: dict) -> str:
        """转换为Markdown格式"""
        if not plan.get("success"):
            return "商业计划书生成失败"

        sections = plan.get("sections", {})
        target = plan.get("target", "")
        disease = plan.get("disease", "")

        md = f"""# {target}{' - ' + disease if disease else ''} 商业计划书

**生成时间:** {plan.get('timestamp', '')}

---

## 1. 执行摘要

{sections.get('executive_summary', {}).get('summary', '')}

### 关键亮点

"""
        for highlight in sections.get('executive_summary', {}).get('key_highlights', []):
            md += f"- {highlight}\n"

        # 科学依据
        scientific = sections.get('scientific_rationale', {})
        md += f"""
---

## 2. 科学依据

### 靶点生物学

{scientific.get('target_biology', {}).get('overview', '')}

### 表达数据

"""
        for finding in scientific.get('expression_data', {}).get('key_findings', []):
            md += f"- {finding}\n"

        # 市场机会
        market = sections.get('market_opportunity', {})
        md += f"""
---

## 3. 市场机会

- **市场成熟度:** {market.get('market_size', {}).get('maturity', 'N/A')}
- **市场机会:** {market.get('market_size', {}).get('opportunity', 'N/A')}

### 未满足需求

{market.get('unmet_needs', {}).get('description', '')}

"""

        # 开发计划
        development = sections.get('development_plan', {})
        timeline = development.get('timeline', {})
        md += f"""
---

## 4. 开发计划

- **总时长:** {timeline.get('total_duration', 'N/A')}
- **预计完成:** {timeline.get('estimated_completion', 'N/A')}

### 阶段计划

| 阶段 | 时长 | 开始 | 结束 |
|------|------|------|------|
"""

        for phase in timeline.get('phases', []):
            md += f"| {phase.get('name', '')} | {phase.get('duration', '')} | {phase.get('start', '')} | {phase.get('end', '')} |\n"

        # 融资需求
        funding = sections.get('funding_requirements', {})
        md += f"""
---

## 5. 融资需求

- **总需求:** {funding.get('total_requirement', {}).get('amount', 'N/A')}
- **时间线:** {funding.get('total_requirement', {}).get('timeline', 'N/A')}

### 融资轮次

| 轮次 | 金额 | 用途 | 时间 |
|------|------|------|------|
"""

        for round_info in funding.get('funding_rounds', []):
            md += f"| {round_info.get('round', '')} | {round_info.get('amount', '')} | {round_info.get('purpose', '')} | {round_info.get('timeline', '')} |\n"

        # 风险评估
        risks = sections.get('risk_assessment', {})
        md += f"""
---

## 6. 风险评估

### 科学风险

"""
        for risk in risks.get('scientific_risks', []):
            md += f"- {risk.get('risk', '')} (严重程度: {risk.get('severity', '')})\n"

        md += f"""
### 缓解策略

"""
        for strategy in risks.get('mitigation_strategies', []):
            md += f"- {strategy}\n"

        # 退出策略
        exit_section = sections.get('milestones_and_exit', {})
        md += f"""
---

## 7. 退出策略

"""
        for exit in exit_section.get('exit_strategies', []):
            md += f"- **{exit.get('strategy', '')}:** {exit.get('timing', '')} - {exit.get('potential_value', '')}\n"

        md += f"""
---

*本商业计划书由靶点研究平台自动生成*
"""

        return md

    def validate_plan(self, plan: dict) -> tuple[bool, list[str]]:
        """验证计划书完整性"""
        issues = []

        if not plan.get("success"):
            issues.append("计划书生成失败")
            return False, issues

        sections = plan.get("sections", {})

        required_sections = [
            "executive_summary",
            "scientific_rationale",
            "market_opportunity",
            "development_plan",
            "funding_requirements"
        ]

        for section in required_sections:
            if not sections.get(section):
                issues.append(f"缺少{section}部分")

        return len(issues) == 0, issues

    def get_summary(self, target_name: str, disease: Optional[str] = None) -> dict:
        """获取计划书摘要"""
        key = f"{target_name}_{disease or 'general'}"

        if key not in self.plans:
            return {
                "target": target_name,
                "disease": disease,
                "status": "not_generated"
            }

        plan = self.plans[key]
        sections = plan.get("sections", {})

        return {
            "target": target_name,
            "disease": disease,
            "status": "generated",
            "sections_count": len(sections),
            "funding_requirement": sections.get("funding_requirements", {}).get("total_requirement", {}).get("amount", ""),
            "timeline": sections.get("development_plan", {}).get("timeline", {}).get("total_duration", "")
        }
