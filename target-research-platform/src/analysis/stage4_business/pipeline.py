"""
阶段4 Pipeline：商业计划书与里程碑规划
汇总前三阶段数据，生成完整的商业规划
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from .milestone_planner import MilestonePlanner
from .business_plan import BusinessPlanGenerator
from ...utils.logger import get_logger


class Stage4Pipeline:
    """阶段4 Pipeline：商业计划书与里程碑规划"""

    logger = get_logger("stage4")

    def __init__(
        self,
        output_dir: str = "./output/stage4",
        cache_dir: str = "./cache"
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 初始化分析器
        self.milestone_planner = MilestonePlanner()
        self.business_plan_generator = BusinessPlanGenerator()

    def run(
        self,
        target_name: str,
        disease: Optional[str] = None,
        stage1_data: Optional[dict] = None,
        stage2_data: Optional[dict] = None,
        stage3_data: Optional[dict] = None,
        modality: str = "small_molecule",
        risk_level: str = "medium",
        company_info: Optional[dict] = None
    ) -> dict:
        """
        执行完整的阶段4分析

        Args:
            target_name: 靶点名称
            disease: 疾病名称
            stage1_data: 阶段1数据
            stage2_data: 阶段2数据
            stage3_data: 阶段3数据
            modality: 药物形式
            risk_level: 风险等级
            company_info: 公司信息

        Returns:
            完整的商业规划结果
        """
        self.logger.info(f"=" * 60)
        self.logger.info(f"阶段4 Pipeline: {target_name}")
        if disease:
            self.logger.info(f"疾病: {disease}")
        self.logger.info(f"药物形式: {modality}")
        self.logger.info(f"风险等级: {risk_level}")
        self.logger.info(f"=" * 60)

        results = {
            "target": target_name,
            "disease": disease,
            "modality": modality,
            "risk_level": risk_level,
            "timestamp": datetime.now().isoformat(),
            "stages": {}
        }

        # 1. 生成里程碑规划（传入前序阶段数据以动态调整成功率）
        self.logger.info("[1/3] 生成里程碑规划...")
        milestone_result = self._generate_milestones(
            target_name, disease, modality, risk_level,
            stage1_data=stage1_data,
            stage2_data=stage2_data,
            stage3_data=stage3_data
        )
        results["stages"]["milestones"] = milestone_result

        # 2. 生成商业计划书
        self.logger.info("[2/3] 生成商业计划书...")
        business_plan_result = self._generate_business_plan(
            target_name, disease,
            stage1_data, stage2_data, stage3_data,
            milestone_result, company_info
        )
        results["stages"]["business_plan"] = business_plan_result

        # 3. 生成Markdown报告
        self.logger.info("[3/3] 生成报告...")
        if business_plan_result.get("success"):
            markdown_report = self.business_plan_generator.to_markdown(
                business_plan_result.get("data", {})
            )
            results["stages"]["markdown_report"] = {
                "success": True,
                "content": markdown_report
            }

        # 生成摘要
        results["summary"] = self._generate_summary(results)

        # 保存结果
        self._save_results(target_name, disease, results)

        self.logger.info(f"{'=' * 60}")
        self.logger.info("阶段4分析完成!")
        self.logger.info(f"结果保存至: {self.output_dir}")
        self.logger.info(f"{'=' * 60}")

        return results

    def _generate_milestones(
        self,
        target_name: str,
        disease: Optional[str],
        modality: str,
        risk_level: str,
        stage1_data: Optional[dict] = None,
        stage2_data: Optional[dict] = None,
        stage3_data: Optional[dict] = None
    ) -> dict:
        """生成里程碑（透传前序阶段数据以动态调整成功率）"""
        self.logger.debug("  - 计算开发时间线（含动态成功率调整）...")

        milestone_result = self.milestone_planner.generate_milestones(
            target_name=target_name,
            disease=disease,
            modality=modality,
            risk_level=risk_level,
            stage1_data=stage1_data,
            stage2_data=stage2_data,
            stage3_data=stage3_data
        )

        return {
            "success": milestone_result.get("success", False),
            "data": milestone_result
        }

    def _generate_business_plan(
        self,
        target_name: str,
        disease: Optional[str],
        stage1_data: Optional[dict],
        stage2_data: Optional[dict],
        stage3_data: Optional[dict],
        milestone_result: dict,
        company_info: Optional[dict]
    ) -> dict:
        """生成商业计划书"""
        self.logger.debug("  - 整合各阶段数据...")

        milestone_data = milestone_result.get("data", {}) if milestone_result.get("success") else None

        plan = self.business_plan_generator.generate(
            target_name=target_name,
            disease=disease,
            stage1_data=stage1_data,
            stage2_data=stage2_data,
            stage3_data=stage3_data,
            milestone_data=milestone_data,
            company_info=company_info
        )

        return {
            "success": plan.get("success", False),
            "data": plan
        }

    def _generate_summary(self, results: dict) -> dict:
        """生成摘要"""
        target = results["target"]
        disease = results.get("disease")
        stages = results.get("stages", {})

        summary = {
            "target": target,
            "disease": disease,
            "analysis_status": "completed",
            "key_outputs": [],
            "milestones": {},
            "funding": {}
        }

        # 里程碑摘要
        milestones = stages.get("milestones", {})
        if milestones.get("success"):
            milestone_data = milestones.get("data", {})
            summary["milestones"] = {
                "total_duration": f"{milestone_data.get('total_duration_months', 0)}个月",
                "total_cost": f"${milestone_data.get('total_cost_estimate', 0)}M",
                "success_rate": f"{milestone_data.get('overall_success_rate', 0) * 100:.1f}%",
                "estimated_completion": milestone_data.get("estimated_completion", "")
            }
            summary["key_outputs"].append("里程碑规划")

        # 商业计划书摘要
        business_plan = stages.get("business_plan", {})
        if business_plan.get("success"):
            plan_data = business_plan.get("data", {})
            funding = plan_data.get("sections", {}).get("funding_requirements", {})
            summary["funding"] = {
                "total_requirement": funding.get("total_requirement", {}).get("amount", ""),
                "rounds": len(funding.get("funding_rounds", []))
            }
            summary["key_outputs"].append("商业计划书")

        # Markdown报告
        if stages.get("markdown_report", {}).get("success"):
            summary["key_outputs"].append("Markdown报告")

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
        json_path = self.output_dir / f"{filename}_stage4_results.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2, default=str)

        # 保存Markdown报告
        markdown_content = results.get("stages", {}).get("markdown_report", {}).get("content", "")
        if markdown_content:
            md_path = self.output_dir / f"{filename}_business_plan.md"
            with open(md_path, 'w', encoding='utf-8') as f:
                f.write(markdown_content)

        # 保存里程碑数据
        milestones = results.get("stages", {}).get("milestones", {}).get("data", {})
        if milestones:
            milestones_path = self.output_dir / f"{filename}_milestones.json"
            with open(milestones_path, 'w', encoding='utf-8') as f:
                json.dump(milestones, f, ensure_ascii=False, indent=2, default=str)

    def validate_inputs(
        self,
        target_name: str
    ) -> tuple[bool, list[str]]:
        """验证输入"""
        issues = []

        if not target_name:
            issues.append("靶点名称不能为空")

        # 验证药物形式
        valid_modalities = [
            "small_molecule", "antibody", "bispecific_antibody",
            "adc", "cell_therapy", "gene_therapy", "rna"
        ]

        return len(issues) == 0, issues

    def get_milestone_summary(
        self,
        target_name: str,
        disease: Optional[str] = None
    ) -> dict:
        """获取里程碑摘要"""
        return self.milestone_planner.get_summary(target_name, disease)

    def get_business_plan_summary(
        self,
        target_name: str,
        disease: Optional[str] = None
    ) -> dict:
        """获取商业计划书摘要"""
        return self.business_plan_generator.get_summary(target_name, disease)
