from __future__ import annotations

import gzip
import io
import json
from pathlib import Path

import pytest

from src.research_os import (
    ClaimLedgerStore,
    LicenseScope,
    PubMedEvidenceWorksheetBuilder,
    PubMedWorksheetClaimSubmitter,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    ReviewStatus,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    TerminologyDecisionError,
    TerminologyMappingDecisionRecorder,
    TerminologyMappingQueue,
    ThreeLayerArtifactStore,
)


def _mesh_bytes() -> bytes:
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<DescriptorRecordSet>
  <DescriptorRecord>
    <DescriptorUI>D008545</DescriptorUI>
    <DescriptorName><String>Melanoma</String></DescriptorName>
    <TreeNumberList><TreeNumber>C04.1</TreeNumber></TreeNumberList>
    <ConceptList><Concept><TermList>
      <Term><String>Melanoma</String></Term>
      <Term><String>Malignant Melanoma</String></Term>
    </TermList></Concept></ConceptList>
  </DescriptorRecord>
  <DescriptorRecord>
    <DescriptorUI>D999999</DescriptorUI>
    <DescriptorName><String>Melanoma Model</String></DescriptorName>
    <TreeNumberList><TreeNumber>E01.1</TreeNumber></TreeNumberList>
    <ConceptList><Concept><TermList>
      <Term><String>Melanoma</String></Term>
    </TermList></Concept></ConceptList>
  </DescriptorRecord>
</DescriptorRecordSet>
"""
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
          <AbstractText>Exact source sentence not copied to worksheet.</AbstractText>
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
    <PubmedData><ArticleIdList>
      <ArticleId IdType="doi">10.1000/test</ArticleId>
    </ArticleIdList></PubmedData>
  </PubmedArticle>
</PubmedArticleSet>
"""


def _store(tmp_path: Path) -> tuple[ThreeLayerArtifactStore, ReviewLedger]:
    registry = SourceRegistry()
    registry.register(SourceDefinition(
        source_id="nlm-mesh",
        name="NLM MeSH",
        authority="NLM",
        version="2026",
        adapter_id="mesh-v1",
        base_urls=("https://nlmpubs.nlm.nih.gov/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research", "public_export"),
        status=SourceStatus.APPROVED,
    ))
    registry.register(SourceDefinition(
        source_id="ncbi-pubmed",
        name="PubMed",
        authority="NCBI",
        version="eutils-v3",
        adapter_id="pubmed-v1",
        base_urls=("https://eutils.ncbi.nlm.nih.gov/",),
        license_scope=LicenseScope.RESTRICTED,
        allowed_uses=("research",),
        status=SourceStatus.APPROVED,
    ))
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    return (
        ThreeLayerArtifactStore(
            tmp_path / "workspace",
            registry=registry,
            reviews=reviews,
        ),
        reviews,
    )


def test_mapping_queue_requires_approved_terminology_parent(tmp_path: Path):
    store, _ = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="nlm-mesh",
        filename="desc2026.gz",
        content=_mesh_bytes(),
        stable_record_ids=("MeSH:2026",),
        retrieval={},
        media_type="application/gzip",
    )

    with pytest.raises(ReviewRequiredError):
        TerminologyMappingQueue().create_request(
            store=store,
            project_id="project-1",
            terminology_artifact_id=raw.artifact_id,
            query="melanoma",
            requested_entity_domain="disease",
        )


def test_mapping_queue_creates_unselected_human_review_artifact(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="nlm-mesh",
        filename="desc2026.gz",
        content=_mesh_bytes(),
        stable_record_ids=("MeSH:2026",),
        retrieval={},
        media_type="application/gzip",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Terminology raw approved.",
        signature="test:mesh-approved",
    )

    artifact = TerminologyMappingQueue().create_request(
        store=store,
        project_id="project-1",
        terminology_artifact_id=raw.artifact_id,
        query="melanoma",
        requested_entity_domain="disease",
    )
    payload = json.loads(store.read_bytes(artifact.artifact_id))

    assert payload["selected_id"] is None
    assert payload["status"] == "human_review_required"
    assert len(payload["candidates"]) == 2
    assert reviews.stage(artifact.artifact_id) is ReviewStage.NORMALIZATION
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED


def test_mapping_decision_requires_approved_request(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="nlm-mesh",
        filename="desc2026.gz",
        content=_mesh_bytes(),
        stable_record_ids=("MeSH:2026",),
        retrieval={},
        media_type="application/gzip",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Terminology raw approved.",
        signature="test:mesh-approved",
    )
    request = TerminologyMappingQueue().create_request(
        store=store,
        project_id="project-1",
        terminology_artifact_id=raw.artifact_id,
        query="melanoma",
        requested_entity_domain="disease",
    )

    with pytest.raises(ReviewRequiredError):
        TerminologyMappingDecisionRecorder().select(
            store=store,
            project_id="project-1",
            mapping_request_artifact_id=request.artifact_id,
            selected_id="D008545",
            reviewer_rationale="Preferred disease descriptor.",
        )


def test_mapping_decision_records_selected_candidate_without_auto_selection(
    tmp_path: Path,
):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="nlm-mesh",
        filename="desc2026.gz",
        content=_mesh_bytes(),
        stable_record_ids=("MeSH:2026",),
        retrieval={},
        media_type="application/gzip",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Terminology raw approved.",
        signature="test:mesh-approved",
    )
    request = TerminologyMappingQueue().create_request(
        store=store,
        project_id="project-1",
        terminology_artifact_id=raw.artifact_id,
        query="melanoma",
        requested_entity_domain="disease",
    )
    reviews.approve(
        request.artifact_id,
        reviewer="human-user",
        note="Candidate queue structure reviewed.",
        signature="test:mapping-request-approved",
    )

    decision = TerminologyMappingDecisionRecorder().select(
        store=store,
        project_id="project-1",
        mapping_request_artifact_id=request.artifact_id,
        selected_id="D008545",
        reviewer_rationale="Preferred disease descriptor over model term.",
    )
    payload = json.loads(store.read_bytes(decision.artifact_id))

    assert payload["decision"]["status"] == "selected"
    assert payload["decision"]["selected_id"] == "D008545"
    assert payload["decision"]["selected_candidate"]["preferred_name"] == "Melanoma"
    assert payload["automatic_selection_performed"] is False
    assert payload["candidate_count"] == 2
    assert reviews.stage(decision.artifact_id) is ReviewStage.NORMALIZATION
    assert reviews.status(decision.artifact_id) is ReviewStatus.REVIEW_REQUIRED
    with pytest.raises(ReviewRequiredError):
        TerminologyMappingDecisionRecorder().require_approved_selection(
            store=store,
            decision_artifact_id=decision.artifact_id,
        )
    reviews.approve(
        decision.artifact_id,
        reviewer="human-user",
        note="Mapping decision approved.",
        signature="test:mapping-decision-approved",
    )

    approved = TerminologyMappingDecisionRecorder().require_approved_selection(
        store=store,
        decision_artifact_id=decision.artifact_id,
    )

    assert approved["decision"]["selected_id"] == "D008545"


def test_mapping_decision_rejects_unknown_candidate_and_allows_reject_all(
    tmp_path: Path,
):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="nlm-mesh",
        filename="desc2026.gz",
        content=_mesh_bytes(),
        stable_record_ids=("MeSH:2026",),
        retrieval={},
        media_type="application/gzip",
    )
    reviews.approve(
        raw.artifact_id,
        reviewer="human-user",
        note="Terminology raw approved.",
        signature="test:mesh-approved",
    )
    request = TerminologyMappingQueue().create_request(
        store=store,
        project_id="project-1",
        terminology_artifact_id=raw.artifact_id,
        query="melanoma",
        requested_entity_domain="disease",
    )
    reviews.approve(
        request.artifact_id,
        reviewer="human-user",
        note="Candidate queue structure reviewed.",
        signature="test:mapping-request-approved",
    )

    with pytest.raises(TerminologyDecisionError, match="candidate set"):
        TerminologyMappingDecisionRecorder().select(
            store=store,
            project_id="project-1",
            mapping_request_artifact_id=request.artifact_id,
            selected_id="D404404",
            reviewer_rationale="Not in the request.",
        )

    rejection = TerminologyMappingDecisionRecorder().reject_all(
        store=store,
        project_id="project-1",
        mapping_request_artifact_id=request.artifact_id,
        reviewer_rationale="Candidates are not acceptable for this project.",
    )
    payload = json.loads(store.read_bytes(rejection.artifact_id))

    assert payload["decision"]["status"] == "rejected"
    assert payload["decision"]["selected_id"] is None
    assert payload["decision"]["reject_all"] is True
    reviews.approve(
        rejection.artifact_id,
        reviewer="human-user",
        note="Reject-all decision approved.",
        signature="test:mapping-rejection-approved",
    )
    with pytest.raises(TerminologyDecisionError, match="did not select"):
        TerminologyMappingDecisionRecorder().require_approved_selection(
            store=store,
            decision_artifact_id=rejection.artifact_id,
        )


def test_evidence_worksheet_requires_approved_pubmed_parent(tmp_path: Path):
    store, _ = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-pubmed",
        filename="pubmed.xml",
        content=_pubmed_xml(),
        stable_record_ids=("PMID:10952317",),
        retrieval={},
        media_type="text/xml",
    )

    with pytest.raises(ReviewRequiredError):
        PubMedEvidenceWorksheetBuilder().create(
            store=store,
            project_id="project-1",
            pubmed_artifact_id=raw.artifact_id,
        )


def test_evidence_worksheet_contains_locators_but_no_claims_or_abstract(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
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
        note="PubMed raw approved.",
        signature="test:pubmed-approved",
    )

    artifact = PubMedEvidenceWorksheetBuilder().create(
        store=store,
        project_id="project-1",
        pubmed_artifact_id=raw.artifact_id,
    )
    payload = json.loads(store.read_bytes(artifact.artifact_id))
    encoded = json.dumps(payload)

    assert payload["claim_count"] == 0
    assert payload["records"][0]["review_items"][0]["claim_text"] is None
    assert payload["records"][0]["review_items"][0]["stance"] is None
    assert payload["records"][0]["review_items"][0]["evidence_assessment"] == {
        "study_design": None,
        "risk_of_bias": None,
        "certainty": None,
        "applicability": None,
    }
    assert payload["records"][0]["review_items"][0]["locator"] == (
        "pubmed:10952317:abstract:0"
    )
    assert "Exact source sentence" not in encoded
    assert "grade_score" not in encoded
    assert reviews.stage(artifact.artifact_id) is ReviewStage.INTELLIGENCE
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED


def test_worksheet_claim_submitter_requires_approved_worksheet(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
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
        note="PubMed raw approved.",
        signature="test:pubmed-approved",
    )
    worksheet = PubMedEvidenceWorksheetBuilder().create(
        store=store,
        project_id="project-1",
        pubmed_artifact_id=raw.artifact_id,
    )
    claims = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=reviews,
    )

    with pytest.raises(ReviewRequiredError):
        PubMedWorksheetClaimSubmitter().submit_claim(
            store=store,
            claims=claims,
            worksheet_artifact_id=worksheet.artifact_id,
            pmid="10952317",
            locator="pubmed:10952317:abstract:0",
            claim_text="Human-authored claim.",
            stance="uncertain",
            evidence_assessment={
                "study_design": "journal_article",
                "risk_of_bias": "not_assessed",
                "certainty": "not_assessed",
                "applicability": "not_assessed",
            },
        )


def test_worksheet_claim_submitter_creates_review_required_claim_from_locator(
    tmp_path: Path,
):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
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
        note="PubMed raw approved.",
        signature="test:pubmed-approved",
    )
    worksheet = PubMedEvidenceWorksheetBuilder().create(
        store=store,
        project_id="project-1",
        pubmed_artifact_id=raw.artifact_id,
    )
    reviews.approve(
        worksheet.artifact_id,
        reviewer="human-user",
        note="Worksheet scaffold reviewed.",
        signature="test:worksheet-approved",
    )
    claims = ClaimLedgerStore(
        tmp_path / "claims",
        artifact_store=store,
        reviews=reviews,
    )

    record = PubMedWorksheetClaimSubmitter().submit_claim(
        store=store,
        claims=claims,
        worksheet_artifact_id=worksheet.artifact_id,
        pmid="10952317",
        locator="pubmed:10952317:abstract:0",
        claim_text="Human-authored claim.",
        stance="uncertain",
        evidence_assessment={
            "study_design": "journal_article",
            "risk_of_bias": "not_assessed",
            "certainty": "not_assessed",
            "applicability": "not_assessed",
        },
    )

    assert record.source_artifact_id == raw.artifact_id
    assert record.source_record_id == "PMID:10952317"
    assert record.locator == "pubmed:10952317:abstract:0"
    assert claims.verify(record.claim_id) is True
    assert reviews.stage(record.claim_id) is ReviewStage.INTELLIGENCE
    assert reviews.status(record.claim_id) is ReviewStatus.REVIEW_REQUIRED
