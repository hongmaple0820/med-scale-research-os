"""
竞争格局分析模块
整合临床试验、药物管线、专利等数据进行竞争分析
"""
from typing import Optional
from datetime import datetime


class CompetitiveAnalyzer:
    """竞争格局分析器"""

    # 药物开发阶段权重
    PHASE_WEIGHTS = {
        "Approved": 5,
        "Phase 4": 4,
        "Phase 3": 3,
        "Phase 2": 2,
        "Phase 1": 1,
        "Early Phase 1": 0.5,
        "Not Applicable": 0
    }

    def __init__(self):
        self.results = {}

    def analyze(
        self,
        target_name: str,
        disease: Optional[str] = None,
        clinical_data: Optional[dict] = None,
        drug_data: Optional[dict] = None,
        patent_data: Optional[dict] = None
    ) -> dict:
        """
        执行竞争格局分析

        Args:
            target_name: 靶点名称
            disease: 疾病名称
            clinical_data: 临床试验数据
            drug_data: 药物数据
            patent_data: 专利数据

        Returns:
            竞争格局分析结果
        """
        result = {
            "success": True,
            "target": target_name,
            "disease": disease,
            "timestamp": datetime.now().isoformat(),
            "sections": {}
        }

        # 1. 临床管线分析
        if clinical_data:
            result["sections"]["clinical_pipeline"] = self._analyze_clinical_pipeline(
                clinical_data
            )

        # 2. 已上市药物
        if drug_data:
            result["sections"]["approved_drugs"] = self._analyze_approved_drugs(
                drug_data
            )

        # 3. 竞争格局
        if clinical_data:
            result["sections"]["competitive_analysis"] = self._analyze_competition(
                clinical_data, drug_data
            )

        # 4. 专利分析
        if patent_data:
            result["sections"]["patent_landscape"] = self._analyze_patents(
                patent_data
            )

        # 5. 市场分析
        result["sections"]["market_analysis"] = self._analyze_market(
            result["sections"]
        )

        # 6. 生成摘要
        result["executive_summary"] = self._generate_executive_summary(
            target_name, disease, result["sections"]
        )

        self.results[f"{target_name}_{disease or 'general'}"] = result
        return result

    def _analyze_clinical_pipeline(self, clinical_data: dict) -> dict:
        """分析临床管线 — 兼容 get_competitive_landscape 扁平格式"""
        studies = clinical_data.get("studies", [])

        # phase_distribution 在顶层（get_competitive_landscape 格式）
        phase_dist = clinical_data.get("phase_distribution", {})
        # 也可在 statistics 子 dict 下（旧格式）
        if not phase_dist:
            stats = clinical_data.get("statistics", {})
            phase_dist = stats.get("phase_distribution", {})

        # status_distribution — get_competitive_landscape 不返回，从 studies 计算
        status_dist = {}
        active_statuses = ["招募中", "进行中（不招募）", "尚未招募"]
        active_trials = 0
        for s in studies:
            status = s.get("status_chinese", s.get("status", "未知"))
            status_dist[status] = status_dist.get(status, 0) + 1
            if status in active_statuses:
                active_trials += 1

        authoritative_active_trials = clinical_data.get("active_trials", 0)
        if authoritative_active_trials > 0:
            active_trials = authoritative_active_trials

        # top_sponsors — 优先从 studies 计算，或使用顶层的 top_players
        top_sponsors = {}
        for p in clinical_data.get("top_players", []):
            sponsor = p.get("sponsor", "")
            if sponsor:
                top_sponsors[sponsor] = p.get("trial_count", 1)
        if not top_sponsors:
            for s in studies:
                sponsor = s.get("sponsor", "")
                if sponsor:
                    top_sponsors[sponsor] = top_sponsors.get(sponsor, 0) + 1

        return {
            "total_trials": clinical_data.get("total_trials", len(studies)),
            "active_trials": active_trials,
            "phase_distribution": phase_dist,
            "status_distribution": status_dist,
            "top_sponsors": top_sponsors,
            "recent_trials": [
                {
                    "nct_id": s.get("nct_id", ""),
                    "title": s.get("title", ""),
                    "phase": s.get("phase_chinese", s.get("phase", "")),
                    "status": s.get("status_chinese", s.get("status", "")),
                    "sponsor": s.get("sponsor", "")
                }
                for s in studies[:10]
            ]
        }

    def _analyze_approved_drugs(self, drug_data: dict) -> dict:
        """分析已上市药物"""
        drugs = drug_data.get("drugs", [])

        # 按公司分组
        company_drugs = {}
        for drug in drugs:
            company = drug.get("company", "未知")
            if company not in company_drugs:
                company_drugs[company] = []
            company_drugs[company].append(drug)

        # 按适应症分组
        indication_drugs = {}
        for drug in drugs:
            for indication in drug.get("indications", []):
                if indication not in indication_drugs:
                    indication_drugs[indication] = []
                indication_drugs[indication].append(drug)

        return {
            "total_drugs": len(drugs),
            "drugs": [
                {
                    "name": d.get("name", ""),
                    "company": d.get("company", ""),
                    "approval_date": d.get("approval_date", ""),
                    "indications": d.get("indications", []),
                    "mechanism": d.get("mechanism", "")
                }
                for d in drugs
            ],
            "by_company": {
                company: len(drug_list)
                for company, drug_list in company_drugs.items()
            },
            "by_indication": {
                indication: len(drug_list)
                for indication, drug_list in indication_drugs.items()
            }
        }

    def _analyze_competition(
        self,
        clinical_data: dict,
        drug_data: Optional[dict]
    ) -> dict:
        """分析竞争格局 — 兼容 get_competitive_landscape 扁平格式"""
        studies = clinical_data.get("studies", [])

        # 主要玩家 — 从 studies 构建，或使用顶层 top_players
        sponsor_counts = {}
        for p in clinical_data.get("top_players", []):
            sponsor = p.get("sponsor", "")
            if sponsor:
                sponsor_counts[sponsor] = p.get("trial_count", 1)
        if not sponsor_counts:
            for s in studies:
                sponsor = s.get("sponsor", "")
                if sponsor:
                    sponsor_counts[sponsor] = sponsor_counts.get(sponsor, 0) + 1

        players = []
        for sponsor, count in sponsor_counts.items():
            sponsor_studies = [s for s in studies if s.get("sponsor") == sponsor]
            phase_scores = []
            for s in sponsor_studies:
                phase = s.get("phase", "NA")
                phase_scores.append(self.PHASE_WEIGHTS.get(phase, 0))

            avg_phase_score = sum(phase_scores) / len(phase_scores) if phase_scores else 0

            players.append({
                "company": sponsor,
                "trial_count": count,
                "phase_score": round(avg_phase_score, 2),
                "latest_phase": self._get_latest_phase(sponsor_studies)
            })

        # 按管线强度排序
        players.sort(key=lambda x: (x["trial_count"], x["phase_score"]), reverse=True)

        # 竞争集中度
        total_trials = clinical_data.get("total_trials", len(studies))
        if total_trials > 0 and players:
            top3_share = sum(p["trial_count"] for p in players[:3]) / total_trials
            if top3_share > 0.7:
                concentration = "high"
            elif top3_share > 0.4:
                concentration = "medium"
            else:
                concentration = "low"
        else:
            concentration = "unknown"
            top3_share = 0

        return {
            "top_players": players[:10],
            "market_concentration": concentration,
            "top3_market_share": round(top3_share, 2),
            "competition_intensity": self._assess_competition_intensity(
                total_trials, len(players)
            )
        }

    def _get_latest_phase(self, studies: list) -> str:
        """获取最新阶段"""
        if not studies:
            return "未知"

        phases = [s.get("phase", "NA") for s in studies]
        phase_order = ["Approved", "Phase 4", "Phase 3", "Phase 2", "Phase 1", "Early Phase 1"]

        for phase in phase_order:
            if phase in phases:
                return phase

        return "NA"

    def _assess_competition_intensity(
        self,
        total_trials: int,
        player_count: int
    ) -> str:
        """评估竞争强度"""
        if total_trials > 100:
            return "very_high"
        elif total_trials > 50:
            return "high"
        elif total_trials > 20:
            return "medium"
        elif total_trials > 5:
            return "low"
        else:
            return "very_low"

    def _analyze_patents(self, patent_data: dict) -> dict:
        """分析专利格局"""
        patents = patent_data.get("patents", [])

        if not patents:
            return {
                "total_patents": 0,
                "analysis": "专利数据不可用"
            }

        # 按年份统计
        year_counts = {}
        for patent in patents:
            year = patent.get("year", "")
            if year:
                year_counts[year] = year_counts.get(year, 0) + 1

        # 按申请人统计
        applicant_counts = {}
        for patent in patents:
            applicant = patent.get("applicant", "")
            if applicant:
                applicant_counts[applicant] = applicant_counts.get(applicant, 0) + 1

        # 排序
        top_applicants = sorted(
            applicant_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]

        return {
            "total_patents": len(patents),
            "year_trend": year_counts,
            "top_applicants": dict(top_applicants),
            "recent_patents": [
                {
                    "id": p.get("id", ""),
                    "title": p.get("title", ""),
                    "applicant": p.get("applicant", ""),
                    "year": p.get("year", "")
                }
                for p in sorted(patents, key=lambda x: x.get("year", ""), reverse=True)[:5]
            ]
        }

    def _analyze_market(self, sections: dict) -> dict:
        """分析市场情况"""
        clinical = sections.get("clinical_pipeline", {})
        approved = sections.get("approved_drugs", {})
        competition = sections.get("competitive_analysis", {})

        # 估算市场规模（简化模型）
        total_trials = clinical.get("total_trials", 0)
        active_trials = clinical.get("active_trials", 0)
        approved_drugs = approved.get("total_drugs", 0)

        # 市场成熟度评估
        if approved_drugs >= 5:
            maturity = "mature"
        elif approved_drugs >= 2:
            maturity = "growing"
        elif active_trials >= 10:
            maturity = "emerging"
        else:
            maturity = "early"

        # 市场机会评估
        competition_intensity = competition.get("competition_intensity", "unknown")
        if maturity in ["early", "emerging"] and competition_intensity in ["low", "very_low"]:
            opportunity = "high"
        elif maturity == "growing" and competition_intensity in ["medium", "low"]:
            opportunity = "medium"
        else:
            opportunity = "low"

        return {
            "maturity": maturity,
            "opportunity": opportunity,
            "indicators": {
                "total_trials": total_trials,
                "active_trials": active_trials,
                "approved_drugs": approved_drugs,
                "competition_intensity": competition_intensity
            }
        }

    def _generate_executive_summary(
        self,
        target_name: str,
        disease: Optional[str],
        sections: dict
    ) -> dict:
        """生成执行摘要"""
        clinical = sections.get("clinical_pipeline", {})
        approved = sections.get("approved_drugs", {})
        competition = sections.get("competitive_analysis", {})
        market = sections.get("market_analysis", {})

        # 关键发现
        key_findings = []

        total_trials = clinical.get("total_trials", 0)
        if total_trials > 0:
            key_findings.append(f"全球共有{total_trials}个相关临床试验")

        active_trials = clinical.get("active_trials", 0)
        if active_trials > 0:
            key_findings.append(f"其中{active_trials}个正在进行中")

        approved_drugs = approved.get("total_drugs", 0)
        if approved_drugs > 0:
            key_findings.append(f"已有{approved_drugs}个药物获批上市")

        top_players = competition.get("top_players", [])
        if top_players:
            top_company = top_players[0].get("company", "")
            key_findings.append(f"主要竞争者为{top_company}")

        # 风险评估
        risks = []
        if competition.get("competition_intensity") in ["high", "very_high"]:
            risks.append("竞争激烈，市场进入门槛高")
        if market.get("maturity") == "mature":
            risks.append("市场成熟，差异化空间有限")

        # 机会评估
        opportunities = []
        if market.get("opportunity") == "high":
            opportunities.append("市场机会大，竞争相对较少")
        if active_trials > 10:
            opportunities.append("研发活跃，技术迭代快")

        return {
            "key_findings": key_findings,
            "risks": risks,
            "opportunities": opportunities,
            "recommendation": self._generate_recommendation(market, competition)
        }

    def _generate_recommendation(
        self,
        market: dict,
        competition: dict
    ) -> str:
        """生成建议"""
        maturity = market.get("maturity", "unknown")
        opportunity = market.get("opportunity", "unknown")
        intensity = competition.get("competition_intensity", "unknown")

        if opportunity == "high":
            return "建议进入：市场机会大，竞争相对较少，具有先发优势"
        elif maturity == "growing" and intensity == "medium":
            return "可考虑进入：市场增长中，需差异化竞争策略"
        elif maturity == "mature":
            return "谨慎进入：市场成熟，需要明确的差异化优势"
        elif intensity in ["high", "very_high"]:
            return "谨慎进入：竞争激烈，需要强大的研发实力或独特的技术平台"
        else:
            return "需要进一步评估：数据不足以做出明确建议"

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证分析结果"""
        issues = []

        if not result.get("success"):
            issues.append("分析失败")
            return False, issues

        sections = result.get("sections", {})

        # 检查临床管线
        if not sections.get("clinical_pipeline"):
            issues.append("缺少临床管线数据")

        return len(issues) == 0, issues

    def get_summary(self, target_name: str, disease: Optional[str] = None) -> dict:
        """获取分析摘要"""
        key = f"{target_name}_{disease or 'general'}"

        if key not in self.results:
            return {
                "target": target_name,
                "disease": disease,
                "status": "not_analyzed"
            }

        result = self.results[key]
        summary = result.get("executive_summary", {})

        return {
            "target": target_name,
            "disease": disease,
            "status": "analyzed",
            "key_findings": summary.get("key_findings", []),
            "risks": summary.get("risks", []),
            "opportunities": summary.get("opportunities", []),
            "recommendation": summary.get("recommendation", "")
        }
