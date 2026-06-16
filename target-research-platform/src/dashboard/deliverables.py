"""研究者面向的交付物目录与靶点对比数据提取。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


# 研究者真正关心的交付物（按优先级）
_DELIVERABLE_RULES: list[dict[str, Any]] = [
    {
        "pattern": re.compile(r".*_manuscript_zhongliu\.md$", re.I),
        "category": "manuscript",
        "title_zh": "中华肿瘤杂志格式稿",
        "description_zh": "按《中华肿瘤杂志》排版的中文投稿草稿，含图表嵌入与逐篇文献评述。",
        "priority": 1,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_manuscript\.md$", re.I),
        "category": "manuscript",
        "title_zh": "期刊论文草稿（Markdown）",
        "description_zh": "中文 IMRaD 研究论文，含真实图表与文献深度解读。",
        "priority": 2,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_manuscript\.docx$", re.I),
        "category": "manuscript",
        "title_zh": "期刊论文草稿（Word）",
        "description_zh": "可下载的 Word 版稿件骨架，便于按目标期刊格式排版。",
        "priority": 3,
        "previewable": False,
    },
    {
        "pattern": re.compile(r".*_manuscript_quality\.json$", re.I),
        "category": "manuscript",
        "title_zh": "论文质量门禁报告",
        "description_zh": "自动检查稿件结构、边界声明、文献评述来源、图表与元数据完整性。",
        "priority": 4,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_manuscript_fact_check\.json$", re.I),
        "category": "manuscript",
        "title_zh": "医学事实核查报告",
        "description_zh": "核查 PMID、研究类型、关键数字、图表引用与医学边界表述。",
        "priority": 5,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_literature_evidence_pack\.json$", re.I),
        "category": "manuscript",
        "title_zh": "文献证据富化包",
        "description_zh": "可复用的 PubMed/OpenAlex/AMiner 文献证据缓存，支持离线复核与再次生成。",
        "priority": 6,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_delivery_manifest\.json$", re.I),
        "category": "manuscript",
        "title_zh": "交付清单与溯源索引",
        "description_zh": "列出交付包文件、hash、数据源、质量门禁、事实核查和人工审阅待办。",
        "priority": 7,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_memory_summary\.md$", re.I),
        "category": "manuscript",
        "title_zh": "\u8bb0\u5fc6\u64ad\u79cd\u6458\u8981",
        "description_zh": "\u9762\u5411 gbrain / scale-local \u7684\u533b\u5b66\u4ea4\u4ed8\u6458\u8981\uff0c\u6c47\u603b\u8d28\u91cf\u95e8\u7981\u3001\u4e8b\u5b9e\u6838\u67e5\u3001\u6587\u732e\u8bc1\u636e\u4e0e\u4eba\u5de5\u5ba1\u9605\u8981\u70b9\u3002",
        "priority": 7.1,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_memory_seed\.json$", re.I),
        "category": "manuscript",
        "title_zh": "\u8bb0\u5fc6\u64ad\u79cd\u8bb0\u5f55",
        "description_zh": "\u8bb0\u5f55\u8bb0\u5fc6\u4f9b\u5e94\u5546\u3001\u5df2\u5bfc\u5165\u6587\u4ef6\u3001\u7f3a\u5931\u89d2\u8272\u548c\u8b66\u544a\uff0c\u7528\u4e8e\u9a8c\u8bc1\u533b\u5b66\u4ea4\u4ed8\u5df2\u6210\u529f\u5199\u5165\u957f\u671f\u8bb0\u5fc6\u3002",
        "priority": 7.2,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_memory_learning_candidate\.json$", re.I),
        "category": "manuscript",
        "title_zh": "\u533b\u5b66\u5b66\u4e60\u5019\u9009\u8bb0\u5f55",
        "description_zh": "\u8bb0\u5f55\u8fd9\u6b21\u533b\u5b66\u4ea4\u4ed8\u662f\u5426\u53ef\u8fdb\u5165\u957f\u671f\u8bb0\u5fc6/\u77e5\u8bc6\u6c89\u6dc0\u5ba1\u9605\uff0c\u542b recommended action\u3001promotable \u548c Memory Brain \u5bfc\u5165\u72b6\u6001\u3002",
        "priority": 7.25,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_memory_learning_candidate\.md$", re.I),
        "category": "manuscript",
        "title_zh": "\u533b\u5b66\u5b66\u4e60\u5019\u9009\u6458\u8981",
        "description_zh": "\u9762\u5411\u4eba\u5de5\u590d\u5ba1\u7684 Markdown \u5b66\u4e60\u6458\u8981\uff0c\u6c47\u603b\u8d28\u91cf\u95e8\u7981\u3001\u4e8b\u5b9e\u6838\u67e5\u3001\u6587\u732e\u8bc1\u636e\u548c\u8b66\u544a\u3002",
        "priority": 7.26,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_delivery\.zip$", re.I),
        "category": "manuscript",
        "title_zh": "医学研究交付 ZIP 包",
        "description_zh": "面向研究者审阅的完整交付包，含论文、图表、元数据、质量报告和事实核查报告。",
        "priority": 8,
        "previewable": False,
    },
    {
        "pattern": re.compile(r"figures/.*\.png$", re.I),
        "category": "manuscript",
        "title_zh": "论文图表（PNG）",
        "description_zh": "表达热图、试验流程图、靶点排名图等发表级图表。",
        "priority": 9,
        "previewable": True,
    },
    {
        "pattern": re.compile(r"report_.*\.html$", re.I),
        "category": "evidence",
        "title_zh": "可视化研究报告",
        "description_zh": "整合四阶段结论的 HTML 报告，适合汇报与分享。",
        "priority": 3,
        "previewable": True,
    },
    {
        "pattern": re.compile(r"report_.*\.docx$", re.I),
        "category": "evidence",
        "title_zh": "Word 研究报告",
        "description_zh": "可下载的 Word 版完整报告，便于批注与流转。",
        "priority": 4,
        "previewable": False,
    },
    {
        "pattern": re.compile(r".*_business_plan\.md$", re.I),
        "category": "business",
        "title_zh": "商业计划书",
        "description_zh": "研发里程碑、成本估算与市场机会分析。",
        "priority": 5,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_stage1_report\.md$", re.I),
        "category": "expression",
        "title_zh": "表达分析报告",
        "description_zh": "GTEx / TCGA / HPA 多源表达与预后挖掘结论。",
        "priority": 6,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_stage2_report\.md$", re.I),
        "category": "screening",
        "title_zh": "靶点筛选报告",
        "description_zh": "候选靶点排名、成药性评分与差异化依据。",
        "priority": 7,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_stage3_report\.md$", re.I),
        "category": "research",
        "title_zh": "深度调研报告",
        "description_zh": "文献综述、临床试验格局与竞争强度分析。",
        "priority": 8,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_milestones\.json$", re.I),
        "category": "business",
        "title_zh": "里程碑数据",
        "description_zh": "各研发阶段周期、成功率与累计成本。",
        "priority": 9,
        "previewable": True,
    },
    {
        "pattern": re.compile(r"pipeline_output\.json$", re.I),
        "category": "summary",
        "title_zh": "管线汇总数据",
        "description_zh": "四阶段结构化汇总，供二次分析或 Agent 读取。",
        "priority": 10,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_review_tasks\.json$", re.I),
        "category": "manuscript",
        "title_zh": "Agent \u6587\u732e\u8bc4\u8ff0\u5f85\u529e",
        "description_zh": "\u5217\u51fa PMID\u3001\u7814\u7a76\u7c7b\u578b\u4e0e\u8bc4\u8ff0\u63d0\u793a\uff0c\u7528\u4e8e\u8865\u5145 Agent/LLM \u6df1\u5ea6\u8bc4\u8ff0\u3002",
        "priority": 6.5,
        "previewable": True,
    },
    {
        "pattern": re.compile(r".*_agent_reviews\.json$", re.I),
        "category": "manuscript",
        "title_zh": "Agent \u6df1\u5ea6\u8bc4\u8ff0\u7f13\u5b58",
        "description_zh": "Agent \u5df2\u5b8c\u6210\u7684\u9010\u7bc7\u4e2d\u6587\u8bc4\u8ff0\u7f13\u5b58\uff0c\u53ef\u76f4\u63a5\u56de\u5199\u8bba\u6587\u6b63\u6587\u3002",
        "priority": 6.6,
        "previewable": True,
    },
]

_CATEGORY_LABELS = {
    "manuscript": "期刊论文",
    "evidence": "证据报告",
    "business": "商业规划",
    "expression": "表达分析",
    "screening": "靶点筛选",
    "research": "深度调研",
    "summary": "汇总数据",
}

_ADVANCED_RULES: list[dict[str, Any]] = [
    {
        "pattern": re.compile(r".*_stage[1-4]_results\.json$", re.I),
        "title_zh": "原始分析数据",
        "description_zh": "完整 JSON 原始结果，供技术人员复核。",
    },
    {
        "pattern": re.compile(r"provenance/.*\.json$", re.I),
        "title_zh": "数据溯源记录",
        "description_zh": "API 调用来源与请求参数，用于审计追溯。",
    },
]


def _match_rule(filename: str, rel_path: str, rules: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = f"{rel_path}/{filename}".replace("\\", "/")
    for rule in rules:
        if rule["pattern"].search(filename) or rule["pattern"].search(text):
            return rule
    return None


def _artifact_entry(file_path: Path, output_dir: Path, rule: dict[str, Any]) -> dict[str, Any]:
    rel = str(file_path.relative_to(output_dir)).replace("\\", "/")
    suffix = file_path.suffix.lower()
    return {
        "filename": file_path.name,
        "path": str(file_path.resolve()),
        "relative_path": rel,
        "suffix": suffix,
        "size": file_path.stat().st_size,
        "category": rule.get("category", "advanced"),
        "category_label": _CATEGORY_LABELS.get(rule.get("category", ""), "高级数据"),
        "title_zh": rule["title_zh"],
        "description_zh": rule["description_zh"],
        "priority": rule.get("priority", 99),
        "previewable": rule.get("previewable", suffix in {".md", ".html", ".json"}),
        "downloadable": True,
    }


def _matches_current_run(file_path: Path, output_dir: Path, target: str | None, disease: str | None) -> bool:
    if not target:
        return True
    rel = str(file_path.relative_to(output_dir)).replace("\\", "/").lower()
    target_l = target.lower()
    disease_l = (disease or "").lower().replace(" ", " ")
    if target_l in rel:
        return True
    if disease_l and disease_l in rel:
        return True
    if rel.startswith("evidence_") and target_l in rel.replace("_", " "):
        return True
    return False


def _dedupe_by_title(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for item in items:
        key = item["title_zh"]
        current = best.get(key)
        if not current or item["size"] >= current["size"]:
            best[key] = item
    return sorted(best.values(), key=lambda item: (item["priority"], item["title_zh"]))


def list_researcher_deliverables(
    output_dir: Path,
    *,
    current_target: str | None = None,
    current_disease: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    deliverables: list[dict[str, Any]] = []
    advanced: list[dict[str, Any]] = []
    if not output_dir.exists():
        return {"deliverables": [], "advanced": [], "scope": "empty"}

    for file_path in sorted(output_dir.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in {".json", ".md", ".html", ".pdf", ".docx", ".csv", ".png", ".svg", ".zip"}:
            continue
        rel = str(file_path.relative_to(output_dir)).replace("\\", "/")
        if rel.startswith("dashboard_runtime/") or rel.startswith("cache/") or rel.startswith("demo/"):
            continue

        rule = _match_rule(file_path.name, rel, _DELIVERABLE_RULES)
        if rule:
            if _matches_current_run(file_path, output_dir, current_target, current_disease):
                deliverables.append(_artifact_entry(file_path, output_dir, rule))
            continue

        adv_rule = _match_rule(file_path.name, rel, _ADVANCED_RULES)
        if adv_rule and _matches_current_run(file_path, output_dir, current_target, current_disease):
            advanced.append(_artifact_entry(file_path, output_dir, adv_rule))

    deliverables = _dedupe_by_title(deliverables)
    advanced = _dedupe_by_title(advanced)

    scope = "current_run" if current_target else "all_runs"
    return {"deliverables": deliverables, "advanced": advanced, "scope": scope}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _find_stage_file(output_dir: Path, stage: str, target: str, disease: str) -> Path | None:
    stage_dir = output_dir / stage
    if not stage_dir.exists():
        return None
    candidates = [
        stage_dir / f"{target}_{disease}_stage4_results.json" if stage == "stage4" else None,
        stage_dir / f"{target}_stage1_results.json" if stage == "stage1" else None,
        stage_dir / f"{target}_{disease}_stage3_results.json" if stage == "stage3" else None,
        stage_dir / f"{disease}_stage2_results.json" if stage == "stage2" else None,
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return None


def _extract_stage1_metrics(data: dict[str, Any]) -> dict[str, Any]:
    summary = data.get("summary") or {}
    validation = data.get("validation") or {}
    return {
        "expression_confidence": summary.get("confidence_level") or validation.get("confidence_level"),
        "top_tissue": (summary.get("key_findings") or [None])[0],
        "data_sources": ", ".join(summary.get("data_sources") or []),
    }


def _extract_stage2_metrics(data: dict[str, Any], target: str) -> dict[str, Any]:
    summary = data.get("summary") or {}
    top_candidates = summary.get("top_candidates") or []
    target_row = next((row for row in top_candidates if row.get("gene") == target), None)
    return {
        "top_candidate": (top_candidates[0] or {}).get("gene") if top_candidates else None,
        "target_rank": next((i + 1 for i, row in enumerate(top_candidates) if row.get("gene") == target), None),
        "target_druggability": target_row.get("druggability_score") if target_row else None,
        "target_score": target_row.get("score") if target_row else None,
        "candidate_count": len(top_candidates),
    }


def _extract_stage3_metrics(data: dict[str, Any]) -> dict[str, Any]:
    clinical = (((data.get("stages") or {}).get("clinical_pipeline") or {}).get("data") or {})
    sections = clinical.get("sections") or {}
    pipeline = sections.get("clinical_pipeline") or clinical
    summary = pipeline.get("summary") or {}
    phase_dist = summary.get("phase_distribution") or pipeline.get("phase_distribution") or {}
    return {
        "trial_count": summary.get("total_trials") or pipeline.get("total_trials"),
        "active_trials": summary.get("active_trials") or pipeline.get("active_trials"),
        "competition_intensity": summary.get("competition_intensity") or pipeline.get("competition_intensity"),
        "max_clinical_phase": summary.get("max_phase") or pipeline.get("max_phase"),
        "approved_drugs": summary.get("approved_drugs_count") or len(summary.get("approved_drugs") or []),
    }


def _extract_stage4_metrics(data: dict[str, Any]) -> dict[str, Any]:
    ms = (((data.get("stages") or {}).get("milestones") or {}).get("data") or {})
    adj = (ms.get("stage_adjustments") or {}).get("adjustment_details") or {}
    competitive = adj.get("competitive_landscape") or {}
    milestones = ms.get("milestones") or []
    last = milestones[-1] if milestones else {}
    return {
        "overall_success_rate": ms.get("overall_success_rate"),
        "total_duration_months": ms.get("total_duration_months"),
        "total_cost_estimate": ms.get("total_cost_estimate"),
        "estimated_completion": ms.get("estimated_completion"),
        "druggability_score": adj.get("druggability_score"),
        "expression_confidence_adj": adj.get("expression_confidence"),
        "has_approved_drugs": competitive.get("has_approved_drugs"),
        "competition_intensity": competitive.get("competition_intensity"),
        "max_clinical_phase": competitive.get("max_clinical_phase"),
        "final_phase_name": last.get("phase_name") or last.get("phase"),
    }


def discover_target_profiles(output_dir: Path) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    stage4_dir = output_dir / "stage4"
    if not stage4_dir.exists():
        return profiles

    for path in sorted(stage4_dir.glob("*_stage4_results.json")):
        data = _read_json(path)
        if not data:
            continue
        target = str(data.get("target") or path.name.split("_")[0])
        disease = str(data.get("disease") or "unknown")
        stage1 = _read_json(_find_stage_file(output_dir, "stage1", target, disease) or Path())
        stage2 = _read_json(_find_stage_file(output_dir, "stage2", target, disease) or Path())
        stage3 = _read_json(_find_stage_file(output_dir, "stage3", target, disease) or Path())

        metrics = {
            "stage1": _extract_stage1_metrics(stage1 or {}),
            "stage2": _extract_stage2_metrics(stage2 or {}, target),
            "stage3": _extract_stage3_metrics(stage3 or {}),
            "stage4": _extract_stage4_metrics(data),
        }
        profiles.append({
            "target": target,
            "disease": disease,
            "timestamp": data.get("timestamp"),
            "path": str(path.resolve()),
            "metrics": metrics,
        })

    return profiles


def build_comparison_report(output_dir: Path) -> dict[str, Any]:
    profiles = discover_target_profiles(output_dir)
    if not profiles:
        return {
            "available": False,
            "profiles": [],
            "rows": [],
            "recommendation": "暂无可对比靶点，请先完成至少一次完整分析。",
        }

    rows = [
        ("表达置信度", "stage1", "expression_confidence", "text"),
        ("主要表达发现", "stage1", "top_tissue", "text"),
        ("靶点综合评分", "stage2", "target_score", "score"),
        ("成药性评分", "stage2", "target_druggability", "score"),
        ("候选排名", "stage2", "target_rank", "rank"),
        ("临床试验总数", "stage3", "trial_count", "count"),
        ("活跃试验数", "stage3", "active_trials", "count"),
        ("竞争强度", "stage3", "competition_intensity", "text"),
        ("最高临床阶段", "stage3", "max_clinical_phase", "phase"),
        ("整体成功率", "stage4", "overall_success_rate", "percent"),
        ("研发总周期(月)", "stage4", "total_duration_months", "months"),
        ("总成本估算(百万美元)", "stage4", "total_cost_estimate", "money"),
        ("预计完成时间", "stage4", "estimated_completion", "text"),
        ("已有上市药物", "stage4", "has_approved_drugs", "bool"),
    ]

    recommendation = _build_recommendation(profiles)
    return {
        "available": len(profiles) >= 1,
        "profiles": profiles,
        "rows": [{"label_zh": label, "stage": stage, "key": key, "format": fmt} for label, stage, key, fmt in rows],
        "recommendation": recommendation,
    }


def _build_recommendation(profiles: list[dict[str, Any]]) -> str:
    if len(profiles) == 1:
        p = profiles[0]
        m4 = p["metrics"]["stage4"]
        m2 = p["metrics"]["stage2"]
        return (
            f"当前仅分析 {p['target']}（{p['disease']}）。"
            f"成药性评分 {m2.get('target_druggability', '—')}，"
            f"整体成功率 { _fmt_percent(m4.get('overall_success_rate')) }，"
            f"建议再分析 1–2 个对照靶点后使用对比功能。"
        )

    def score(profile: dict[str, Any]) -> float:
        m2 = profile["metrics"]["stage2"]
        m4 = profile["metrics"]["stage4"]
        drug = float(m2.get("target_druggability") or 0)
        success = float(m4.get("overall_success_rate") or 0)
        return drug * 0.6 + success * 0.4

    ranked = sorted(profiles, key=score, reverse=True)
    best = ranked[0]
    second = ranked[1]
    return (
        f"综合成药性与发展成功率，{best['target']}（{best['disease']}）当前优先级更高；"
        f"对照靶点 {second['target']} 可作为差异化或风险对照继续深挖。"
    )


def _fmt_percent(value: Any) -> str:
    if value is None:
        return "—"
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return str(value)


def discover_latest_run(output_dir: Path) -> tuple[str | None, str | None]:
    stage4 = output_dir / "stage4"
    if not stage4.exists():
        return None, None
    candidates = list(stage4.glob("*_business_plan.md"))
    if not candidates:
        candidates = list(stage4.glob("*_stage4_results.json"))
    if not candidates:
        return None, None
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    stem = latest.stem
    if stem.endswith("_business_plan"):
        base = stem[: -len("_business_plan")]
    elif stem.endswith("_stage4_results"):
        base = stem[: -len("_stage4_results")]
    else:
        return None, None
    if "_" in base:
        target, disease = base.split("_", 1)
        return target, disease.replace("_", " ")
    return base, None


def _find_report_file(output_dir: Path, patterns: list[str]) -> str | None:
    for pattern in patterns:
        matches = sorted(output_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
        if matches:
            return str(matches[0].resolve())
    return None


def build_report_bundle(
    output_dir: Path,
    *,
    current_target: str | None = None,
    current_disease: str | None = None,
) -> dict[str, Any]:
    """构建在线阅读用的分析报告包（非学术论文）。"""
    target = current_target or None
    disease = current_disease or None
    if not target:
        target, disease = discover_latest_run(output_dir)

    if not target:
        return {
            "available": False,
            "target": None,
            "disease": None,
            "note": "暂无可读报告。请先运行一次完整分析。",
            "sections": [],
            "summary_cards": [],
        }

    disease_token = (disease or "").replace(" ", " ")
    sections = [
        {
            "id": "stage1",
            "title_zh": "表达分析",
            "subtitle_zh": "多源表达与预后挖掘（GTEx / TCGA / HPA）",
            "kind": "markdown",
            "path": _find_report_file(output_dir, [
                f"stage1/{target}_stage1_report.md",
                f"stage1/*{target}*stage1_report.md",
            ]),
        },
        {
            "id": "stage2",
            "title_zh": "靶点筛选",
            "subtitle_zh": "候选靶点排名与成药性评分",
            "kind": "markdown",
            "path": _find_report_file(output_dir, [
                f"stage2/{disease_token}_stage2_report.md",
                f"stage2/*{disease_token}*stage2_report.md",
                "stage2/*_stage2_report.md",
            ]),
        },
        {
            "id": "stage3",
            "title_zh": "深度调研",
            "subtitle_zh": "文献、临床试验与竞争格局（不是学术论文）",
            "kind": "markdown",
            "path": _find_report_file(output_dir, [
                f"stage3/{target}_{disease_token}_stage3_report.md",
                f"stage3/*{target}*stage3_report.md",
            ]),
        },
        {
            "id": "stage4",
            "title_zh": "商业规划",
            "subtitle_zh": "里程碑、成功率与成本估算",
            "kind": "markdown",
            "path": _find_report_file(output_dir, [
                f"stage4/{target}_{disease_token}_business_plan.md",
                f"stage4/*{target}*business_plan.md",
            ]),
        },
        {
            "id": "evidence",
            "title_zh": "完整可视化报告",
            "subtitle_zh": "四阶段整合 HTML 证据包",
            "kind": "html",
            "path": _find_report_file(output_dir, [
                f"evidence_{target}_{disease_token.replace(' ', '_')}/report_{target}.html",
                f"evidence_*/report_{target}.html",
                "evidence_*/report_*.html",
            ]),
        },
        {
            "id": "manuscript",
            "title_zh": "期刊论文草稿",
            "subtitle_zh": "中文 IMRaD 结构稿件（含结构化摘要、图表与逐篇文献评述，投稿前需人工审校）",
            "kind": "markdown",
            "path": _find_report_file(output_dir, [
                f"manuscripts/{target}_{disease_token}_manuscript.md",
                f"manuscripts/{target}_{disease_token.replace(' ', '_')}_manuscript.md",
                "manuscripts/*_manuscript.md",
            ]),
        },
    ]

    stage4_path = _find_report_file(output_dir, [
        f"stage4/{target}_{disease_token}_stage4_results.json",
        f"stage4/*{target}*stage4_results.json",
    ])
    stage4_json = _read_json(Path(stage4_path)) if stage4_path else None

    summary_cards: list[dict[str, str]] = []
    if stage4_json:
        ms = (((stage4_json.get("stages") or {}).get("milestones") or {}).get("data") or {})
        adj = (ms.get("stage_adjustments") or {}).get("adjustment_details") or {}
        competitive = adj.get("competitive_landscape") or {}
        summary_cards = [
            {"label": "靶点", "value": target},
            {"label": "疾病", "value": disease or "—"},
            {"label": "成药性评分", "value": str(adj.get("druggability_score", "—"))},
            {"label": "整体成功率", "value": _fmt_percent(ms.get("overall_success_rate"))},
            {"label": "研发周期", "value": f"{ms.get('total_duration_months', '—')} 个月"},
            {"label": "成本估算", "value": f"${ms.get('total_cost_estimate', '—')}M"},
            {"label": "竞争强度", "value": str(competitive.get("competition_intensity", "—"))},
            {"label": "已有上市药", "value": "是" if competitive.get("has_approved_drugs") else "否"},
        ]

    available_sections = [s for s in sections if s.get("path")]
    return {
        "available": bool(available_sections),
        "target": target,
        "disease": disease,
        "note": (
            "包含四阶段靶点分析汇报与期刊论文草稿。"
            "论文草稿为基于公开数据的 IMRaD 骨架，不可直接投稿，需补充实验与作者信息。"
        ),
        "sections": sections,
        "summary_cards": summary_cards,
    }


def summarize_json_preview(filename: str, payload: dict[str, Any]) -> list[dict[str, str]]:
    """将 JSON 原始数据提炼为研究者可读的摘要条目。"""
    rows: list[dict[str, str]] = []
    lower = filename.lower()

    if "business_plan" in lower or "stage4" in lower:
        ms = (((payload.get("stages") or {}).get("milestones") or {}).get("data") or payload)
        rows.extend([
            {"label": "靶点", "value": str(payload.get("target") or ms.get("target") or "—")},
            {"label": "疾病", "value": str(payload.get("disease") or ms.get("disease") or "—")},
            {"label": "整体成功率", "value": _fmt_percent(ms.get("overall_success_rate"))},
            {"label": "研发周期", "value": f"{ms.get('total_duration_months', '—')} 个月"},
            {"label": "成本估算", "value": f"${ms.get('total_cost_estimate', '—')}M"},
        ])
        return rows

    if "stage2" in lower:
        summary = payload.get("summary") or {}
        top = (summary.get("top_candidates") or [{}])[0]
        rows.extend([
            {"label": "疾病", "value": str(summary.get("disease") or payload.get("disease") or "—")},
            {"label": "Top 候选", "value": str(top.get("gene") or "—")},
            {"label": "Top 评分", "value": str(top.get("score") or "—")},
            {"label": "成药性", "value": str(top.get("druggability_score") or "—")},
        ])
        return rows

    if "stage3" in lower:
        clinical = (((payload.get("stages") or {}).get("clinical_pipeline") or {}).get("data") or {})
        summary = (clinical.get("sections") or {}).get("clinical_pipeline", clinical).get("summary") or clinical.get("summary") or {}
        rows.extend([
            {"label": "靶点", "value": str(payload.get("target") or "—")},
            {"label": "临床试验数", "value": str(summary.get("total_trials") or "—")},
            {"label": "活跃试验", "value": str(summary.get("active_trials") or "—")},
            {"label": "竞争强度", "value": str(summary.get("competition_intensity") or "—")},
        ])
        return rows

    if "stage1" in lower or payload.get("gene"):
        summary = payload.get("summary") or {}
        findings = summary.get("key_findings") or []
        rows.extend([
            {"label": "基因", "value": str(payload.get("gene") or "—")},
            {"label": "置信度", "value": str(summary.get("confidence_level") or "—")},
            {"label": "关键发现", "value": str(findings[0] if findings else "—")},
        ])
        return rows

    if "milestone" in lower:
        rows.append({"label": "里程碑数", "value": str(len(payload.get("milestones") or []))})
        return rows

    for key in ("target", "disease", "gene", "success", "status"):
        if key in payload:
            rows.append({"label": key, "value": str(payload[key])})
    return rows[:8]
