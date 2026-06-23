"""
阶段3 Pipeline：靶点深度调研与赛道格局分析
整合靶点功能、竞争格局、专利、临床管线等多维分析
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from ...api_clients.clinicaltrials_client import ClinicalTrialsClient
from ...api_clients.pubmed_client import PubMedClient
from ...api_clients.opentargets_client import OpenTargetsClient
from ...api_clients.openfda_client import OpenFDAClient
from ...api_clients.patentsview_client import PatentsViewClient
from ...utils.logger import get_logger
from ...validators.data_provenance import ProvenanceTracker
from ...validators.evidence_gate import evaluate_stage3_evidence
from .target_function import TargetFunctionAnalyzer
from .competitive_landscape import CompetitiveAnalyzer


class Stage3Pipeline:
    """阶段3 Pipeline：靶点深度调研与赛道格局分析"""
    logger = get_logger("stage3")

    def __init__(
        self,
        output_dir: str = "./output/stage3",
        cache_dir: str = "./cache"
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 初始化API客户端
        self.clinical_client = ClinicalTrialsClient(cache_dir=cache_dir)
        self.pubmed_client = PubMedClient(cache_dir=cache_dir)
        self.opentargets_client = OpenTargetsClient(cache_dir=cache_dir)
        self.openfda_client = OpenFDAClient(cache_dir=cache_dir)
        self.patents_client = PatentsViewClient(cache_dir=cache_dir)

        # 初始化分析器
        self.function_analyzer = TargetFunctionAnalyzer()
        self.competitive_analyzer = CompetitiveAnalyzer()

        # 初始化验证器
        self.provenance_tracker = ProvenanceTracker(
            log_dir=str(self.output_dir / "provenance")
        )

    def run(
        self,
        target_name: str,
        ensg_id: Optional[str] = None,
        disease: Optional[str] = None
    ) -> dict:
        """
        执行完整的阶段3分析

        Args:
            target_name: 靶点名称
            ensg_id: Ensembl基因ID（可选）
            disease: 疾病名称（可选）

        Returns:
            完整的分析结果
        """
        self.logger.info(f"{'=' * 60}")
        self.logger.info(f"阶段3 Pipeline: {target_name}")
        if disease:
            self.logger.info(f"疾病: {disease}")
        self.logger.info(f"{'=' * 60}")

        # 自动解析 ENSG ID
        if not ensg_id:
            self.logger.info("[解析] 自动解析 ENSG ID...")
            ensg_id = self._resolve_ensg_id(target_name)
            if ensg_id:
                self.logger.info(f"  - 解析成功: {ensg_id}")
            else:
                self.logger.warning(f"  - 解析失败，跳过需要 ENSG ID 的查询")

        results = {
            "target": target_name,
            "ensg_id": ensg_id,
            "disease": disease,
            "timestamp": datetime.now().isoformat(),
            "stages": {}
        }

        # 1. 靶点功能分析
        self.logger.info("[1/5] 靶点功能分析...")
        function_result = self._analyze_target_function(target_name, ensg_id)
        results["stages"]["target_function"] = function_result

        # 2. 临床管线分析
        self.logger.info("[2/5] 临床管线分析...")
        clinical_result = self._analyze_clinical_pipeline(target_name, disease)
        results["stages"]["clinical_pipeline"] = clinical_result

        # 3. 文献分析
        self.logger.info("[3/5] 文献分析...")
        literature_result = self._analyze_literature(target_name, disease)
        results["stages"]["literature"] = literature_result

        # 4. 竞争格局分析
        self.logger.info("[4/5] 竞争格局分析...")
        patent_result = self._analyze_patents(target_name, disease)
        results["stages"]["patents"] = patent_result
        market_result = self._analyze_market_evidence(target_name, disease)
        results["stages"]["market_evidence"] = market_result

        competitive_result = self._analyze_competitive_landscape(
            target_name, disease, clinical_result, patent_result, market_result
        )
        results["stages"]["competitive_landscape"] = competitive_result

        # 5. 综合评估
        self.logger.info("[5/5] 综合评估...")
        assessment_result = self._generate_assessment(
            target_name, disease, results["stages"]
        )
        results["stages"]["assessment"] = assessment_result

        # 验证
        validation_result = self._validate_results(results)
        results["validation"] = validation_result

        # 生成摘要
        results["summary"] = self._generate_summary(results)

        # 保存结果
        self._save_results(target_name, disease, results)

        self.logger.info(f"{'=' * 60}")
        self.logger.info("阶段3分析完成!")
        self.logger.info(f"结果保存至: {self.output_dir}")
        self.logger.info(f"{'=' * 60}")

        return results

    def _resolve_ensg_id(self, gene_symbol: str) -> Optional[str]:
        """通过 OpenTargets 解析基因符号到 ENSG ID"""
        try:
            resp = self.opentargets_client.resolve_gene_symbol(gene_symbol)
            if resp.success:
                return resp.data.get("ensg_id")
        except Exception:
            pass
        return None

    def _analyze_target_function(
        self,
        target_name: str,
        ensg_id: Optional[str]
    ) -> dict:
        """分析靶点功能"""
        result = {
            "success": False,
            "data": None
        }

        # 查询OpenTargets获取靶点信息
        if ensg_id:
            self.logger.debug("  - 查询OpenTargets靶点信息...")
            ot_response = self.opentargets_client.get_target_druggability(ensg_id)

            if ot_response.success:
                self.provenance_tracker.track_from_api_response(
                    "target_function.opentargets",
                    ot_response.data,
                    ot_response
                )

                # 执行功能分析
                protein_ids = ot_response.data.get("protein_ids", [])
                uniprot_id = protein_ids[0].get("id", "") if protein_ids else ""

                function_result = self.function_analyzer.analyze(
                    gene_symbol=target_name,
                    uniprot_data={
                        "uniprot_id": uniprot_id,
                        "gene_name": target_name,
                        "protein_name": ot_response.data.get("gene_symbol", ""),
                        "function": ot_response.data.get("function", []),
                        "subcellular_location": ot_response.data.get("subcellular_locations", [])
                    }
                )

                result["success"] = True
                result["data"] = function_result
            else:
                result["error"] = ot_response.error
        else:
            # 无ENSG ID时的简化分析
            result["success"] = True
            result["data"] = {
                "gene": target_name,
                "note": "缺少Ensembl ID，无法获取详细功能数据"
            }

        return result

    def _analyze_clinical_pipeline(
        self,
        target_name: str,
        disease: Optional[str]
    ) -> dict:
        """分析临床管线"""
        self.logger.debug("  - 查询ClinicalTrials.gov...")
        clinical_response = self.clinical_client.get_competitive_landscape(
            target_name, disease
        )

        if clinical_response.get("success"):
            self.provenance_tracker.track(
                "clinical_pipeline",
                clinical_response,
                "ClinicalTrials.gov",
                "/studies",
                {"target": target_name, "disease": disease}
            )

            return {
                "success": True,
                "data": clinical_response
            }
        else:
            return {
                "success": False,
                "error": clinical_response.get("error", "查询失败")
            }

    def _analyze_literature(
        self,
        target_name: str,
        disease: Optional[str]
    ) -> dict:
        """分析文献"""
        self.logger.debug("  - 查询PubMed文献...")
        pubmed_response = self.pubmed_client.search_gene_literature(
            target_name, disease, max_results=30
        )

        if pubmed_response.success:
            self.provenance_tracker.track_from_api_response(
                "literature.pubmed",
                pubmed_response.data,
                pubmed_response
            )

            # 获取文献详情
            pmids = pubmed_response.data.get("pmids", [])
            if pmids:
                details_response = self.pubmed_client.fetch_details(pmids[:20])
                if details_response.success:
                    return {
                        "success": True,
                        "data": {
                            "search_results": pubmed_response.data,
                            "papers": details_response.data.get("papers", [])
                        }
                    }

            return {
                "success": True,
                "data": {
                    "search_results": pubmed_response.data,
                    "papers": []
                }
            }
        else:
            return {
                "success": False,
                "error": pubmed_response.error
            }

    def _analyze_patents(
        self,
        target_name: str,
        disease: Optional[str]
    ) -> dict:
        """Fetch traceable patent evidence."""
        self.logger.debug("  - Query USPTO PatentsView/ODP...")
        patent_response = self.patents_client.search_patents(
            target_name,
            disease,
            max_results=25
        )

        if patent_response.success:
            self.provenance_tracker.track_from_api_response(
                "patents.uspto",
                patent_response.data,
                patent_response
            )
            return {
                "success": True,
                "data": patent_response.data
            }

        return {
            "success": False,
            "error": patent_response.error,
            "data": patent_response.data
        }

    def _analyze_market_evidence(
        self,
        target_name: str,
        disease: Optional[str]
    ) -> dict:
        """Fetch public regulatory evidence for market/competitive context."""
        self.logger.debug("  - Query openFDA drug labels...")
        market_response = self.openfda_client.search_market_evidence(
            target_name,
            disease,
            max_results=10
        )

        if market_response.success:
            self.provenance_tracker.track_from_api_response(
                "market.openfda",
                market_response.data,
                market_response
            )
            return {
                "success": True,
                "data": market_response.data
            }

        return {
            "success": False,
            "error": market_response.error,
            "data": market_response.data
        }

    def _analyze_competitive_landscape(
        self,
        target_name: str,
        disease: Optional[str],
        clinical_result: dict,
        patent_result: Optional[dict] = None,
        market_result: Optional[dict] = None
    ) -> dict:
        """分析竞争格局"""
        self.logger.debug("  - 整合竞争数据...")

        clinical_data = clinical_result.get("data", {}) if clinical_result.get("success") else None

        if not clinical_data:
            return {
                "success": False,
                "error": "缺少临床数据"
            }

        # 执行竞争分析
        competitive_result = self.competitive_analyzer.analyze(
            target_name=target_name,
            disease=disease,
            clinical_data=clinical_data,
            patent_data=(patent_result or {}).get("data") if (patent_result or {}).get("success") else None,
            market_data=(market_result or {}).get("data") if (market_result or {}).get("success") else None
        )

        return {
            "success": competitive_result.get("success"),
            "data": competitive_result
        }

    def _generate_assessment(
        self,
        target_name: str,
        disease: Optional[str],
        stages: dict
    ) -> dict:
        """生成综合评估"""
        self.logger.debug("  - 生成综合评估...")

        # 收集各阶段结果
        function_data = stages.get("target_function", {}).get("data", {})
        clinical_data = stages.get("clinical_pipeline", {}).get("data", {})
        literature_data = stages.get("literature", {}).get("data", {})
        competitive_data = stages.get("competitive_landscape", {}).get("data", {})

        # 可开发性评估
        developability = self._assess_developability(
            function_data, clinical_data, competitive_data
        )

        # 痛点分析
        pain_points = self._identify_pain_points(
            function_data, clinical_data, competitive_data
        )

        # 机会分析
        opportunities = self._identify_opportunities(
            clinical_data, competitive_data
        )

        # 研发建议
        rd_recommendations = self._generate_rd_recommendations(
            developability, pain_points, opportunities
        )

        return {
            "success": True,
            "developability": developability,
            "pain_points": pain_points,
            "opportunities": opportunities,
            "rd_recommendations": rd_recommendations
        }

    def _assess_developability(
        self,
        function_data: dict,
        clinical_data: dict,
        competitive_data: dict
    ) -> dict:
        """评估可开发性"""
        score = 0
        evidence = []

        # 靶点验证程度 — function_data 结构为 {success, sections: {basic_info, function}}
        func_sections = function_data.get("sections", {})
        func_basic = func_sections.get("basic_info", {})
        func_detail = func_sections.get("function", {})
        if func_basic.get("uniprot_id") or func_detail.get("function_description"):
            score += 20
            evidence.append("靶点研究活跃，功能注释充分")

        # 临床进展 — clinical_data 结构为 {success, total_trials, active_trials, ...}
        if clinical_data.get("active_trials", 0) > 0:
            score += 20
            evidence.append(f"有{clinical_data['active_trials']}个活跃临床试验")

        # 已知药物 — 检查是否有 top_players（表示有公司在推进）
        top_players = clinical_data.get("top_players", [])
        if top_players:
            score += 25
            evidence.append(f"已有{len(top_players)}家公司在推进临床管线")

        # 竞争强度
        competition = competitive_data.get("competitive_analysis", {})
        intensity = competition.get("competition_intensity", "unknown")
        if intensity in ["low", "very_low"]:
            score += 20
            evidence.append("竞争相对较少")
        elif intensity == "medium":
            score += 10
            evidence.append("竞争中等")

        # 市场机会
        market = competitive_data.get("market_analysis", {})
        if market.get("opportunity") == "high":
            score += 10
            evidence.append("市场机会大")

        # 分类
        if score >= 70:
            level = "high"
        elif score >= 50:
            level = "medium"
        elif score >= 30:
            level = "low"
        else:
            level = "very_low"

        return {
            "score": score,
            "level": level,
            "evidence": evidence,
            "interpretation": self._interpret_developability(score, level)
        }

    def _interpret_developability(self, score: int, level: str) -> str:
        """解释可开发性"""
        level_descriptions = {
            "high": "高开发潜力",
            "medium": "中等开发潜力",
            "low": "低开发潜力",
            "very_low": "开发风险高"
        }

        return f"可开发性评分{score}/100，属于{level_descriptions.get(level, '未知')}"

    def _identify_pain_points(
        self,
        function_data: dict,
        clinical_data: dict,
        competitive_data: dict
    ) -> list:
        """识别痛点"""
        pain_points = []

        # competitive_data 结构: {sections: {competitive_analysis, market_analysis, ...}}
        comp_sections = competitive_data.get("sections", {})
        competition = comp_sections.get("competitive_analysis", {})

        # 竞争激烈
        if competition.get("competition_intensity") in ["high", "very_high"]:
            pain_points.append({
                "type": "competition",
                "description": "竞争激烈，市场进入门槛高",
                "severity": "high"
            })

        # 市场成熟
        market = comp_sections.get("market_analysis", {})
        if market.get("maturity") == "mature":
            pain_points.append({
                "type": "market",
                "description": "市场成熟，差异化空间有限",
                "severity": "medium"
            })

        # 靶点验证不足
        func_sections = function_data.get("sections", {})
        if not func_sections.get("basic_info", {}).get("uniprot_id"):
            pain_points.append({
                "type": "validation",
                "description": "靶点研究不充分，验证数据有限",
                "severity": "high"
            })

        return pain_points

    def _identify_opportunities(
        self,
        clinical_data: dict,
        competitive_data: dict
    ) -> list:
        """识别机会"""
        opportunities = []

        # 市场机会
        market = competitive_data.get("market_analysis", {})
        if market.get("opportunity") == "high":
            opportunities.append({
                "type": "market",
                "description": "市场机会大，竞争相对较少",
                "potential": "high"
            })

        # 新适应症 — active_trials 在 clinical_data 顶层
        if clinical_data.get("active_trials", 0) > 5:
            opportunities.append({
                "type": "indication",
                "description": "多个适应症正在探索，扩展潜力大",
                "potential": "medium"
            })

        # 技术迭代
        competition = competitive_data.get("competitive_analysis", {})
        if competition.get("competition_intensity") == "medium":
            opportunities.append({
                "type": "technology",
                "description": "技术仍有迭代空间，差异化机会存在",
                "potential": "medium"
            })

        return opportunities

    def _generate_rd_recommendations(
        self,
        developability: dict,
        pain_points: list,
        opportunities: list
    ) -> list:
        """生成研发建议"""
        recommendations = []

        # 基于可开发性
        if developability.get("level") == "high":
            recommendations.append({
                "priority": "high",
                "recommendation": "建议推进：靶点验证充分，市场机会明确",
                "next_steps": [
                    "深入分析竞品差异化策略",
                    "评估技术平台优势",
                    "制定临床开发计划"
                ]
            })
        elif developability.get("level") == "medium":
            recommendations.append({
                "priority": "medium",
                "recommendation": "可考虑推进：需要明确差异化优势",
                "next_steps": [
                    "识别未满足的临床需求",
                    "评估技术可行性",
                    "寻找合作伙伴"
                ]
            })
        else:
            recommendations.append({
                "priority": "low",
                "recommendation": "谨慎推进：风险较高，需要充分评估",
                "next_steps": [
                    "深入研究靶点生物学",
                    "评估技术壁垒",
                    "考虑替代靶点"
                ]
            })

        # 基于痛点
        high_severity_pain_points = [p for p in pain_points if p.get("severity") == "high"]
        if high_severity_pain_points:
            recommendations.append({
                "priority": "high",
                "recommendation": "需要解决的关键痛点",
                "next_steps": [
                    f"解决: {p.get('description', '')}"
                    for p in high_severity_pain_points
                ]
            })

        return recommendations

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

        if not stages.get("clinical_pipeline", {}).get("success"):
            validation["issues"].append("临床管线分析失败")

        if not stages.get("literature", {}).get("success"):
            validation["issues"].append("文献分析失败")

        validation["data_completeness"] = {
            "target_function": stages.get("target_function", {}).get("success", False),
            "clinical_pipeline": stages.get("clinical_pipeline", {}).get("success", False),
            "literature": stages.get("literature", {}).get("success", False),
            "patents": stages.get("patents", {}).get("success", False),
            "market_evidence": stages.get("market_evidence", {}).get("success", False),
            "competitive_landscape": stages.get("competitive_landscape", {}).get("success", False)
        }

        evidence_gate = evaluate_stage3_evidence(results)
        validation["evidence_gate"] = evidence_gate
        validation["decision_eligible"] = evidence_gate["decision_eligible"]
        if not evidence_gate["decision_eligible"]:
            validation["issues"].extend(evidence_gate["issues"])

        return validation

    def _generate_summary(self, results: dict) -> dict:
        """生成摘要"""
        target = results["target"]
        disease = results.get("disease")
        stages = results.get("stages", {})

        summary = {
            "target": target,
            "disease": disease,
            "analysis_status": "completed",
            "key_findings": [],
            "data_sources": [],
            "developability": {},
            "recommendations": []
        }

        # 收集数据源
        if stages.get("clinical_pipeline", {}).get("success"):
            summary["data_sources"].append("ClinicalTrials.gov")

        if stages.get("literature", {}).get("success"):
            summary["data_sources"].append("PubMed")

        if stages.get("target_function", {}).get("success"):
            summary["data_sources"].append("OpenTargets")

        # 关键发现
        clinical_data = stages.get("clinical_pipeline", {}).get("data", {})
        if clinical_data:
            total_trials = clinical_data.get("total_trials", 0)
            if total_trials > 0:
                summary["key_findings"].append(f"全球共有{total_trials}个相关临床试验")

            active_trials = clinical_data.get("active_trials", 0)
            if active_trials > 0:
                summary["key_findings"].append(f"其中{active_trials}个正在进行中")

        # 可开发性
        assessment = stages.get("assessment", {})
        if assessment.get("success"):
            developability = assessment.get("developability", {})
            summary["developability"] = {
                "score": developability.get("score", 0),
                "level": developability.get("level", ""),
                "interpretation": developability.get("interpretation", "")
            }

            # 建议
            summary["recommendations"] = [
                r.get("recommendation", "")
                for r in assessment.get("rd_recommendations", [])
            ]

        return summary

    def _save_results(
        self,
        target_name: str,
        disease: Optional[str],
        results: dict
    ):
        """保存结果"""
        # 生成文件名
        filename = target_name
        if disease:
            filename += f"_{disease}"

        # 保存JSON
        json_path = self.output_dir / f"{filename}_stage3_results.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2, default=str)

        # 保存溯源
        self.provenance_tracker.save_to_file(f"{filename}_provenance.json")

        # 保存报告
        report_path = self.output_dir / f"{filename}_stage3_report.md"
        self._generate_markdown_report(target_name, disease, results, report_path)

    def _generate_markdown_report(
        self,
        target_name: str,
        disease: Optional[str],
        results: dict,
        output_path: Path
    ):
        """生成Markdown报告"""
        summary = results.get("summary", {})
        stages = results.get("stages", {})

        report = f"""# 靶点深度调研报告: {target_name}

**生成时间:** {results.get('timestamp', '')}
**疾病:** {disease or '通用'}

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

        # 可开发性
        developability = summary.get("developability", {})
        if developability:
            report += f"""
## 3. 可开发性评估

- **评分:** {developability.get('score', 0)}/100
- **等级:** {developability.get('level', 'N/A')}
- **解释:** {developability.get('interpretation', '')}
"""

        # 临床管线
        clinical = stages.get("clinical_pipeline", {}).get("data", {})
        if clinical:
            report += f"""
## 4. 临床管线概况

- **总试验数:** {clinical.get('total_trials', 0)}
- **活跃试验:** {clinical.get('active_trials', 0)}

### 阶段分布

| 阶段 | 数量 |
|------|------|
"""

            for phase, count in clinical.get("phase_distribution", {}).items():
                report += f"| {phase} | {count} |\n"

        # 竞争格局
        competitive = stages.get("competitive_landscape", {}).get("data", {})
        if competitive:
            comp_sections = competitive.get("sections", {})
            competition = comp_sections.get("competitive_analysis", {})
            report += f"""
## 5. 竞争格局

- **竞争强度:** {competition.get('competition_intensity', 'N/A')}
- **市场集中度:** {competition.get('market_concentration', 'N/A')}

### 主要玩家

| 排名 | 公司 | 试验数 | 管线强度 |
|------|------|--------|----------|
"""

            for i, player in enumerate(competition.get("top_players", [])[:5], 1):
                report += f"| {i} | {player.get('company', player.get('sponsor', ''))} | {player.get('trial_count', 0)} | {player.get('latest_phase', '')} |\n"

        # 建议
        recommendations = summary.get("recommendations", [])
        if recommendations:
            report += f"""
## 6. 研发建议

"""
            for rec in recommendations:
                report += f"- {rec}\n"

        report += f"""
---
*报告由靶点研究平台自动生成*
"""

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(report)

    def validate_inputs(
        self,
        target_name: str
    ) -> tuple[bool, list[str]]:
        """验证输入"""
        issues = []

        if not target_name:
            issues.append("靶点名称不能为空")

        return len(issues) == 0, issues
