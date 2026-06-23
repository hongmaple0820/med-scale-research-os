"""医学 Skills 文献富化与评述测试"""
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.api_clients.pubmed_client import PubMedClient
from src.output.literature_enricher import enrich_papers_for_manuscript, write_literature_evidence_pack
from src.output.literature_reviewer import LiteratureReviewer
from src.output.medical_skills_bridge import infer_study_design, build_literature_skill_context


SAMPLE_XML = """<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation>
    <PMID>999</PMID>
    <MeshHeadingList>
      <MeshHeading><DescriptorName>CDK4 Protein</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName>Breast Neoplasms</DescriptorName></MeshHeading>
    </MeshHeadingList>
    <KeywordList><Keyword>resistance</Keyword></KeywordList>
    <Article>
      <ArticleTitle>Resistance to CDK4/6 inhibitors in breast cancer</ArticleTitle>
      <Abstract><AbstractText>Background: resistance mechanisms.</AbstractText></Abstract>
      <AuthorList><Author><LastName>Zhang</LastName><ForeName>L</ForeName></Author></AuthorList>
      <Journal><Title>Oncogene</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
      <PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
    </Article>
  </MedlineCitation>
</PubmedArticle>
</PubmedArticleSet>"""


def test_pubmed_extracts_mesh_and_keywords():
    root = ET.fromstring(SAMPLE_XML)
    article = root.find(".//PubmedArticle")
    paper = PubMedClient()._extract_article_info(article)
    assert paper["pmid"] == "999"
    assert "CDK4 Protein" in paper["mesh_terms"]
    assert "Breast Neoplasms" in paper["mesh_terms"]
    assert "resistance" in paper["keywords"]
    assert "Journal Article" in paper["publication_types"]


def test_infer_study_design_from_publication_type():
    paper = {
        "title": "A trial of drug X",
        "publication_types": ["Randomized Controlled Trial"],
        "mesh_terms": [],
    }
    assert infer_study_design(paper) == "随机对照试验"


def test_infer_study_design_prioritizes_review_publication_type_over_topic_mesh():
    paper = {
        "title": "Targeting EGFR in lung cancer: Lessons learned and future perspectives.",
        "publication_types": ["Journal Article", "Review"],
        "mesh_terms": ["Randomized Controlled Trials as Topic", "Clinical Trials as Topic"],
    }
    assert infer_study_design(paper) == "综述"


def test_medical_skills_context_includes_mesh():
    paper = {
        "title": "Test",
        "mesh_terms": ["Breast Neoplasms"],
        "publication_types": ["Review"],
        "study_design": "综述",
    }
    ctx = build_literature_skill_context(paper, target="CDK4", disease_zh="乳腺癌")
    assert "MeSH" in ctx
    assert "证据边界" in ctx


@patch("src.output.literature_enricher.PubMedClient")
@patch("src.output.literature_enricher.AMinerClient")
def test_enricher_merges_pubmed_and_aminer(mock_aminer_cls, mock_pubmed_cls, tmp_path, monkeypatch):
    monkeypatch.setenv("MANUSCRIPT_ENRICH_CACHE_DIR", str(tmp_path / "enrich-cache"))
    mock_pubmed = MagicMock()
    mock_pubmed.fetch_details.return_value = MagicMock(
        success=True,
        data={
            "papers": [{
                "pmid": "1",
                "abstract": "Full abstract text.",
                "mesh_terms": ["CDK4 Protein"],
                "publication_types": ["Journal Article"],
            }]
        },
    )
    mock_pubmed_cls.return_value = mock_pubmed

    mock_aminer = MagicMock()
    mock_aminer.available = True
    mock_aminer.enrich_by_title.return_value = {
        "aminer_matched": True,
        "aminer_citation_count": 42,
    }
    mock_aminer_cls.return_value = mock_aminer

    result = enrich_papers_for_manuscript(
        [{"pmid": "1", "title": "CDK4 resistance", "journal": "Oncogene", "year": 2024}],
        target="CDK4",
        disease_zh="乳腺癌",
        use_pubmed=True,
        use_aminer=True,
    )
    paper = result["papers"][0]
    assert paper["abstract"] == "Full abstract text."
    assert paper["aminer_citation_count"] == 42
    assert "pubmed_efetch" in paper["enrichment_sources"]
    assert result["enrichment"]["pubmed_efetch"] is True
    assert result["enrichment"]["aminer_used"] is True


@patch("src.output.literature_enricher.OpenAlexClient")
@patch("src.output.literature_enricher.PubMedClient")
@patch("src.output.literature_enricher.AMinerClient")
def test_enricher_reuses_cached_evidence_when_live_sources_fail(
    mock_aminer_cls,
    mock_pubmed_cls,
    mock_openalex_cls,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MANUSCRIPT_ENRICH_CACHE_DIR", str(tmp_path / "enrich-cache"))
    mock_aminer = MagicMock()
    mock_aminer.available = False
    mock_aminer_cls.return_value = mock_aminer

    mock_pubmed = MagicMock()
    mock_pubmed.fetch_details.return_value = MagicMock(
        success=True,
        data={
            "papers": [{
                "pmid": "1",
                "abstract": "Full abstract text.",
                "mesh_terms": ["CDK4 Protein"],
                "publication_types": ["Journal Article"],
            }]
        },
    )
    mock_pubmed_cls.return_value = mock_pubmed

    mock_openalex = MagicMock()
    mock_openalex.enrich_paper.return_value = {
        "openalex_matched": True,
        "citation_count": 17,
    }
    mock_openalex_cls.return_value = mock_openalex

    first = enrich_papers_for_manuscript(
        [{"pmid": "1", "title": "CDK4 resistance", "journal": "Oncogene", "year": 2024}],
        target="CDK4",
        disease_zh="乳腺癌",
        use_pubmed=True,
        use_aminer=False,
    )
    assert first["enrichment"]["cache_write_count"] == 1

    mock_pubmed.fetch_details.return_value = MagicMock(success=False, data={})
    mock_openalex.enrich_paper.return_value = {}

    second = enrich_papers_for_manuscript(
        [{"pmid": "1", "title": "CDK4 resistance", "journal": "Oncogene", "year": 2024}],
        target="CDK4",
        disease_zh="乳腺癌",
        use_pubmed=True,
        use_aminer=False,
    )

    paper = second["papers"][0]
    assert paper["mesh_terms"] == ["CDK4 Protein"]
    assert paper["citation_count"] == 17
    assert "cache" in paper["enrichment_sources"]
    assert "cache" in second["enrichment"]["sources"]
    assert second["enrichment"]["cache_used"] is True
    assert second["enrichment"]["cache_hit_count"] == 1


@patch("src.output.literature_enricher.OpenAlexClient")
@patch("src.output.literature_enricher.PubMedClient")
@patch("src.output.literature_enricher.AMinerClient")
def test_enricher_uses_portable_evidence_pack_when_live_sources_fail(
    mock_aminer_cls,
    mock_pubmed_cls,
    mock_openalex_cls,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("MANUSCRIPT_ENRICH_CACHE_DIR", str(tmp_path / "enrich-cache"))
    pack_path = tmp_path / "CDK4_literature_evidence_pack.json"
    write_literature_evidence_pack(
        [{
            "pmid": "2",
            "title": "CDK4 evidence",
            "journal": "Cancer Research",
            "year": 2023,
            "mesh_terms": ["CDK4 Protein", "Breast Neoplasms"],
            "publication_types": ["Journal Article"],
            "citation_count": 31,
            "openalex_matched": True,
            "enrichment_sources": ["pubmed_efetch", "openalex"],
        }],
        pack_path,
        target="CDK4",
        disease="乳腺癌",
        enrichment_meta={"sources": ["pubmed_efetch", "openalex"], "mesh_count": 1, "citation_count_available": 1},
    )

    mock_aminer = MagicMock()
    mock_aminer.available = False
    mock_aminer_cls.return_value = mock_aminer
    mock_pubmed = MagicMock()
    mock_pubmed.fetch_details.return_value = MagicMock(success=False, data={})
    mock_pubmed_cls.return_value = mock_pubmed
    mock_openalex = MagicMock()
    mock_openalex.enrich_paper.return_value = {}
    mock_openalex_cls.return_value = mock_openalex

    result = enrich_papers_for_manuscript(
        [{"pmid": "2", "title": "CDK4 evidence", "journal": "Cancer Research", "year": 2023}],
        target="CDK4",
        disease_zh="乳腺癌",
        use_pubmed=True,
        use_aminer=False,
        evidence_pack_path=pack_path,
    )

    paper = result["papers"][0]
    assert paper["mesh_terms"] == ["CDK4 Protein", "Breast Neoplasms"]
    assert paper["citation_count"] == 31
    assert "evidence_pack" in paper["enrichment_sources"]
    assert "pubmed_efetch" in paper["evidence_pack_sources"]
    assert result["enrichment"]["evidence_pack_used"] is True
    assert result["enrichment"]["evidence_pack_hit_count"] == 1
    assert "evidence_pack" in result["enrichment"]["sources"]
    assert result["enrichment"]["cache_write_count"] == 1


def test_reviewer_includes_mesh_in_rule_based(tmp_path: Path):
    reviewer = LiteratureReviewer(api_key=None)
    reviews = reviewer.review_papers(
        [{
            "title": "Resistance to CDK4/6 inhibitors",
            "journal": "Oncogene",
            "year": 2024,
            "pmid": "1",
            "authors": ["Zhang L"],
            "mesh_terms": ["Breast Neoplasms", "CDK4 Protein"],
            "study_design": "机制与转化研究",
            "enrichment_sources": ["pubmed_efetch"],
        }],
        target="CDK4",
        disease_zh="乳腺癌",
    )
    assert "MeSH" in reviews[0]["commentary_zh"]
    assert reviews[0]["mesh_terms"]
