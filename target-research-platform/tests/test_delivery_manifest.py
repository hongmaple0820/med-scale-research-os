from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZipFile

from src.output.delivery_packager import (
    audit_delivery_package,
    create_delivery_package,
    package_existing_delivery,
    write_delivery_manifest,
)


def _write_delivery_files(
    output: Path,
    slug: str = "CDK4_breast_cancer",
    *,
    include_agent_reviews: bool = False,
    include_memory_seed: bool = False,
    include_learning_candidate: bool = False,
) -> dict:
    manuscripts = output / "manuscripts"
    figures = manuscripts / "figures"
    manuscripts.mkdir(parents=True, exist_ok=True)
    figures.mkdir(parents=True, exist_ok=True)
    paths = {
        "markdown": manuscripts / f"{slug}_manuscript.md",
        "zhongliu": manuscripts / f"{slug}_manuscript_zhongliu.md",
        "metadata": manuscripts / f"{slug}_manuscript_meta.json",
        "quality": manuscripts / f"{slug}_manuscript_quality.json",
        "fact_check": manuscripts / f"{slug}_manuscript_fact_check.json",
        "literature_evidence_pack": manuscripts / f"{slug}_literature_evidence_pack.json",
        "agent_review_tasks": manuscripts / f"{slug}_review_tasks.json",
        "agent_reviews": manuscripts / f"{slug}_agent_reviews.json",
        "delivery_manifest": manuscripts / f"{slug}_delivery_manifest.json",
        "docx": manuscripts / f"{slug}_manuscript.docx",
        "figures_dir": figures,
        "memory_seed_record": manuscripts / f"{slug}_memory_seed.json",
        "memory_seed_summary": manuscripts / f"{slug}_memory_summary.md",
        "learning_candidate_record": manuscripts / f"{slug}_memory_learning_candidate.json",
        "learning_candidate_summary": manuscripts / f"{slug}_memory_learning_candidate.md",
    }
    paths["markdown"].write_text("# manuscript\n\n![Figure 1](figures/figure1.png)\n\nPMID 12345678", encoding="utf-8")
    paths["zhongliu"].write_text("# zhongliu", encoding="utf-8")
    paths["docx"].write_bytes(b"docx" * 400)
    figure = figures / "figure1.png"
    figure.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 256)
    paths["metadata"].write_text(json.dumps({
        "target": "CDK4",
        "disease": "breast cancer",
        "data_sources": ["GTEx", "PubMed"],
        "figures": [{"id": "fig1", "path": str(figure), "relative": "figures/figure1.png"}],
        "literature_reviews": [{"source": "agent_cache"}],
        "literature_review_sources": {"agent_cache": 1},
        "literature_enrichment": {"sources": ["pubmed_efetch"]},
        "usage_envelopes": [{
            "schema": "medscale.usage_envelope.v1",
            "usage_id": "MSU-test-delivery",
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "medical_lane": "literature",
            "source_role": "agent_cache_review",
            "target": "CDK4",
            "disease": "breast cancer",
            "evidence_ref": "pmid:12345678",
            "usage": {"input_tokens": 300, "output_tokens": 50},
        }],
    }, ensure_ascii=False), encoding="utf-8")
    paths["quality"].write_text(json.dumps({"passed": True, "score": 95, "grade": "A", "errors": 0, "warnings": 1}), encoding="utf-8")
    paths["fact_check"].write_text(json.dumps({"passed": True, "score": 100, "errors": 0, "warnings": 0}), encoding="utf-8")
    paths["literature_evidence_pack"].write_text(json.dumps({
        "pack_version": "1.0",
        "paper_count": 1,
        "papers": [{"pmid": "12345678", "mesh_terms": ["Breast Neoplasms"], "citation_count": 10}],
    }, ensure_ascii=False), encoding="utf-8")
    paths["agent_review_tasks"].write_text(json.dumps({
        "target": "CDK4",
        "disease_zh": "breast cancer",
        "task_type": "literature_deep_review",
        "papers": [{"index": 1, "pmid": "12345678"}],
    }, ensure_ascii=False), encoding="utf-8")
    if include_agent_reviews:
        paths["agent_reviews"].write_text(json.dumps({
            "target": "CDK4",
            "disease_zh": "breast cancer",
            "reviews": [{"index": 1, "pmid": "12345678", "commentary_zh": "Agent review"}],
        }, ensure_ascii=False), encoding="utf-8")
    if include_memory_seed:
        paths["memory_seed_summary"].write_text("# memory summary", encoding="utf-8")
        paths["memory_seed_record"].write_text(json.dumps({
            "generated_at": "2026-06-14T12:00:00Z",
            "provider": "gbrain",
            "summary_path": str(paths["memory_seed_summary"]),
            "source_files": [str(paths["markdown"]), str(paths["delivery_manifest"])],
            "staged_files": [str(paths["markdown"]), str(paths["delivery_manifest"])],
            "missing_roles": [],
            "warnings": [],
            "import_ok": True,
        }, ensure_ascii=False), encoding="utf-8")
    if include_learning_candidate:
        candidate_dir = output.parent / ".scale" / "memory" / "learning-candidates"
        candidate_dir.mkdir(parents=True, exist_ok=True)
        candidate_json = candidate_dir / f"MLC-medical-{slug.replace('_', '-')}.json"
        candidate_md = candidate_dir / f"MLC-medical-{slug.replace('_', '-')}.md"
        candidate_json.write_text('{"candidate":"ok"}', encoding="utf-8")
        candidate_md.write_text("# candidate", encoding="utf-8")
        paths["learning_candidate_summary"].write_text("# learning candidate", encoding="utf-8")
        paths["learning_candidate_record"].write_text(json.dumps({
            "generated_at": "2026-06-14T12:05:00Z",
            "candidate_id": f"MLC-medical-{slug.replace('_', '-')}",
            "candidate_path": str(candidate_json),
            "candidate_markdown_path": str(candidate_md),
            "summary_path": str(paths["learning_candidate_summary"]),
            "recommended_action": "review-for-knowledge-base",
            "promotable": True,
            "brain_ingest_ok": True,
            "brain_node_id": f"MEM-MLC-medical-{slug.replace('_', '-')}",
            "warnings": [],
        }, ensure_ascii=False), encoding="utf-8")
    return {key: str(value) for key, value in paths.items()}


def test_delivery_manifest_contains_files_hashes_and_review_todo(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "data_sources": ["GTEx", "PubMed"],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "quality_gate": {"passed": True, "score": 95, "grade": "A", "errors": 0, "warnings": 1},
        "fact_check": {"passed": True, "score": 100, "errors": 0, "warnings": 0},
    }

    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    assert manifest["target"] == "CDK4"
    assert manifest["quality_gate"]["grade"] == "A"
    assert manifest["fact_check"]["passed"] is True
    assert manifest["human_review_todo"]
    assert all(
        item.get("sha256")
        for item in manifest["files"]
        if item.get("role") != "delivery_manifest"
    )
    assert any(item["role"] == "literature_evidence_pack" for item in manifest["files"])
    assert any(item["role"] == "agent_review_tasks" for item in manifest["files"])
    assert manifest["usage"]["summary"]["total_records"] == 1
    assert manifest["usage"]["summary"]["total_tokens"] == 350


def test_delivery_manifest_combines_stage_and_literature_data_sources(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "data_sources": ["GTEx", "PubMed"],
        "literature_reviews": {
            "count": 1,
            "source_counts": {"agent_cache": 1},
            "enrichment": {"sources": ["pubmed_efetch", "openalex"]},
        },
        "quality_gate": {"passed": True},
        "fact_check": {"passed": True},
    }

    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    assert manifest["data_sources"] == ["GTEx", "PubMed", "pubmed_efetch", "openalex"]


def test_delivery_manifest_adds_dynamic_review_todo_for_missing_enrichment(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {
            "count": 1,
            "source_counts": {"rule_based": 1},
            "enrichment": {
                "sources": [],
                "pubmed_efetch": False,
                "openalex_used": False,
                "mesh_count": 0,
                "citation_count_available": 0,
            },
        },
        "quality_gate": {
            "passed": True,
            "score": 95,
            "grade": "B",
            "errors": 0,
            "warnings": 1,
            "checks": [{
                "id": "literature.enrichment_coverage",
                "passed": False,
                "severity": "warning",
                "message": "Literature metadata should include PubMed MeSH or citation enrichment for Beta delivery.",
            }],
        },
        "fact_check": {"passed": True, "score": 100, "errors": 0, "warnings": 0},
    }

    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    assert manifest["quality_findings"][0]["id"] == "literature.enrichment_coverage"
    todos = " ".join(manifest["human_review_todo"])
    assert "Re-run PubMed/OpenAlex enrichment" in todos
    assert "Upgrade rule-based literature reviews" in todos


def test_delivery_package_zip_contains_manifest_readme_and_artifacts(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(
        output,
        include_agent_reviews=True,
        include_memory_seed=True,
        include_learning_candidate=True,
    )
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "quality_gate": {"passed": True},
        "fact_check": {"passed": True},
    }
    write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    zip_path = create_delivery_package(result, output / "deliveries" / "CDK4_breast_cancer_delivery.zip", base_dir=output)

    assert Path(zip_path).exists()
    with ZipFile(zip_path) as zf:
        names = set(zf.namelist())
    assert "README_DELIVERY.md" in names
    assert any(name.endswith("_delivery_manifest.json") for name in names)
    assert any(name.endswith("_literature_evidence_pack.json") for name in names)
    assert any(name.endswith("_review_tasks.json") for name in names)
    assert any(name.endswith("_agent_reviews.json") for name in names)
    assert any(name.endswith("_memory_seed.json") for name in names)
    assert any(name.endswith("_memory_summary.md") for name in names)
    assert any(name.endswith("_memory_learning_candidate.json") for name in names)
    assert any(name.endswith("_memory_learning_candidate.md") for name in names)
    assert any(name.endswith("_manuscript.md") for name in names)
    assert any(name.endswith(".png") for name in names)


def test_delivery_package_audit_passes_for_packaged_archive(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "quality_gate": {"passed": True},
        "fact_check": {"passed": True},
    }
    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    zip_path = create_delivery_package(
        result,
        output / "deliveries" / "CDK4_breast_cancer_delivery.zip",
        base_dir=output,
    )
    audit = audit_delivery_package(zip_path, manifest)

    assert audit["passed"] is True
    assert audit["readme_present"] is True
    assert audit["manifest_present"] is True
    assert audit["image_refs_checked"] == 1
    assert audit["broken_image_refs"] == []


def test_delivery_manifest_only_includes_registered_figures(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    unrelated = Path(paths["figures_dir"]) / "other_target.png"
    unrelated.write_bytes(b"\x89PNG\r\n\x1a\n" + b"1" * 128)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "quality_gate": {"passed": True},
        "fact_check": {"passed": True},
    }

    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    relative_paths = {item["relative_path"] for item in manifest["files"]}
    assert "manuscripts/figures/figure1.png" in relative_paths
    assert "manuscripts/figures/other_target.png" not in relative_paths


def test_delivery_package_readme_summarizes_quality_and_evidence(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output, include_memory_seed=True, include_learning_candidate=True)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {
            "count": 1,
            "source_counts": {"agent_cache": 1},
            "enrichment": {
                "sources": ["pubmed_efetch"],
                "pubmed_efetch": True,
                "mesh_count": 1,
                "citation_count_available": 0,
            },
        },
        "quality_gate": {"passed": True, "score": 95, "grade": "B", "errors": 0, "warnings": 1},
        "fact_check": {"passed": True, "score": 100, "errors": 0, "warnings": 0},
    }
    write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    zip_path = create_delivery_package(result, output / "deliveries" / "CDK4_breast_cancer_delivery.zip", base_dir=output)

    with ZipFile(zip_path) as zf:
        readme = zf.read("README_DELIVERY.md").decode("utf-8")
    assert "Quality gate: PASS; grade=B" in readme
    assert "Fact check: PASS" in readme
    assert "Agent cache reviews: 1" in readme
    assert "Enrichment sources: pubmed_efetch" in readme
    assert "Memory seed provider: gbrain" in readme
    assert "Learning recommendation: review-for-knowledge-base" in readme


def test_delivery_manifest_includes_memory_seed_and_learning_candidate_sections(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output, include_memory_seed=True, include_learning_candidate=True)
    result = {
        "target": "CDK4",
        "disease": "breast cancer",
        "paths": paths,
        "figures": [{"id": "fig1", "path": str(Path(paths["figures_dir"]) / "figure1.png")}],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "quality_gate": {"passed": True},
        "fact_check": {"passed": True},
    }

    manifest = write_delivery_manifest(result, paths["delivery_manifest"], base_dir=output)

    assert manifest["memory_seed"]["provider"] == "gbrain"
    assert manifest["memory_seed"]["record_ready"] is True
    assert manifest["memory_seed"]["summary_ready"] is True
    assert manifest["learning_candidate"]["candidate_id"] == "MLC-medical-CDK4-breast-cancer"
    assert manifest["learning_candidate"]["promotable"] is True
    assert manifest["learning_candidate"]["brain_ingest_ok"] is True
    roles = {item["role"] for item in manifest["files"]}
    assert "memory_seed_record" in roles
    assert "memory_seed_summary" in roles
    assert "learning_candidate_record" in roles
    assert "learning_candidate_summary" in roles


def test_package_existing_delivery_fails_when_required_file_missing(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    Path(paths["fact_check"]).unlink()

    result = package_existing_delivery(output, "CDK4", "breast cancer")

    assert result["success"] is False
    assert "fact_check" in result["missing"]


def test_package_existing_delivery_creates_zip(tmp_path: Path):
    output = tmp_path / "output"
    _write_delivery_files(output)

    result = package_existing_delivery(output, "CDK4", "breast cancer")

    assert result["success"] is True
    assert Path(result["delivery_package"]).exists()
    assert Path(result["delivery_manifest"]).exists()
    assert result["package_audit"]["passed"] is True


def test_package_existing_delivery_fails_when_markdown_figure_reference_is_broken(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    Path(paths["markdown"]).write_text(
        "# manuscript\n\n![Missing Figure](figures/missing_figure.png)\n",
        encoding="utf-8",
    )

    result = package_existing_delivery(output, "CDK4", "breast cancer")

    assert result["success"] is False
    assert result["package_audit"]["passed"] is False
    assert result["package_audit"]["broken_image_refs"][0]["resolved_path"] == "manuscripts/figures/missing_figure.png"
    assert "Delivery package audit failed" in result["error"]


def test_package_existing_delivery_derives_review_sources_from_reviews_when_summary_missing(tmp_path: Path):
    output = tmp_path / "output"
    paths = _write_delivery_files(output)
    metadata_path = Path(paths["metadata"])
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    payload.pop("literature_review_sources", None)
    payload["literature_reviews"] = [
        {"source": "agent_cache"},
        {"source": "agent_cache"},
        {"source": "rule_based"},
    ]
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    result = package_existing_delivery(output, "CDK4", "breast cancer")

    assert result["success"] is True
    assert result["literature_reviews"]["source_counts"] == {
        "agent_cache": 2,
        "rule_based": 1,
    }
