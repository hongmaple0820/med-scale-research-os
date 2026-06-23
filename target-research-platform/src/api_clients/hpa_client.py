"""
Human Protein Atlas (HPA) API客户端
用于获取蛋白表达、亚细胞定位等数据
API文档：https://www.proteinatlas.org/about/help/api
"""
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class HPAClient(BaseAPIClient):
    """Human Protein Atlas API客户端"""

    @property
    def source_name(self) -> str:
        return "HPA"

    @property
    def base_url(self) -> str:
        return "https://www.proteinatlas.org"

    def health_check(self) -> bool:
        """检查HPA API可用性"""
        response = self._make_request(
            "GET",
            "/ENSG00000146648.json",
            use_cache=False
        )
        return response.success

    def get_protein_expression(self, ensg_id: str) -> APIResponse:
        """
        获取蛋白表达数据（IHC）

        Args:
            ensg_id: Ensembl基因ID，如 "ENSG00000146648"

        Returns:
            包含蛋白表达数据的APIResponse
        """
        response = self._make_request("GET", f"/{ensg_id}.json")

        if not response.success:
            return response

        return self._parse_protein_data(response, ensg_id)

    def _parse_protein_data(self, response: APIResponse, ensg_id: str) -> APIResponse:
        """解析HPA蛋白数据"""
        try:
            raw_data = response.data
            if not raw_data:
                return response

            # HPA返回的是数组，取第一个
            if isinstance(raw_data, list):
                protein_data = raw_data[0] if raw_data else {}
            else:
                protein_data = raw_data

            # 提取组织表达数据
            tissue_expression = []
            for tissue in protein_data.get('tissueExpression', []):
                tissue_expression.append({
                    "tissue": tissue.get('tissue', ''),
                    "level": tissue.get('level', ''),  # High/Medium/Low/Not detected
                    "cell_type": tissue.get('cellType', ''),
                    "reliability": tissue.get('reliability', '')
                })

            # 提取亚细胞定位
            subcellular = []
            for loc in protein_data.get('subcellularLocation', []):
                subcellular.append({
                    "location": loc.get('location', ''),
                    "reliability": loc.get('reliability', '')
                })

            return APIResponse(
                success=True,
                data={
                    "ensg_id": ensg_id,
                    "gene_name": protein_data.get('Gene', ''),
                    "protein_name": protein_data.get('Gene description', ''),
                    "tissue_expression": tissue_expression,
                    "subcellular_location": subcellular,
                    "antibody": protein_data.get('Antibody', '')
                },
                source=self.source_name,
                endpoint=f"/{ensg_id}.json",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=f"/{ensg_id}.json",
                params={"ensg_id": ensg_id},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def get_subcellular_location(self, ensg_id: str) -> APIResponse:
        """
        获取亚细胞定位信息

        Args:
            ensg_id: Ensembl基因ID

        Returns:
            包含亚细胞定位的APIResponse
        """
        response = self.get_protein_expression(ensg_id)
        if not response.success:
            return response

        return APIResponse(
            success=True,
            data={
                "ensg_id": ensg_id,
                "subcellular_location": response.data.get("subcellular_location", [])
            },
            source=self.source_name,
            endpoint=f"/{ensg_id}.json",
            params={"ensg_id": ensg_id},
            timestamp=response.timestamp
        )

    def validate_protein_data(self, data: dict) -> tuple[bool, list[str]]:
        """验证蛋白数据合理性"""
        issues = []

        if not data:
            return False, ["缺少数据"]

        # 检查组织表达数据
        tissue_expr = data.get("tissue_expression", [])
        if len(tissue_expr) < 10:
            issues.append(f"组织表达数据不足: {len(tissue_expr)} < 10")

        # 检查亚细胞定位
        subcellular = data.get("subcellular_location", [])
        if not subcellular:
            issues.append("缺少亚细胞定位数据")

        return len(issues) == 0, issues

    def search_gene_by_symbol(self, gene_symbol: str) -> APIResponse:
        """
        通过基因符号搜索Ensembl ID

        Args:
            gene_symbol: 基因符号

        Returns:
            包含Ensembl ID的APIResponse
        """
        # HPA不提供直接的符号搜索，需要通过其他方式
        # 这里返回一个需要外部转换的提示
        return APIResponse(
            success=False,
            data=None,
            source=self.source_name,
            endpoint="/search",
            params={"gene_symbol": gene_symbol},
            timestamp="",
            error="HPA API不支持直接按基因符号搜索，请使用Ensembl ID"
        )
