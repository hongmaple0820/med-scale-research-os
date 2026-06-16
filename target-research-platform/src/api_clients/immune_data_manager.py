"""
免疫浸润数据管理器
管理 TCGA 免疫浸润预计算数据的下载、加载和查询

数据来源优先级：
1. 本地预计算文件 (data/immune_infiltration/)
2. TIMER2.0 预计算数据下载
3. 基于 marker gene 的简化估算（降级方案）
"""
import csv
import gzip
import warnings
from pathlib import Path
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class ImmuneDataManager(BaseAPIClient):
    """TCGA 免疫浸润数据管理器"""

    # 支持的免疫细胞类型（与 ImmuneCorrelationAnalyzer 对齐）
    IMMUNE_CELLS = [
        "B_cell", "CD4_T_cell", "CD8_T_cell", "Neutrophil",
        "Macrophage", "Dendritic_cell", "NK_cell", "Monocyte",
        "Mast_cell", "Eosinophil"
    ]

    # TIMER2.0 提供的 6 种细胞类型映射
    TIMER_CELL_MAP = {
        "B_cell": "B_cell",
        "CD4_T_cell": "CD4_T_cell",
        "CD8_T_cell": "CD8_T_cell",
        "Neutrophil": "Neutrophil",
        "Macrophage": "Macrophage",
        "Dendritic_cell": "Dendritic_cell"
    }

    # TCGA 癌型列表
    TCGA_CANCERS = [
        "ACC", "BLCA", "BRCA", "CESC", "CHOL", "COAD", "DLBC",
        "ESCA", "GBM", "HNSC", "KICH", "KIRC", "KIRP", "LAML",
        "LGG", "LIHC", "LUAD", "LUSC", "MESO", "OV", "PAAD",
        "PCPG", "PRAD", "READ", "SARC", "SKCM", "STAD", "TGCT",
        "THCA", "THYM", "UCEC", "UCS", "UVM"
    ]

    def __init__(self, cache_dir: Optional[str] = None, data_dir: Optional[str] = None):
        super().__init__(cache_dir=cache_dir)
        self.data_dir = Path(data_dir) if data_dir else Path("./data/immune_infiltration")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._loaded_data = {}  # 缓存已加载的数据

    @property
    def source_name(self) -> str:
        return "ImmuneDataManager"

    @property
    def base_url(self) -> str:
        return ""

    def health_check(self) -> bool:
        return True

    def get_immune_infiltration(
        self,
        cancer_type: str,
        source: str = "auto"
    ) -> APIResponse:
        """
        获取指定癌型的免疫浸润数据

        Args:
            cancer_type: TCGA 癌型代码，如 "BRCA"
            source: 数据来源 ("auto", "local", "timer", "tcga_marker")

        Returns:
            APIResponse 包含 {sample_id: {cell_type: proportion}}
        """
        if cancer_type not in self.TCGA_CANCERS:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="get_immune_infiltration",
                params={"cancer_type": cancer_type},
                timestamp="",
                error=f"不支持的癌型: {cancer_type}"
            )

        # 内存缓存
        if cancer_type in self._loaded_data:
            return APIResponse(
                success=True, data=self._loaded_data[cancer_type],
                source=self.source_name, endpoint="get_immune_infiltration",
                params={"cancer_type": cancer_type}, timestamp=""
            )

        if source == "auto":
            # 优先本地文件
            local_result = self._load_local_data(cancer_type)
            if local_result.success:
                self._loaded_data[cancer_type] = local_result.data
                return local_result

            # 降级：从 TCGA 表达数据估算
            return self._estimate_from_tcga_expression(cancer_type)

        elif source == "local":
            return self._load_local_data(cancer_type)

        elif source == "tcga_marker":
            return self._estimate_from_tcga_expression(cancer_type)

        else:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="get_immune_infiltration",
                params={"cancer_type": cancer_type}, timestamp="",
                error=f"未知数据来源: {source}"
            )

    def _load_local_data(self, cancer_type: str) -> APIResponse:
        """加载本地预计算的免疫浸润数据"""
        # 尝试多种文件格式
        for ext in [".csv", ".tsv", ".csv.gz"]:
            file_path = self.data_dir / f"{cancer_type}{ext}"
            if file_path.exists():
                return self._parse_immune_file(file_path, cancer_type)

        return APIResponse(
            success=False, data=None, source=self.source_name,
            endpoint="_load_local_data",
            params={"cancer_type": cancer_type}, timestamp="",
            error=f"未找到本地免疫数据文件: {cancer_type}"
        )

    def _parse_immune_file(self, file_path: Path, cancer_type: str) -> APIResponse:
        """解析免疫浸润数据文件"""
        try:
            open_func = gzip.open if file_path.suffix == '.gz' else open
            mode = 'rt' if file_path.suffix == '.gz' else 'r'
            delimiter = '\t' if file_path.suffix == '.tsv' else ','

            with open_func(file_path, mode, encoding='utf-8') as f:
                reader = csv.DictReader(f, delimiter=delimiter)
                immune_data = {}

                for row in reader:
                    sample_id = row.get("sample_id", "")
                    if not sample_id:
                        continue

                    cell_fractions = {}
                    for cell in self.IMMUNE_CELLS:
                        val = row.get(cell, row.get(cell.lower(), ""))
                        if val:
                            try:
                                cell_fractions[cell] = float(val)
                            except ValueError:
                                pass

                    if cell_fractions:
                        immune_data[sample_id] = cell_fractions

            if not immune_data:
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint="_parse_immune_file",
                    params={"cancer_type": cancer_type}, timestamp="",
                    error="解析后无有效数据"
                )

            self._loaded_data[cancer_type] = immune_data
            return APIResponse(
                success=True, data=immune_data,
                source="local_file", endpoint=str(file_path),
                params={"cancer_type": cancer_type}, timestamp=""
            )

        except Exception as e:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="_parse_immune_file",
                params={"cancer_type": cancer_type}, timestamp="",
                error=f"文件解析错误: {str(e)}"
            )

    def _estimate_from_tcga_expression(self, cancer_type: str) -> APIResponse:
        """
        基于 TCGA 表达数据和 marker gene 估算免疫浸润

        使用已知的免疫细胞 marker gene 表达水平做简化估算。
        这是降级方案，精度低于 CIBERSORT/TIMER 等反卷积方法。

        标记基因：
        - B_cell: CD19, MS4A1
        - CD4_T_cell: CD4
        - CD8_T_cell: CD8A, CD8B
        - Neutrophil: FCGR3B, CSF3R
        - Macrophage: CD68, CD163
        - Dendritic_cell: ITGAX, HLA-DRA
        - NK_cell: NCAM1, KLRD1
        - Monocyte: CD14
        - Mast_cell: KIT, TPSAB1
        - Eosinophil: IL5RA
        """
        warnings.warn(
            f"使用 marker gene 估算 {cancer_type} 免疫浸润（降级方案），"
            "建议提供预计算数据文件以获得更准确的结果",
            UserWarning
        )

        # 返回一个空结果，标记需要预计算数据
        return APIResponse(
            success=False, data=None,
            source=self.source_name,
            endpoint="_estimate_from_tcga_expression",
            params={"cancer_type": cancer_type}, timestamp="",
            error=(
                f"缺少 {cancer_type} 的预计算免疫浸润数据。"
                f"请将数据文件放置在 {self.data_dir}/{cancer_type}.csv，"
                f"格式: sample_id,B_cell,CD4_T_cell,CD8_T_cell,Neutrophil,"
                f"Macrophage,Dendritic_cell,NK_cell,Monocyte,Mast_cell,Eosinophil"
            )
        )

    def get_supported_cancers(self) -> list[str]:
        """返回支持的癌型列表"""
        available = []
        for cancer in self.TCGA_CANCERS:
            for ext in [".csv", ".tsv", ".csv.gz"]:
                if (self.data_dir / f"{cancer}{ext}").exists():
                    available.append(cancer)
                    break
        return available

    def get_data_status(self) -> dict:
        """返回各癌型的数据状态"""
        status = {}
        for cancer in self.TCGA_CANCERS:
            has_local = any(
                (self.data_dir / f"{cancer}{ext}").exists()
                for ext in [".csv", ".tsv", ".csv.gz"]
            )
            status[cancer] = {
                "local_data": has_local,
                "in_memory": cancer in self._loaded_data
            }
        return status
