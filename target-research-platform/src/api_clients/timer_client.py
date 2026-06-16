"""
TIMER API客户端 (deprecated)
用于获取肿瘤免疫浸润数据

deprecated: TIMER 无公开 REST API，此客户端返回空数据。
请使用 ImmuneDataManager 获取预计算的免疫浸润数据。
"""
import warnings
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class TIMERClient(BaseAPIClient):
    """TIMER (Tumor IMmune Estimation Resource) API客户端"""

    # TIMER支持的癌种
    SUPPORTED_CANCERS = [
        "BRCA", "LUAD", "LUSC", "PRAD", "COAD", "READ", "STAD",
        "LIHC", "KIRC", "THCA", "UCEC", "GBM", "LGG", "OV",
        "BLCA", "HNSC", "CESC", "PAAD", "SKCM", "ESCA", "ACC",
        "CHOL", "DLBC", "KICH", "KIRP", "MESO", "PCPG", "SARC",
        "TGCT", "THYM", "UCS", "UVM"
    ]

    # 免疫细胞类型
    IMMUNE_CELLS = [
        "B_cell", "CD4_T_cell", "CD8_T_cell", "Neutrophil",
        "Macrophage", "Dendritic_cell"
    ]

    @property
    def source_name(self) -> str:
        return "TIMER"

    @property
    def base_url(self) -> str:
        return "http://timer.comp-genomics.org"

    def health_check(self) -> bool:
        """检查TIMER API可用性 (deprecated)"""
        warnings.warn(
            "TIMERClient 已废弃，请使用 ImmuneDataManager",
            DeprecationWarning, stacklevel=2
        )
        return True

    def get_immune_infiltration(
        self,
        gene_symbol: str,
        cancer_type: str
    ) -> APIResponse:
        """
        获取基因表达与免疫细胞浸润的相关性 (deprecated)

        deprecated: TIMER 无公开 REST API。
        请使用 ImmuneDataManager.get_immune_infiltration(cancer_type) 获取数据。
        """
        warnings.warn(
            "TIMERClient.get_immune_infiltration 已废弃，"
            "请使用 ImmuneDataManager.get_immune_infiltration(cancer_type)",
            DeprecationWarning, stacklevel=2
        )
        return APIResponse(
            success=False,
            data=None,
            source=self.source_name,
            endpoint="/timer",
            params={"gene": gene_symbol, "cancer": cancer_type},
            timestamp="",
            error="TIMER 已废弃，请使用 ImmuneDataManager"
        )

    def get_immune_data_from_tcga(
        self,
        gene_symbol: str,
        cancer_type: str,
        tcga_client=None
    ) -> APIResponse:
        """
        使用TCGA数据计算免疫浸润相关性

        需要配合CIBERSORT或类似反卷积算法
        """
        if not tcga_client:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/immune_analysis",
                params={"gene": gene_symbol, "cancer": cancer_type},
                timestamp="",
                error="需要提供TCGA客户端实例"
            )

        # 获取基因表达数据
        expr_response = tcga_client.get_gene_expression_by_project(
            gene_symbol,
            f"TCGA-{cancer_type}"
        )

        if not expr_response.success:
            return expr_response

        # 返回数据供下游免疫反卷积分析
        return APIResponse(
            success=True,
            data={
                "gene": gene_symbol,
                "cancer_type": cancer_type,
                "expression_data": expr_response.data,
                "analysis_method": "需要使用CIBERSORT/MCP-counter进行免疫反卷积",
                "note": "TIMER原始数据需从官网下载"
            },
            source=self.source_name,
            endpoint="/immune_analysis",
            params={"gene": gene_symbol, "cancer": cancer_type},
            timestamp=expr_response.timestamp
        )

    def get_multiple_genes_correlation(
        self,
        gene_list: list[str],
        cancer_type: str
    ) -> APIResponse:
        """
        批量获取多个基因与免疫细胞的相关性

        Args:
            gene_list: 基因符号列表
            cancer_type: 癌种代码

        Returns:
            包含批量分析结果的APIResponse
        """
        results = {}
        for gene in gene_list:
            results[gene] = self.get_immune_infiltration(gene, cancer_type)

        return APIResponse(
            success=True,
            data={
                "cancer_type": cancer_type,
                "gene_count": len(gene_list),
                "results": results
            },
            source=self.source_name,
            endpoint="/batch_immune",
            params={"genes": gene_list, "cancer": cancer_type},
            timestamp=""
        )

    def validate_immune_data(self, data: dict) -> tuple[bool, list[str]]:
        """验证免疫数据合理性"""
        issues = []

        if not data:
            return False, ["缺少数据"]

        immune_cells = data.get("immune_cells", {})
        if not immune_cells:
            issues.append("缺少免疫细胞数据")

        # 检查相关系数范围
        for cell, values in immune_cells.items():
            corr = values.get("correlation")
            if corr is not None and (corr < -1 or corr > 1):
                issues.append(f"{cell}相关系数超出范围: {corr}")

        return len(issues) == 0, issues
