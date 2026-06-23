from __future__ import annotations

import json
from pathlib import Path

from src.output.manuscript_quality import validate_manuscript_delivery


def _write_good_delivery(tmp_path: Path) -> dict:
    manuscript = tmp_path / "CDK4_breast_cancer_manuscript.md"
    zhongliu = tmp_path / "CDK4_breast_cancer_manuscript_zhongliu.md"
    meta = tmp_path / "CDK4_breast_cancer_manuscript_meta.json"
    fact_check = tmp_path / "CDK4_breast_cancer_manuscript_fact_check.json"
    manifest = tmp_path / "CDK4_breast_cancer_delivery_manifest.json"
    figures = tmp_path / "figures"
    figures.mkdir()
    fig = figures / "figure1.png"
    fig.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 256)
    manuscript.write_text(
        "\n".join(
            [
                "# Title",
                "## 摘要",
                "## 1 引言",
                "## 2 材料与方法",
                "## 3 结果",
                "### 3.6.1 逐篇文献深度解读",
                "## 4 讨论",
                "## 5 结论",
                "## 参考文献",
            ]
        )
        + "\n"
        + "图1 PMID 12345678 0.527 PubMed GTEx 投稿前需专家审校。"
        + ("正文。" * 1600),
        encoding="utf-8",
    )
    zhongliu.write_text(
        "# 中华肿瘤杂志\n\n**【摘要】** 正文\n\n利益冲突声明：待确认。\n"
        + ("投稿格式正文。" * 180),
        encoding="utf-8",
    )
    meta.write_text(json.dumps({
        "target": "CDK4",
        "disease": "breast cancer",
        "data_sources": ["GTEx", "PubMed"],
        "literature_enrichment": {"sources": ["pubmed_efetch"]},
        "references": [
            {"pmid": "12345678", "citation_zh": "A. CDK4 study[J]. Journal, 2024."},
            {"pmid": "12345679", "citation_zh": "B. CDK4 study[J]. Journal, 2024."},
            {"pmid": "12345680", "citation_zh": "C. CDK4 study[J]. Journal, 2024."},
            {"pmid": "12345681", "citation_zh": "D. CDK4 study[J]. Journal, 2024."},
            {"pmid": "12345682", "citation_zh": "E. CDK4 study[J]. Journal, 2024."},
        ],
    }, ensure_ascii=False), encoding="utf-8")
    fact_payload = {
        "passed": True,
        "score": 100,
        "errors": 0,
        "warnings": 0,
        "claims_checked": 8,
        "unverified_claims": [],
        "numeric_mismatches": [],
    }
    fact_check.write_text(json.dumps(fact_payload, ensure_ascii=False), encoding="utf-8")
    manifest.write_text(json.dumps({
        "files": [{"role": "manuscript_markdown", "path": str(manuscript), "sha256": "abc"}],
        "disclaimer": "draft only",
    }, ensure_ascii=False), encoding="utf-8")
    return {
        "success": True,
        "paths": {
            "markdown": str(manuscript),
            "zhongliu": str(zhongliu),
            "metadata": str(meta),
            "fact_check": str(fact_check),
            "delivery_manifest": str(manifest),
            "figures_dir": str(figures),
        },
        "figures": [{"id": "fig1", "path": str(fig)}],
        "literature_reviews": {"count": 1, "source_counts": {"agent_cache": 1}},
        "char_count": manuscript.stat().st_size,
        "fact_check": fact_payload,
        "disclaimer": "投稿前需专家审校。",
    }


def test_validate_manuscript_delivery_passes_for_complete_artifacts(tmp_path: Path):
    quality = validate_manuscript_delivery(_write_good_delivery(tmp_path))

    assert quality["passed"] is True
    assert quality["errors"] == 0
    assert quality["score"] >= 80
    assert quality["grade"] in {"A", "B", "C"}


def test_validate_manuscript_delivery_fails_on_boundary_regressions(tmp_path: Path):
    delivery = _write_good_delivery(tmp_path)
    Path(delivery["paths"]["markdown"]).write_text("LLM：None\n短稿", encoding="utf-8")
    Path(delivery["paths"]["zhongliu"]).write_text(
        "国家自然科学基金；所有作者声明不存在利益冲突；免予伦理审查。",
        encoding="utf-8",
    )

    quality = validate_manuscript_delivery(delivery)

    assert quality["passed"] is False
    failed = {check["id"] for check in quality["checks"] if not check["passed"]}
    assert "content.no_llm_none" in failed
    assert "journal.no_unverified_claims" in failed
    assert "structure.required_sections" in failed


def test_validate_manuscript_delivery_fails_when_fact_check_fails(tmp_path: Path):
    delivery = _write_good_delivery(tmp_path)
    delivery["fact_check"] = {"passed": False, "score": 60, "errors": 1, "warnings": 0}
    Path(delivery["paths"]["fact_check"]).write_text(json.dumps(delivery["fact_check"]), encoding="utf-8")

    quality = validate_manuscript_delivery(delivery)

    assert quality["passed"] is False
    assert quality["grade"] == "D"
    failed = {check["id"] for check in quality["checks"] if not check["passed"]}
    assert "fact_check.passed" in failed


def test_validate_manuscript_delivery_warns_when_literature_enrichment_missing(tmp_path: Path):
    delivery = _write_good_delivery(tmp_path)
    meta_path = Path(delivery["paths"]["metadata"])
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    metadata["literature_enrichment"] = {
        "sources": [],
        "pubmed_efetch": False,
        "openalex_used": False,
        "aminer_used": False,
        "mesh_count": 0,
        "citation_count_available": 0,
    }
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")

    quality = validate_manuscript_delivery(delivery)

    assert quality["passed"] is True
    assert quality["grade"] in {"B", "C"}
    assert quality["score"] < 100
    failed_warnings = {
        check["id"]
        for check in quality["checks"]
        if check["severity"] == "warning" and not check["passed"]
    }
    assert "literature.enrichment_coverage" in failed_warnings
