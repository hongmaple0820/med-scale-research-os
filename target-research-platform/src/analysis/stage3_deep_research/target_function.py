"""
靶点功能分析模块
整合UniProt、PubMed、KEGG等数据源进行靶点功能机制分析
"""
from typing import Optional
from datetime import datetime


class TargetFunctionAnalyzer:
    """靶点功能分析器"""

    def __init__(self):
        self.results = {}

    def analyze(
        self,
        gene_symbol: str,
        uniprot_data: Optional[dict] = None,
        pubmed_data: Optional[dict] = None,
        pathway_data: Optional[dict] = None,
        ppi_data: Optional[dict] = None
    ) -> dict:
        """
        执行靶点功能分析

        Args:
            gene_symbol: 基因符号
            uniprot_data: UniProt数据
            pubmed_data: PubMed文献数据
            pathway_data: 通路数据
            ppi_data: 蛋白互作数据

        Returns:
            功能分析结果
        """
        result = {
            "success": True,
            "gene": gene_symbol,
            "timestamp": datetime.now().isoformat(),
            "sections": {}
        }

        # 1. 基本信息
        if uniprot_data:
            result["sections"]["basic_info"] = self._extract_basic_info(uniprot_data)

        # 2. 功能描述
        if uniprot_data:
            result["sections"]["function"] = self._extract_function(uniprot_data)

        # 3. 结构域
        if uniprot_data:
            result["sections"]["domains"] = self._extract_domains(uniprot_data)

        # 4. 通路信息
        if pathway_data:
            result["sections"]["pathways"] = self._extract_pathways(pathway_data)

        # 5. 蛋白互作网络
        if ppi_data:
            result["sections"]["ppi_network"] = self._extract_ppi(ppi_data)

        # 6. 文献概况
        if pubmed_data:
            result["sections"]["literature"] = self._extract_literature(pubmed_data)

        # 7. 生成百科全书式摘要
        result["encyclopedia"] = self._generate_encyclopedia(result["sections"])

        self.results[gene_symbol] = result
        return result

    def _extract_basic_info(self, uniprot_data: dict) -> dict:
        """提取基本信息"""
        return {
            "uniprot_id": uniprot_data.get("uniprot_id", ""),
            "gene_name": uniprot_data.get("gene_name", ""),
            "protein_name": uniprot_data.get("protein_name", ""),
            "organism": uniprot_data.get("organism", "Homo sapiens"),
            "sequence_length": uniprot_data.get("sequence_length", 0),
            "molecular_weight": uniprot_data.get("molecular_weight", 0),
            "subcellular_location": uniprot_data.get("subcellular_location", [])
        }

    def _extract_function(self, uniprot_data: dict) -> dict:
        """提取功能描述"""
        function_texts = uniprot_data.get("function", [])

        # 合并功能描述
        full_function = " ".join(function_texts) if function_texts else ""

        return {
            "function_description": full_function,
            "function_summary": self._summarize_function(full_function)
        }

    def _summarize_function(self, function_text: str) -> str:
        """生成功能摘要"""
        if not function_text:
            return "功能描述不可用"

        # 截取前500字符作为摘要
        if len(function_text) > 500:
            return function_text[:500] + "..."
        return function_text

    def _extract_domains(self, uniprot_data: dict) -> list:
        """提取结构域信息"""
        domains = uniprot_data.get("domains", [])

        return [
            {
                "name": domain.get("name", ""),
                "start": domain.get("start", 0),
                "end": domain.get("end", 0),
                "description": domain.get("description", "")
            }
            for domain in domains
        ]

    def _extract_pathways(self, pathway_data: dict) -> list:
        """提取通路信息"""
        pathways = pathway_data.get("pathways", [])

        return [
            {
                "name": pathway.get("name", ""),
                "source": pathway.get("source", ""),
                "id": pathway.get("id", ""),
                "description": pathway.get("description", "")
            }
            for pathway in pathways[:20]  # 限制返回数量
        ]

    def _extract_ppi(self, ppi_data: dict) -> dict:
        """提取蛋白互作网络"""
        interactions = ppi_data.get("interactions", [])

        # 按置信度排序
        sorted_interactions = sorted(
            interactions,
            key=lambda x: x.get("score", 0),
            reverse=True
        )

        return {
            "total_interactions": len(interactions),
            "top_partners": [
                {
                    "partner": interaction.get("partner", ""),
                    "score": interaction.get("score", 0),
                    "evidence": interaction.get("evidence", "")
                }
                for interaction in sorted_interactions[:20]
            ]
        }

    def _extract_literature(self, pubmed_data: dict) -> dict:
        """提取文献概况"""
        papers = pubmed_data.get("papers", [])

        if not papers:
            return {
                "total_papers": 0,
                "recent_papers": [],
                "research_trends": []
            }

        # 按年份统计
        year_counts = {}
        for paper in papers:
            year = paper.get("year", "")
            if year:
                year_counts[year] = year_counts.get(year, 0) + 1

        # 最近文献
        recent_papers = sorted(
            papers,
            key=lambda x: x.get("year", ""),
            reverse=True
        )[:10]

        return {
            "total_papers": len(papers),
            "year_distribution": year_counts,
            "recent_papers": [
                {
                    "pmid": paper.get("pmid", ""),
                    "title": paper.get("title", ""),
                    "year": paper.get("year", ""),
                    "journal": paper.get("journal", "")
                }
                for paper in recent_papers
            ]
        }

    def _generate_encyclopedia(self, sections: dict) -> dict:
        """生成百科全书式摘要"""
        basic_info = sections.get("basic_info", {})
        function = sections.get("function", {})
        domains = sections.get("domains", [])
        pathways = sections.get("pathways", [])
        ppi = sections.get("ppi_network", {})
        literature = sections.get("literature", {})

        # 生成概述
        overview_parts = []

        protein_name = basic_info.get("protein_name", "")
        if protein_name:
            overview_parts.append(f"{protein_name}")

        gene_name = basic_info.get("gene_name", "")
        if gene_name:
            overview_parts.append(f"由{gene_name}基因编码")

        function_desc = function.get("function_summary", "")
        if function_desc and function_desc != "功能描述不可用":
            overview_parts.append(function_desc)

        overview = "。".join(overview_parts) + "。" if overview_parts else ""

        # 关键特征
        key_features = []

        if domains:
            domain_names = [d.get("name", "") for d in domains[:3] if d.get("name")]
            if domain_names:
                key_features.append(f"包含{', '.join(domain_names)}等结构域")

        if pathways:
            pathway_names = [p.get("name", "") for p in pathways[:3] if p.get("name")]
            if pathway_names:
                key_features.append(f"参与{', '.join(pathway_names)}等信号通路")

        if ppi.get("top_partners"):
            partners = [p.get("partner", "") for p in ppi["top_partners"][:3]]
            if partners:
                key_features.append(f"与{', '.join(partners)}等蛋白存在互作")

        return {
            "overview": overview,
            "key_features": key_features,
            "research_status": {
                "total_publications": literature.get("total_papers", 0),
                "research_active": literature.get("total_papers", 0) > 100
            }
        }

    def validate_result(self, result: dict) -> tuple[bool, list[str]]:
        """验证分析结果"""
        issues = []

        if not result.get("success"):
            issues.append("分析失败")
            return False, issues

        sections = result.get("sections", {})

        # 检查基本信息
        if not sections.get("basic_info"):
            issues.append("缺少基本信息")

        # 检查功能描述
        function = sections.get("function", {})
        if not function.get("function_description"):
            issues.append("缺少功能描述")

        return len(issues) == 0, issues

    def get_summary(self, gene_symbol: str) -> dict:
        """获取分析摘要"""
        if gene_symbol not in self.results:
            return {"gene": gene_symbol, "status": "not_analyzed"}

        result = self.results[gene_symbol]
        sections = result.get("sections", {})
        encyclopedia = result.get("encyclopedia", {})

        return {
            "gene": gene_symbol,
            "status": "analyzed",
            "has_basic_info": bool(sections.get("basic_info")),
            "has_function": bool(sections.get("function", {}).get("function_description")),
            "has_domains": len(sections.get("domains", [])) > 0,
            "has_pathways": len(sections.get("pathways", [])) > 0,
            "has_ppi": sections.get("ppi_network", {}).get("total_interactions", 0) > 0,
            "publication_count": sections.get("literature", {}).get("total_papers", 0),
            "overview": encyclopedia.get("overview", "")
        }
