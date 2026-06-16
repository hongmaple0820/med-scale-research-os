#!/usr/bin/env python3
"""
Nature Skills Bridge: 将工作流数据转换为 nature-paper2ppt 可用的输入格式。

定位：
- 我们的工作流 = 数据采集/分析
- nature-skills = 报告/PPT生成

这个模块负责将分析结果转换为 nature-paper2ppt 能理解的格式。
"""

import json
from pathlib import Path
from typing import Dict, List, Optional


def build_paper_input(gene: str, output_dir: Path) -> dict:
    """将工作流输出转换为 nature-paper2ppt 的输入格式。

    Args:
        gene: 基因符号
        output_dir: 工作流输出目录

    Returns:
        dict: 符合 nature-paper2ppt 输入格式的数据
    """
    output_dir = Path(output_dir)

    # 加载所有阶段数据
    phase1_data = _load_phase1_data(gene, output_dir)
    phase2_data = _load_phase2_data(gene, output_dir)
    phase3_data = _load_phase3_data(gene, output_dir)
    phase4_data = _load_phase4_data(gene, output_dir)

    # 构建论文输入
    paper_input = {
        "title": f"{gene} 靶点智能分析报告",
        "authors": ["Target Intelligence Pipeline"],
        "journal": "Auto-generated Analysis Report",
        "year": "2026",
        "field": "Drug Target Analysis",
        "subfield": "Oncology",
        "paper_type": "resource",  # 资源/数据集类论文
        "central_problem": f"系统分析 {gene} 作为药物靶点的潜力",
        "main_claim": _build_main_claim(gene, phase1_data, phase3_data),
        "study_design": "多数据源整合分析",
        "key_methods": [
            "GTEx 组织表达谱分析",
            "TCGA 生存分析",
            "免疫微环境分析",
            "临床试验数据挖掘",
            "专利格局分析",
        ],
        "main_results": _build_main_results(gene, phase1_data, phase2_data, phase3_data),
        "key_figures": _collect_figures(output_dir),
        "limitations": _build_limitations(phase1_data),
        "translational_meaning": _build_translational_meaning(gene, phase3_data, phase4_data),
    }

    return paper_input


def _load_phase1_data(gene: str, output_dir: Path) -> dict:
    """加载 Phase 1 数据。"""
    data = {}

    # GTEx 表达
    gtex_file = output_dir / f"gtex_{gene}_expression.json"
    if gtex_file.exists():
        data["gtex"] = json.loads(gtex_file.read_text(encoding="utf-8"))

    # 生存分析
    for f in output_dir.glob(f"survival_*_results.json"):
        data["survival"] = json.loads(f.read_text(encoding="utf-8"))
        break

    # 免疫分析
    for f in output_dir.glob(f"immune_*_correlation.json"):
        data["immune"] = json.loads(f.read_text(encoding="utf-8"))
        break

    # TME 分析
    tme_file = output_dir / f"tme_{gene}_*_profile.json"
    for f in output_dir.glob(tme_file.name if '*' in tme_file.name else f"tme_{gene}_*_profile.json"):
        data["tme"] = json.loads(f.read_text(encoding="utf-8"))
        break

    # 蛋白验证
    protein_file = output_dir / f"protein_{gene}_validation.json"
    if protein_file.exists():
        data["protein"] = json.loads(protein_file.read_text(encoding="utf-8"))

    return data


def _load_phase2_data(gene: str, output_dir: Path) -> dict:
    """加载 Phase 2 数据。"""
    data = {}

    # 靶点优先级
    for f in output_dir.glob("target_priority_*.json"):
        data["priority"] = json.loads(f.read_text(encoding="utf-8"))
        break

    # 可药性
    for f in output_dir.glob(f"pharos_{gene}_druggability.json"):
        data["druggability"] = json.loads(f.read_text(encoding="utf-8"))
        break

    return data


def _load_phase3_data(gene: str, output_dir: Path) -> dict:
    """加载 Phase 3 数据。"""
    data = {}

    # 竞争格局
    comp_file = output_dir / f"competitive_{gene}_intelligence.json"
    if comp_file.exists():
        data["competitive"] = json.loads(comp_file.read_text(encoding="utf-8"))

    # 专利
    patent_file = output_dir / f"patent_{gene}_landscape.json"
    if patent_file.exists():
        data["patent"] = json.loads(patent_file.read_text(encoding="utf-8"))

    # 证据分级
    profile_file = output_dir / f"tooluniverse_{gene}_research_profile.json"
    if profile_file.exists():
        data["research_profile"] = json.loads(profile_file.read_text(encoding="utf-8"))

    return data


def _load_phase4_data(gene: str, output_dir: Path) -> dict:
    """加载 Phase 4 数据。"""
    data = {}

    # 里程碑
    milestone_file = output_dir / f"milestones_{gene}.json"
    if milestone_file.exists():
        data["milestones"] = json.loads(milestone_file.read_text(encoding="utf-8"))

    # 商业计划
    bp_file = output_dir / f"business_plan_{gene}.json"
    if bp_file.exists():
        data["business_plan"] = json.loads(bp_file.read_text(encoding="utf-8"))

    return data


def _build_main_claim(gene: str, phase1: dict, phase3: dict) -> str:
    """构建主要结论。"""
    parts = []

    # 表达信息
    gtex = phase1.get("gtex", {})
    if gtex:
        tau = gtex.get("summary_stats", {}).get("tau_index", 0)
        if tau and tau > 0.5:
            parts.append(f"{gene} 表现组织特异性表达 (Tau={tau:.3f})")

    # 生存信息
    surv = phase1.get("survival", {}).get("survival_stats", {})
    if surv:
        hr = surv.get("cox_regression", {}).get("hazard_ratio", 0)
        pval = surv.get("cox_regression", {}).get("cox_pvalue", 1)
        if pval < 0.05:
            direction = "不良" if hr > 1 else "良好"
            parts.append(f"表达与{direction}预后显著相关 (HR={hr:.3f})")

    # 竞争信息
    comp = phase3.get("competitive", {}).get("competition", {})
    if comp:
        n_drugs = len(comp.get("approved_drugs", []))
        if n_drugs:
            parts.append(f"已有 {n_drugs} 个上市药物")

    return "。".join(parts) if parts else f"{gene} 是一个有潜力的药物靶点"


def _build_main_results(gene: str, phase1: dict, phase2: dict, phase3: dict) -> List[str]:
    """构建主要结果列表。"""
    results = []

    # 表达结果
    gtex = phase1.get("gtex", {})
    if gtex:
        n_tissues = len(gtex.get("expression_by_tissue", {}))
        results.append(f"在 {n_tissues} 个组织中检测到表达")

    # 生存结果
    surv = phase1.get("survival", {}).get("survival_stats", {})
    if surv:
        n_patients = surv.get("n_high", 0) + surv.get("n_low", 0)
        results.append(f"生存分析纳入 {n_patients} 例患者")

    # 免疫结果
    immune = phase1.get("immune", {}).get("immune_correlations", {})
    if immune:
        sig_cells = [k for k, v in immune.items() if isinstance(v, dict) and v.get("significant")]
        results.append(f"与 {len(sig_cells)} 种免疫细胞显著相关")

    # TME 结果
    tme = phase1.get("tme", {})
    if tme:
        phenotype = tme.get("phenotype", "")
        if phenotype:
            results.append(f"TME 表型: {phenotype}")

    # 竞争结果
    comp = phase3.get("competitive", {}).get("competition", {})
    if comp:
        n_trials = comp.get("total_trials", 0)
        results.append(f"临床试验: {n_trials} 个")

    return results


def _collect_figures(output_dir: Path) -> List[Dict]:
    """收集所有图表文件。"""
    figures = []

    for f in sorted(output_dir.glob("*.png")):
        figures.append({
            "path": str(f),
            "name": f.stem,
            "type": _classify_figure(f.stem),
        })

    return figures


def _classify_figure(filename: str) -> str:
    """根据文件名分类图表类型。"""
    filename_lower = filename.lower()

    if "expression" in filename_lower or "gtex" in filename_lower:
        return "expression"
    elif "survival" in filename_lower or "km" in filename_lower:
        return "survival"
    elif "immune" in filename_lower or "heatmap" in filename_lower:
        return "immune"
    elif "competitive" in filename_lower or "key_players" in filename_lower:
        return "competitive"
    elif "patent" in filename_lower:
        return "patent"
    elif "milestone" in filename_lower or "timeline" in filename_lower:
        return "milestone"
    elif "priority" in filename_lower:
        return "priority"
    else:
        return "other"


def _build_limitations(phase1: dict) -> List[str]:
    """构建局限性说明。"""
    limitations = []

    # 样本量限制
    surv = phase1.get("survival", {}).get("survival_stats", {})
    if surv:
        n = surv.get("n_high", 0) + surv.get("n_low", 0)
        if n < 100:
            limitations.append(f"生存分析样本量较小 (n={n})")

    # 免疫分析限制
    immune = phase1.get("immune", {})
    if immune:
        n_samples = immune.get("n_samples_analyzed", 0)
        if n_samples < 50:
            limitations.append(f"免疫分析样本量有限 (n={n_samples})")

    limitations.append("基于公开数据库，可能存在选择偏倚")
    limitations.append("需要实验验证")

    return limitations


def _build_translational_meaning(gene: str, phase3: dict, phase4: dict) -> str:
    """构建转化意义说明。"""
    parts = []

    # 已上市药物
    comp = phase3.get("competitive", {}).get("competition", {})
    if comp:
        approved = comp.get("approved_drugs", [])
        if approved:
            drug_names = [d.get("name", "") for d in approved[:3]]
            parts.append(f"已有上市药物: {', '.join(drug_names)}")

    # 开发时间线
    milestones = phase4.get("milestones", {})
    if milestones:
        total_months = milestones.get("total_timeline_months", 0)
        if total_months and isinstance(total_months, (int, float)):
            parts.append(f"预计开发周期: {total_months} 个月 ({total_months/12:.1f} 年)")
        elif isinstance(total_months, str) and total_months:
            parts.append(f"预计开发周期: {total_months}")

    return "。".join(parts) if parts else f"{gene} 具有药物开发潜力"


def save_paper_input(gene: str, output_dir: Path) -> Path:
    """生成并保存 nature-paper2ppt 输入文件。"""
    output_dir = Path(output_dir)
    paper_input = build_paper_input(gene, output_dir)

    # 保存为 JSON
    input_path = output_dir / f"nature_input_{gene}.json"
    input_path.write_text(
        json.dumps(paper_input, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    # 保存为 Markdown (nature-paper2ppt 可接受的格式)
    md_path = output_dir / f"nature_input_{gene}.md"
    md_content = _convert_to_markdown(paper_input)
    md_path.write_text(md_content, encoding="utf-8")

    print(f"[Nature Bridge] Input files saved:")
    print(f"  JSON: {input_path}")
    print(f"  Markdown: {md_path}")

    return md_path


def _convert_to_markdown(paper_input: dict) -> str:
    """将论文输入转换为 Markdown 格式。"""
    lines = [
        f"# {paper_input.get('title', '')}",
        "",
        f"**作者:** {', '.join(paper_input.get('authors', []))}",
        f"**期刊:** {paper_input.get('journal', '')}",
        f"**年份:** {paper_input.get('year', '')}",
        f"**领域:** {paper_input.get('field', '')} - {paper_input.get('subfield', '')}",
        "",
        "## 核心问题",
        "",
        paper_input.get("central_problem", ""),
        "",
        "## 主要结论",
        "",
        paper_input.get("main_claim", ""),
        "",
        "## 研究设计",
        "",
        paper_input.get("study_design", ""),
        "",
        "## 关键方法",
        "",
    ]

    for method in paper_input.get("key_methods", []):
        lines.append(f"- {method}")

    lines.extend([
        "",
        "## 主要结果",
        "",
    ])

    for result in paper_input.get("main_results", []):
        lines.append(f"- {result}")

    lines.extend([
        "",
        "## 图表",
        "",
    ])

    for fig in paper_input.get("key_figures", []):
        lines.append(f"- {fig.get('name', '')} ({fig.get('type', '')})")

    lines.extend([
        "",
        "## 局限性",
        "",
    ])

    for limit in paper_input.get("limitations", []):
        lines.append(f"- {limit}")

    lines.extend([
        "",
        "## 转化意义",
        "",
        paper_input.get("translational_meaning", ""),
    ])

    return "\n".join(lines)
