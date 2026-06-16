"""
GTEx API客户端
用于获取正常组织基因表达数据
API文档：https://gtexportal.org/api/v2/
"""
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class GTExClient(BaseAPIClient):
    """GTEx Portal API客户端"""

    @property
    def source_name(self) -> str:
        return "GTEx"

    @property
    def base_url(self) -> str:
        return "https://gtexportal.org/api/v2"

    def health_check(self) -> bool:
        """检查GTEx API可用性"""
        response = self._make_request("GET", "/dataset/tissueSiteDetail", use_cache=False)
        return response.success

    def get_gene_expression(self, gene_symbol: str) -> APIResponse:
        """
        获取基因在正常组织中的表达数据

        Args:
            gene_symbol: 基因符号，如 "CDK4"

        Returns:
            APIResponse包含 {tissue: median_tpm} 数据
        """
        # 先获取基因ID（GTEx API 使用 geneId 参数）
        gene_response = self._make_request(
            "GET",
            "/reference/gene",
            params={"geneId": gene_symbol}
        )

        if not gene_response.success or not gene_response.data:
            return gene_response

        # 从返回数据中提取gencode_id
        gene_data = gene_response.data
        if isinstance(gene_data, dict) and 'data' in gene_data:
            genes = gene_data['data']
        elif isinstance(gene_data, list):
            genes = gene_data
        else:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/reference/gene",
                params={"geneSymbol": gene_symbol},
                timestamp=gene_response.timestamp,
                error="无法解析基因数据"
            )

        # 查找匹配的基因
        gencode_id = None
        for gene in genes:
            if gene.get('geneSymbol') == gene_symbol:
                gencode_id = gene.get('gencodeId')
                break

        if not gencode_id:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/expression/geneExpression",
                params={"geneSymbol": gene_symbol},
                timestamp=gene_response.timestamp,
                error=f"未找到基因 {gene_symbol}"
            )

        # 获取表达数据
        expression_response = self._make_request(
            "GET",
            "/expression/geneExpression",
            params={
                "gencodeId": gencode_id,
                "datasetId": "gtex_v8"
            }
        )

        if not expression_response.success:
            return expression_response

        # 解析表达数据
        return self._parse_expression(expression_response, gene_symbol)

    def _parse_expression(self, response: APIResponse, gene_symbol: str) -> APIResponse:
        """解析GTEx表达数据（v2 API 格式）"""
        try:
            import statistics

            raw_data = response.data
            if not raw_data or 'data' not in raw_data:
                return response

            # GTEx v2 API: raw_data['data'] 是 tissue items 的数组
            # 每个 item: {data: [expr_values], tissueSiteDetailId: "Thyroid", unit: "TPM", ...}
            expression_data = {}
            tissue_items = raw_data['data']
            if not isinstance(tissue_items, list):
                return response

            for item in tissue_items:
                tissue = item.get('tissueSiteDetailId', '')
                expr_values = item.get('data', [])
                if tissue and expr_values and len(expr_values) > 0:
                    # 计算中位数表达值
                    median_tpm = statistics.median(expr_values)
                    expression_data[tissue] = round(float(median_tpm), 2)

            return APIResponse(
                success=True,
                data={
                    "gene": gene_symbol,
                    "tissues": expression_data,
                    "unit": "TPM",
                    "dataset": "GTEx v8"
                },
                source=self.source_name,
                endpoint="/expression/geneExpression",
                params={"geneSymbol": gene_symbol},
                timestamp=response.timestamp,
                raw_response=response.raw_response
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/expression/geneExpression",
                params={"geneSymbol": gene_symbol},
                timestamp=response.timestamp,
                error=f"数据解析错误: {str(e)}"
            )

    def validate_expression(self, data: dict) -> tuple[bool, list[str]]:
        """
        验证表达数据合理性

        Returns:
            (是否通过, 问题列表)
        """
        issues = []

        if not data or 'tissues' not in data:
            return False, ["缺少表达数据"]

        tissues = data['tissues']

        # 检查组织数量
        if len(tissues) < 30:
            issues.append(f"组织数量不足: {len(tissues)} < 30")

        # 检查TPM值范围
        for tissue, tpm in tissues.items():
            if tpm < 0:
                issues.append(f"组织 {tissue} 的TPM值为负数: {tpm}")
            if tpm > 100000:
                issues.append(f"组织 {tissue} 的TPM值异常高: {tpm}")

        return len(issues) == 0, issues

    def get_tissue_specificity(self, gene_symbol: str) -> APIResponse:
        """
        计算组织特异性指数

        返回基因在哪些组织中高表达（>中位数的2倍）
        """
        response = self.get_gene_expression(gene_symbol)
        if not response.success:
            return response

        tissues = response.data.get('tissues', {})
        if not tissues:
            return response

        values = list(tissues.values())
        median_tpm = sorted(values)[len(values) // 2]

        high_expression_tissues = {
            tissue: tpm for tissue, tpm in tissues.items()
            if tpm > median_tpm * 2
        }

        return APIResponse(
            success=True,
            data={
                "gene": gene_symbol,
                "median_tpm_all_tissues": median_tpm,
                "high_expression_tissues": high_expression_tissues,
                "tissue_count": len(tissues),
                "high_expression_count": len(high_expression_tissues)
            },
            source=self.source_name,
            endpoint="/expression/geneExpression",
            params={"geneSymbol": gene_symbol},
            timestamp=response.timestamp
        )
