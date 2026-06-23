"""
GEO (Gene Expression Omnibus) API客户端
用于获取基因表达数据集
API文档：https://www.ncbi.nlm.nih.gov/geo/info/geo_acqu.html
"""
import gzip
import re
import tempfile
from pathlib import Path
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class GEOClient(BaseAPIClient):
    """GEO API客户端"""

    @property
    def source_name(self) -> str:
        return "GEO"

    @property
    def base_url(self) -> str:
        return "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def health_check(self) -> bool:
        """检查GEO API可用性"""
        response = self._make_request(
            "GET",
            "/einfo.fcgi",
            params={"db": "gds", "retmode": "json"},
            use_cache=False
        )
        return response.success

    def search_datasets(
        self,
        disease: str,
        organism: str = "Homo sapiens",
        dataset_type: str = "Expression profiling by array",
        max_results: int = 20
    ) -> APIResponse:
        """
        搜索GEO数据集

        Args:
            disease: 疾病名称
            organism: 物种
            dataset_type: 数据集类型
            max_results: 最大返回数量

        Returns:
            包含数据集列表的APIResponse
        """
        # 构建搜索查询
        query = f"{disease} AND {organism}[orgn] AND {dataset_type}[gdstype] AND gds[entry_type]"

        params = {
            "db": "gds",
            "term": query,
            "retmax": max_results,
            "retmode": "json"
        }

        response = self._make_request("GET", "/esearch.fcgi", params=params)

        if not response.success:
            return response

        return self._parse_search_response(response, disease, query)

    def _parse_search_response(
        self,
        response: APIResponse,
        disease: str,
        query: str
    ) -> APIResponse:
        """解析搜索结果"""
        try:
            raw_data = response.data
            if not raw_data or 'esearchresult' not in raw_data:
                return response

            result = raw_data['esearchresult']
            ids = result.get('idlist', [])
            count = int(result.get('count', 0))

            return APIResponse(
                success=True,
                data={
                    "disease": disease,
                    "query": query,
                    "total_count": count,
                    "returned_count": len(ids),
                    "dataset_ids": ids
                },
                source=self.source_name,
                endpoint="/esearch.fcgi",
                params={"disease": disease},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/esearch.fcgi",
                params={"disease": disease},
                timestamp=response.timestamp,
                error=f"搜索结果解析错误: {str(e)}"
            )

    def get_dataset_details(self, dataset_ids: list[str]) -> APIResponse:
        """
        获取数据集详细信息

        Args:
            dataset_ids: 数据集ID列表

        Returns:
            包含数据集详情的APIResponse
        """
        if not dataset_ids:
            return APIResponse(
                success=True,
                data={"datasets": []},
                source=self.source_name,
                endpoint="/esummary.fcgi",
                params={},
                timestamp=""
            )

        params = {
            "db": "gds",
            "id": ",".join(dataset_ids[:50]),
            "retmode": "json"
        }

        response = self._make_request("GET", "/esummary.fcgi", params=params)

        if not response.success:
            return response

        return self._parse_details_response(response, dataset_ids)

    def _parse_details_response(
        self,
        response: APIResponse,
        dataset_ids: list[str]
    ) -> APIResponse:
        """解析数据集详情"""
        try:
            raw_data = response.data
            if not raw_data or 'result' not in raw_data:
                return response

            result = raw_data['result']
            datasets = []

            for ds_id in dataset_ids:
                if ds_id in result:
                    ds_info = result[ds_id]
                    # NCBI E-utilities v2: accession 是数据库记录 ID
                    # GDS 记录: accession=GDSxxx, gse=数字 → 构造 GSE accession
                    # GSE 记录: accession=GSExxx, gse=数字
                    gds_acc = ds_info.get('accession', '')
                    gse_num = ds_info.get('gse', '')
                    if gds_acc.startswith('GDS') and gse_num:
                        # GDS 策展数据集 → 用对应的 GSE 下载
                        download_acc = f"GSE{gse_num}"
                    else:
                        download_acc = gds_acc
                    datasets.append({
                        "accession": download_acc,
                        "gds_accession": gds_acc,
                        "title": ds_info.get('title', ''),
                        "summary": (ds_info.get('summary', '') or '')[:500],
                        "organism": ds_info.get('taxon', ''),
                        "platform": ds_info.get('gpl', ''),
                        "sample_count": self._parse_sample_count(ds_info),
                        "dataset_type": ds_info.get('gdstype', ''),
                        "pubmed_ids": ds_info.get('pmids', []),
                        "ftp_link": ds_info.get('ftplink', '')
                    })

            return APIResponse(
                success=True,
                data={
                    "datasets": datasets,
                    "count": len(datasets)
                },
                source=self.source_name,
                endpoint="/esummary.fcgi",
                params={"ids": dataset_ids},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/esummary.fcgi",
                params={"ids": dataset_ids},
                timestamp=response.timestamp,
                error=f"详情解析错误: {str(e)}"
            )

    def find_differential_expression_datasets(
        self,
        disease: str,
        tissue: Optional[str] = None,
        max_results: int = 10
    ) -> APIResponse:
        """
        查找差异表达数据集

        优先搜索 RNA-seq 数据集（基因符号做行ID，无需探针映射），
        再回退到微阵列数据集。

        Args:
            disease: 疾病名称
            tissue: 组织类型（可选）
            max_results: 最大返回数量

        Returns:
            包含差异表达数据集的APIResponse
        """
        # 优先搜索 RNA-seq 数据集（行ID是基因符号，无需探针映射）
        query_parts = [disease]
        if tissue:
            query_parts.append(tissue)

        query = " AND ".join(query_parts)
        query += " AND expression profiling by high throughput sequencing[gdstype]"
        query += " AND Homo sapiens[orgn] AND gse[entry_type]"

        params = {
            "db": "gds",
            "term": query,
            "retmax": max_results,
            "retmode": "json"
        }

        response = self._make_request("GET", "/esearch.fcgi", params=params)

        if response.success:
            parsed = self._parse_search_response(response, disease, query)
            if parsed.success and parsed.data.get("total_count", 0) > 0:
                parsed.data["dataset_type"] = "rnaseq"
                return parsed

        # 回退到微阵列数据集
        return self._search_microarray_datasets(disease, tissue, max_results)

    def _search_microarray_datasets(
        self,
        disease: str,
        tissue: Optional[str],
        max_results: int
    ) -> APIResponse:
        """搜索微阵列数据集"""
        query_parts = [disease]
        if tissue:
            query_parts.append(tissue)

        query = " AND ".join(query_parts)
        query += " AND expression profiling by array[gdstype]"
        query += " AND Homo sapiens[orgn] AND gse[entry_type]"

        params = {
            "db": "gds",
            "term": query,
            "retmax": max_results,
            "retmode": "json"
        }

        return self._make_request("GET", "/esearch.fcgi", params=params)

    def get_geo_to_sra(self, geo_accession: str) -> APIResponse:
        """
        获取GEO数据集关联的SRA数据

        Args:
            geo_accession: GEO登录号（如GSE123456）

        Returns:
            包含SRA链接的APIResponse
        """
        # 先搜索GEO
        search_params = {
            "db": "gds",
            "term": f"{geo_accession}[accn]",
            "retmode": "json"
        }

        search_response = self._make_request("GET", "/esearch.fcgi", params=search_params)

        if not search_response.success:
            return search_response

        try:
            ids = search_response.data.get('esearchresult', {}).get('idlist', [])
            if not ids:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="/elink.fcgi",
                    params={"accession": geo_accession},
                    timestamp=search_response.timestamp,
                    error=f"未找到GEO数据集: {geo_accession}"
                )

            # 链接到SRA
            link_params = {
                "dbfrom": "gds",
                "db": "sra",
                "id": ids[0]
            }

            link_response = self._make_request("GET", "/elink.fcgi", params=link_params)

            if not link_response.success:
                return link_response

            # 解析SRA链接
            sra_ids = []
            if link_response.data and 'linksets' in link_response.data:
                for linkset in link_response.data['linksets']:
                    for linkdb in linkset.get('linksetdbs', []):
                        for link in linkdb.get('links', []):
                            sra_ids.append(str(link))

            return APIResponse(
                success=True,
                data={
                    "geo_accession": geo_accession,
                    "sra_ids": sra_ids[:20],
                    "sra_count": len(sra_ids)
                },
                source=self.source_name,
                endpoint="/elink.fcgi",
                params={"accession": geo_accession},
                timestamp=link_response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/elink.fcgi",
                params={"accession": geo_accession},
                timestamp=search_response.timestamp,
                error=f"SRA链接解析错误: {str(e)}"
            )

    @staticmethod
    def _parse_sample_count(ds_info: dict) -> int:
        """从 NCBI summary 响应解析样本数"""
        # GDS 记录有 n_samples 字段
        n = ds_info.get('n_samples')
        if n is not None:
            return int(n)
        # GSE 记录样本数在 ssinfo 字段中
        ssinfo = ds_info.get('ssinfo', '')
        if ssinfo:
            import re as _re
            m = _re.search(r'(\d+)', str(ssinfo))
            if m:
                return int(m.group(1))
        return 0

    def validate_dataset(self, dataset: dict) -> tuple[bool, list[str]]:
        """验证数据集质量"""
        issues = []

        # 检查样本量
        sample_count = dataset.get("sample_count", 0)
        if sample_count < 10:
            issues.append(f"样本量不足: {sample_count} < 10")

        # 检查物种
        organism = dataset.get("organism", "")
        if "Homo sapiens" not in organism and "human" not in organism.lower():
            issues.append(f"非人类数据集: {organism}")

        # 检查数据集类型
        dataset_type = dataset.get("dataset_type", "")
        if "expression" not in dataset_type.lower():
            issues.append(f"非表达数据集: {dataset_type}")

        usable, reason = self.is_usable_expression_dataset(dataset)
        if not usable:
            issues.append(reason)

        return len(issues) == 0, issues

    @staticmethod
    def is_usable_expression_dataset(dataset: dict) -> tuple[bool, str]:
        """排除 SuperSeries 等无本地表达矩阵的数据集。"""
        title = (dataset.get("title") or "").lower()
        summary = (dataset.get("summary") or "").lower()
        dtype = (dataset.get("dataset_type") or "").lower()

        if "superseries" in title or "superseries" in summary:
            return False, "SuperSeries 无本地表达矩阵"
        if "composed of the subseries" in summary:
            return False, "SuperSeries 无本地表达矩阵"
        if "refer to individual series" in summary and "expression" not in dtype:
            return False, "父级汇总数据集，无表达矩阵"
        if dtype == "other" and "expression" not in title and "expression" not in summary:
            return False, "非表达数据集 (Other)"
        if (
            "expression" not in dtype
            and "high throughput" not in dtype
            and "array" not in dtype
        ):
            return False, f"非表达数据集: {dataset.get('dataset_type', 'unknown')}"
        return True, ""

    def filter_expression_datasets(self, datasets: list[dict]) -> list[dict]:
        """仅保留可用于差异表达分析的数据集。"""
        kept: list[dict] = []
        for dataset in datasets:
            usable, reason = self.is_usable_expression_dataset(dataset)
            if usable:
                kept.append(dataset)
        return kept

    @staticmethod
    def series_matrix_has_expression_table(file_path: str) -> bool:
        """快速检测 series matrix 是否含表达表（避免 SuperSeries 元数据文件）。"""
        path = Path(file_path)
        if not path.exists():
            return False
        try:
            open_func = gzip.open if str(file_path).endswith(".gz") else open
            mode = "rt" if str(file_path).endswith(".gz") else "r"
            in_table = False
            with open_func(file_path, mode, encoding="utf-8", errors="replace") as handle:
                for _ in range(5000):
                    line = handle.readline()
                    if not line:
                        break
                    stripped = line.strip()
                    if stripped.startswith("!series_matrix_table_begin") or stripped.startswith(
                        "!sample_table_begin"
                    ):
                        in_table = True
                        continue
                    if stripped.startswith("!series_matrix_table_end") or stripped.startswith(
                        "!sample_table_end"
                    ):
                        break
                    if not in_table:
                        continue
                    if stripped.startswith("!") or stripped.startswith("#") or not stripped:
                        continue
                    unquoted = stripped.strip('"')
                    if unquoted.startswith("ID_REF"):
                        return True
                    parts = stripped.split("\t")
                    if len(parts) > 1:
                        probe = parts[0].strip('"')
                        if probe and probe != "ID_REF":
                            try:
                                float(parts[1].strip('"'))
                                return True
                            except ValueError:
                                pass
            return False
        except OSError:
            return False

    def rank_datasets(
        self,
        datasets: list[dict],
        disease: str
    ) -> list[dict]:
        """
        对数据集进行质量排序

        Args:
            datasets: 数据集列表
            disease: 疾病名称

        Returns:
            排序后的数据集列表
        """
        scored_datasets = []
        datasets = self.filter_expression_datasets(datasets)

        for ds in datasets:
            score = 0

            # 样本量得分
            sample_count = ds.get("sample_count", 0)
            if sample_count >= 100:
                score += 3
            elif sample_count >= 50:
                score += 2
            elif sample_count >= 20:
                score += 1

            # 数据类型得分
            dataset_type = ds.get("dataset_type", "").lower()
            if "high throughput sequencing" in dataset_type:
                score += 3  # RNA-seq优先
            elif "array" in dataset_type:
                score += 2

            # 疾病相关性得分
            title = ds.get("title", "").lower()
            if disease.lower() in title:
                score += 2

            # 有PubMed文献支持
            if ds.get("pubmed_ids"):
                score += 1

            ds["quality_score"] = score
            scored_datasets.append(ds)

        # 按得分排序
        scored_datasets.sort(key=lambda x: x["quality_score"], reverse=True)

        return scored_datasets

    def download_series_matrix(
        self,
        geo_accession: str,
        output_dir: Optional[str] = None
    ) -> APIResponse:
        """
        下载 GEO Series Matrix 文件

        Args:
            geo_accession: GEO 登录号，如 "GSE12345"
            output_dir: 输出目录（默认使用临时目录）

        Returns:
            APIResponse 包含 {"file_path": str, "accession": str}
        """
        import requests as req

        # 构建 URL
        # GSE12345 → GSE12nnn
        num = int(geo_accession.replace("GSE", ""))
        series_dir = f"GSE{num // 1000}nnn"
        base_url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{series_dir}/{geo_accession}/matrix"

        # 尝试下载
        output_path = Path(output_dir) if output_dir else Path(tempfile.gettempdir())
        output_path.mkdir(parents=True, exist_ok=True)

        file_path = output_path / f"{geo_accession}_series_matrix.txt.gz"

        # 检查缓存（无效 SuperSeries 缓存需剔除）
        if file_path.exists():
            if self.series_matrix_has_expression_table(str(file_path)):
                return APIResponse(
                    success=True,
                    data={"file_path": str(file_path), "accession": geo_accession},
                    source=self.source_name,
                    endpoint=base_url,
                    params={"accession": geo_accession},
                    timestamp=""
                )
            try:
                file_path.unlink()
            except OSError:
                pass

        try:
            # 先获取目录列表找到确切文件名
            dir_resp = req.get(base_url + "/", timeout=30)
            dir_resp.raise_for_status()

            # 查找 series_matrix.txt.gz（兼容 GSE12345 与 GSE12345-GPLxxxx 命名）
            candidates = re.findall(
                rf'({re.escape(geo_accession)}(?:-GPL\d+)?_series_matrix\.txt\.gz)',
                dir_resp.text,
            )
            if not candidates:
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint=base_url, params={"accession": geo_accession},
                    timestamp="",
                    error=f"未找到 {geo_accession} 的 series matrix 文件"
                )

            def _size_hint(name: str) -> int:
                pattern = rf'{re.escape(name)}</a>\s+[\d-]+\s+[\d:]+\s+([\d.]+)([KMG]?)'
                m = re.search(pattern, dir_resp.text)
                if not m:
                    return 0
                value = float(m.group(1))
                unit = m.group(2).upper()
                multiplier = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3}.get(unit, 1)
                return int(value * multiplier)

            filename = max(set(candidates), key=_size_hint)
            file_url = f"{base_url}/{filename}"

            # 下载文件
            self._wait_for_rate_limit()
            dl_resp = req.get(file_url, timeout=120, stream=True)
            dl_resp.raise_for_status()

            with open(file_path, 'wb') as f:
                for chunk in dl_resp.iter_content(chunk_size=8192):
                    f.write(chunk)

            if not self.series_matrix_has_expression_table(str(file_path)):
                try:
                    file_path.unlink()
                except OSError:
                    pass
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint=file_url, params={"accession": geo_accession},
                    timestamp="",
                    error=f"{geo_accession} 下载文件无表达矩阵（可能为 SuperSeries）"
                )

            return APIResponse(
                success=True,
                data={"file_path": str(file_path), "accession": geo_accession},
                source=self.source_name,
                endpoint=file_url,
                params={"accession": geo_accession},
                timestamp=""
            )

        except Exception as e:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint=base_url, params={"accession": geo_accession},
                timestamp="",
                error=f"下载失败: {str(e)}"
            )

    def download_platform_annotation(
        self,
        platform_id: str,
        output_dir: Optional[str] = None
    ) -> APIResponse:
        """
        下载 GPL 平台注释文件，用于探针 ID → 基因符号映射

        Args:
            platform_id: GPL 编号，如 "GPL570"
            output_dir: 输出目录

        Returns:
            APIResponse 包含 {"file_path": str, "platform_id": str}
        """
        import requests as req

        output_path = Path(output_dir) if output_dir else Path(tempfile.gettempdir())
        output_path.mkdir(parents=True, exist_ok=True)
        file_path = output_path / f"{platform_id}_annot.txt.gz"

        # 检查缓存
        if file_path.exists():
            return APIResponse(
                success=True,
                data={"file_path": str(file_path), "platform_id": platform_id},
                source=self.source_name,
                endpoint="platform_annotation",
                params={"platform_id": platform_id},
                timestamp=""
            )

        # 尝试从 GEO FTP 下载平台注释文件
        num = int(platform_id.replace("GPL", ""))
        platform_dir = f"GPL{num // 1000}nnn"
        base_url = f"https://ftp.ncbi.nlm.nih.gov/geo/platform/{platform_dir}/{platform_id}/annot"

        try:
            # 列出目录，找到注释文件
            dir_resp = req.get(base_url + "/", timeout=30)
            if dir_resp.status_code != 200:
                # 尝试软平台格式 (SOFT 格式)
                soft_url = f"https://ftp.ncbi.nlm.nih.gov/geo/platform/{platform_dir}/{platform_id}/soft/{platform_id}"
                soft_file = output_path / f"{platform_id}_annot.txt.gz"
                soft_resp = req.get(soft_url, timeout=60, stream=True)
                if soft_resp.status_code == 200:
                    with open(soft_file, 'wb') as f:
                        for chunk in soft_resp.iter_content(chunk_size=8192):
                            f.write(chunk)
                    return APIResponse(
                        success=True,
                        data={"file_path": str(soft_file), "platform_id": platform_id},
                        source=self.source_name,
                        endpoint=soft_url,
                        params={"platform_id": platform_id},
                        timestamp=""
                    )
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint=base_url, params={"platform_id": platform_id},
                    timestamp="", error=f"无法下载 {platform_id} 注释文件"
                )

            # 查找注释文件
            match = re.search(
                rf'({platform_id}[.-].*?\.txt\.gz)',
                dir_resp.text
            )
            if not match:
                # 回退：使用 NCBI E-utilities 获取平台信息
                return self._fetch_platform_via_eutils(platform_id, output_path)

            filename = match.group(1)
            file_url = f"{base_url}/{filename}"

            self._wait_for_rate_limit()
            dl_resp = req.get(file_url, timeout=120, stream=True)
            dl_resp.raise_for_status()

            with open(file_path, 'wb') as f:
                for chunk in dl_resp.iter_content(chunk_size=8192):
                    f.write(chunk)

            return APIResponse(
                success=True,
                data={"file_path": str(file_path), "platform_id": platform_id},
                source=self.source_name,
                endpoint=file_url,
                params={"platform_id": platform_id},
                timestamp=""
            )

        except Exception as e:
            # 最终回退：通过 E-utilities 获取
            return self._fetch_platform_via_eutils(platform_id, output_path)

    def _fetch_platform_via_eutils(
        self,
        platform_id: str,
        output_path: Path
    ) -> APIResponse:
        """通过 NCBI E-utilities 获取平台注释数据"""
        import requests as req

        # 使用 efetch 获取 GPL SOFT 格式
        gpl_num = platform_id.replace("GPL", "")
        params = {
            "db": "gpl",
            "id": gpl_num,
            "rettype": "soft",
            "retmode": "text"
        }

        try:
            self._wait_for_rate_limit()
            resp = req.get(f"{self.base_url}/efetch.fcgi", params=params, timeout=60)
            resp.raise_for_status()

            file_path = output_path / f"{platform_id}_annot.txt"
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(resp.text)

            return APIResponse(
                success=True,
                data={"file_path": str(file_path), "platform_id": platform_id},
                source=self.source_name,
                endpoint="/efetch.fcgi",
                params={"platform_id": platform_id},
                timestamp=""
            )
        except Exception as e:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="/efetch.fcgi", params={"platform_id": platform_id},
                timestamp="", error=f"通过 E-utilities 获取 {platform_id} 失败: {str(e)}"
            )

    def build_probe_gene_map(
        self,
        platform_id: str,
        cache_dir: Optional[str] = None
    ) -> dict:
        """
        构建 探针 ID → 基因符号 映射表

        Args:
            platform_id: GPL 编号，如 "GPL570"
            cache_dir: 缓存目录

        Returns:
            {"probe_id": "gene_symbol", ...} 映射字典
        """
        import pandas as pd

        annot_dir = str(Path(cache_dir) / "platform_annotations") if cache_dir else None

        # 1. 先检查是否有本地缓存映射
        if cache_dir:
            map_cache = Path(cache_dir) / "probe_maps" / f"{platform_id}_probe_map.json"
            if map_cache.exists():
                import json
                with open(map_cache, 'r', encoding='utf-8') as f:
                    return json.load(f)

        # 2. 下载注释文件
        dl_result = self.download_platform_annotation(platform_id, output_dir=annot_dir)
        if not dl_result.success:
            return {}

        file_path = dl_result.data["file_path"]
        probe_map = {}

        try:
            # 判断文件格式并解析
            open_func = gzip.open if file_path.endswith('.gz') else open
            mode = 'rt' if file_path.endswith('.gz') else 'r'

            in_data = False
            header_line = None
            id_col_idx = None
            gene_col_idx = None
            gene_symbol_patterns = [
                "gene symbol", "gene_symbol", "genesymbol",
                "gene assignment", "gene_assignment",
                "symbol", "gene title", "gene_title",
                "GENE_SYMBOL", "Gene Symbol"
            ]

            with open_func(file_path, mode, encoding='utf-8', errors='replace') as f:
                for line in f:
                    line = line.strip()

                    # SOFT 格式：找到数据表开始
                    if line.startswith('^DATABASE') or line.startswith('^PLATFORM'):
                        continue

                    if line.startswith('!platform_table_begin'):
                        in_data = True
                        continue
                    if line.startswith('!platform_table_end'):
                        break

                    # 非 SOFT 格式的 tab 分隔注释文件
                    if not in_data and not line.startswith('#') and '\t' in line:
                        # 检查是否是表头行
                        parts = [p.strip('"').strip() for p in line.split('\t')]
                        lower_parts = [p.lower() for p in parts]
                        # 找 ID 和 Gene Symbol 列
                        for idx, lp in enumerate(lower_parts):
                            if lp == "id" or lp == "probe_id" or lp == "id_ref":
                                id_col_idx = idx
                            for pattern in gene_symbol_patterns:
                                if pattern in lp:
                                    gene_col_idx = idx
                                    break
                        if id_col_idx is not None and gene_col_idx is not None:
                            in_data = True
                            header_line = parts
                            continue

                    if not in_data:
                        continue

                    # 跳过表头行
                    if header_line is not None and line.startswith(header_line[0]):
                        continue

                    if not line or line.startswith('#') or line.startswith('!'):
                        continue

                    parts = [p.strip('"').strip() for p in line.split('\t')]

                    # 如果还没找到列索引，第一行就是表头
                    if id_col_idx is None:
                        lower_parts = [p.lower() for p in parts]
                        for idx, lp in enumerate(lower_parts):
                            if lp == "id" or lp == "probe_id" or lp == "id_ref":
                                id_col_idx = idx
                            for pattern in gene_symbol_patterns:
                                if pattern in lp:
                                    gene_col_idx = idx
                                    break
                        continue

                    # 提取映射
                    if id_col_idx < len(parts):
                        probe_id = parts[id_col_idx]
                        if gene_col_idx is not None and gene_col_idx < len(parts):
                            gene_field = parts[gene_col_idx]
                            # 解析基因符号 — 多种格式：
                            # 直接: "TP53"
                            # Affymetrix: "TP53 /// MDM2" (多基因)
                            # Illumina: "NM_001126112 /// TP53" (转录本+基因)
                            # 赋值格式: "GB_ACC:NM_001126112 // STRAND:+ // SYMBOL:TP53"
                            gene_symbol = self._parse_gene_symbol(gene_field)
                            if gene_symbol:
                                probe_map[probe_id] = gene_symbol

        except Exception as e:
            # 解析失败，返回空映射
            pass

        # 3. 缓存映射结果
        if cache_dir and probe_map:
            map_cache = Path(cache_dir) / "probe_maps"
            map_cache.mkdir(parents=True, exist_ok=True)
            map_file = map_cache / f"{platform_id}_probe_map.json"
            import json
            with open(map_file, 'w', encoding='utf-8') as f:
                json.dump(probe_map, f, ensure_ascii=False)

        return probe_map

    @staticmethod
    def _parse_gene_symbol(gene_field: str) -> str:
        """
        从平台注释字段中解析基因符号

        支持多种格式：
        - 直接基因符号: "TP53"
        - Affymetrix 多基因: "TP53 /// MDM2" → 取第一个
        - Illumina 赋值: "GB_ACC:NM_001126112 // STRAND:+ // SYMBOL:TP53" → 提取 SYMBOL
        - 转录本+基因: "NM_001126112 /// TP53" → 取基因符号部分
        """
        if not gene_field or gene_field in ('---', 'nan', '', 'null', 'NA'):
            return ""

        # 赋值格式: "KEY:VALUE // KEY2:VALUE2"
        if '//' in gene_field and ':' in gene_field:
            parts = gene_field.split('//')
            for part in parts:
                part = part.strip()
                if part.upper().startswith('SYMBOL:') or part.upper().startswith('GENE SYMBOL:'):
                    symbol = part.split(':', 1)[1].strip()
                    if symbol and not symbol.startswith('NM_') and not symbol.startswith('NR_'):
                        return symbol
            # 没有 SYMBOL 键，尝试取非转录本部分
            for part in parts:
                part = part.strip()
                if ':' in part:
                    val = part.split(':', 1)[1].strip()
                else:
                    val = part.strip()
                if val and not val.startswith('NM_') and not val.startswith('NR_') and not val.startswith('ENST'):
                    return val
            return ""

        # Affymetrix 多基因格式: "TP53 /// MDM2"
        if '///' in gene_field:
            parts = gene_field.split('///')
            for part in parts:
                part = part.strip()
                # 跳过转录本 ID
                if part and not part.startswith('NM_') and not part.startswith('NR_') and not part.startswith('ENST'):
                    # 去掉引号
                    part = part.strip('"').strip("'")
                    if part:
                        return part
            return ""

        # 直接基因符号
        gene_field = gene_field.strip().strip('"').strip("'")
        # 如果是纯转录本 ID，跳过
        if gene_field.startswith('NM_') or gene_field.startswith('NR_') or gene_field.startswith('ENST'):
            return ""

        return gene_field

    def _parse_gene_symbol_from_data_table(
        self,
        data_lines: list[str],
        header_samples: list[str]
    ) -> dict:
        """
        从 series matrix 数据表中直接提取 探针ID → 基因符号 映射

        很多 GEO 数据集的表达数据行格式为:
        ID_REF  Sample1  Sample2  ...  (但某些平台会在数据行中包含基因符号)

        也处理 SOFT 格式中 !platform_table_begin 区域的基因符号列。
        """
        probe_map = {}
        # 常见的基因符号列名模式
        gene_col_patterns = [
            "gene symbol", "gene_symbol", "genesymbol", "symbol",
            "gene_assignment", "gene title", "gene_title",
            "GENE_SYMBOL", "Gene Symbol", "gene", "gene name"
        ]

        for line in data_lines[:5]:  # 只检查前几行来判断格式
            parts = [p.strip('"').strip() for p in line.split('\t')]
            if len(parts) < 3:
                continue
            # 如果第二列看起来是基因符号（非数字、长度合理）
            candidate = parts[1] if len(parts) > 1 else ""
            if (candidate and not candidate.replace('.', '').replace('-', '').isdigit()
                    and len(candidate) <= 30 and not candidate.startswith('GSM')):
                # 可能是基因符号列
                # 验证：检查更多行
                gene_col_idx = 1
                mapped = 0
                for dl in data_lines[:200]:
                    dp = [p.strip('"').strip() for p in dl.split('\t')]
                    if len(dp) > gene_col_idx:
                        probe_id = dp[0]
                        gene_sym = dp[gene_col_idx]
                        if gene_sym and not gene_sym.replace('.', '').replace('-', '').isdigit():
                            # 验证看起来像基因符号
                            if len(gene_sym) <= 30 and not gene_sym.startswith('GSM'):
                                parsed = self._parse_gene_symbol(gene_sym)
                                if parsed:
                                    probe_map[probe_id] = parsed
                                    mapped += 1
                if mapped > len(data_lines) * 0.1:  # 至少10%映射成功
                    return probe_map

        return probe_map

    def parse_series_matrix(
        self,
        file_path: str,
        target_genes: Optional[list[str]] = None,
        probe_id_map: Optional[dict] = None,
        cache_dir: Optional[str] = None
    ) -> APIResponse:
        """
        解析 GEO Series Matrix 文件

        Args:
            file_path: series_matrix.txt.gz 文件路径
            target_genes: 目标基因列表（None 则解析全部）
            probe_id_map: 探针→基因映射（None 则自动从平台注释构建）
            cache_dir: 缓存目录（用于下载/缓存平台注释）

        Returns:
            APIResponse 包含 {
                "expression_matrix": pd.DataFrame,  # gene_symbols x samples
                "sample_metadata": dict,
                "platform": str,
                "gene_count": int,
                "sample_count": int,
                "probe_mapping_stats": dict
            }
        """
        try:
            import pandas as pd
        except ImportError:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="parse_series_matrix", params={"file_path": file_path},
                timestamp="", error="需要安装 pandas"
            )

        try:
            open_func = gzip.open if file_path.endswith('.gz') else open
            mode = 'rt' if file_path.endswith('.gz') else 'r'

            metadata = {}
            sample_titles = {}
            sample_characteristics = {}  # sample_index -> list of characteristic strings
            data_lines = []
            header_samples = []
            in_data = False
            # 用于从SOFT格式平台表提取基因符号
            platform_probe_map = {}
            in_platform_table = False
            platform_header_parsed = False
            platform_id_col_idx = None
            platform_gene_col_idx = None

            with open_func(file_path, mode, encoding='utf-8', errors='replace') as f:
                for line in f:
                    line = line.strip()

                    # SOFT 格式平台表
                    if line.startswith('!platform_table_begin'):
                        in_platform_table = True
                        platform_header_parsed = False
                        continue
                    if line.startswith('!platform_table_end'):
                        in_platform_table = False
                        continue

                    if in_platform_table:
                        if not line or line.startswith('#') or line.startswith('!'):
                            continue
                        parts = [p.strip('"').strip() for p in line.split('\t')]
                        if not platform_header_parsed:
                            # 解析表头，找 ID 和 Gene Symbol 列
                            lower_parts = [p.lower() for p in parts]
                            gene_symbol_patterns = [
                                "gene symbol", "gene_symbol", "genesymbol",
                                "gene assignment", "gene_assignment",
                                "symbol", "gene title", "gene_title",
                                "GENE_SYMBOL", "Gene Symbol"
                            ]
                            for idx, lp in enumerate(lower_parts):
                                if lp in ("id", "probe_id", "id_ref"):
                                    platform_id_col_idx = idx
                                for pattern in gene_symbol_patterns:
                                    if pattern in lp:
                                        platform_gene_col_idx = idx
                                        break
                            platform_header_parsed = True
                            continue

                        # 数据行
                        if platform_id_col_idx is not None and platform_gene_col_idx is not None:
                            if platform_id_col_idx < len(parts) and platform_gene_col_idx < len(parts):
                                probe_id = parts[platform_id_col_idx]
                                gene_field = parts[platform_gene_col_idx]
                                gene_symbol = self._parse_gene_symbol(gene_field)
                                if gene_symbol:
                                    platform_probe_map[probe_id] = gene_symbol
                        continue

                    if line.startswith('!series_matrix_table_begin') or line.startswith('!sample_table_begin'):
                        in_data = True
                        continue
                    if line.startswith('!series_matrix_table_end') or line.startswith('!sample_table_end'):
                        break

                    if not in_data:
                        # 解析元数据
                        if line.startswith('!Sample_title'):
                            parts = line.split('\t')
                            if len(parts) > 1:
                                metadata['_titles'] = [p.strip('"') for p in parts[1:]]

                        elif line.startswith('!Sample_geo_accession'):
                            parts = line.split('\t')
                            if len(parts) > 1:
                                metadata['_accessions'] = [p.strip('"') for p in parts[1:]]

                        elif line.startswith('!Sample_source_name_ch1'):
                            parts = line.split('\t')
                            if len(parts) > 1:
                                metadata['_source_names'] = [p.strip('"') for p in parts[1:]]

                        elif line.startswith('!Sample_characteristics_ch1'):
                            # characteristics 可能有多行，需要合并
                            parts = line.split('\t')
                            if len(parts) > 1:
                                char_values = [p.strip('"') for p in parts[1:]]
                                if '_characteristics_list' not in metadata:
                                    metadata['_characteristics_list'] = {}
                                for i, cv in enumerate(char_values):
                                    if i not in metadata['_characteristics_list']:
                                        metadata['_characteristics_list'][i] = []
                                    metadata['_characteristics_list'][i].append(cv)

                        elif line.startswith('!Sample_group'):
                            parts = line.split('\t')
                            if len(parts) > 1:
                                metadata['_groups'] = [p.strip('"') for p in parts[1:]]

                        elif line.startswith('!Sample_platform_id') or line.startswith('!Series_platform_id'):
                            parts = line.split('\t')
                            if len(parts) > 1:
                                metadata['platform'] = parts[1].strip('"')

                    else:
                        # 数据行
                        if line.startswith('!') or line.startswith('#') or not line:
                            continue
                        # 去掉引号后检查 ID_REF
                        unquoted = line.strip('"')
                        if unquoted.startswith('ID_REF'):
                            # 表头行
                            parts = line.split('\t')
                            header_samples = [p.strip('"') for p in parts[1:]]
                            continue
                        data_lines.append(line)

            # 构建 sample metadata（合并多行 characteristics）
            accessions = metadata.get('_accessions', [])
            titles = metadata.get('_titles', [])
            source_names = metadata.get('_source_names', [])
            groups = metadata.get('_groups', [])
            char_lists = metadata.get('_characteristics_list', {})

            sample_metadata = {}
            for i, acc in enumerate(accessions):
                # 合并该样本的所有 characteristics 行
                merged_chars = '; '.join(char_lists.get(i, []))
                sample_metadata[acc] = {
                    "title": titles[i] if i < len(titles) else "",
                    "characteristics": merged_chars,
                    "source_name": source_names[i] if i < len(source_names) else "",
                    "group": groups[i] if i < len(groups) else ""
                }

            # 解析表达矩阵
            if not data_lines or not header_samples:
                return APIResponse(
                    success=False, data=None, source=self.source_name,
                    endpoint="parse_series_matrix",
                    params={"file_path": file_path}, timestamp="",
                    error="无法解析表达数据"
                )

            # 构建 DataFrame
            rows = []
            gene_ids = []
            for line in data_lines:
                parts = line.split('\t')
                gene_id = parts[0].strip('"')
                values = []
                for v in parts[1:]:
                    v = v.strip('"')
                    try:
                        values.append(float(v))
                    except ValueError:
                        values.append(float('nan'))
                gene_ids.append(gene_id)
                rows.append(values)

            df = pd.DataFrame(rows, index=gene_ids, columns=header_samples[:len(rows[0]) if rows else 0])

            # === 探针 ID → 基因符号映射 ===
            mapping_stats = {
                "total_probes": len(df),
                "mapped_probes": 0,
                "unmapped_probes": 0,
                "unique_genes": 0,
                "platform_id": metadata.get('platform', ''),
                "mapping_applied": False
            }

            platform_id = metadata.get('platform', '')

            # 优先级1：SOFT文件内嵌的平台表映射（最可靠，因为它与数据完全对应）
            probe_map_to_use = None
            mapping_source = ""

            if platform_probe_map:
                probe_map_to_use = platform_probe_map
                mapping_source = "soft_platform_table"

            # 优先级2：外部提供的映射表
            if probe_map_to_use is None and probe_id_map:
                probe_map_to_use = probe_id_map
                mapping_source = "provided"

            # 优先级3：自动下载平台注释
            if probe_map_to_use is None and platform_id:
                downloaded_map = self.build_probe_gene_map(platform_id, cache_dir=cache_dir)
                if downloaded_map:
                    probe_map_to_use = downloaded_map
                    mapping_source = "platform_annotation_download"

            # 优先级4：从数据表结构推断基因符号列
            if probe_map_to_use is None:
                inferred_map = self._parse_gene_symbol_from_data_table(data_lines, header_samples)
                if inferred_map:
                    probe_map_to_use = inferred_map
                    mapping_source = "data_table_inference"

            if probe_map_to_use:
                # 应用映射
                mapped_index = []
                unmapped_count = 0
                for idx in df.index:
                    gene_symbol = probe_map_to_use.get(idx, "")
                    if gene_symbol:
                        mapped_index.append(gene_symbol)
                    else:
                        unmapped_count += 1
                        mapped_index.append(None)

                # 替换索引
                df.index = mapped_index

                # 删除未映射的行
                unmapped_count_before = len(df)
                df = df[df.index.notna()]
                unmapped_count = unmapped_count_before - len(df)

                # 多探针对同一基因：取均值
                duplicated_genes = df.index.duplicated(keep=False)
                if duplicated_genes.any():
                    df = df.groupby(df.index).mean()

                mapping_stats["mapped_probes"] = len(df)
                mapping_stats["unmapped_probes"] = unmapped_count
                mapping_stats["unique_genes"] = len(df)
                mapping_stats["mapping_applied"] = True
                mapping_stats["mapping_source"] = mapping_source
            else:
                # 无映射 — 行索引保持原始 probe ID
                mapping_stats["unmapped_probes"] = len(df)
                mapping_stats["mapping_applied"] = False

            # 如果指定了目标基因，只保留目标基因
            if target_genes:
                available_genes = [g for g in target_genes if g in df.index]
                if available_genes:
                    df = df.loc[available_genes]

            return APIResponse(
                success=True,
                data={
                    "expression_matrix": df,
                    "sample_metadata": sample_metadata,
                    "platform": metadata.get('platform', ''),
                    "gene_count": len(df),
                    "sample_count": len(df.columns),
                    "accession": Path(file_path).stem.replace('_series_matrix.txt', ''),
                    "probe_mapping_stats": mapping_stats
                },
                source=self.source_name,
                endpoint="parse_series_matrix",
                params={"file_path": file_path},
                timestamp=""
            )

        except Exception as e:
            return APIResponse(
                success=False, data=None, source=self.source_name,
                endpoint="parse_series_matrix",
                params={"file_path": file_path}, timestamp="",
                error=f"解析错误: {str(e)}"
            )

    def infer_sample_groups(
        self,
        sample_metadata: dict,
        disease: str
    ) -> dict:
        """
        从样本元数据推断 case/control 分组

        策略（按优先级）：
        1. group 标签直接分组
        2. characteristics 中包含 disease/healthy 关键词
        3. title + source_name 中包含 disease/normal/control 关键词
        4. 按位置前半/后半分组（最后手段）

        Returns:
            {"disease": [sample_ids], "control": [sample_ids], "method": str}
        """
        disease_samples = []
        control_samples = []
        unassigned_samples = []

        disease_lower = disease.lower()
        # 疾病关键词：完整疾病名 + 单个词（长度>2）+ 通用癌症关键词
        disease_words = [w for w in disease_lower.split() if len(w) > 2]
        disease_keywords = [
            disease_lower, "tumor", "tumour", "cancer", "carcinoma",
            "adenocarcinoma", "malignant", "case", "patient"
        ] + disease_words
        # 去重
        disease_keywords = list(dict.fromkeys(disease_keywords))

        control_keywords = [
            "normal", "control", "healthy", "adjacent", "benign",
            "non-tumor", "non_tumor", "noncancer", "healthy volunteer",
            "non-neoplastic", "non_neoplastic", "parenchyma"
        ]

        for sample_id, meta in sample_metadata.items():
            # 构建完整文本（所有可用字段拼接）
            text_parts = [
                meta.get('title', ''),
                meta.get('characteristics', ''),
                meta.get('source_name', '')
            ]
            text = ' '.join(text_parts).lower()
            group_label = meta.get('group', '').lower()

            is_disease = any(kw in text for kw in disease_keywords)
            is_control = any(kw in text for kw in control_keywords)

            # 也检查 group 标签
            if group_label:
                if not is_disease and any(kw in group_label for kw in disease_keywords):
                    is_disease = True
                if not is_control and any(kw in group_label for kw in control_keywords):
                    is_control = True

            # 特殊处理：如果文本包含 disease 名但也被标记为 normal/adjacent，
            # 优先识别为 control（如 "breast cancer adjacent normal"）
            if is_disease and is_control:
                # 检查是否更偏向 control
                control_indicators = ["adjacent", "normal", "benign", "non-tumor", "non-neoplastic"]
                if any(ci in text for ci in control_indicators):
                    is_disease = False
                else:
                    is_control = False

            if is_disease and not is_control:
                disease_samples.append(sample_id)
            elif is_control and not is_disease:
                control_samples.append(sample_id)
            else:
                unassigned_samples.append(sample_id)

        # 如果分组失败，尝试按位置分组
        if not disease_samples or not control_samples:
            all_samples = list(sample_metadata.keys())
            mid = len(all_samples) // 2
            if len(all_samples) >= 4:
                return {
                    "disease": all_samples[:mid],
                    "control": all_samples[mid:],
                    "method": "positional",
                    "warning": "无法从元数据推断分组，按位置前后分组（结果可能不准确）"
                }

        return {
            "disease": disease_samples,
            "control": control_samples,
            "unassigned": unassigned_samples,
            "method": "metadata"
        }
