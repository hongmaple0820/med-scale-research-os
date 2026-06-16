"""
TCGA/GDC API客户端
用于获取肿瘤基因表达和生存数据
表达数据：FireBrowse API (http://firebrowse.org)
临床数据：GDC API (https://api.gdc.cancer.gov)
"""
import math
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class TCGAClient(BaseAPIClient):
    """TCGA/GDC API客户端
    
    表达数据来源: FireBrowse (http://firebrowse.org/api/v1/Samples/mRNASeq)
    临床生存数据来源: GDC (https://api.gdc.cancer.gov/cases)
    """

    # TCGA癌种代码映射
    TCGA_PROJECTS = {
        "BRCA": "TCGA-BRCA",  # 乳腺癌
        "LUAD": "TCGA-LUAD",  # 肺腺癌
        "LUSC": "TCGA-LUSC",  # 肺鳞癌
        "PRAD": "TCGA-PRAD",  # 前列腺癌
        "COAD": "TCGA-COAD",  # 结肠癌
        "READ": "TCGA-READ",  # 直肠癌
        "STAD": "TCGA-STAD",  # 胃癌
        "LIHC": "TCGA-LIHC",  # 肝癌
        "KIRC": "TCGA-KIRC",  # 肾透明细胞癌
        "THCA": "TCGA-THCA",  # 甲状腺癌
        "UCEC": "TCGA-UCEC",  # 子宫内膜癌
        "GBM": "TCGA-GBM",    # 胶质母细胞瘤
        "LGG": "TCGA-LGG",    # 低级别胶质瘤
        "OV": "TCGA-OV",      # 卵巢癌
        "BLCA": "TCGA-BLCA",  # 膀胱癌
        "HNSC": "TCGA-HNSC",  # 头颈鳞癌
        "CESC": "TCGA-CESC",  # 宫颈癌
        "PAAD": "TCGA-PAAD",  # 胰腺癌
        "SKCM": "TCGA-SKCM",  # 皮肤黑色素瘤
        "ESCA": "TCGA-ESCA",  # 食管癌
    }

    # FireBrowse API base URL
    FIREBROWSE_BASE = "http://firebrowse.org/api/v1"

    @property
    def source_name(self) -> str:
        return "TCGA/GDC"

    @property
    def base_url(self) -> str:
        return "https://api.gdc.cancer.gov"

    def health_check(self) -> bool:
        """检查GDC API可用性"""
        response = self._make_request("GET", "/status", use_cache=False)
        return response.success

    def _project_to_cohort(self, project_id: str) -> str:
        """将 TCGA project ID (如 TCGA-BRCA) 转换为 FireBrowse cohort 名 (如 BRCA)"""
        # 从 TCGA_PROJECTS 反向查找
        for code, proj in self.TCGA_PROJECTS.items():
            if proj == project_id:
                return code
        # 如果不在映射中，尝试去掉 "TCGA-" 前缀
        if project_id.startswith("TCGA-"):
            return project_id[5:]
        return project_id

    def get_gene_expression_by_project(
        self,
        gene_symbol: str,
        project_id: str
    ) -> APIResponse:
        """
        获取特定癌种中基因的表达数据（通过 FireBrowse API）

        Args:
            gene_symbol: 基因符号
            project_id: TCGA项目ID，如 "TCGA-BRCA"

        Returns:
            包含表达数据的APIResponse
        """
        import requests

        cohort = self._project_to_cohort(project_id)
        all_samples = []
        page = 1
        page_size = 500
        max_pages = 10  # 安全上限

        try:
            while page <= max_pages:
                url = f"{self.FIREBROWSE_BASE}/Samples/mRNASeq"
                params = {
                    "format": "json",
                    "gene": gene_symbol,
                    "cohort": cohort,
                    "page": page,
                    "page_size": page_size
                }

                self._wait_for_rate_limit()
                resp = self._session.get(url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()

                samples = data.get("mRNASeq", [])
                if not samples:
                    break

                all_samples.extend(samples)

                # 检查是否还有更多页
                if len(samples) < page_size:
                    break
                page += 1

            if not all_samples:
                return APIResponse(
                    success=False,
                    data=None,
                    source="FireBrowse",
                    endpoint="/Samples/mRNASeq",
                    params={"gene": gene_symbol, "cohort": cohort},
                    timestamp="",
                    error=f"未找到 {gene_symbol} 在 {cohort} 中的表达数据"
                )

            return self._parse_firebrowse_expression(all_samples, gene_symbol, project_id)

        except requests.exceptions.RequestException as e:
            return APIResponse(
                success=False,
                data=None,
                source="FireBrowse",
                endpoint="/Samples/mRNASeq",
                params={"gene": gene_symbol, "cohort": cohort},
                timestamp="",
                error=str(e)
            )

    def _parse_firebrowse_expression(
        self,
        raw_samples: list,
        gene_symbol: str,
        project_id: str
    ) -> APIResponse:
        """解析 FireBrowse 表达数据为统一样本格式"""
        try:
            expressions = []
            for item in raw_samples:
                barcode = item.get("tcga_participant_barcode", "")
                expr_log2 = item.get("expression_log2")
                z_score = item.get("z-score")

                if not barcode or expr_log2 is None:
                    continue

                # FireBrowse 返回 log2(RSEM) 值，转换为线性空间
                expr_linear = math.pow(2, float(expr_log2))

                expressions.append({
                    "sample_id": barcode,
                    "expression_value": round(expr_linear, 2),
                    "expression_log2": round(float(expr_log2), 4),
                    "z_score": round(float(z_score), 4) if z_score is not None else None,
                    "unit": "RSEM (linear from log2)",
                    "source": "FireBrowse"
                })

            return APIResponse(
                success=True,
                data={
                    "gene": gene_symbol,
                    "project": project_id,
                    "samples": expressions,
                    "sample_count": len(expressions)
                },
                source="FireBrowse",
                endpoint="/Samples/mRNASeq",
                params={"gene": gene_symbol, "project": project_id},
                timestamp=""
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source="FireBrowse",
                endpoint="/Samples/mRNASeq",
                params={"gene": gene_symbol, "project": project_id},
                timestamp="",
                error=f"数据解析错误: {str(e)}"
            )

    def get_survival_data(
        self,
        gene_symbol: str,
        project_id: str,
        split_method: str = "median"
    ) -> APIResponse:
        """
        获取生存分析所需数据

        Args:
            gene_symbol: 基因符号
            project_id: TCGA项目ID
            split_method: 分组方法 ("median", "quartile")

        Returns:
            包含生存数据的APIResponse
        """
        # 获取表达数据
        expr_response = self.get_gene_expression_by_project(gene_symbol, project_id)
        if not expr_response.success:
            return expr_response

        # 获取临床生存数据
        clinical_response = self._get_clinical_survival(project_id)
        if not clinical_response.success:
            return clinical_response

        # 合并表达和生存数据
        return self._merge_survival_data(
            expr_response.data,
            clinical_response.data,
            gene_symbol,
            split_method
        )

    def _get_clinical_survival(self, project_id: str) -> APIResponse:
        """获取临床生存数据（GDC API）"""
        filters = {
            "op": "=",
            "content": {
                "field": "cases.project.project_id",
                "value": [project_id]
            }
        }

        fields = [
            "case_id",
            "submitter_id",
            "demographic.days_to_death",
            "demographic.vital_status",
            "diagnoses.days_to_last_follow_up"
        ]

        response = self._make_request(
            "POST",
            "/cases",
            json_data={
                "filters": filters,
                "fields": ",".join(fields),
                "size": 10000
            }
        )

        if not response.success:
            return response

        return self._parse_clinical_response(response, project_id)

    def _parse_clinical_response(
        self,
        response: APIResponse,
        project_id: str
    ) -> APIResponse:
        """解析GDC临床数据"""
        try:
            raw_data = response.data
            if not raw_data or 'data' not in raw_data:
                return response

            clinical_data = []
            for case in raw_data['data'].get('hits', []):
                case_id = case.get('case_id', '')
                submitter_id = case.get('submitter_id', '')

                days_to_death = None
                vital_status = None
                days_to_followup = None

                demographic = case.get('demographic', {})
                if demographic:
                    days_to_death = demographic.get('days_to_death')
                    vital_status = demographic.get('vital_status')

                diagnoses = case.get('diagnoses', [])
                if diagnoses:
                    days_to_followup = diagnoses[0].get('days_to_last_follow_up')

                survival_days = None
                event = None

                if days_to_death is not None:
                    survival_days = int(days_to_death)
                    event = 1
                elif days_to_followup is not None:
                    survival_days = int(days_to_followup)
                    event = 0

                if survival_days is not None and survival_days > 0:
                    clinical_data.append({
                        "case_id": case_id,
                        "submitter_id": submitter_id,
                        "survival_days": survival_days,
                        "survival_months": round(survival_days / 30.44, 1),
                        "event": event,
                        "vital_status": vital_status
                    })

            return APIResponse(
                success=True,
                data={
                    "project": project_id,
                    "patients": clinical_data,
                    "patient_count": len(clinical_data)
                },
                source=self.source_name,
                endpoint="/cases",
                params={"project": project_id},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/cases",
                params={"project": project_id},
                timestamp=response.timestamp,
                error=f"临床数据解析错误: {str(e)}"
            )

    def _merge_survival_data(
        self,
        expr_data: dict,
        clinical_data: dict,
        gene_symbol: str,
        split_method: str
    ) -> APIResponse:
        """
        合并表达和生存数据

        匹配逻辑：
        - FireBrowse 表达数据: tcga_participant_barcode → "TCGA-AB-1234" (participant level)
        - GDC 临床数据: submitter_id → "TCGA-AB-1234" (participant level)
        两者直接匹配
        """
        try:
            # 构建 patient barcode → clinical data 映射
            clinical_by_barcode = {}
            for patient in clinical_data.get("patients", []):
                barcode = patient.get("submitter_id", "")
                if barcode:
                    clinical_by_barcode[barcode] = patient

            # expression sample 匹配到 clinical data
            expression_flat = {}
            clinical_flat = {}

            for sample in expr_data.get("samples", []):
                sample_id = sample.get("sample_id", "")
                if not sample_id:
                    continue

                # FireBrowse 返回的是 participant barcode，直接匹配
                # 也尝试提取前3段作为备选（兼容不同格式）
                patient_barcode = sample_id
                if "-" in sample_id:
                    parts = sample_id.split("-")
                    if len(parts) >= 3:
                        patient_barcode = "-".join(parts[:3])

                if patient_barcode in clinical_by_barcode:
                    patient = clinical_by_barcode[patient_barcode]
                    expression_flat[sample_id] = sample.get("expression_value", 0)
                    clinical_flat[sample_id] = {
                        "survival_months": patient["survival_months"],
                        "event": patient["event"]
                    }

            if not expression_flat:
                return APIResponse(
                    success=False,
                    data=None,
                    source=self.source_name,
                    endpoint="/survival_analysis",
                    params={"gene": gene_symbol},
                    timestamp="",
                    error="无法匹配表达数据与临床数据"
                )

            return APIResponse(
                success=True,
                data={
                    "gene": gene_symbol,
                    "project": clinical_data.get("project", ""),
                    "expression_data": expression_flat,
                    "clinical_data": clinical_flat,
                    "matched_count": len(expression_flat),
                    "total_expression": len(expr_data.get("samples", [])),
                    "total_clinical": len(clinical_data.get("patients", [])),
                    "split_method": split_method
                },
                source=self.source_name,
                endpoint="/survival_analysis",
                params={"gene": gene_symbol},
                timestamp=""
            )

        except Exception as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/survival_analysis",
                params={"gene": gene_symbol},
                timestamp="",
                error=f"数据合并错误: {str(e)}"
            )

    # 疾病名称到TCGA项目代码的映射
    DISEASE_TO_PROJECT = {
        "breast cancer": "BRCA",
        "breast carcinoma": "BRCA",
        "lung cancer": "LUAD",
        "lung adenocarcinoma": "LUAD",
        "lung squamous": "LUSC",
        "prostate cancer": "PRAD",
        "colon cancer": "COAD",
        "colorectal cancer": "COAD",
        "rectal cancer": "READ",
        "stomach cancer": "STAD",
        "gastric cancer": "STAD",
        "liver cancer": "LIHC",
        "hepatocellular carcinoma": "LIHC",
        "kidney cancer": "KIRC",
        "renal cell carcinoma": "KIRC",
        "thyroid cancer": "THCA",
        "endometrial cancer": "UCEC",
        "glioblastoma": "GBM",
        "glioma": "LGG",
        "ovarian cancer": "OV",
        "bladder cancer": "BLCA",
        "head and neck cancer": "HNSC",
        "cervical cancer": "CESC",
        "pancreatic cancer": "PAAD",
        "melanoma": "SKCM",
        "esophageal cancer": "ESCA",
    }

    def resolve_disease_to_cohort(self, disease: str) -> Optional[str]:
        """将疾病名称解析为 FireBrowse cohort 代码"""
        disease_lower = disease.lower().strip()
        return self.DISEASE_TO_PROJECT.get(disease_lower)

    def batch_gene_expression(
        self,
        gene_list: list[str],
        cohort: str
    ) -> APIResponse:
        """
        批量获取多个基因在指定癌种中的表达数据（tumor + normal）

        利用 FireBrowse /Samples/mRNASeq 端点，分别查询 TP (tumor) 和 NT (normal) 样本。
        对每个基因，分别获取 tumor 和 normal 的表达值列表。

        Args:
            gene_list: 基因符号列表
            cohort: FireBrowse cohort 代码 (如 "BRCA")

        Returns:
            APIResponse 包含 {
                "cohort": str,
                "gene_count": int,
                "tumor_sample_count": int,
                "normal_sample_count": int,
                "gene_expression": {gene: {"tumor": [...], "normal": [...]}},
            }
        """
        import requests

        gene_expression = {}
        tumor_barcodes = set()
        normal_barcodes = set()

        for gene in gene_list:
            tumor_vals = []
            normal_vals = []

            # 分别查询 TP (Primary Tumor) 和 NT (Normal Tissue)
            for sample_type, vals_list in [("TP", tumor_vals), ("NT", normal_vals)]:
                try:
                    url = f"{self.FIREBROWSE_BASE}/Samples/mRNASeq"
                    params = {
                        "format": "json",
                        "gene": gene,
                        "cohort": cohort,
                        "sample_type": sample_type,
                        "page": 1,
                        "page_size": 2000
                    }

                    self._wait_for_rate_limit()
                    resp = self._session.get(url, params=params, timeout=30)

                    if resp.status_code != 200:
                        continue

                    data = resp.json()
                    samples = data.get("mRNASeq", [])

                    for item in samples:
                        expr_log2 = item.get("expression_log2")
                        barcode = item.get("tcga_participant_barcode", "")
                        if expr_log2 is not None:
                            vals_list.append(float(expr_log2))
                            if sample_type == "TP":
                                tumor_barcodes.add(barcode[:12] if len(barcode) >= 12 else barcode)
                            else:
                                normal_barcodes.add(barcode[:12] if len(barcode) >= 12 else barcode)

                except Exception:
                    continue

            if tumor_vals or normal_vals:
                gene_expression[gene] = {
                    "tumor": tumor_vals,
                    "normal": normal_vals
                }

        if not gene_expression:
            return APIResponse(
                success=False,
                data=None,
                source="FireBrowse",
                endpoint="/Samples/mRNASeq",
                params={"cohort": cohort, "genes": len(gene_list)},
                timestamp="",
                error=f"FireBrowse 未返回 {cohort} 的表达数据"
            )

        return APIResponse(
            success=True,
            data={
                "cohort": cohort,
                "gene_count": len(gene_expression),
                "tumor_sample_count": len(tumor_barcodes),
                "normal_sample_count": len(normal_barcodes),
                "gene_expression": gene_expression
            },
            source="FireBrowse",
            endpoint="/Samples/mRNASeq",
            params={"cohort": cohort, "genes": len(gene_list)},
            timestamp=""
        )

    def compute_differential_expression(
        self,
        gene_list: list[str],
        disease: str,
        cancer_code: Optional[str] = None
    ) -> APIResponse:
        """
        基于 TCGA/FireBrowse 数据计算差异表达

        对每个基因分别查询 tumor 和 normal 样本表达值，
        使用 t-test 计算 log2FC 和 p-value。

        Args:
            gene_list: 待分析的基因列表
            disease: 疾病名称（自动映射到TCGA项目）
            cancer_code: TCGA cancer code（如 BRCA），覆盖 disease 映射

        Returns:
            APIResponse 包含 {
                "cohort": str,
                "method": "tcga_firebrowse",
                "significant_genes": [...],
                "all_results": [...],
                "tumor_count": int,
                "normal_count": int,
            }
        """
        import numpy as np
        from scipy import stats as scipy_stats

        # 解析 cohort
        if cancer_code:
            cohort = cancer_code
        else:
            cohort = self.resolve_disease_to_cohort(disease)
            if not cohort:
                return APIResponse(
                    success=False, data=None, source="FireBrowse",
                    endpoint="compute_differential_expression",
                    params={"disease": disease}, timestamp="",
                    error=f"无法将疾病 '{disease}' 映射到 TCGA 项目代码"
                )

        # 批量获取表达数据
        batch_result = self.batch_gene_expression(gene_list, cohort)
        if not batch_result.success:
            return batch_result

        gene_expr = batch_result.data["gene_expression"]
        tumor_count = batch_result.data["tumor_sample_count"]
        normal_count = batch_result.data["normal_sample_count"]

        # 逐基因做 t-test
        all_results = []
        significant_genes = []

        for gene, expr_data in gene_expr.items():
            tumor_vals = expr_data.get("tumor", [])
            normal_vals = expr_data.get("normal", [])

            if not tumor_vals or not normal_vals:
                continue

            tumor_arr = np.array(tumor_vals)
            normal_arr = np.array(normal_vals)

            # 计算均值
            tumor_mean = float(np.mean(tumor_arr))
            normal_mean = float(np.mean(normal_arr))

            # log2FC
            log2fc = tumor_mean - normal_mean  # 已经在 log2 空间

            # t-test
            if len(tumor_arr) >= 3 and len(normal_arr) >= 3:
                try:
                    t_stat, p_value = scipy_stats.ttest_ind(
                        tumor_arr, normal_arr, equal_var=False
                    )
                except Exception:
                    p_value = 1.0
            else:
                p_value = 1.0

            result = {
                "gene": gene,
                "gene_symbol": gene,
                "log2fc": round(log2fc, 4),
                "p_value": round(float(p_value), 6),
                "adjusted_p_value": round(float(p_value), 6),  # 后续统一校正
                "tumor_mean": round(tumor_mean, 4),
                "normal_mean": round(normal_mean, 4),
                "tumor_n": len(tumor_vals),
                "normal_n": len(normal_vals)
            }
            all_results.append(result)

            # 使用宽松阈值（|log2FC| > 0.5 且 p < 0.05）
            if abs(log2fc) > 0.5 and p_value < 0.05:
                significant_genes.append(result)

        # 多重检验校正 (Benjamini-Hochberg)
        if all_results:
            all_results.sort(key=lambda x: x["p_value"])
            m = len(all_results)
            for i, r in enumerate(all_results):
                bh_p = min(r["p_value"] * m / (i + 1), 1.0)
                r["adjusted_p_value"] = round(bh_p, 6)

            # 更新 significant_genes（使用校正后 p 值）
            significant_genes = [
                r for r in all_results
                if abs(r["log2fc"]) > 0.5 and r["adjusted_p_value"] < 0.05
            ]

        return APIResponse(
            success=True,
            data={
                "cohort": cohort,
                "method": "tcga_firebrowse",
                "significant_genes": significant_genes,
                "all_results": all_results,
                "tumor_count": tumor_count,
                "normal_count": normal_count,
                "gene_count": len(all_results)
            },
            source="FireBrowse",
            endpoint="compute_differential_expression",
            params={"disease": disease, "cohort": cohort, "genes": len(gene_list)},
            timestamp=""
        )

    def validate_expression_data(self, data: dict) -> tuple[bool, list[str]]:
        """验证表达数据合理性"""
        issues = []

        if not data:
            return False, ["缺少数据"]

        samples = data.get("samples", [])
        if len(samples) < 50:
            issues.append(f"样本量不足: {len(samples)} < 50")

        # 检查表达值范围
        for sample in samples:
            expr_value = sample.get("expression_value", 0)
            if expr_value < 0:
                issues.append(f"表达值为负: {expr_value}")

        return len(issues) == 0, issues
