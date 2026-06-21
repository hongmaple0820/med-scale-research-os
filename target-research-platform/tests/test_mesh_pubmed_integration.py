from __future__ import annotations

from pathlib import Path

import pytest

from src.research_os import (
    LicenseScope,
    MeshTerminologyAdapter,
    PubMedEfetchAdapter,
    PubMedRecordControl,
    ReviewLedger,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    TerminologyReleaseControl,
    ThreeLayerArtifactStore,
)


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


@pytest.mark.integration
def test_live_mesh_and_pubmed_reference_controls(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    store = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=reviews,
    )
    mesh_control = TerminologyReleaseControl.load(
        root / "config" / "reference_controls" / "nlm_mesh_2026_descriptors_v1.json"
    )
    pubmed_control = PubMedRecordControl.load(
        root / "config" / "reference_controls" / "ncbi_pubmed_pmid_10952317_v1.json"
    )

    mesh = MeshTerminologyAdapter(store=store).download_control(
        project_id="terminology-literature-controls",
        control=mesh_control,
        download_dir=tmp_path / "downloads",
    )
    pubmed = PubMedEfetchAdapter(store=store).download_control(
        project_id="terminology-literature-controls",
        control=pubmed_control,
        download_dir=tmp_path / "downloads",
    )

    assert mesh.sha256 == mesh_control.expected_sha256
    assert mesh.retrieval["terminology_profile"]["descriptor_count"] == 31110
    assert pubmed.sha256 == pubmed_control.expected_sha256
    assert pubmed.retrieval["pubmed_profile"]["records"][0]["pmid"] == "10952317"
