from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.research_os import (
    ArtifactIntegrityError,
    ArtifactLayer,
    HttpFileAdapter,
    InvalidReviewTransitionError,
    LicenseScope,
    LicenseViolationError,
    PathBoundaryError,
    ReviewLedger,
    ReviewRequiredError,
    ReviewStage,
    ReviewStatus,
    SourceDefinition,
    SourceRegistry,
    SourceStatus,
    SourceUnavailableError,
    ThreeLayerArtifactStore,
)


def _registry() -> SourceRegistry:
    registry = SourceRegistry()
    registry.register(SourceDefinition(
        source_id="ncbi-geo",
        name="NCBI Gene Expression Omnibus",
        authority="NCBI",
        version="2026-06",
        adapter_id="http-file-v1",
        base_urls=("https://ftp.ncbi.nlm.nih.gov/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research", "public_export"),
        status=SourceStatus.APPROVED,
    ))
    registry.register(SourceDefinition(
        source_id="licensed-market",
        name="Licensed Market Database",
        authority="Vendor",
        version="2026-Q2",
        adapter_id="licensed-import-v1",
        base_urls=("https://licensed.example/",),
        license_scope=LicenseScope.RESTRICTED,
        allowed_uses=("research",),
        status=SourceStatus.APPROVED,
    ))
    registry.register(SourceDefinition(
        source_id="experimental-source",
        name="Unapproved Source",
        authority="Unknown",
        version="draft",
        adapter_id="experimental-v1",
        base_urls=("https://experimental.example/",),
        license_scope=LicenseScope.PUBLIC,
        allowed_uses=("research",),
        status=SourceStatus.PENDING,
    ))
    return registry


def _store(tmp_path: Path) -> tuple[ThreeLayerArtifactStore, ReviewLedger]:
    reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    store = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=reviews,
    )
    return store, reviews


def _approve(reviews: ReviewLedger, artifact_id: str, reviewer: str = "researcher-a") -> None:
    reviews.approve(
        artifact_id,
        reviewer=reviewer,
        note="Checked source, checksum, and control output.",
        signature=f"{reviewer}:signed",
    )


def test_source_registry_rejects_unapproved_and_restricted_public_export():
    registry = _registry()

    with pytest.raises(SourceUnavailableError):
        registry.require_approved("experimental-source", use="research")

    registry.require_approved("licensed-market", use="research")
    with pytest.raises(LicenseViolationError):
        registry.require_public_export("licensed-market")


def test_source_registry_round_trips_and_rejects_unapproved_endpoint(tmp_path: Path):
    path = _registry().save(tmp_path / "source-registry.json")
    registry = SourceRegistry.load(path)

    assert registry.get("ncbi-geo").authority == "NCBI"
    with pytest.raises(SourceUnavailableError):
        registry.require_url(
            "ncbi-geo",
            "https://malicious.example/pretend-geo-file",
        )


def test_restricted_artifact_cannot_enter_public_export(tmp_path: Path):
    store, _ = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="licensed-market",
        filename="licensed.csv",
        content=b"licensed data",
        stable_record_ids=("vendor-record-1",),
        retrieval={"import": "local-authorized-file"},
        media_type="text/csv",
    )

    with pytest.raises(LicenseViolationError):
        store.require_public_export(artifact.artifact_id)


def test_raw_ingest_creates_immutable_manifest_and_three_layer_layout(tmp_path: Path):
    store, reviews = _store(tmp_path)

    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="GSE12345_series_matrix.txt.gz",
        content=b"real downloaded bytes",
        stable_record_ids=("GSE12345",),
        retrieval={
            "url": "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE12nnn/GSE12345/matrix/file.gz",
            "query": {"accession": "GSE12345"},
        },
        media_type="application/gzip",
    )

    assert artifact.schema == "medscale.artifact_manifest.v1"
    assert artifact.layer is ArtifactLayer.RAW
    assert artifact.sha256 == store.sha256_bytes(b"real downloaded bytes")
    assert artifact.size_bytes == len(b"real downloaded bytes")
    assert artifact.review_status is ReviewStatus.REVIEW_REQUIRED
    assert Path(artifact.absolute_path).is_file()
    assert "/raw/" in Path(artifact.absolute_path).as_posix()
    assert store.verify(artifact.artifact_id) is True
    assert reviews.status(artifact.artifact_id) is ReviewStatus.REVIEW_REQUIRED

    manifest_payload = json.loads(Path(artifact.manifest_path).read_text(encoding="utf-8"))
    assert manifest_payload["stable_record_ids"] == ["GSE12345"]
    assert manifest_payload["retrieval"]["url"].startswith("https://ftp.ncbi.nlm.nih.gov/")


def test_review_decisions_require_signature_and_reject_duplicate_approval(tmp_path: Path):
    store, reviews = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.txt",
        content=b"trusted",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.txt"},
        media_type="text/plain",
    )

    with pytest.raises(InvalidReviewTransitionError, match="signature"):
        reviews.approve(
            artifact.artifact_id,
            reviewer="researcher-a",
            note="Reviewed.",
            signature="",
        )

    _approve(reviews, artifact.artifact_id)
    with pytest.raises(InvalidReviewTransitionError, match="approved"):
        _approve(reviews, artifact.artifact_id)


def test_derived_layers_require_approved_parents(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.tsv",
        content=b"gene\ts1\nTP53\t10\n",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.tsv"},
        media_type="text/tab-separated-values",
    )

    with pytest.raises(ReviewRequiredError):
        store.derive(
            project_id="project-1",
            layer=ArtifactLayer.NORMALIZED,
            filename="normalized.tsv",
            content=b"gene\ts1\nTP53\t1.0\n",
            parent_artifact_ids=(raw.artifact_id,),
            producer={"name": "normalizer", "version": "1.0", "parameters": {"method": "TMM"}},
            method_card_id="transcriptomics-tmm-v1",
            media_type="text/tab-separated-values",
        )

    _approve(reviews, raw.artifact_id)
    normalized = store.derive(
        project_id="project-1",
        layer=ArtifactLayer.NORMALIZED,
        filename="normalized.tsv",
        content=b"gene\ts1\nTP53\t1.0\n",
        parent_artifact_ids=(raw.artifact_id,),
        producer={"name": "normalizer", "version": "1.0", "parameters": {"method": "TMM"}},
        method_card_id="transcriptomics-tmm-v1",
        media_type="text/tab-separated-values",
    )
    assert normalized.layer is ArtifactLayer.NORMALIZED
    assert normalized.parent_artifact_ids == (raw.artifact_id,)

    with pytest.raises(ReviewRequiredError):
        store.derive(
            project_id="project-1",
            layer=ArtifactLayer.ANALYSIS,
            filename="de.json",
            content=b'{"gene":"TP53","effect":1.2}',
            parent_artifact_ids=(normalized.artifact_id,),
            producer={"name": "de-engine", "version": "1.0", "parameters": {"alpha": 0.05}},
            method_card_id="de-v1",
            media_type="application/json",
        )

    _approve(reviews, normalized.artifact_id)
    analysis = store.derive(
        project_id="project-1",
        layer=ArtifactLayer.ANALYSIS,
        filename="de.json",
        content=b'{"gene":"TP53","effect":1.2}',
        parent_artifact_ids=(normalized.artifact_id,),
        producer={"name": "de-engine", "version": "1.0", "parameters": {"alpha": 0.05}},
        method_card_id="de-v1",
        media_type="application/json",
    )
    assert analysis.layer is ArtifactLayer.ANALYSIS
    assert reviews.stage(analysis.artifact_id) is ReviewStage.SCREENING


def test_tampering_and_path_traversal_fail_closed(tmp_path: Path):
    store, _ = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.txt",
        content=b"trusted",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.txt"},
        media_type="text/plain",
    )
    Path(artifact.absolute_path).write_bytes(b"tampered")

    assert store.verify(artifact.artifact_id) is False

    with pytest.raises(PathBoundaryError):
        store.ingest_raw(
            project_id="project-1",
            source_id="ncbi-geo",
            filename="../../escape.txt",
            content=b"escape",
            stable_record_ids=("GSE2",),
            retrieval={"url": "https://example.invalid/escape.txt"},
            media_type="text/plain",
        )


def test_manifest_tampering_is_detected_against_review_ledger(tmp_path: Path):
    store, _ = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.txt",
        content=b"trusted",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.txt"},
        media_type="text/plain",
    )
    tampered = b"tampered"
    tampered_hash = store.sha256_bytes(tampered)
    Path(artifact.absolute_path).write_bytes(tampered)
    payload = json.loads(Path(artifact.manifest_path).read_text(encoding="utf-8"))
    payload["sha256"] = tampered_hash
    payload["size_bytes"] = len(tampered)
    Path(artifact.manifest_path).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )

    reloaded = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=ReviewLedger(tmp_path / "audit" / "reviews.jsonl"),
    )
    assert reloaded.verify(artifact.artifact_id) is False


def test_manifest_metadata_tampering_is_detected_against_review_ledger(tmp_path: Path):
    store, _ = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="licensed-market",
        filename="licensed.csv",
        content=b"licensed data",
        stable_record_ids=("vendor-record-1",),
        retrieval={"import": "local-authorized-file"},
        media_type="text/csv",
    )
    payload = json.loads(Path(artifact.manifest_path).read_text(encoding="utf-8"))
    payload["source_id"] = "ncbi-geo"
    payload["source_ids"] = ["ncbi-geo"]
    payload["license"]["scope"] = "public"
    payload["license"]["public_export_allowed"] = True
    Path(artifact.manifest_path).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )

    reloaded = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=ReviewLedger(tmp_path / "audit" / "reviews.jsonl"),
    )
    assert reloaded.verify(artifact.artifact_id) is False


def test_failed_review_registration_rolls_back_artifact_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    store, reviews = _store(tmp_path)

    def fail_review_registration(*_args, **_kwargs):
        raise RuntimeError("audit storage unavailable")

    monkeypatch.setattr(reviews, "require_review", fail_review_registration)

    with pytest.raises(RuntimeError, match="audit storage unavailable"):
        store.ingest_raw(
            project_id="project-1",
            source_id="ncbi-geo",
            filename="raw.txt",
            content=b"trusted",
            stable_record_ids=("GSE1",),
            retrieval={"url": "https://example.invalid/raw.txt"},
            media_type="text/plain",
        )

    assert not list((tmp_path / "workspace").glob("**/raw/*"))
    assert not list((tmp_path / "workspace").glob("**/manifests/*.json"))


def test_store_and_review_ledger_reload_from_disk(tmp_path: Path):
    store, reviews = _store(tmp_path)
    artifact = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.txt",
        content=b"trusted",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.txt"},
        media_type="text/plain",
    )
    _approve(reviews, artifact.artifact_id)

    reloaded_reviews = ReviewLedger(tmp_path / "audit" / "reviews.jsonl")
    reloaded_store = ThreeLayerArtifactStore(
        tmp_path / "workspace",
        registry=_registry(),
        reviews=reloaded_reviews,
    )

    assert reloaded_store.read_bytes(artifact.artifact_id) == b"trusted"
    assert reloaded_reviews.status(artifact.artifact_id) is ReviewStatus.APPROVED


def test_upstream_invalidation_invalidates_descendant_approvals(tmp_path: Path):
    store, reviews = _store(tmp_path)
    raw = store.ingest_raw(
        project_id="project-1",
        source_id="ncbi-geo",
        filename="raw.tsv",
        content=b"raw",
        stable_record_ids=("GSE1",),
        retrieval={"url": "https://example.invalid/raw.tsv"},
        media_type="text/plain",
    )
    _approve(reviews, raw.artifact_id)
    normalized = store.derive(
        project_id="project-1",
        layer=ArtifactLayer.NORMALIZED,
        filename="normalized.tsv",
        content=b"normalized",
        parent_artifact_ids=(raw.artifact_id,),
        producer={"name": "normalizer", "version": "1"},
        method_card_id="normalization-v1",
        media_type="text/plain",
    )
    _approve(reviews, normalized.artifact_id)
    analysis = store.derive(
        project_id="project-1",
        layer=ArtifactLayer.ANALYSIS,
        filename="analysis.json",
        content=b"{}",
        parent_artifact_ids=(normalized.artifact_id,),
        producer={"name": "analysis", "version": "1"},
        method_card_id="analysis-v1",
        media_type="application/json",
    )
    _approve(reviews, analysis.artifact_id)

    invalidated = store.invalidate_from(
        raw.artifact_id,
        actor="admin",
        reason="Source version or raw bytes changed.",
    )

    assert set(invalidated) == {
        raw.artifact_id,
        normalized.artifact_id,
        analysis.artifact_id,
    }
    assert reviews.status(normalized.artifact_id) is ReviewStatus.INVALIDATED
    assert reviews.status(analysis.artifact_id) is ReviewStatus.INVALIDATED


def test_http_reference_adapter_preserves_retrieval_evidence(tmp_path: Path):
    store, _ = _store(tmp_path)
    requests: list[tuple[str, dict[str, str]]] = []

    def fetch(url: str, headers: dict[str, str]):
        requests.append((url, headers))
        return (
            b"downloaded authoritative file",
            {
                "etag": '"abc123"',
                "last-modified": "Fri, 19 Jun 2026 00:00:00 GMT",
                "content-type": "application/octet-stream",
            },
        )

    adapter = HttpFileAdapter(
        source_id="ncbi-geo",
        store=store,
        fetch=fetch,
        user_agent="MedSCALE-Test/1.0",
    )
    artifact = adapter.download(
        project_id="project-1",
        url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
        filename="file.bin",
        stable_record_ids=("GSE12345",),
        query={"accession": "GSE12345"},
    )

    assert requests[0][1]["User-Agent"] == "MedSCALE-Test/1.0"
    assert artifact.retrieval["response_headers"]["etag"] == '"abc123"'
    assert artifact.retrieval["query"] == {"accession": "GSE12345"}
    assert store.read_bytes(artifact.artifact_id) == b"downloaded authoritative file"


def test_http_reference_adapter_blocks_failed_checksum_control(tmp_path: Path):
    store, _ = _store(tmp_path)

    adapter = HttpFileAdapter(
        source_id="ncbi-geo",
        store=store,
        fetch=lambda _url, _headers: (b"unexpected bytes", {}),
    )

    with pytest.raises(ArtifactIntegrityError, match="expected control checksum"):
        adapter.download(
            project_id="project-1",
            url="https://ftp.ncbi.nlm.nih.gov/geo/file.bin",
            filename="file.bin",
            stable_record_ids=("GSE12345",),
            query={"accession": "GSE12345"},
            expected_sha256="0" * 64,
        )

    assert not list((tmp_path / "workspace").glob("**/manifests/*.json"))
