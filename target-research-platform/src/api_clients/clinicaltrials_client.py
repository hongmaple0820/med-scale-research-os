"""
ClinicalTrials.gov API客户端
用于获取临床试验数据
API文档：https://clinicaltrials.gov/api/
"""
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class ClinicalTrialsClient(BaseAPIClient):
    """ClinicalTrials.gov API客户端"""

    # 试验阶段映射
    PHASE_MAPPING = {
        "EARLY_PHASE1": "Early Phase 1",
        "PHASE1": "Phase 1",
        "PHASE2": "Phase 2",
        "PHASE3": "Phase 3",
        "PHASE4": "Phase 4",
        "NA": "Not Applicable"
    }

    # 试验状态
    STATUS_MAPPING = {
        "RECRUITING": "招募中",
        "ACTIVE_NOT_RECRUITING": "进行中（不招募）",
        "COMPLETED": "已完成",
        "TERMINATED": "已终止",
        "WITHDRAWN": "已撤回",
        "SUSPENDED": "已暂停",
        "NOT_YET_RECRUITING": "尚未招募"
    }

    @property
    def source_name(self) -> str:
        return "ClinicalTrials.gov"

    @property
    def base_url(self) -> str:
        return "https://clinicaltrials.gov/api/v2"

    def health_check(self) -> bool:
        """检查API可用性"""
        response = self._make_request(
            "GET",
            "/studies",
            params={"pageSize": 1},
            use_cache=False
        )
        return response.success

    def search_by_target(
        self,
        target_name: str,
        condition: Optional[str] = None,
        status: Optional[str] = None,
        max_results: int = 50
    ) -> APIResponse:
        """
        按靶点搜索临床试验

        Args:
            target_name: 靶点名称
            condition: 疾病/适应症（可选）
            status: 试验状态（可选）
            max_results: 最大返回数量

        Returns:
            包含临床试验列表的APIResponse
        """
        # 构建查询
        query_parts = [target_name]
        if condition:
            query_parts.append(condition)

        params = {
            "query.term": " ".join(query_parts),
            "pageSize": min(max_results, 100),
            "format": "json"
        }

        if status:
            params["filter.overallStatus"] = status

        response = self._make_request("GET", "/studies", params=params)

        if not response.success:
            return response

        return self._parse_studies_response(response, target_name)

    def _parse_studies_response(
        self,
        response: APIResponse,
        target_name: str
    ) -> APIResponse:
        """解析临床试验数据"""
        try:
            raw_data = response.data
            if not raw_data or 'studies' not in raw_data:
                return response

            studies = []
            for study in raw_data.get('studies', []):
                protocol = study.get('protocolSection', {})

                # 基本信息
                identification = protocol.get('identificationModule', {})
                status_module = protocol.get('statusModule', {})
                design_module = protocol.get('designModule', {})
                conditions_module = protocol.get('conditionsModule', {})
                sponsors_module = protocol.get('sponsorCollaboratorsModule', {})

                # 提取阶段
                phases = design_module.get('phases', [])
                phase = phases[0] if phases else "NA"

                # 提取状态
                overall_status = status_module.get('overallStatus', '')

                # 提取适应症
                conditions = conditions_module.get('conditions', [])

                # 提取申办方
                lead_sponsor = sponsors_module.get('leadSponsor', {}).get('name', '')

                studies.append({
                    "nct_id": identification.get('nctId', ''),
                    "title": identification.get('briefTitle', ''),
                    "official_title": identification.get('officialTitle', ''),
                    "status": overall_status,
                    "status_chinese": self.STATUS_MAPPING.get(overall_status, overall_status),
                    "phase": phase,
                    "phase_chinese": self.PHASE_MAPPING.get(phase, phase),
                    "conditions": conditions[:5],
                    "sponsor": lead_sponsor,
                    "start_date": status_module.get('startDateStruct', {}).get('date', ''),
                    "completion_date": status_module.get('completionDateStruct', {}).get('date', ''),
                    "enrollment": design_module.get('enrollmentInfo', {}).get('count', 0),
                    "url": f"https://clinicaltrials.gov/study/{identification.get('nctId', '')}"
                })

            # 统计分析
            stats = self._calculate_statistics(studies)

            return APIResponse(
                success=True,
                data={
                    "target": target_name,
                    "total_count": raw_data.get('totalCount', 0),
                    "returned_count": len(studies),
                    "studies": studies,
                    "statistics": stats
                },
                source=self.source_name,
                endpoint="/studies",
                params={"target": target_name},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/studies",
                params={"target": target_name},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def _calculate_statistics(self, studies: list) -> dict:
        """计算统计数据"""
        if not studies:
            return {}

        # 阶段分布
        phase_dist = {}
        for study in studies:
            phase = study.get("phase_chinese", "未知")
            phase_dist[phase] = phase_dist.get(phase, 0) + 1

        # 状态分布
        status_dist = {}
        for study in studies:
            status = study.get("status_chinese", "未知")
            status_dist[status] = status_dist.get(status, 0) + 1

        # 申办方分布
        sponsor_dist = {}
        for study in studies:
            sponsor = study.get("sponsor", "未知")
            if sponsor:
                sponsor_dist[sponsor] = sponsor_dist.get(sponsor, 0) + 1

        # 排序取Top 10
        top_sponsors = sorted(
            sponsor_dist.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]

        return {
            "phase_distribution": phase_dist,
            "status_distribution": status_dist,
            "top_sponsors": dict(top_sponsors),
            "total_enrollment": sum(s.get("enrollment", 0) for s in studies)
        }

    def search_by_disease(
        self,
        disease: str,
        target_name: Optional[str] = None,
        max_results: int = 50
    ) -> APIResponse:
        """
        按疾病搜索临床试验

        Args:
            disease: 疾病名称
            target_name: 靶点名称（可选）
            max_results: 最大返回数量

        Returns:
            包含临床试验列表的APIResponse
        """
        query_parts = [disease]
        if target_name:
            query_parts.append(target_name)

        params = {
            "query.term": " ".join(query_parts),
            "pageSize": min(max_results, 100),
            "format": "json"
        }

        response = self._make_request("GET", "/studies", params=params)

        if not response.success:
            return response

        return self._parse_studies_response(response, disease)

    def get_study_details(self, nct_id: str) -> APIResponse:
        """
        获取单个临床试验详情

        Args:
            nct_id: NCT编号

        Returns:
            包含试验详情的APIResponse
        """
        response = self._make_request(
            "GET",
            f"/studies/{nct_id}",
            params={"format": "json"}
        )

        if not response.success:
            return response

        return self._parse_single_study(response, nct_id)

    def _parse_single_study(self, response: APIResponse, nct_id: str) -> APIResponse:
        """解析单个试验数据"""
        try:
            raw_data = response.data
            if not raw_data:
                return response

            protocol = raw_data.get('protocolSection', {})

            # 提取详细信息
            identification = protocol.get('identificationModule', {})
            status_module = protocol.get('statusModule', {})
            design_module = protocol.get('designModule', {})
            conditions_module = protocol.get('conditionsModule', {})
            interventions_module = protocol.get('interventionsModule', {})
            outcomes_module = protocol.get('outcomesModule', {})
            eligibility_module = protocol.get('eligibilityModule', {})

            # 提取干预措施
            interventions = []
            for intervention in interventions_module.get('interventions', []):
                interventions.append({
                    "type": intervention.get('type', ''),
                    "name": intervention.get('name', ''),
                    "description": intervention.get('description', '')
                })

            # 提取主要终点
            primary_outcomes = []
            for outcome in outcomes_module.get('primaryOutcomes', []):
                primary_outcomes.append({
                    "measure": outcome.get('measure', ''),
                    "time_frame": outcome.get('timeFrame', '')
                })

            return APIResponse(
                success=True,
                data={
                    "nct_id": nct_id,
                    "title": identification.get('briefTitle', ''),
                    "official_title": identification.get('officialTitle', ''),
                    "description": identification.get('briefSummary', ''),
                    "status": status_module.get('overallStatus', ''),
                    "phase": design_module.get('phases', ['NA'])[0],
                    "conditions": conditions_module.get('conditions', []),
                    "interventions": interventions,
                    "primary_outcomes": primary_outcomes,
                    "eligibility": eligibility_module.get('eligibilityCriteria', ''),
                    "enrollment": design_module.get('enrollmentInfo', {}).get('count', 0),
                    "start_date": status_module.get('startDateStruct', {}).get('date', ''),
                    "completion_date": status_module.get('completionDateStruct', {}).get('date', ''),
                    "url": f"https://clinicaltrials.gov/study/{nct_id}"
                },
                source=self.source_name,
                endpoint=f"/studies/{nct_id}",
                params={"nct_id": nct_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=f"/studies/{nct_id}",
                params={"nct_id": nct_id},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def validate_study(self, study: dict) -> tuple[bool, list[str]]:
        """验证试验数据质量"""
        issues = []

        # 检查NCT ID
        if not study.get("nct_id"):
            issues.append("缺少NCT编号")

        # 检查标题
        if not study.get("title"):
            issues.append("缺少试验标题")

        # 检查状态
        if not study.get("status"):
            issues.append("缺少试验状态")

        return len(issues) == 0, issues

    def get_competitive_landscape(
        self,
        target_name: str,
        disease: Optional[str] = None
    ) -> dict:
        """
        获取竞争格局分析

        Args:
            target_name: 靶点名称
            disease: 疾病名称（可选）

        Returns:
            竞争格局分析结果
        """
        response = self.search_by_target(target_name, disease, max_results=100)

        if not response.success:
            return {
                "success": False,
                "error": response.error
            }

        data = response.data
        studies = data.get("studies", [])
        stats = data.get("statistics", {})

        # 分析主要玩家
        sponsors = stats.get("top_sponsors", {})
        top_players = [
            {"sponsor": sponsor, "trial_count": count}
            for sponsor, count in list(sponsors.items())[:10]
        ]

        # 分析阶段分布
        phase_dist = stats.get("phase_distribution", {})

        # 计算活跃试验数
        active_statuses = ["招募中", "进行中（不招募）", "尚未招募"]
        active_trials = sum(
            stats.get("status_distribution", {}).get(s, 0)
            for s in active_statuses
        )

        # total_count from API may be unreliable; use actual returned study count as fallback
        total_count = data.get("total_count", 0)
        if total_count == 0 and studies:
            total_count = len(studies)

        return {
            "success": True,
            "target": target_name,
            "disease": disease,
            "total_trials": total_count,
            "active_trials": active_trials,
            "phase_distribution": phase_dist,
            "top_players": top_players,
            "studies": studies[:20]  # 返回前20个试验
        }
