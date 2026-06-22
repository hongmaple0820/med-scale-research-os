from __future__ import annotations

import gzip
import hashlib
import io
import json
from pathlib import Path

import pytest

from src.research_os import (
    ClaimAdmissionError,
    ClaimLedgerStore,
    LicenseScope,
    LiteratureAdmissionError,
    MeshDescriptorInspector,
    MeshTerminologyAdapter,
    NcbiRateLimiter,
    PubMedEfetchAdapter,
    PubMedRecordControl,
    PubMedRecordInspector,
    RangeDownloadResponse,
    ResumableHttpDownloader,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    ReviewStatus,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    TerminologyReleaseControl,
    ThreeLayerArtifactStore,
)


def _mesh_bytes(records: list[dict]) -> bytes:
    descriptor_xml = []
    for record in records:
        terms = "".join(
            f"<Term><String>{term}</String></Term>"
            for term in record["terms"]
        )
        trees = "".join(
            f"<TreeNumber>{tree}</TreeNumber>"
            for tree in record.get("trees", [])
        )
        descriptor_xml.append(
            "<DescriptorRecord>"
            f"<DescriptorUI>{record['ui']}</DescriptorUI>"
            f"<DescriptorName><String>{record['name']}</String></DescriptorName>"
            f"<TreeNumberList>{trees}</TreeNumberList>"
            f"<ConceptList><Concept><TermList>{terms}</TermList></Concept></ConceptList>"
            "</DescriptorRecord>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<DescriptorRecordSet>"
        + "".join(descriptor_xml)
        + "</DescriptorRecordSet>"
    ).encode("utf-8")
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as handle:
        handle.write(xml)
    return output.getvalue()


def _pubmed_xml() -> bytes:
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>10952317</PMID>
      <Article>
        <ArticleTitle>Molecular classification of melanoma.</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">First exact source sentence.</AbstractText>
          <AbstractText Label="RESULTS">Second exact source sentence.</AbstractText>
        </Abstract>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
      <MeshHeadingList>
        <MeshHeading>
          <DescriptorName UI="D008545" MajorTopicYN="N">Melanoma</DescriptorName>
        </MeshHeading>
      </MeshHeadingList>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.1000/test</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>
"""


def _registry() -> SourceRegistry:
    registry = SourceRegistry()
    registry.register(SourceDefinition(
        source_id="nlm-mesh",
        name="NLM Medical Subject Headings",
        authority="U.S. National Library of Medicine",
        version="2026",
        adapter_id="mesh-descriptor-release-v1",
        base_urls=("https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research", "public_export"),
        status=SourceStatus.APPROVED,
    ))
    registry.register(SourceDefinition(
        source_id="ncbi-pubmed",
        name="NCBI PubMed",
        authority="NCBI",
        version="eutils-v3",
        adapter_id="pubmed-efetch-v1",
        base_urls=("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research",),
        status=SourceStatus.APPROVED,
    ))
    return registry


def _store(tmp_path: Path) -> tuple[ThreeLayerArtifactStore, ReviewLedger]:
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    return (
        ThreeLayerArtifactStore(
            tmp_path / "workspace",
            registry=_registry(),
            reviews=reviews,
        ),
        reviews,
    )


def _mesh_control(content: bytes) -> TerminologyReleaseControl:
    return TerminologyReleaseControl(
        schema="medscale.terminology_release_control.v1",
        control_id="test-mesh-v1",
        source_id="nlm-mesh",
        terminology_id="MeSH",
        version="2026",
        filename="desc2026.gz",
        url="https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.gz",
        expected_size_bytes=len(content),
        expected_sha256=hashlib.sha256(content).hexdigest(),
        expected_descriptor_count=2,
        reference_descriptor={
            "descriptor_ui": "D008545",
            "preferred_name": "Melanoma",
            "tree_numbers": ["C04.1"],
        },
        license={
            "scope": "public",
            "terms_url": "https://www.nlm.nih.gov/mesh-terms",
            "attribution_required": True,
        },
        observed_at="2026-06-19T00:00:00+08:00",
        observation_note="test",
    )


def _pubmed_control(content: bytes) -> PubMedRecordControl:
    return PubMedRecordControl(
        schema="medscale.pubmed_record_control.v1",
        control_id="test-pubmed-v1",
        source_id="ncbi-pubmed",
        pmid="10952317",
        filename="pubmed_10952317.xml",
        url=(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
            "efetch.fcgi?db=pubmed&id=10952317&rettype=abstract&retmode=xml"
        ),
        expected_size_bytes=len(content),
        expected_sha256=hashlib.sha256(content).hexdigest(),
        expected_title="Molecular classification of melanoma.",
        expected_doi="10.1000/test",
        required_mesh=({
            "descriptor_ui": "D008545",
            "descriptor_name": "Melanoma",
        },),
        observed_at="2026-06-19T00:00:00+08:00",
        observation_note="test",
    )


def test_mesh_inspector_profiles_release_and_returns_unselected_candidates():
    content = _mesh_bytes([
        {
            "ui": "D008545",
            "name": "Melanoma",
            "trees": ["C04.1"],
            "terms": ["Melanoma", "Malignant Melanoma"],
        },
        {
            "ui": "D999999",
            "name": "Melanoma Model",
            "trees": ["E01.1"],
            "terms": ["Melanoma"],
        },
    ])
    inspector = MeshDescriptorInspector()

    profile = inspector.inspect(content)
    resolution = inspector.resolve_candidates(content, "melanoma")

    assert profile["descriptor_count"] == 2
    assert profile["reference_descriptors"]["D008545"]["preferred_name"] == "Melanoma"
    assert resolution["status"] == "human_review_required"
    assert resolution["selected_id"] is None
    assert {item["descriptor_ui"] for item in resolution["candidates"]} == {
        "D008545",
        "D999999",
    }


def test_mesh_adapter_requires_control_profile_and_human_review(tmp_path: Path):
    content = _mesh_bytes([
        {
            "ui": "D008545",
            "name": "Melanoma",
            "trees": ["C04.1"],
            "terms": ["Melanoma"],
        },
        {
            "ui": "D000001",
            "name": "Other",
            "trees": ["A01.1"],
            "terms": ["Other"],
        },
    ])
    store, reviews = _store(tmp_path)
    control = _mesh_control(content)
    adapter = MeshTerminologyAdapter.from_bytes(
        store=store,
        content=content,
        response_headers={"content-length": str(len(content))},
    )

    artifact = adapter.download_control(
        project_id="terminology-controls",
        control=control,
        download_dir=tmp_path / "downloads",
    )

    assert artifact.stable_record_ids == ("MeSH:2026",)
    assert artifact.retrieval["terminology_profile"]["descriptor_count"] == 2
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED


def test_ncbi_rate_limiter_enforces_public_interval():
    times = iter([0.0, 0.1, 0.34])
    sleeps: list[float] = []
    limiter = NcbiRateLimiter(
        api_key=None,
        clock=lambda: next(times),
        sleep=sleeps.append,
    )

    limiter.wait()
    limiter.wait()

    assert sleeps == [pytest.approx(0.24)]
    assert limiter.minimum_interval_seconds == pytest.approx(0.34)


def test_pubmed_inspector_emits_exact_original_text_locators():
    record = PubMedRecordInspector().inspect(
        _pubmed_xml(),
        expected_pmids=("10952317",),
    )["records"][0]

    assert record["pmid"] == "10952317"
    assert record["mesh_headings"][0]["descriptor_ui"] == "D008545"
    assert record["abstract_sections"][1]["locator"] == (
        "pubmed:10952317:abstract:1"
    )
    assert record["abstract_sections"][1]["text_sha256"] == hashlib.sha256(
        b"Second exact source sentence."
    ).hexdigest()


def test_pubmed_adapter_ingests_controlled_raw_xml(tmp_path: Path):
    content = _pubmed_xml()
    store, reviews = _store(tmp_path)
    response = RangeDownloadResponse(
        status_code=200,
        content=content,
        headers={
            "Content-Length": str(len(content)),
            "Content-Type": "text/xml; charset=UTF-8",
        },
    )
    adapter = PubMedEfetchAdapter(
        store=store,
        downloader=ResumableHttpDownloader(
            fetch=lambda _url, _headers: response
        ),
    )

    artifact = adapter.download_control(
        project_id="literature-controls",
        control=_pubmed_control(content),
        download_dir=tmp_path / "downloads",
    )

    assert artifact.stable_record_ids == ("PMID:10952317",)
    assert artifact.retrieval["pubmed_profile"]["record_count"] == 1
    assert artifact.retrieval["ncbi_minimum_interval_seconds"] == 0.34
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED


def test_pubmed_adapter_blocks_metadata_drift(tmp_path: Path):
    content = _pubmed_xml()
    store, _ = _store(tmp_path)
    response = RangeDownloadResponse(
        status_code=200,
        content=content,
        headers={"Content-Length": str(len(content))},
    )
    adapter = PubMedEfetchAdapter(
        store=store,
        downloader=ResumableHttpDownloader(
            fetch=lambda _url, _headers: response
        ),
    )
    control = _pubmed_control(content)
    drifted = PubMedRecordControl(
        **{
            **control.to_dict(),
            "expected_title": "Unexpected revised title",
        }
    )

    with pytest.raises(LiteratureAdmissionError, match="title or DOI"):
        adapter.download_control(
            project_id="literature-controls",
            control=drifted,
            download_dir=tmp_path / "downloads",
        )

    assert not list((tmp_path / "workspace").glob("**/manifests/*.json"))


def test_claim_requires_approved_source_and_exact_locator(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="literature",
        source_id="ncbi-pubmed",
        filename="pubmed_10952317.xml",
        content=_pubmed_xml(),
        stable_record_ids=("PMID:10952317",),
        retrieval={"url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"},
        media_type="text/xml",
    )
    claims = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=reviews,
    )
    locator_hash = hashlib.sha256(b"Second exact source sentence.").hexdigest()

    with pytest.raises(ReviewRequiredError):
        claims.submit(
            claim_text="Human-authored statement.",
            stance="support",
            source_artifact_id=raw.artifact_id,
            source_record_id="PMID:10952317",
            locator="pubmed:10952317:abstract:1",
            locator_text_sha256=locator_hash,
            evidence_assessment={
                "study_design": "journal_article",
                "risk_of_bias": "not_assessed",
                "certainty": "not_assessed",
                "applicability": "not_assessed",
            },
        )

    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="PubMed raw record reviewed.",
        signature="test:pubmed-approved",
    )
    record = claims.submit(
        claim_text="Human-authored statement.",
        stance="support",
        source_artifact_id=raw.artifact_id,
        source_record_id="PMID:10952317",
        locator="pubmed:10952317:abstract:1",
        locator_text_sha256=locator_hash,
        evidence_assessment={
            "study_design": "journal_article",
            "risk_of_bias": "not_assessed",
            "certainty": "not_assessed",
            "applicability": "not_assessed",
        },
    )

    assert reviews.stage(record.claim_id) is ReviewStage.INTELLIGENCE
    assert reviews.status(record.claim_id) is ReviewStatus.REVIEW_REQUIRED


def test_claim_rejects_wrong_locator_and_pseudo_grade(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="literature",
        source_id="ncbi-pubmed",
        filename="pubmed.xml",
        content=_pubmed_xml(),
        stable_record_ids=("PMID:10952317",),
        retrieval={},
        media_type="text/xml",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Reviewed.",
        signature="test:approved",
    )
    claims = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=reviews,
    )
    common = {
        "claim_text": "Human-authored statement.",
        "stance": "support",
        "source_artifact_id": raw.artifact_id,
        "source_record_id": "PMID:10952317",
        "locator": "pubmed:10952317:abstract:1",
        "locator_text_sha256": "0" * 64,
        "evidence_assessment": {
            "study_design": "journal_article",
            "risk_of_bias": "not_assessed",
            "certainty": "not_assessed",
            "applicability": "not_assessed",
        },
    }
    with pytest.raises(ClaimAdmissionError, match="locator"):
        claims.submit(**common)

    common["locator_text_sha256"] = hashlib.sha256(
        b"Second exact source sentence."
    ).hexdigest()
    common["evidence_assessment"]["grade_score"] = 10
    with pytest.raises(ClaimAdmissionError, match="pseudo-GRADE"):
        claims.submit(**common)


def test_claim_ledger_reloads_and_detects_tampering(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="literature",
        source_id="ncbi-pubmed",
        filename="pubmed.xml",
        content=_pubmed_xml(),
        stable_record_ids=("PMID:10952317",),
        retrieval={},
        media_type="text/xml",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Reviewed.",
        signature="test:approved",
    )
    claims = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=reviews,
    )
    record = claims.submit(
        claim_text="Human-authored statement.",
        stance="uncertain",
        source_artifact_id=raw.artifact_id,
        source_record_id="PMID:10952317",
        locator="pubmed:10952317:abstract:0",
        locator_text_sha256=hashlib.sha256(
            b"First exact source sentence."
        ).hexdigest(),
        evidence_assessment={
            "study_design": "journal_article",
            "risk_of_bias": "not_assessed",
            "certainty": "not_assessed",
            "applicability": "not_assessed",
        },
    )
    reloaded = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=ReviewLedger(tmp_path / "audit" / "reviews.jsonl"),
    )

    assert reloaded.verify(record.claim_id) is True
    with pytest.raises(ReviewRequiredError):
        reloaded.require_approved(record.claim_id)

    path = Path(record.path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["claim_text"] = "Tampered statement."
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert reloaded.verify(record.claim_id) is False
    with pytest.raises(ClaimAdmissionError, match="integrity"):
        reloaded.require_approved(record.claim_id)
