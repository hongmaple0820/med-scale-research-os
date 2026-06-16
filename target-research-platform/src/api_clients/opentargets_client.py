"""
Open Targets Platform API客户端
用于靶点-疾病关联和成药性评估
API文档：https://platform-docs.opentargets.org/api
"""
import hashlib
import json as json_module
from datetime import datetime
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class OpenTargetsClient(BaseAPIClient):
    """Open Targets Platform GraphQL API客户端"""

    @property
    def source_name(self) -> str:
        return "OpenTargets"

    @property
    def base_url(self) -> str:
        return "https://api.platform.opentargets.org/api/v4/graphql"

    def health_check(self) -> bool:
        """检查Open Targets API可用性"""
        query = """
        query {
            meta {
                apiVersion {
                    x
                    y
                    z
                }
            }
        }
        """
        response = self._graphql_query(query)
        return response.success

    def _graphql_query(self, query: str, variables: Optional[dict] = None) -> APIResponse:
        """执行GraphQL查询（带缓存）"""
        query_hash = hashlib.md5(
            f"{query}{json_module.dumps(variables or {}, sort_keys=True)}".encode()
        ).hexdigest()
        cache_key = self._get_cache_key("graphql", {"hash": query_hash})

        # 检查缓存
        cached = self._get_from_cache(cache_key)
        if cached:
            return APIResponse(**cached)

        # 速率限制
        self._wait_for_rate_limit()

        try:
            payload = {"query": query}
            if variables:
                payload["variables"] = variables

            resp = self._session.post(
                self.base_url,
                json=payload,
                timeout=30
            )
            resp.raise_for_status()

            data = resp.json()

            if 'errors' in data:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="graphql",
                    params=variables or {},
                    timestamp=datetime.now().isoformat(),
                    error=str(data['errors'])
                )

            api_response = APIResponse(
                success=True,
                data=data.get('data'),
                source=self.source_name,
                endpoint="graphql",
                params=variables or {},
                timestamp=datetime.now().isoformat(),
                raw_response=str(data)[:1000]
            )

            # 写入缓存
            self._save_to_cache(cache_key, api_response)

            return api_response

        except Exception as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="graphql",
                params=variables or {},
                timestamp=datetime.now().isoformat(),
                error=str(e)
            )

    def resolve_gene_symbol(self, gene_symbol: str) -> APIResponse:
        """
        通过基因符号解析 ENSG ID

        Args:
            gene_symbol: 基因符号，如 "EGFR"

        Returns:
            APIResponse 包含 {"ensg_id": "ENSG00000146648", "symbol": "EGFR", ...}
        """
        query = """
        query SearchGene($symbol: String!) {
            search(queryString: $symbol, entityNames: ["target"], page: {index: 0, size: 5}) {
                total
                hits {
                    id
                    name
                    entity
                    description
                }
            }
        }
        """
        response = self._graphql_query(query, {"symbol": gene_symbol})

        if not response.success:
            return response

        try:
            hits = response.data.get("search", {}).get("hits", [])
            if not hits:
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint="resolve_gene_symbol",
                    params={"gene_symbol": gene_symbol}, timestamp=response.timestamp,
                    error=f"未找到基因 {gene_symbol}"
                )

            # 精确匹配 name 字段（新 API 用 name 代替 approvedSymbol）
            for hit in hits:
                if hit.get("name", "").upper() == gene_symbol.upper():
                    return APIResponse(
                        success=True,
                        data={
                            "ensg_id": hit["id"],
                            "symbol": hit.get("name", gene_symbol),
                            "name": hit.get("description", ""),
                        },
                        source=self.source_name, endpoint="resolve_gene_symbol",
                        params={"gene_symbol": gene_symbol},
                        timestamp=response.timestamp
                    )

            # 无精确匹配，返回第一个结果
            hit = hits[0]
            return APIResponse(
                success=True,
                data={
                    "ensg_id": hit["id"],
                    "symbol": hit.get("name", gene_symbol),
                    "name": hit.get("description", ""),
                },
                source=self.source_name, endpoint="resolve_gene_symbol",
                params={"gene_symbol": gene_symbol},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="resolve_gene_symbol",
                params={"gene_symbol": gene_symbol}, timestamp=response.timestamp,
                error=f"解析错误: {str(e)}"
            )

    def get_target_associated_diseases(self, ensg_id: str) -> APIResponse:
        """
        获取基因关联的疾病列表

        Args:
            ensg_id: Ensembl基因ID

        Returns:
            包含疾病关联数据的APIResponse
        """
        query = """
        query TargetAssociatedDiseases($ensemblId: String!) {
            target(ensemblId: $ensemblId) {
                id
                approvedSymbol
                approvedName
                associatedDiseases(page: {index: 0, size: 50}) {
                    count
                    rows {
                        disease {
                            id
                            name
                        }
                        score
                        datatypeScores {
                            componentId: id
                            score
                        }
                    }
                }
            }
        }
        """

        variables = {"ensemblId": ensg_id}
        response = self._graphql_query(query, variables)

        if not response.success:
            return response

        return self._parse_disease_associations(response, ensg_id)

    def _parse_disease_associations(self, response: APIResponse, ensg_id: str) -> APIResponse:
        """解析疾病关联数据"""
        try:
            data = response.data
            if not data or 'target' not in data:
                return response

            target = data['target']
            if not target:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="graphql",
                    params={"ensg_id": ensg_id},
                    timestamp=response.timestamp,
                    error=f"未找到基因 {ensg_id}"
                )

            associations = target.get('associatedDiseases', {})
            diseases = []

            for row in associations.get('rows', []):
                disease = row.get('disease', {})
                diseases.append({
                    "disease_id": disease.get('id', ''),
                    "disease_name": disease.get('name', ''),
                    "association_score": row.get('score', 0),
                    "datatype_scores": {
                        dt.get('componentId'): dt.get('score', 0)
                        for dt in row.get('datatypeScores', [])
                    }
                })

            return APIResponse(
                success=True,
                data={
                    "ensg_id": ensg_id,
                    "gene_symbol": target.get('approvedSymbol', ''),
                    "gene_name": target.get('approvedName', ''),
                    "disease_count": associations.get('count', 0),
                    "diseases": diseases
                },
                source=self.source_name,
                endpoint="graphql",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="graphql",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def get_disease_associated_targets(self, disease_id: str) -> APIResponse:
        """
        获取疾病关联的靶点列表

        Args:
            disease_id: 疾病ID（如 "EFO_0000270"）

        Returns:
            包含靶点关联数据的APIResponse
        """
        query = """
        query DiseaseAssociatedTargets($efoId: String!) {
            disease(efoId: $efoId) {
                id
                name
                associatedTargets(page: {index: 0, size: 50}) {
                    count
                    rows {
                        target {
                            id
                            approvedSymbol
                            approvedName
                        }
                        score
                        datatypeScores {
                            componentId: id
                            score
                        }
                    }
                }
            }
        }
        """

        variables = {"efoId": disease_id}
        response = self._graphql_query(query, variables)

        if not response.success:
            return response

        return self._parse_target_associations(response, disease_id)

    def _parse_target_associations(self, response: APIResponse, disease_id: str) -> APIResponse:
        """解析靶点关联数据"""
        try:
            data = response.data
            if not data or 'disease' not in data:
                return response

            disease = data['disease']
            if not disease:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="graphql",
                    params={"disease_id": disease_id},
                    timestamp=response.timestamp,
                    error=f"未找到疾病 {disease_id}"
                )

            associations = disease.get('associatedTargets', {})
            targets = []

            for row in associations.get('rows', []):
                target = row.get('target', {})
                targets.append({
                    "ensg_id": target.get('id', ''),
                    "gene_symbol": target.get('approvedSymbol', ''),
                    "gene_name": target.get('approvedName', ''),
                    "association_score": row.get('score', 0),
                    "datatype_scores": {
                        dt.get('componentId'): dt.get('score', 0)
                        for dt in row.get('datatypeScores', [])
                    }
                })

            return APIResponse(
                success=True,
                data={
                    "disease_id": disease_id,
                    "disease_name": disease.get('name', ''),
                    "target_count": associations.get('count', 0),
                    "targets": targets
                },
                source=self.source_name,
                endpoint="graphql",
                params={"disease_id": disease_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="graphql",
                params={"disease_id": disease_id},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def get_target_druggability(self, ensg_id: str) -> APIResponse:
        """
        获取靶点成药性评估

        Args:
            ensg_id: Ensembl基因ID

        Returns:
            包含成药性数据的APIResponse
        """
        query = """
        query TargetDruggability($ensemblId: String!) {
            target(ensemblId: $ensemblId) {
                id
                approvedSymbol
                approvedName
                functionDescriptions
                subcellularLocations {
                    location
                }
                proteinIds {
                    id
                    source
                }
                drugAndClinicalCandidates {
                    count
                    rows {
                        id
                        maxClinicalStage
                        drug {
                            id
                            name
                            maximumClinicalStage
                            drugType
                        }
                        clinicalReports {
                            id
                            title
                            trialPhase
                            trialOverallStatus
                        }
                        diseases {
                            diseaseFromSource
                            disease {
                                id
                                name
                            }
                        }
                    }
                }
            }
        }
        """

        variables = {"ensemblId": ensg_id}
        response = self._graphql_query(query, variables)

        if not response.success:
            return response

        return self._parse_druggability(response, ensg_id)

    def _parse_druggability(self, response: APIResponse, ensg_id: str) -> APIResponse:
        """解析成药性数据"""
        try:
            data = response.data
            if not data or 'target' not in data:
                return response

            target = data['target']
            if not target:
                return response

            drug_candidates = target.get('drugAndClinicalCandidates', {})
            drugs = []

            for row in drug_candidates.get('rows', []):
                drug = row.get('drug', {})
                diseases_raw = row.get('diseases', [])
                disease_names = [
                    (d.get('disease', {}) or {}).get('name', '') or d.get('diseaseFromSource', '')
                    for d in diseases_raw
                    if (d.get('disease') or d.get('diseaseFromSource'))
                ]
                # 阶段字符串转数字（兼容有无下划线/空格的格式）
                def _phase_to_num(phase_str):
                    if not phase_str:
                        return 0
                    s = phase_str.upper().replace('_', '').replace(' ', '')
                    phase_map = {
                        'PHASE4': 4, 'PHASE3': 3, 'PHASE23': 2.5,
                        'PHASE2': 2, 'PHASE12': 1.5, 'PHASE1': 1,
                        'PHASE0': 0, 'APPROVAL': 4, 'APPROVED': 4,
                        'UNKNOWN': 0, 'NA': 0
                    }
                    return phase_map.get(s, 0)

                reports = row.get('clinicalReports', [])
                best_report = max(
                    reports,
                    key=lambda r: _phase_to_num(r.get('trialPhase') or ''),
                    default={}
                )

                drug_max_phase_num = _phase_to_num(
                    drug.get('maximumClinicalStage', '')
                )

                drugs.append({
                    "drug_id": drug.get('id', ''),
                    "drug_name": drug.get('name', ''),
                    "max_phase": drug.get('maximumClinicalStage', ''),
                    "max_phase_num": drug_max_phase_num,
                    "drug_type": drug.get('drugType', ''),
                    "clinical_stage": row.get('maxClinicalStage', ''),
                    "trial_phase": best_report.get('trialPhase', ''),
                    "trial_status": best_report.get('trialOverallStatus', ''),
                    "diseases": disease_names[:5]
                })

            return APIResponse(
                success=True,
                data={
                    "ensg_id": ensg_id,
                    "gene_symbol": target.get('approvedSymbol', ''),
                    "function": target.get('functionDescriptions', []),
                    "subcellular_locations": [
                        loc.get('location', '')
                        for loc in target.get('subcellularLocations', [])
                    ],
                    "protein_ids": target.get('proteinIds', []),
                    "druggability": {
                        "total_drug_candidates": drug_candidates.get('count', 0),
                        "total_evidence": drug_candidates.get('count', 0),
                        "drugs": drugs
                    }
                },
                source=self.source_name,
                endpoint="graphql",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="graphql",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def validate_target_data(self, data: dict) -> tuple[bool, list[str]]:
        """验证靶点数据合理性"""
        issues = []

        if not data:
            return False, ["缺少数据"]

        # 检查疾病关联
        diseases = data.get("diseases", [])
        if not diseases:
            issues.append("未找到疾病关联数据")

        # 检查成药性
        druggability = data.get("druggability", {})
        if druggability:
            drugs = druggability.get("drugs", [])
            if not drugs:
                issues.append("未找到已知药物数据")

        return len(issues) == 0, issues
