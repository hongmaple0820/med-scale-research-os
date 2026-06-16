"""
PubMed E-utilities API客户端
用于生物医学文献检索
API文档：https://www.ncbi.nlm.nih.gov/books/NBK25500/
"""
import os
import xml.etree.ElementTree as ET
from typing import Optional
from .base_client import BaseAPIClient, APIResponse


class PubMedClient(BaseAPIClient):
    """PubMed E-utilities API客户端"""

    @property
    def source_name(self) -> str:
        return "PubMed"

    @property
    def base_url(self) -> str:
        return "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def health_check(self) -> bool:
        """检查PubMed API可用性"""
        response = self._make_request(
            "GET",
            "/einfo.fcgi",
            params={"db": "pubmed", "retmode": "json"},
            use_cache=False
        )
        return response.success

    def search(
        self,
        query: str,
        max_results: int = 20,
        sort: str = "relevance"
    ) -> APIResponse:
        """
        搜索PubMed文献

        Args:
            query: 搜索查询（支持PubMed语法）
            max_results: 最大返回数量
            sort: 排序方式 ("relevance", "date")

        Returns:
            包含PMID列表的APIResponse
        """
        params = {
            "db": "pubmed",
            "term": query,
            "retmax": max_results,
            "retmode": "json",
            "sort": sort
        }

        response = self._make_request("GET", "/esearch.fcgi", params=params)

        if not response.success:
            return response

        return self._parse_search_response(response, query)

    def _parse_search_response(self, response: APIResponse, query: str) -> APIResponse:
        """解析搜索结果"""
        try:
            raw_data = response.data
            if not raw_data or 'esearchresult' not in raw_data:
                return response

            result = raw_data['esearchresult']
            pmids = result.get('idlist', [])
            count = int(result.get('count', 0))

            return APIResponse(
                success=True,
                data={
                    "query": query,
                    "total_count": count,
                    "returned_count": len(pmids),
                    "pmids": pmids
                },
                source=self.source_name,
                endpoint="/esearch.fcgi",
                params={"query": query},
                timestamp=response.timestamp
            )

        except (KeyError, ValueError, TypeError) as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/esearch.fcgi",
                params={"query": query},
                timestamp=response.timestamp,
                error=f"搜索结果解析错误: {str(e)}"
            )

    def fetch_details(self, pmids: list[str]) -> APIResponse:
        """
        获取文献详细信息

        Args:
            pmids: PMID列表

        Returns:
            包含文献详细信息的APIResponse
        """
        if not pmids:
            return APIResponse(
                success=True,
                data={"papers": []},
                source=self.source_name,
                endpoint="/efetch.fcgi",
                params={},
                timestamp=""
            )

        params = {
            "db": "pubmed",
            "id": ",".join(pmids[:100]),  # 限制最多100个
            "rettype": "abstract",
            "retmode": "xml"
        }

        # XML格式需要特殊处理
        response = self._make_raw_request("GET", "/efetch.fcgi", params=params)

        if not response.success:
            return response

        return self._parse_fetch_response(response, pmids)

    def _make_raw_request(self, method: str, endpoint: str, params: dict) -> APIResponse:
        """发起原始请求（不解析JSON，带缓存）"""
        from datetime import datetime

        # 检查缓存
        cache_key = self._get_cache_key(endpoint, params)
        cached = self._get_from_cache(cache_key)
        if cached:
            return APIResponse(**cached)

        # 速率限制
        self._wait_for_rate_limit()
        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        try:
            timeout = float(os.environ.get("MANUSCRIPT_ENRICH_PUBMED_TIMEOUT", "10"))
            resp = self._session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()

            api_response = APIResponse(
                success=True,
                data=resp.text,
                source=self.source_name,
                endpoint=endpoint,
                params=params,
                timestamp=datetime.now().isoformat(),
                raw_response=resp.text[:2000]
            )

            # 写入缓存
            self._save_to_cache(cache_key, api_response)

            return api_response
        except Exception as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint=endpoint,
                params=params,
                timestamp=datetime.now().isoformat(),
                error=str(e)
            )

    def _parse_fetch_response(self, response: APIResponse, pmids: list[str]) -> APIResponse:
        """解析XML格式的文献详情"""
        try:
            xml_text = response.data
            if not xml_text:
                return response

            root = ET.fromstring(xml_text)
            papers = []

            for article in root.findall('.//PubmedArticle'):
                paper = self._extract_article_info(article)
                if paper:
                    papers.append(paper)

            return APIResponse(
                success=True,
                data={
                    "papers": papers,
                    "count": len(papers)
                },
                source=self.source_name,
                endpoint="/efetch.fcgi",
                params={"pmids": pmids},
                timestamp=response.timestamp
            )

        except ET.ParseError as e:
            return APIResponse(
                success=False,
                data=None,
                source=self.source_name,
                endpoint="/efetch.fcgi",
                params={"pmids": pmids},
                timestamp=response.timestamp,
                error=f"XML解析错误: {str(e)}"
            )

    def _extract_article_info(self, article_elem) -> Optional[dict]:
        """从XML元素提取文章信息"""
        try:
            medline = article_elem.find('.//MedlineCitation')
            if medline is None:
                return None

            pmid_elem = medline.find('.//PMID')
            pmid = pmid_elem.text if pmid_elem is not None else ""

            article = medline.find('.//Article')
            if article is None:
                return None

            # 提取标题
            title_elem = article.find('.//ArticleTitle')
            title = title_elem.text if title_elem is not None else ""

            # 提取摘要
            abstract_parts = []
            abstract = article.find('.//Abstract')
            if abstract is not None:
                for text in abstract.findall('.//AbstractText'):
                    label = text.get('Label', '')
                    content = text.text or ''
                    if label:
                        abstract_parts.append(f"{label}: {content}")
                    else:
                        abstract_parts.append(content)

            abstract_text = " ".join(abstract_parts)

            # 提取作者
            authors = []
            author_list = article.find('.//AuthorList')
            if author_list is not None:
                for author in author_list.findall('.//Author'):
                    last_name = author.find('LastName')
                    fore_name = author.find('ForeName')
                    if last_name is not None and fore_name is not None:
                        authors.append(f"{fore_name.text} {last_name.text}")

            # 提取期刊
            journal_elem = article.find('.//Journal/Title')
            journal = journal_elem.text if journal_elem is not None else ""

            # 提取DOI
            doi = ""
            for id_elem in article.findall('.//ELocationID'):
                if id_elem.get('EIdType') == 'doi':
                    doi = id_elem.text or ""
                    break

            # 发表日期
            pub_date = article.find('.//Journal/JournalIssue/PubDate')
            year = ""
            if pub_date is not None:
                year_elem = pub_date.find('Year')
                if year_elem is not None:
                    year = year_elem.text

            # MeSH 主题词（DescriptorName）
            mesh_terms: list[str] = []
            if medline is not None:
                for mesh in medline.findall(".//MeshHeading"):
                    descriptor = mesh.find("DescriptorName")
                    if descriptor is not None and descriptor.text:
                        mesh_terms.append(descriptor.text.strip())

            # 发表类型（RCT / Review / Clinical Trial 等）
            publication_types: list[str] = []
            for pt in article.findall(".//PublicationType"):
                if pt.text:
                    publication_types.append(pt.text.strip())

            # 作者关键词
            keywords: list[str] = []
            if medline is not None:
                for kw in medline.findall(".//Keyword"):
                    if kw.text:
                        keywords.append(kw.text.strip())

            return {
                "pmid": pmid,
                "title": title,
                "abstract": abstract_text,
                "authors": authors[:5],  # 只保留前5位作者
                "journal": journal,
                "doi": doi,
                "year": year,
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                "mesh_terms": mesh_terms[:15],
                "publication_types": publication_types[:8],
                "keywords": keywords[:12],
            }

        except Exception:
            return None

    def search_gene_literature(
        self,
        gene_symbol: str,
        disease: Optional[str] = None,
        max_results: int = 20
    ) -> APIResponse:
        """
        搜索基因相关文献

        Args:
            gene_symbol: 基因符号
            disease: 疾病名称（可选）
            max_results: 最大返回数量

        Returns:
            包含文献列表的APIResponse
        """
        # 构建PICOS原则查询
        query_parts = [gene_symbol]
        if disease:
            query_parts.append(disease)

        query = " AND ".join(query_parts)

        return self.search(query, max_results=max_results)

    def validate_search_results(self, data: dict) -> tuple[bool, list[str]]:
        """验证搜索结果合理性"""
        issues = []

        if not data:
            return False, ["缺少数据"]

        papers = data.get("papers", [])
        if not papers:
            issues.append("未找到相关文献")

        # 检查文献完整性
        for i, paper in enumerate(papers[:3]):
            if not paper.get("pmid"):
                issues.append(f"文献{i+1}缺少PMID")
            if not paper.get("title"):
                issues.append(f"文献{i+1}缺少标题")

        return len(issues) == 0, issues
