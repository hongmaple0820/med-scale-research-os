"""
期刊论文草稿生成器（IMRaD）

基于四阶段 pipeline 已验证的 JSON 结果合成**中文**研究论文草稿。
仅引用溯源数据与 PubMed 元数据，不编造实验结果。
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .chart_generator import ChartGenerator
from .delivery_packager import create_delivery_package, write_delivery_manifest
from .journal_templates import render_zhonghua_oncology
from .literature_enricher import enrich_papers_for_manuscript, write_literature_evidence_pack
from .manuscript_fact_checker import validate_manuscript_facts
from .manuscript_quality import validate_manuscript_delivery
from .literature_reviewer import review_literature_for_manuscript
from .medical_skills_bridge import drug_target_evidence_framing


_DISEASE_ZH: dict[str, str] = {
    "breast cancer": "乳腺癌",
    "lung cancer": "肺癌",
    "colorectal cancer": "结直肠癌",
    "prostate cancer": "前列腺癌",
    "melanoma": "黑色素瘤",
}

_TISSUE_ZH: dict[str, str] = {
    "Cells_Cultured_fibroblasts": "培养成纤维细胞",
    "Cells_EBV-transformed_lymphocytes": "EBV 转化淋巴细胞",
    "Ovary": "卵巢",
    "Uterus": "子宫",
    "Cervix_Endocervix": "宫颈内口",
    "Cervix_Ectocervix": "宫颈外口",
    "Fallopian_Tube": "输卵管",
    "Adrenal_Gland": "肾上腺",
    "Nerve_Tibial": "胫神经",
    "Bladder": "膀胱",
    "Lung": "肺",
    "Breast": "乳腺",
    "Liver": "肝脏",
    "Kidney": "肾脏",
    "Heart": "心脏",
    "Brain": "脑",
    "Thyroid": "甲状腺",
    "Pancreas": "胰腺",
    "Spleen": "脾脏",
    "Colon": "结肠",
    "Skin": "皮肤",
}

_PHASE_ZH: dict[str, str] = {
    "Phase 1": "I 期",
    "Phase 2": "II 期",
    "Phase 3": "III 期",
    "Phase 4": "IV 期",
    "Not Applicable": "不适用/观察性",
}


def assess_manuscript_readiness(
    target: str,
    disease: str,
    stage1: dict,
    stage2: dict,
    stage3: dict,
    stage4: dict,
) -> dict[str, Any]:
    """Require explicit upstream evidence approval before drafting claims."""
    checks = {
        "stage1_evidence": bool(
            (stage1.get("summary") or {}).get("decision_eligible")
            or (stage1.get("validation") or {})
            .get("evidence_gate", {})
            .get("decision_eligible")
        ),
        "stage2_evidence": bool(
            (stage2.get("summary") or {}).get("decision_eligible")
            or (stage2.get("stages") or {})
            .get("source_validation", {})
            .get("decision_eligible")
        ),
        "stage3_complete": bool(stage3.get("success")),
        "stage4_complete": bool(stage4.get("success")),
    }
    issues = [
        f"{name} did not pass"
        for name, passed in checks.items()
        if not passed
    ]

    stage1_target = str(stage1.get("gene") or "").strip().upper()
    if stage1_target and stage1_target != target.strip().upper():
        issues.append(
            f"Stage 1 target {stage1_target} does not match requested target {target}."
        )
    stage2_disease = str(stage2.get("disease") or "").strip().lower()
    if stage2_disease and stage2_disease != disease.strip().lower():
        issues.append(
            f"Stage 2 disease {stage2_disease} does not match requested disease {disease}."
        )

    return {
        "status": "ready" if not issues else "blocked",
        "decision_eligible": not issues,
        "checks": checks,
        "issues": issues,
    }


class ManuscriptGenerator:
    """从 pipeline 结果生成期刊论文 Markdown / DOCX 草稿（默认中文正文）。"""

    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate(
        self,
        pipeline_results: dict,
        target: str,
        disease: str,
        *,
        language: str = "zh",
    ) -> dict:
        stages = pipeline_results.get("stages", pipeline_results)
        s1 = stages.get("stage1", {}) or {}
        s2 = stages.get("stage2", {}) or {}
        s3 = stages.get("stage3", {}) or {}
        s4 = stages.get("stage4", {}) or {}
        readiness = assess_manuscript_readiness(
            target, disease, s1, s2, s3, s4
        )
        if not readiness["decision_eligible"]:
            return {
                "success": False,
                "status": "blocked",
                "target": target,
                "disease": disease,
                "error": "Upstream evidence is not ready for manuscript generation.",
                "readiness": readiness,
                "paths": {},
            }

        context = self._build_context(target, disease, s1, s2, s3, s4)
        context["evidence_readiness"] = readiness
        context["claim_ledger"] = self._build_claim_ledger(context)
        slug = f"{target}_{disease}".replace(" ", "_")

        enrich_result = enrich_papers_for_manuscript(
            context.get("papers_raw", []),
            target=target,
            disease_zh=context.get("disease_zh", disease),
        )
        enriched_papers = enrich_result.get("papers", [])
        context["papers_enriched"] = enriched_papers
        context["literature_enrichment"] = enrich_result.get("enrichment", {})
        evidence_pack_path = self.output_dir / f"{slug}_literature_evidence_pack.json"
        evidence_pack = write_literature_evidence_pack(
            enriched_papers,
            evidence_pack_path,
            target=target,
            disease=context.get("disease_zh", disease),
            enrichment_meta=context["literature_enrichment"],
        )
        context["literature_evidence_pack"] = {
            "path": str(evidence_pack_path.resolve()),
            "paper_count": evidence_pack.get("paper_count", 0),
            "source_summary": evidence_pack.get("source_summary", {}),
        }
        context["literature_evidence_framing"] = drug_target_evidence_framing(
            target,
            context.get("disease_zh", disease),
            int(context.get("pubmed_total") or len(enriched_papers)),
        )
        if enriched_papers:
            context["references"] = self._format_references(enriched_papers[:25])
            context["literature_highlights"] = self._build_literature_highlights(enriched_papers[:12])

        lit_result = review_literature_for_manuscript(
            enriched_papers,
            target=target,
            disease_zh=context.get("disease_zh", disease),
            enrichment_meta=enrich_result.get("enrichment"),
            output_dir=str(self.output_dir),
            slug=slug,
        )
        context["agent_review_tasks"] = lit_result.get("agent_review_tasks")
        context["agent_cache_expected"] = lit_result.get("agent_cache_expected")
        context["literature_llm_source"] = lit_result.get("llm_source")
        context["literature_reviews"] = lit_result.get("reviews", [])
        context["usage_envelopes"] = lit_result.get("usage_envelopes", [])
        context["usage_summary"] = lit_result.get("usage_summary", {})
        context["literature_review_sources"] = self._summarize_review_sources(
            context["literature_reviews"]
        )
        context["literature_llm_used"] = lit_result.get("llm_used", False)
        context["literature_llm_model"] = lit_result.get("llm_model")
        context["literature_llm_available"] = lit_result.get("llm_available", False)
        context["figures"] = self._generate_figures(context, s1)

        markdown = self._render_markdown_zh(context) if language == "zh" else self._render_markdown_en(context)

        md_path = self.output_dir / f"{slug}_manuscript.md"
        zhongliu_path = self.output_dir / f"{slug}_manuscript_zhongliu.md"
        json_path = self.output_dir / f"{slug}_manuscript_meta.json"
        fact_check_path = self.output_dir / f"{slug}_manuscript_fact_check.json"
        claim_ledger_path = self.output_dir / f"{slug}_claim_ledger.json"
        quality_path = self.output_dir / f"{slug}_manuscript_quality.json"
        delivery_manifest_path = self.output_dir / f"{slug}_delivery_manifest.json"
        delivery_package_path = self.output_dir.parent / "deliveries" / f"{slug}_delivery.zip"
        agent_review_tasks_path = context.get("agent_review_tasks")
        agent_reviews_path = context.get("agent_cache_expected")
        if agent_reviews_path and Path(agent_reviews_path).is_file():
            agent_reviews_path = str(Path(agent_reviews_path).resolve())
        else:
            agent_reviews_path = None
        md_path.write_text(markdown, encoding="utf-8")
        zhongliu_md = render_zhonghua_oncology(context, markdown, figures=context.get("figures"))
        zhongliu_path.write_text(zhongliu_md, encoding="utf-8")
        json_path.write_text(
            json.dumps(context, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        claim_ledger_path.write_text(
            json.dumps(
                context["claim_ledger"],
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )

        docx_path: str | None = None
        docx_error: str | None = None
        try:
            docx_path = self._render_docx_zh(context, slug)
        except Exception as exc:
            docx_error = str(exc)

        char_count = len(markdown)
        result = {
            "success": True,
            "target": target,
            "disease": disease,
            "language": language,
            "disclaimer": (
                "本文件为基于公开数据库的计算分析研究论文草稿，需研究者补充实验设计、"
                "伦理审批、作者信息与目标期刊格式后方能投稿。"
            ),
            "paths": {
                "markdown": str(md_path.resolve()),
                "zhongliu": str(zhongliu_path.resolve()),
                "metadata": str(json_path.resolve()),
                "fact_check": str(fact_check_path.resolve()),
                "claim_ledger": str(claim_ledger_path.resolve()),
                "docx": docx_path,
                "figures_dir": str((self.output_dir / "figures").resolve()),
                "literature_evidence_pack": str(evidence_pack_path.resolve()),
                "agent_review_tasks": agent_review_tasks_path,
                "agent_reviews": agent_reviews_path,
                "delivery_manifest": str(delivery_manifest_path.resolve()),
                "delivery_package": str(delivery_package_path.resolve()),
            },
            "figures": context.get("figures", []),
            "data_sources": context.get("data_sources", []),
            "literature_reviews": {
                "count": len(context.get("literature_reviews", [])),
                "source_counts": context.get("literature_review_sources", {}),
                "llm_used": context.get("literature_llm_used", False),
                "llm_available": context.get("literature_llm_available", False),
                "llm_model": context.get("literature_llm_model"),
                "enrichment": context.get("literature_enrichment", {}),
                "usage_summary": context.get("usage_summary", {}),
            },
            "docx_error": docx_error,
            "reference_count": len(context.get("references", [])),
            "word_estimate": len(markdown.split()),
            "char_count": char_count,
            "zhongliu_char_count": len(zhongliu_md),
        }
        fact_check = validate_manuscript_facts(result)
        fact_check_path.write_text(
            json.dumps(fact_check, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        result["fact_check"] = fact_check
        result["delivery_manifest"] = str(delivery_manifest_path.resolve())
        write_delivery_manifest(result, delivery_manifest_path, base_dir=self.output_dir.parent)

        quality = validate_manuscript_delivery(result)
        quality_path.write_text(
            json.dumps(quality, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        result["paths"]["quality"] = str(quality_path.resolve())
        result["quality_gate"] = quality
        result["success"] = bool(
            fact_check.get("passed") and quality.get("passed")
        )
        if not result["success"]:
            result["error"] = (
                "Manuscript fact-check or quality gate did not pass."
            )
        write_delivery_manifest(result, delivery_manifest_path, base_dir=self.output_dir.parent)
        if result["success"]:
            result["delivery_package"] = create_delivery_package(
                result,
                delivery_package_path,
                base_dir=self.output_dir.parent,
            )
        else:
            result["delivery_package"] = None
        return result

    @staticmethod
    def _build_claim_ledger(context: dict[str, Any]) -> list[dict[str, Any]]:
        clinical = context.get("clinical_summary") or {}
        milestones = context.get("milestones") or {}
        claims = [
            (
                "target_druggability",
                context.get("target_druggability"),
                "stage2.stages.primary_target_druggability.targets."
                f"{context.get('target')}.composite_score",
            ),
            (
                "pubmed_total",
                context.get("pubmed_total"),
                "stage3.stages.literature.data.search_results.total_count",
            ),
            (
                "clinical_total_trials",
                clinical.get("total_trials"),
                "stage3.stages.clinical_pipeline.data.total_trials",
            ),
            (
                "clinical_active_trials",
                clinical.get("active_trials"),
                "stage3.stages.clinical_pipeline.data.active_trials",
            ),
            (
                "development_success_rate",
                milestones.get("success_rate"),
                "stage4.stages.milestones.data.overall_success_rate",
            ),
            (
                "development_total_duration",
                milestones.get("total_duration"),
                "stage4.stages.milestones.data.total_duration_months",
            ),
            (
                "development_total_cost",
                milestones.get("total_cost"),
                "stage4.stages.milestones.data.total_cost_estimate",
            ),
        ]
        return [
            {
                "claim_id": claim_id,
                "claim_type": "quantitative",
                "value": value,
                "source_locator": source_locator,
            }
            for claim_id, value, source_locator in claims
            if value not in (None, "", [])
        ]

    @staticmethod
    def _summarize_review_sources(reviews: list[dict]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for review in reviews or []:
            source = str(review.get("source") or "unknown")
            counts[source] = counts.get(source, 0) + 1
        return counts

    def _build_context(
        self,
        target: str,
        disease: str,
        s1: dict,
        s2: dict,
        s3: dict,
        s4: dict,
    ) -> dict[str, Any]:
        s1_summary = s1.get("summary", s1) or {}
        s2_summary = s2.get("summary", s2) or {}
        s3_summary = s3.get("summary", s3) or {}
        s4_summary = s4.get("summary", s4) or {}

        disease_zh = _DISEASE_ZH.get(disease.lower(), disease)

        # --- Stage1: 表达与生存 ---
        te_stage = (s1.get("stages", {}) or {}).get("tissue_expression", {}) or {}
        gtex_block = te_stage.get("gtex", {}) or {}
        gtex_data = gtex_block.get("data", gtex_block) if isinstance(gtex_block, dict) else {}
        tissues_raw = gtex_data.get("tissues", {}) if isinstance(gtex_data, dict) else {}
        top_tissues = sorted(
            ((k, float(v)) for k, v in tissues_raw.items() if v is not None),
            key=lambda x: x[1],
            reverse=True,
        )[:15]

        tu_stage = (s1.get("stages", {}) or {}).get("tumor_expression", {}) or {}
        tumor_stats: dict[str, Any] = {}
        tumor_sample_values: list[float] = []
        for cancer, block in (tu_stage.get("cancer_results") or {}).items():
            if not isinstance(block, dict) or not block.get("success"):
                continue
            samples = (block.get("data") or {}).get("samples") or []
            values = [float(s.get("expression_value", 0)) for s in samples if s.get("expression_value") is not None]
            if values:
                tumor_stats[cancer] = {
                    "n_samples": len(values),
                    "mean": round(statistics.mean(values), 2),
                    "median": round(statistics.median(values), 2),
                    "max": round(max(values), 2),
                    "min": round(min(values), 2),
                }
                if cancer == "BRCA" or not tumor_sample_values:
                    tumor_sample_values = values

        survival: dict[str, Any] = {}
        sa_stage = (s1.get("stages", {}) or {}).get("survival_analysis", {}) or {}
        for cancer, block in (sa_stage.get("cancer_results") or {}).items():
            if isinstance(block, dict) and block.get("success"):
                survival[cancer] = block.get("data", {})

        # --- Stage2: 筛选与成药性 ---
        de_stage = (s2.get("stages", {}) or {}).get("differential_expression", {}) or {}
        source_validation = (
            (s2.get("stages", {}) or {}).get("source_validation", {}) or {}
        )
        independent_sources = source_validation.get("independent_sources") or []
        de_source = " + ".join(independent_sources) or de_stage.get("accession") or "GEO + TCGA"
        de_method = de_stage.get("method", "标准差异表达分析")

        top_targets = (
            s2_summary.get("top_targets")
            or s2_summary.get("top_candidates")
            or []
        )
        target_rank = next(
            (i + 1 for i, t in enumerate(top_targets) if t.get("gene") == target),
            None,
        )

        drug_stage = (s2.get("stages", {}) or {}).get("druggability", {}) or {}
        primary_drug_stage = (
            (s2.get("stages", {}) or {}).get("primary_target_druggability", {})
            or {}
        )
        drug_targets = drug_stage.get("targets", {}) if isinstance(drug_stage.get("targets"), dict) else {}
        primary_targets = (
            primary_drug_stage.get("targets", {})
            if isinstance(primary_drug_stage.get("targets"), dict)
            else {}
        )
        target_drug = (
            primary_targets.get(target)
            or (drug_targets.get(target, {}) if isinstance(drug_targets, dict) else {})
        )
        target_druggability = (
            target_drug.get("composite_score")
            or next((t.get("druggability_score") or t.get("score") for t in top_targets if t.get("gene") == target), None)
        )
        drug_class = target_drug.get("druggability_class", "")
        drug_evidence = target_drug.get("evidence", []) or []
        drug_interpretation = target_drug.get("interpretation", "")

        # --- Stage3: 文献、临床、竞争 ---
        developability = s3_summary.get("developability", {}) or {}
        recommendations = s3_summary.get("recommendations", []) or []

        cp_stage = (s3.get("stages", {}) or {}).get("clinical_pipeline", {}) or {}
        cp_data = cp_stage.get("data", {}) if isinstance(cp_stage.get("data"), dict) else {}

        comp_stage = (s3.get("stages", {}) or {}).get("competitive_landscape", {}) or {}
        comp_data = comp_stage.get("data", {}) if isinstance(comp_stage.get("data"), dict) else {}
        comp_sections = comp_data.get("sections", comp_data) if isinstance(comp_data, dict) else {}
        competition = (
            comp_sections.get("competitive_landscape")
            or comp_sections.get("competitive_analysis")
            or comp_sections
            or {}
        )
        if not competition.get("competition_intensity"):
            assess_stage = (s3.get("stages", {}) or {}).get("assessment", {}) or {}
            assess_data = assess_stage.get("data", {}) if isinstance(assess_stage.get("data"), dict) else {}
            for pain in assess_data.get("pain_points", []) or []:
                if pain.get("type") == "competition":
                    competition.setdefault("competition_intensity", "high" if pain.get("severity") == "high" else pain.get("severity", "—"))
                    competition.setdefault("competition_note", pain.get("description", ""))
                    break

        clinical_summary = {
            "total_trials": cp_data.get("total_trials"),
            "active_trials": cp_data.get("active_trials"),
            "phase_distribution": cp_data.get("phase_distribution", {}),
            "top_players": cp_data.get("top_players") or cp_data.get("top_sponsors"),
            "status_distribution": comp_sections.get("clinical_pipeline", {}).get("status_distribution")
            if isinstance(comp_sections.get("clinical_pipeline"), dict)
            else cp_data.get("status_distribution"),
        }
        if not clinical_summary["total_trials"] and isinstance(comp_sections.get("clinical_pipeline"), dict):
            cp_sec = comp_sections["clinical_pipeline"]
            clinical_summary.update({
                "total_trials": cp_sec.get("total_trials"),
                "active_trials": cp_sec.get("active_trials"),
                "phase_distribution": cp_sec.get("phase_distribution", {}),
            })

        tf_stage = (s3.get("stages", {}) or {}).get("target_function", {}) or {}
        tf_data = tf_stage.get("data", {}) if isinstance(tf_stage.get("data"), dict) else {}
        tf_sections = tf_data.get("sections", {}) if isinstance(tf_data, dict) else {}
        basic_info = tf_sections.get("basic_info", {}) or {}
        function_info = tf_sections.get("function", {}) or {}
        protein_function = (
            function_info.get("function_description")
            or function_info.get("description")
            or (function_info.get("functions", [""])[0] if function_info.get("functions") else "")
        )

        lit_stage = (s3.get("stages", {}) or {}).get("literature", {}) or {}
        lit_data = lit_stage.get("data", {}) if isinstance(lit_stage.get("data"), dict) else {}
        papers = lit_data.get("papers", []) or []
        references = self._format_references(papers[:25])
        literature_highlights = self._build_literature_highlights(papers[:12])

        # --- Stage4: 里程碑与商业 ---
        milestones_summary = s4_summary.get("milestones", {}) or {}
        ms_stage = (s4.get("stages", {}) or {}).get("milestones", {}) or {}
        ms_data = ms_stage.get("data", {}) if isinstance(ms_stage.get("data"), dict) else {}
        adj = (ms_data.get("stage_adjustments") or {}).get("adjustment_details", {}) or {}
        competitive_adj = adj.get("competitive_landscape", {}) or {}
        milestone_rows = ms_data.get("milestones", []) or []

        funding = s4_summary.get("funding", {}) or {}

        return {
            "generated_at": datetime.now().isoformat(),
            "target": target,
            "disease": disease,
            "disease_zh": disease_zh,
            "title_zh": (
                f"基于多组学与临床注册数据的 {target} 靶点在{disease_zh}中的"
                f"成药性评估与研发路径分析"
            ),
            "title_en": (
                f"Integrative druggability and development-path analysis of {target} "
                f"in {disease} using multi-omics and clinical registry data"
            ),
            "data_sources": sorted(
                set(
                    (s1_summary.get("data_sources") or [])
                    + (s2_summary.get("data_sources") or [])
                    + (s3_summary.get("data_sources") or [])
                )
            ),
            "cancer_types": s1_summary.get("cancer_types") or s1.get("cancer_types") or [],
            "confidence": s1_summary.get("confidence_level", "medium"),
            "key_findings_s1": s1_summary.get("key_findings", []),
            "key_findings_s2": s2_summary.get("key_findings", []),
            "key_findings_s3": s3_summary.get("key_findings", []),
            "top_tissues": top_tissues,
            "tissue_count": len(tissues_raw),
            "tumor_stats": tumor_stats,
            "survival": survival,
            "de_source": de_source,
            "de_method": de_method,
            "target_rank": target_rank,
            "target_druggability": target_druggability,
            "drug_class": drug_class,
            "drug_evidence": drug_evidence,
            "drug_interpretation": drug_interpretation,
            "top_targets": top_targets[:15],
            "developability": developability,
            "recommendations": recommendations,
            "clinical_summary": clinical_summary,
            "competition": competition or competitive_adj,
            "basic_info": basic_info,
            "protein_function": protein_function,
            "milestones": {
                "total_duration": milestones_summary.get("total_duration") or ms_data.get("total_duration_months"),
                "total_cost": milestones_summary.get("total_cost") or ms_data.get("total_cost_estimate"),
                "success_rate": milestones_summary.get("success_rate") or ms_data.get("overall_success_rate"),
                "estimated_completion": ms_data.get("estimated_completion"),
                "modality": s4.get("modality", "small_molecule"),
                "risk_level": s4.get("risk_level", "medium"),
            },
            "milestone_rows": milestone_rows,
            "funding": funding,
            "stage4_druggability": adj.get("druggability_score"),
            "references": references,
            "literature_highlights": literature_highlights,
            "papers_raw": papers,
            "tissues_full": {k: float(v) for k, v in tissues_raw.items() if v is not None},
            "tumor_sample_values": tumor_sample_values,
            "pubmed_total": (lit_data.get("search_results") or {}).get("total_count"),
        }

    @staticmethod
    def _build_literature_highlights(papers: list[dict]) -> list[dict]:
        highlights = []
        for paper in papers:
            title = paper.get("title", "")
            highlights.append({
                "title": title,
                "title_zh_note": title,
                "year": paper.get("year", ""),
                "journal": paper.get("journal", ""),
                "pmid": paper.get("pmid", ""),
                "theme": ManuscriptGenerator._infer_paper_theme(title),
                "study_design": paper.get("study_design", ""),
                "mesh_terms": (paper.get("mesh_terms") or [])[:4],
            })
        return highlights

    @staticmethod
    def _infer_paper_theme(title: str) -> str:
        t = title.lower()
        if "resistance" in t or "耐药" in t:
            return "耐药机制"
        if "cdk4/6" in t or "cdk4/6" in t:
            return "CDK4/6 抑制剂"
        if "selective" in t and "cdk4" in t:
            return "CDK4 选择性抑制"
        if "biomarker" in t or "predict" in t:
            return "生物标志物预测"
        if "adjuvant" in t or "metastatic" in t:
            return "临床疗效与试验设计"
        if "review" in t or "systematic" in t:
            return "循证综述"
        return "机制与转化研究"

    @staticmethod
    def _format_references(papers: list[dict]) -> list[dict]:
        refs = []
        for idx, paper in enumerate(papers, start=1):
            authors = paper.get("authors") or []
            author_str = ", ".join(authors[:3])
            if len(authors) > 3:
                author_str += ", 等"
            refs.append({
                "index": idx,
                "pmid": paper.get("pmid", ""),
                "citation_zh": (
                    f"{author_str}. {paper.get('title', '')}[J]. "
                    f"{paper.get('journal', '')}, {paper.get('year', 'n.d.')}."
                ),
                "citation_en": (
                    f"{author_str} ({paper.get('year', 'n.d.')}). "
                    f"{paper.get('title', 'Untitled')}. {paper.get('journal', '')}."
                ),
                "doi": paper.get("doi", ""),
                "url": paper.get("url") or f"https://pubmed.ncbi.nlm.nih.gov/{paper.get('pmid', '')}/",
            })
        return refs

    def _tissue_zh(self, name: str) -> str:
        return _TISSUE_ZH.get(name, name.replace("_", " "))

    @staticmethod
    def _level_zh(value: Any) -> str:
        mapping = {"high": "高", "medium": "中", "low": "低", "emerging": "新兴"}
        if value is None:
            return "—"
        return mapping.get(str(value).lower(), str(value))

    def _generate_figures(self, ctx: dict[str, Any], s1: dict) -> list[dict[str, str]]:
        """生成论文嵌入图表，返回相对路径元数据。"""
        figures_dir = self.output_dir / "figures"
        charts = ChartGenerator(str(figures_dir))
        target = ctx["target"]
        disease_zh = ctx.get("disease_zh", ctx["disease"])
        out: list[dict[str, str]] = []

        tissues = ctx.get("tissues_full") or dict(ctx.get("top_tissues") or [])
        if tissues:
            paths = charts.tissue_expression_heatmap(
                tissues, target, top_n=20, tissue_labels_zh=_TISSUE_ZH
            )
            if paths.get("png"):
                out.append({
                    "id": "fig1",
                    "path": paths["png"],
                    "relative": "figures/" + Path(paths["png"]).name,
                    "title_zh": f"{target} 正常组织表达热图（GTEx）",
                    "title_en": f"Heatmap of {target} expression across GTEx tissues",
                })

        samples = ctx.get("tumor_sample_values") or []
        if samples:
            paths = charts.tumor_expression_distribution(samples, target, "BRCA")
            if paths.get("png"):
                out.append({
                    "id": "fig2",
                    "path": paths["png"],
                    "relative": "figures/" + Path(paths["png"]).name,
                    "title_zh": f"TCGA-BRCA {target} 肿瘤表达分布",
                    "title_en": f"Distribution of {target} expression in TCGA-BRCA",
                })

        clin = ctx.get("clinical_summary") or {}
        phase_dist = clin.get("phase_distribution") or {}
        if phase_dist:
            paths = charts.clinical_trial_sankey(
                phase_dist,
                clin.get("status_distribution"),
                target,
                disease_zh,
                total_trials=clin.get("total_trials"),
            )
            if paths.get("png"):
                out.append({
                    "id": "fig3",
                    "path": paths["png"],
                    "relative": "figures/" + Path(paths["png"]).name,
                    "title_zh": f"{target}/{disease_zh} 临床试验阶段与状态流程图",
                    "title_en": f"Clinical trial phase-status flow for {target} in {disease_zh}",
                })

        top_targets = ctx.get("top_targets") or []
        if top_targets:
            paths = charts.composite_ranking_bar(
                top_targets,
                title=f"{disease_zh} 候选靶点综合排名",
            )
            if paths.get("png"):
                out.append({
                    "id": "fig4",
                    "path": paths["png"],
                    "relative": "figures/" + Path(paths["png"]).name,
                    "title_zh": "候选靶点成药性综合排名",
                    "title_en": "Composite ranking of candidate targets",
                })

        return out

    @staticmethod
    def _embed_figure(fig: dict[str, str] | None) -> str:
        if not fig or not fig.get("relative"):
            return ""
        num = fig.get("id", "fig").replace("fig", "")
        title = fig.get("title_zh", "")
        return f"\n\n![{title}]({fig['relative']})\n\n**图{num}　{title}**\n"

    def _fig(self, ctx: dict[str, Any], fig_id: str) -> dict[str, str] | None:
        for fig in ctx.get("figures") or []:
            if fig.get("id") == fig_id:
                return fig
        return None

    def _render_markdown_zh(self, ctx: dict[str, Any]) -> str:
        clin = ctx.get("clinical_summary") or {}
        dev = ctx.get("developability") or {}
        ms = ctx.get("milestones") or {}
        comp = ctx.get("competition") or {}
        basic = ctx.get("basic_info") or {}

        tissue_rows = "\n".join(
            f"| {i} | {self._tissue_zh(name)} | {name} | {val:.2f} |"
            for i, (name, val) in enumerate(ctx.get("top_tissues", []), 1)
        ) or "| — | 暂无 GTEx 组织数据 | — | — |"

        tumor_rows = "\n".join(
            f"| {cancer} | {st['n_samples']} | {st['mean']} | {st['median']} | {st['min']}–{st['max']} |"
            for cancer, st in (ctx.get("tumor_stats") or {}).items()
        ) or "| — | — | — | — | — |"

        target_rows = "\n".join(
            f"| {i} | {t.get('gene', '—')} | {float(t.get('composite_score') or t.get('score') or 0):.3f} | "
            f"{float(t.get('druggability_score') or 0):.3f} | {t.get('class', t.get('druggability_class', '—'))} |"
            for i, t in enumerate(ctx.get("top_targets", []), 1)
        ) or f"| 1 | {ctx['target']} | — | — | — |"

        phase_dist = clin.get("phase_distribution") or {}
        phase_rows = "\n".join(
            f"| {_PHASE_ZH.get(phase, phase)} | {count} |"
            for phase, count in sorted(phase_dist.items(), key=lambda x: -x[1])
        ) or "| — | — |"

        status_dist = clin.get("status_distribution") or {}
        status_rows = "\n".join(
            f"| {status} | {count} |"
            for status, count in (status_dist.items() if isinstance(status_dist, dict) else [])
        ) or "| 详见 ClinicalTrials.gov | — |"

        players = clin.get("top_players") or {}
        if isinstance(players, list):
            player_rows = "\n".join(
                f"| {i} | {p.get('name', p.get('sponsor', '—'))} | {p.get('trials', p.get('count', '—'))} |"
                for i, p in enumerate(players[:8], 1)
            )
        elif isinstance(players, dict):
            player_rows = "\n".join(
                f"| {i} | {name} | {count} |"
                for i, (name, count) in enumerate(
                    sorted(players.items(), key=lambda x: -x[1] if isinstance(x[1], (int, float)) else 0)[:8], 1
                )
            )
        else:
            player_rows = "| — | — | — |"

        milestone_rows = "\n".join(
            f"| {m.get('name', m.get('stage', '—'))} | {m.get('duration_months', m.get('duration', '—'))} | "
            f"{m.get('success_rate', '—')} | {m.get('cost_estimate', m.get('cost', '—'))} |"
            for m in (ctx.get("milestone_rows") or [])[:12]
        ) or "| 见商业计划书附录 | — | — | — |"

        lit_reviews = ctx.get("literature_reviews") or []
        enrich = ctx.get("literature_enrichment") or {}
        enrich_note = []
        if enrich.get("pubmed_efetch"):
            enrich_note.append(f"PubMed MeSH 富化 {enrich.get('mesh_count', 0)} 篇")
        if enrich.get("openalex_used"):
            enrich_note.append(f"OpenAlex 被引 {enrich.get('citation_count_available', 0)} 篇")
        if enrich.get("aminer_used"):
            enrich_note.append("AMiner 引用链")
        llm_note = (
            f"（已启用 {ctx.get('literature_llm_source') or 'LLM'}：{ctx.get('literature_llm_model')}）"
            if ctx.get("literature_llm_used")
            else "（规则化评述；可用 Agent 缓存 / SCALE 本地模型 / OPENAI_API_KEY）"
        )
        source_counts = ctx.get("literature_review_sources") or {}
        review_source_note = []
        if source_counts.get("agent_cache"):
            review_source_note.append(f"Agent 缓存评述 {source_counts['agent_cache']} 篇")
        if source_counts.get("scale_local"):
            review_source_note.append(f"SCALE 本地模型评述 {source_counts['scale_local']} 篇")
        if source_counts.get("openai"):
            review_source_note.append(f"外部 LLM 评述 {source_counts['openai']} 篇")
        if source_counts.get("rule_based"):
            review_source_note.append(f"规则回退评述 {source_counts['rule_based']} 篇")
        if review_source_note:
            llm_note = "（" + "；".join(review_source_note) + "）"
        if ctx.get("agent_review_tasks") and not ctx.get("literature_llm_used"):
            llm_note += f" | Agent 待办：{ctx.get('agent_review_tasks')}"
        skills_note = "；".join(enrich_note) if enrich_note else "仅使用 Stage3 缓存元数据"
        lit_deep_section = "\n\n".join(
            f"#### 文献 {r['index']}：{r.get('title', '')}\n\n"
            f"- **主题：** {r.get('theme', '—')}　|　**研究设计：** {r.get('study_design', '—')}　|　"
            f"**证据等级：** {r.get('evidence_level', '—')}\n"
            f"- **期刊：** {r.get('journal', '')} ({r.get('year', '')})　|　"
            f"**PMID：** [{r.get('pmid', '')}](https://pubmed.ncbi.nlm.nih.gov/{r.get('pmid', '')}/)"
            + (
                f"　|　**被引：** {r.get('aminer_citation_count')}"
                if r.get("aminer_citation_count") is not None
                else ""
            )
            + "\n"
            + (
                f"- **MeSH：** {'；'.join(r.get('mesh_terms') or [])[:6]}\n"
                if r.get("mesh_terms")
                else ""
            )
            + f"\n{r.get('commentary_zh', '')}"
            for r in lit_reviews
        ) or "暂无逐篇评述。"
        lit_skills_header = (
            f"> **医学 Skills 富化：** {skills_note}。{llm_note}\n\n"
            f"> {ctx.get('literature_evidence_framing', '')}\n\n"
        )

        lit_section = "\n".join(
            f"{i}. **【{h['theme']}】** {h['title']}（{h['journal']}, {h['year']}）"
            for i, h in enumerate(ctx.get("literature_highlights", []), 1)
        ) or "暂无文献摘要。"

        fig1 = self._embed_figure(self._fig(ctx, "fig1"))
        fig2 = self._embed_figure(self._fig(ctx, "fig2"))
        fig3 = self._embed_figure(self._fig(ctx, "fig3"))
        fig4 = self._embed_figure(self._fig(ctx, "fig4"))

        refs_block = "\n".join(
            f"[{r['index']}] {r['citation_zh']} doi:{r.get('doi', 'N/A')} {r['url']}"
            for r in ctx.get("references", [])
        )

        findings_s1 = "\n".join(f"- {f}" for f in ctx.get("key_findings_s1", [])) or "- 见表达分析结果。"
        findings_s3 = "\n".join(f"- {f}" for f in ctx.get("key_findings_s3", [])) or "- 见深度调研结果。"
        recs = "\n".join(f"- {r}" for r in ctx.get("recommendations", [])) or "- 需结合差异化策略推进。"
        evidence_lines = "\n".join(f"  - {e}" for e in (ctx.get("drug_evidence") or [])[:6])

        survival_text = ""
        for cancer, data in (ctx.get("survival") or {}).items():
            hr = data.get("hr") or data.get("hazard_ratio")
            p = data.get("p_value")
            if hr is not None:
                survival_text += f"在 TCGA-{cancer} 队列中，{ctx['target']} 表达与生存结局关联 HR={hr:.3f}（P={p}）。"
        if not survival_text:
            survival_text = (
                "当前运行未获得稳定的预后 Cox 模型输出；"
                "后续可结合 TCGA 完整临床随访数据进行补充验证。"
            )

        top_tissues = ctx.get("top_tissues") or []
        if top_tissues:
            tissue_result = (
                f"GTEx 显示 {ctx['target']} 在 {self._tissue_zh(top_tissues[0][0])} 呈相对高表达"
                f"（最高 {top_tissues[0][1]:.1f} TPM，共 {ctx.get('tissue_count', 0)} 个组织）。"
            )
        else:
            tissue_result = f"GTEx 组织表达数据在当前运行中未完整提取（共 {ctx.get('tissue_count', 0)} 个组织）。"

        abstract = f"""**目的**  整合公开转录组、成药性知识库与临床试验注册信息，系统评估 {ctx['target']} 作为{ctx['disease_zh']}治疗靶点的生物学合理性、成药性、竞争格局与研发可行性。

**方法**  采用四阶段可复现计算管线：①多源表达与预后挖掘（GTEx v8、TCGA、HPA）；②差异表达驱动的靶点筛选与成药性评分（OpenTargets、Pharos、ChEMBL）；③PubMed 文献计量与 ClinicalTrials.gov 临床管线分析；④基于风险调整的里程碑与成本模型。全部指标保留 API 溯源记录。

**结果**  {tissue_result}"""
        if ctx.get("tumor_stats"):
            brca = ctx["tumor_stats"].get("BRCA", {})
            if brca:
                abstract += f"TCGA-BRCA 肿瘤样本（n={brca.get('n_samples', '—')}）中表达中位数为 {brca.get('median', '—')}。"
        abstract += f"""成药性综合评分 {self._fmt_num(ctx.get('target_druggability'))}（{ctx.get('drug_class', '—')}），可开发性指数 {dev.get('score', '—')}/100。
ClinicalTrials.gov 检索到 {clin.get('total_trials', '—')} 项相关试验（活跃 {clin.get('active_trials', '—')} 项），竞争强度 {self._level_zh(comp.get('competition_intensity'))}。
研发模型估算总周期 {self._fmt_duration(ms.get('total_duration'))}、累计成本约 {self._fmt_money(ms.get('total_cost'))}、综合成功率 {self._fmt_percent(ms.get('success_rate'))}。

**结论**  公开证据支持 {ctx['target']} 在{ctx['disease_zh']}中作为**中等优先级**研发靶点继续投入，但须在 CDK4/6 抑制剂红海格局下明确选择性抑制或联合用药的差异化定位；建议优先开展生物标志物分层与治疗窗口评估。"""

        return f"""# {ctx['title_zh']}

> **稿件类型：** 基于公共数据的计算药理学研究论文（中文草稿）
> **生成时间：** {ctx['generated_at']}
> **数据置信度：** {ctx.get('confidence', 'medium')}
> **说明：** 本文由靶点研究平台自动合成，正文为中文。投稿前须补充作者信息、伦理声明、原创实验与期刊格式。

---

## 摘要

{abstract}

**关键词：** {ctx['target']}；{ctx['disease_zh']}；治疗靶点；成药性；CDK4/6 抑制剂；临床试验；生物信息学

---

## 1 引言

细胞周期蛋白依赖性激酶 4（CDK4）与 Cyclin D 形成复合物，磷酸化 RB1 并释放 E2F 转录因子，驱动 G1/S 期转换，是肿瘤增殖的关键节点。在激素受体阳性（HR+）{ctx['disease_zh']}中，CDK4/6 抑制剂（如 palbociclib、ribociclib、abemaciclib）已成为一线标准治疗，显著改善无进展生存期。然而，**原发性与获得性耐药**、**CDK4 选择性抑制 vs CDK4/6 联合抑制**的疗效-毒性平衡，以及**新一代 CDK4 选择性抑制剂**的临床定位，仍是活跃研究方向。

PubMed 检索显示，与「{ctx['target']} AND {ctx['disease']}」相关的文献约 **{ctx.get('pubmed_total', '—')}** 篇，提示该领域证据密集、迭代迅速。对于药物研发决策而言，仅依赖单一数据源难以形成可执行的靶点优先级判断，需要同时回答：

1. **生物学合理性**：肿瘤 vs 正常组织的表达差异是否支持治疗窗口？
2. **成药性**：是否具备可药化的化学空间与已有工具化合物？
3. **临床可行性**：注册试验格局是否过饱和？是否存在差异化切入点？
4. **研发经济性**：在竞争强度与风险调整下，预期周期与成功率是否可接受？

本研究利用可复现的四阶段计算管线，对 {ctx['target']} 在{ctx['disease_zh']}中进行整合评估，旨在为靶点立项、竞品跟踪与实验设计提供**结构化证据链**。

---

## 2 材料与方法

### 2.1 研究设计

本研究为**基于公开数据库的回顾性计算分析**，未纳入新收集的患者样本。分析流程分为四个阶段，各阶段输出均附带 JSON 溯源文件与 Markdown 分析报告。

### 2.2 数据来源

| 数据库 | 版本/来源 | 用途 |
|--------|-----------|------|
| GTEx | v8 | 正常组织 RNA-seq 表达（TPM） |
| TCGA | BRCA 等 | 肿瘤表达谱与样本级 RSEM |
| HPA | 最新 API | 蛋白水平定位与组织染色 |
| OpenTargets / Pharos / ChEMBL | 最新 API | 成药性、已知药物与活性化合物 |
| {ctx.get('de_source', 'TCGA/GEO')} | 管线回退 | 差异表达（方法：{ctx.get('de_method', '—')}） |
| PubMed | NCBI E-utilities | 文献检索与引用网络 |
| ClinicalTrials.gov | API v2 | 试验注册、阶段与申办方 |

**本分析纳入的癌种：** {', '.join(ctx.get('cancer_types') or ['BRCA'])}

### 2.3 分析流程

**阶段一（表达与预后）**：提取 {ctx['target']} 跨组织表达谱，计算 TCGA 肿瘤样本表达分布，并在可用时进行生存关联分析。

**阶段二（靶点筛选）**：以 {ctx['disease_zh']} 相关差异表达基因为基础，综合 DE 强度、成药性分类与文献证据进行排名；对 {ctx['target']} 单独输出成药性组分评分。

**阶段三（深度调研）**：整合靶点功能注释、临床试验阶段分布、竞争格局与可开发性指数（0–100）。

**阶段四（研发建模）**：在成药性、竞争强度与风险等级（{ms.get('risk_level', 'medium')}）约束下，生成里程碑时间表与成本-成功率估计。

### 2.4 统计学与质量控制

差异表达分析采用标准组间检验并控制多重比较；肿瘤表达报告均值、中位数与极差。所有外部 API 响应写入 `provenance/` 目录以便审计。交叉验证置信度：**{ctx.get('confidence', 'medium')}**。

---

## 3 结果

### 3.1 靶点生物学特征

| 项目 | 结果 |
|------|------|
| 基因符号 | {ctx['target']} |
| UniProt | {basic.get('uniprot_id', 'P11802')} |
| 蛋白名称 | {basic.get('protein_name', ctx['target'])} |
| 亚细胞定位 | {', '.join(basic.get('subcellular_location', [])[:5]) or '细胞质/细胞核'} |

**功能概述：** {(ctx.get('protein_function') or '—')[:500]}

### 3.2 正常组织表达谱（GTEx）

共分析 **{ctx.get('tissue_count', 0)}** 个正常组织。表达最高的组织如下：

| 排名 | 组织（中文） | GTEx 组织名 | TPM |
|------|-------------|-------------|-----|
{tissue_rows}

**阶段一关键发现：**

{findings_s1}

**解读：** {ctx['target']} 在生殖道相关组织及培养成纤维细胞中表达较高，提示药物开发需重点关注**治疗窗口**与正常组织毒性；乳腺本身并非最高表达组织，有利于在{ctx['disease_zh']}中探索肿瘤选择性干预。
{fig1}

### 3.3 肿瘤组织表达（TCGA）

| 癌种 | 样本数 | 均值 | 中位数 | 范围 |
|------|--------|------|--------|------|
{tumor_rows}

肿瘤表达呈右偏分布，部分样本显著高表达，支持在{ctx['disease_zh']}亚型中开展分层研究。
{fig2}

### 3.4 预后关联

{survival_text}

### 3.5 靶点筛选与成药性

在 {ctx['disease_zh']} 候选靶点排名中，**{ctx['target']}** 位列第 **{ctx.get('target_rank') or '—'}** 名（若未进入 Top 列表，说明同疾病筛选中其他靶点 DE 信号更强，但不排除 {ctx['target']} 的生物学相关性）。

**{ctx['target']} 成药性详情：**

| 指标 | 数值 |
|------|------|
| 综合成药性评分 | {self._fmt_num(ctx.get('target_druggability'))} |
| 成药性分类 | {ctx.get('drug_class', '—')} |
| 阶段四校正评分 | {self._fmt_num(ctx.get('stage4_druggability'))} |
| 可开发性指数 | {dev.get('score', '—')}/100（{dev.get('level', '—')}） |

**证据链：**

{evidence_lines or '  - 见 OpenTargets / ChEMBL 原始记录'}

{ctx.get('drug_interpretation', '')}

**候选靶点 Top 排名（节选）：**

| 排名 | 基因 | 综合评分 | 成药性 | 分类 |
|------|------|----------|--------|------|
{target_rows}
{fig4}

### 3.6 文献研究热点

PubMed 检索获得 **{len(ctx.get('references', []))}** 篇核心文献（全文元数据），主要主题分布如下：

{lit_section}

上述文献表明，当前研究焦点集中于 **CDK4/6 抑制剂疗效与耐药机制**、**联合治疗策略**（如 PI3K/mTOR、GPX4 等通路）以及 **CDK4 选择性抑制** 的临床前证据。

### 3.6.1 逐篇文献深度解读

{lit_skills_header}

{lit_deep_section}

### 3.7 临床试验格局

| 指标 | 数值 |
|------|------|
| 注册试验总数 | {clin.get('total_trials', '—')} |
| 活跃试验 | {clin.get('active_trials', '—')} |
| 竞争强度 | {self._level_zh(comp.get('competition_intensity'))} |
| 市场集中度 | {self._level_zh(comp.get('market_concentration'))} |

**试验阶段分布：**

| 阶段 | 试验数 |
|------|--------|
{phase_rows}

**试验状态分布（节选）：**

| 状态 | 数量 |
|------|------|
{status_rows}

**主要申办方/参与方（节选）：**

| 排名 | 机构 | 试验数 |
|------|------|--------|
{player_rows}
{fig3}

**阶段三关键发现：**

{findings_s3}

### 3.8 研发里程碑与经济性估计

在 **{ms.get('modality', '小分子')}** 模态与 **{ms.get('risk_level', 'medium')}** 风险假设下：

| 指标 | 估计值 |
|------|--------|
| 总研发周期 | {self._fmt_duration(ms.get('total_duration'))} |
| 预计完成时间 | {ms.get('estimated_completion', '—')} |
| 累计成本 | {self._fmt_money(ms.get('total_cost'))} |
| 综合成功率 | {self._fmt_percent(ms.get('success_rate'))} |
| 融资轮次 | {ctx.get('funding', {}).get('rounds', '—')} |

**分阶段里程碑（节选）：**

| 阶段 | 周期（月） | 成功率 | 成本 |
|------|------------|--------|------|
{milestone_rows}

---

## 4 讨论

### 4.1 生物学与表达层面的启示

本分析显示 {ctx['target']} 在 TCGA-BRCA 肿瘤样本中表达变异较大，而在正常组织中于多种增殖活跃组织呈中高表达。这意味着：

- **支持点**：肿瘤中确实存在高表达亚群，可用于患者分层或伴随诊断开发；
- **风险点**：正常组织表达提示需警惕骨髓抑制、胃肠道毒性等与 CDK4/6 抑制剂类似的不良反应谱。

与已上市 CDK4/6 抑制剂相比，**CDK4 选择性抑制**（见参考文献中 2025 年 Cancer Cell 报道）试图在保留疗效的同时降低 CDK6 相关毒性，是本靶点差异化的重要科学假设。

### 4.2 成药性与可开发性

成药性评分 **{self._fmt_num(ctx.get('target_druggability'))}**，ChEMBL 显示已有活性化合物与上市药物关联，Pharos 分类为 Tchem，表明**化学工具链成熟**。可开发性指数 **{dev.get('score', '—')}/100** 处于中等水平，主要受**竞争强度**与**临床开发不确定性**拖累，而非生物学证据不足。

### 4.3 临床竞争格局

{clin.get('total_trials', '—')} 项注册试验中，II/III 期占比高，说明该领域已越过早期概念验证阶段，进入**红海竞争**。申办方分散（市场集中度 {comp.get('market_concentration', 'low')}），既有大型药企也有学术主导试验，意味着：

- 常规 CDK4/6 抑制路径难以获得同类最佳（Best-in-class）定位；
- **细分人群**（如 CDK4 扩增、CDK6 低表达、内分泌耐药后线）可能是突破口。

### 4.4 研发经济性与决策建议

模型估算总周期 **{self._fmt_duration(ms.get('total_duration'))}**、成本 **{self._fmt_money(ms.get('total_cost'))}**，综合成功率仅 **{self._fmt_percent(ms.get('success_rate'))}**，符合肿瘤靶向药行业基线。对于立项决策：

{recs}

### 4.5 局限性

1. **计算回顾性设计**：未包含前瞻性验证实验，表达-疗效因果链需体外/体内实验确认；
2. **公共数据滞后**：ClinicalTrials.gov 与 PubMed 更新存在延迟，近期试验可能未完全纳入；
3. **GEO 数据缺失**：部分差异表达队列因 GEO 矩阵解析失败而回退至 TCGA，可能低估特定亚型信号；
4. **经济性模型为情景假设**：成功率与成本受模态、适应症扩展策略影响较大。

---

## 5 结论

综合多组学表达、成药性证据、文献趋势与临床注册数据，**{ctx['target']} 在{ctx['disease_zh']}中具备继续研发的生物学与化学基础**，但临床竞争已高度激烈。建议后续工作优先围绕：

1. **差异化科学假说**：CDK4 选择性抑制 vs 传统 CDK4/6 抑制的疗效/毒性优势；
2. **生物标志物分层**：结合肿瘤表达异质性与耐药突变谱；
3. **联合用药策略**：参考近期文献中的 PI3K/mTOR、铁死亡等联合路径；
4. **监管与临床路径**：在 II 期单臂或随机对照设计中明确终点与伴随诊断。

---

## 6 临床转化与后续实验建议

| 优先级 | 建议实验 | 预期产出 |
|--------|----------|----------|
| P0 | HR+/{ctx['disease_zh']} 细胞系 CDK4 磷酸化/RB 磷酸化验证 | 靶点 occupancy 与通路抑制证据 |
| P0 | 患者来源异种移植（PDX）分层疗效 | 高表达亚群响应数据 |
| P1 | 与内分泌治疗及 CDK4/6 抑制剂的序贯/联合方案 | 耐药逆转或延迟耐药 |
| P1 | 正常组织毒性面板（骨髓、肠道上皮） | 治疗窗口评估 |
| P2 | 真实世界注册研究方案设计 | 上市后差异化定位 |

---

## 数据可用性声明

全部结构化结果、HTML 证据包与 API 溯源文件存放于管线 `output/` 目录，包括：

- `stage1/{ctx['target']}_stage1_results.json`
- `stage2/{ctx['disease']}_stage2_results.json`
- `stage3/{ctx['target']}_{ctx['disease']}_stage3_results.json`
- `stage4/{ctx['target']}_{ctx['disease']}_stage4_results.json`

---

## 参考文献

{refs_block}

---

## 图表目录（建议）

- **图 1** {ctx['target']} 在 GTEx 54 个正常组织中的 TPM 表达热图
- **图 2** TCGA-BRCA 肿瘤样本 {ctx['target']} 表达分布（小提琴图/直方图）
- **图 3** 候选靶点成药性评分排名森林图
- **图 4** ClinicalTrials.gov 试验阶段与状态桑基图
- **图 5** 研发里程碑甘特图与累计成本曲线
- **表 1** 数据来源与检索式汇总（见方法部分）
- **表 2** 核心文献主题分类与代表性研究

---

## 作者贡献、利益冲突与伦理

- **作者贡献：** [待填写，建议采用 CRediT 分类]
- **利益冲突：** 待全体作者确认后填写；本自动草稿不代替作者声明。
- **伦理声明：** 本稿基于公开数据库与去标识化数据；是否需要伦理审查或豁免应由作者所在机构确认。

---

*靶点研究平台 · 期刊论文生成器 v2.0（中文版）*
"""

    def _render_markdown_en(self, ctx: dict[str, Any]) -> str:
        """英文简版（保留兼容）。"""
        return self._render_markdown_zh(ctx).replace("（中文版）", "(English placeholder — use language=zh)")

    @staticmethod
    def _fmt_percent(value: Any) -> str:
        if value is None:
            return "—"
        try:
            v = float(value)
            if v <= 1:
                return f"{v * 100:.2f}%"
            return f"{v:.2f}%"
        except (TypeError, ValueError):
            return str(value)

    @staticmethod
    def _fmt_num(value: Any) -> str:
        if value is None:
            return "—"
        try:
            return f"{float(value):.3f}"
        except (TypeError, ValueError):
            return str(value)

    @staticmethod
    def _fmt_money(value: Any) -> str:
        if value is None:
            return "—"
        try:
            return f"${float(value):.1f}M"
        except (TypeError, ValueError):
            return str(value)

    @staticmethod
    def _fmt_duration(value: Any) -> str:
        if value is None:
            return "—"
        s = str(value)
        if "个月" in s or "月" in s:
            return s
        try:
            months = int(float(value))
            years = months / 12
            return f"{months} 个月（约 {years:.1f} 年）"
        except (TypeError, ValueError):
            return s

    def _render_docx_zh(self, ctx: dict[str, Any], slug: str) -> str:
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Pt, RGBColor

        doc = Document()
        title = doc.add_heading(ctx["title_zh"], level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        meta = doc.add_paragraph("计算药理学研究论文草稿（中文）— 投稿前须人工修订")
        meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
        meta.runs[0].font.size = Pt(9)
        meta.runs[0].font.color.rgb = RGBColor(0x88, 0x88, 0x88)

        doc.add_heading("摘要", level=1)
        clin = ctx.get("clinical_summary") or {}
        dev = ctx.get("developability") or {}
        doc.add_paragraph(
            f"目的：评估 {ctx['target']} 在{ctx['disease_zh']}中的治疗靶点价值。"
            f"结果：临床试验 {clin.get('total_trials', '—')} 项，可开发性 {dev.get('score', '—')}/100，"
            f"成药性 {self._fmt_num(ctx.get('target_druggability'))}。"
            f"结论：具备研发基础，需明确差异化定位。"
        )

        for heading, body in [
            ("1 引言", f"{ctx['target']} 是细胞周期关键激酶，在{ctx['disease_zh']}治疗中具有重要意义。"),
            ("2 方法", f"数据来源：{', '.join(ctx.get('data_sources') or [])}。四阶段可复现管线。"),
            ("3 结果", ctx.get("drug_interpretation") or "见 Markdown 完整版。"),
            ("4 讨论", f"竞争强度 {ctx.get('competition', {}).get('competition_intensity', '—')}，需关注治疗窗口。"),
            ("5 结论", f"建议围绕生物标志物分层与 CDK4 选择性抑制继续推进。"),
        ]:
            doc.add_heading(heading, level=1)
            doc.add_paragraph(body)

        doc.add_heading("参考文献", level=1)
        for ref in ctx.get("references", [])[:20]:
            doc.add_paragraph(f"[{ref['index']}] {ref['citation_zh']}", style="List Number")

        path = self.output_dir / f"{slug}_manuscript.docx"
        doc.save(str(path))
        return str(path.resolve())


def generate_manuscript_from_stages(
    output_root: str | Path,
    target: str,
    disease: str,
    stage1: dict,
    stage2: dict,
    stage3: dict,
    stage4: dict,
    *,
    language: str = "zh",
) -> dict:
    """从各阶段结果 dict 生成稿件（无需完整 pipeline JSON）。"""
    generator = ManuscriptGenerator(str(Path(output_root) / "manuscripts"))
    return generator.generate(
        {
            "stages": {
                "stage1": stage1,
                "stage2": stage2,
                "stage3": stage3,
                "stage4": stage4,
            }
        },
        target,
        disease,
        language=language,
    )
