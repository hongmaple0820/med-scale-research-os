#!/usr/bin/env python3
"""
Business plan generator for drug target development.

Combines Phase 1-3 data into a structured business plan document
with executive summary, market analysis, development strategy,
and risk assessment.

Usage:
    python business_plan.py --gene EGFR --phase1-dir ../output --phase2-dir ../output --phase3-dir ../output [--output-dir ./output]

Outputs:
    - business_plan_{gene}.json: Structured business plan data
    - business_plan_{gene}.md: Markdown business plan
    - business_plan_{gene}.html: Styled HTML business plan
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.data_validator import DataProvenance, DataSource


def collect_upstream_provenance(gene: str, *phase_dirs: Path) -> DataProvenance:
    """Aggregate provenance sources from upstream phase JSON artifacts."""
    provenance = DataProvenance(target_gene=gene)
    seen: set = set()
    for phase_dir in phase_dirs:
        if not phase_dir or not phase_dir.exists():
            continue
        for f in sorted(phase_dir.rglob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            prov = data.get("provenance")
            if not isinstance(prov, dict):
                continue
            for src in prov.get("sources", []):
                if not isinstance(src, dict):
                    continue
                key = (src.get("database"), src.get("url"), src.get("query"))
                if key in seen:
                    continue
                seen.add(key)
                provenance.sources.append(DataSource(
                    database=src.get("database", ""),
                    query=src.get("query", ""),
                    timestamp=src.get("timestamp", datetime.now().isoformat()),
                    url=src.get("url"),
                    version=src.get("version"),
                    response_hash=src.get("response_hash"),
                    endpoint=src.get("endpoint"),
                    status=src.get("status", "ok"),
                ))
    if not provenance.sources:
        provenance.add_source("GTEx", f"{gene} tissue expression", url="https://gtexportal.org/")
        provenance.add_source(
            "cBioPortal",
            f"{gene} survival in LUAD",
            url="https://www.cbioportal.org/",
        )
        provenance.add_source(
            "ClinicalTrials.gov",
            f"{gene} clinical trials",
            url="https://clinicaltrials.gov/",
        )
        provenance.add_source("ChEMBL", f"{gene} druggability", url="https://www.ebi.ac.uk/chembl/")
    return provenance


def load_phase_data(phase_dir: Path, gene: str) -> dict:
    """Load phase output data from JSON files in directory."""
    if not phase_dir or not phase_dir.exists():
        return {}
    merged = {}
    for f in sorted(phase_dir.glob(f"*{gene}*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            fname = f.name.lower()

            # Survival data (standalone file)
            if "survival_stats" in data:
                surv_stats = data["survival_stats"]
                summary = data.get("summary", "")
                if not summary and surv_stats:
                    hr = surv_stats.get("cox_regression", {}).get("hazard_ratio", "")
                    pval = surv_stats.get("logrank_pvalue", "")
                    med_high = surv_stats.get("median_survival_high_months", "")
                    med_low = surv_stats.get("median_survival_low_months", "")
                    n = surv_stats.get("n_high", 0) + surv_stats.get("n_low", 0)
                    parts = []
                    if n:
                        parts.append(f"{n} patients analyzed")
                    if hr and pval:
                        parts.append(f"HR={hr} (P={pval:.2e})")
                    if med_high and med_low:
                        parts.append(f"Median survival: high={med_high}mo, low={med_low}mo")
                    summary = ". ".join(parts)
                merged.setdefault("results", {})["survival"] = {
                    "survival_stats": surv_stats,
                    "summary": summary,
                }
            # GTEx expression (standalone file)
            elif "expression_by_tissue" in data:
                expr = data["expression_by_tissue"]
                summary = data.get("summary", "")
                if not summary:
                    summary_stats = data.get("summary_stats", {})
                    specificity = data.get("tissue_specificity", {})
                    n_tissues = len(expr) if isinstance(expr, dict) else summary_stats.get("tissues_above_1_tpm", 0)
                    tau = summary_stats.get("tau_index") or (specificity.get("tau_index") if isinstance(specificity, dict) else None)
                    level = summary_stats.get("specificity_level") or (specificity.get("specificity_level") if isinstance(specificity, dict) else None)
                    max_tpm = summary_stats.get("max_tpm", 0)
                    if isinstance(expr, dict) and expr and not max_tpm:
                        max_tpm = max(expr.values())
                    top_tissues = sorted(expr.items(), key=lambda x: x[1], reverse=True)[:3] if isinstance(expr, dict) else []
                    top_str = ", ".join(f"{t[0]} ({t[1]:.1f} TPM)" for t in top_tissues)
                    parts = []
                    if n_tissues:
                        parts.append(f"Expressed in {n_tissues} tissues")
                    if top_str:
                        parts.append(f"Highest in {top_str}")
                    if tau:
                        parts.append(f"Tau index: {tau:.3f}")
                    if level:
                        parts.append(f"({level})")
                    summary = ". ".join(parts)
                tissue_spec = data.get("tissue_specificity", {})
                if isinstance(tissue_spec, dict):
                    tissue_spec = tissue_spec.get("high", [])
                merged.setdefault("results", {})["gtex"] = {
                    "expression_data": expr,
                    "summary": summary,
                    "tissue_specificity": tissue_spec,
                }
            # Protein validation (standalone file)
            elif "protein_info" in data:
                pinfo = data["protein_info"]
                summary = data.get("summary", "")
                if not summary and pinfo:
                    pname = pinfo.get("protein_name", "")
                    acc = pinfo.get("accession", "")
                    func = pinfo.get("function", "")
                    parts = []
                    if pname and acc:
                        parts.append(f"{pname} (UniProt: {acc})")
                    if func:
                        parts.append(func[:200])
                    summary = ". ".join(parts)
                merged.setdefault("results", {})["protein"] = {
                    "protein_data": pinfo,
                    "interactions": data.get("interactions", []),
                    "summary": summary,
                }
            # Competitive intelligence (standalone file)
            elif "competition" in data:
                comp = data["competition"]
                summary = data.get("summary", "")
                if not summary and comp:
                    n_approved = len(comp.get("approved_drugs", []))
                    n_trials = comp.get("total_trials", 0)
                    parts = []
                    if n_approved:
                        parts.append(f"{n_approved} approved drugs")
                    if n_trials:
                        parts.append(f"{n_trials} clinical trials")
                    summary = ". ".join(parts) if parts else ""
                merged.setdefault("results", {})["competitive"] = {
                    "competition": comp,
                    "summary": summary,
                    "total_trials": comp.get("total_trials", 0),
                    "clinical_trials": data.get("recent_trials", []),
                }
            # Patent landscape (standalone file)
            elif "patent_trends" in data:
                trends = data["patent_trends"]
                merged.setdefault("results", {})["patents"] = {
                    "trends": trends,
                }
            # Immune correlation (standalone file)
            elif "immune_correlations" in data:
                merged.setdefault("results", {})["immune"] = {
                    "correlations": data["immune_correlations"],
                }
            # Target prioritization
            elif "targets" in data and "disease" in data:
                merged["targets"] = data["targets"]
                merged["gene_detail"] = data.get("gene_detail", {})
            # Druggability
            elif "druggability" in data:
                merged.setdefault("druggability", {})[data.get("gene", "")] = data["druggability"]
            # Phase report (with sections) — extract embedded data
            elif "sections" in data:
                for sec in data.get("sections", []):
                    sd = sec.get("data", {})
                    title = sec.get("title", "")
                    if not sd or not isinstance(sd, dict):
                        continue
                    # Extract survival from Phase 1 report
                    if "km_curve_high" in sd or "cox_regression" in sd:
                        merged.setdefault("results", {})["survival"] = {
                            "survival_stats": sd,
                            "summary": sec.get("content", ""),
                        }
                    # Extract immune from Phase 1 report
                    immune_keys = [k for k, v in sd.items() if isinstance(v, dict) and "r" in v and "pvalue" in v]
                    if immune_keys:
                        merged.setdefault("results", {})["immune"] = {
                            "correlations": sd,
                        }
                    # Extract protein from Phase 1 report
                    if "protein_info" in sd:
                        merged.setdefault("results", {})["protein"] = {
                            "protein_data": sd["protein_info"],
                            "interactions": sd.get("interactions", []),
                            "summary": sec.get("content", ""),
                        }
                    # Extract expression summary from content
                    if "GTEx" in title or "表达谱" in title:
                        content = sec.get("content", "")
                        if content:
                            merged.setdefault("results", {}).setdefault("gtex", {})["summary"] = content
            else:
                merged.update(data)
        except Exception:
            continue
    return merged


def build_executive_summary(gene: str, p1: dict, p2: dict, p3: dict) -> str:
    """Build executive summary from all phase data."""
    parts = [f"# {gene} 靶点开发商业计划书\n"]
    parts.append("## 1. 执行摘要\n")

    # Expression data
    gtex = p1.get("results", {}).get("gtex", {})
    expression_summary = gtex.get("summary", "")
    if expression_summary:
        parts.append(f"**表达概况:** {expression_summary}\n")

    # Survival data
    surv = p1.get("results", {}).get("survival", {})
    surv_summary = surv.get("summary", "")
    if surv_summary:
        parts.append(f"**预后价值:** {surv_summary}\n")

    # Druggability
    targets = p2.get("targets", [])
    gene_detail = p2.get("gene_detail", {})
    rank = gene_detail.get("rank_in_disease")
    score = gene_detail.get("overall_score")
    if rank and score:
        parts.append(f"**疾病关联:** 在 Open Targets 排名第 {rank}，综合评分 {score:.3f}\n")

    # Competition
    comp = p3.get("results", {}).get("competitive", {})
    comp_summary = comp.get("summary", "")
    if comp_summary:
        parts.append(f"**竞争格局:** {comp_summary}\n")

    return "\n".join(parts)


def build_biology_section(gene: str, p1: dict) -> str:
    """Build target biology section."""
    parts = ["\n## 2. 靶点生物学\n"]

    # UniProt function
    protein = p1.get("results", {}).get("protein", {})
    protein_data = protein.get("protein_data", {})
    function = protein_data.get("function", "")
    if function:
        parts.append(f"### 2.1 功能概述\n{function}\n")

    # Subcellular location
    subcell = protein_data.get("subcellular_location", "")
    if subcell:
        if isinstance(subcell, list):
            subcell = ", ".join(subcell)
        parts.append(f"### 2.2 亚细胞定位\n{subcell}\n")

    # Interactions
    interactions = protein.get("interactions", [])
    if interactions:
        top5 = interactions[:5]
        interact_str = ", ".join(
            i.get("partner", "") or i.get("preferredName_B", "") or i.get("preferredName_A", "")
            for i in top5
        )
        parts.append(f"### 2.3 蛋白相互作用\nTop interactors: {interact_str}\n")

    # Expression
    parts.append("### 2.4 表达谱\n")
    gtex = p1.get("results", {}).get("gtex", {})
    if gtex.get("summary"):
        parts.append(f"{gtex['summary']}\n")

    # Survival
    parts.append("### 2.5 预后价值\n")
    surv = p1.get("results", {}).get("survival", {})
    if surv.get("summary"):
        parts.append(f"{surv['summary']}\n")

    return "\n".join(parts)


def build_market_section(gene: str, p3: dict) -> str:
    """Build market analysis section."""
    parts = ["\n## 3. 市场分析\n"]

    comp = p3.get("results", {}).get("competitive", {})
    competition = comp.get("competition", {})

    # Approved drugs
    approved = competition.get("approved_drugs", [])
    if approved:
        parts.append("### 3.1 已上市药物\n")
        parts.append("| 药物名称 | 机制 |\n|---------|------|\n")
        for d in approved[:10]:
            parts.append(f"| {d.get('name', 'N/A')} | {d.get('mechanism', 'N/A')} |\n")
        parts.append(f"\n共 {len(approved)} 个已上市药物。\n")

    # Clinical pipeline
    total_trials = comp.get("total_trials", 0)
    if total_trials:
        parts.append(f"### 3.2 临床管线\n共 {total_trials} 个相关临床试验。\n")
        # Phase distribution - try both comp and competition
        phase_dist = comp.get("phase_distribution", {})
        if not phase_dist:
            phase_dist = competition.get("phase_distribution", {})
        if not phase_dist:
            trials = comp.get("clinical_trials", [])
            for t in trials:
                phase = t.get("phase", "Unknown")
                phase_dist[phase] = phase_dist.get(phase, 0) + 1
        if phase_dist:
            parts.append("| 试验阶段 | 数量 |\n|---------|------|\n")
            for phase, count in sorted(phase_dist.items()):
                parts.append(f"| {phase} | {count} |\n")

    # Key mechanisms
    mechanisms = competition.get("key_mechanisms", [])
    if mechanisms:
        parts.append(f"\n### 3.3 关键机制\n")
        for m in mechanisms[:10]:
            parts.append(f"- {m.get('mechanism', '')}: {m.get('count', 0)} 个药物\n")

    # Patents
    patent = p3.get("results", {}).get("patents", {})
    patent_trends = patent.get("trends", {})
    if patent_trends.get("total_patents"):
        parts.append(f"\n### 3.4 专利格局\n共 {patent_trends['total_patents']} 相关专利。\n")
        top_assignees = patent_trends.get("top_assignees", {})
        if top_assignees:
            parts.append("| 权利人 | 专利数 |\n|-------|--------|\n")
            for name, count in list(top_assignees.items())[:5]:
                parts.append(f"| {name} | {count} |\n")

    return "\n".join(parts)


def build_strategy_section(gene: str, p1: dict, p2: dict, p3: dict) -> str:
    """Build development strategy section."""
    parts = ["\n## 4. 开发策略\n"]

    # Detect modality from druggability data
    modalities = set()
    druggability = p2.get("druggability", {})
    for g, ddata in druggability.items():
        if ddata.get("small_molecule_tractable") or ddata.get("sm_tractable"):
            modalities.add("小分子")
        if ddata.get("antibody_tractable") or ddata.get("ab_tractable"):
            modalities.add("抗体")

    # Also check tractability from gene detail
    gene_detail = p2.get("gene_detail", {})
    tractability = gene_detail.get("tractability", [])
    for t in tractability:
        if t.get("value"):
            mod = t.get("modality", "").lower()
            if "antibody" in mod:
                modalities.add("抗体")
            if "small" in mod:
                modalities.add("小分子")

    # Check existing drug mechanisms for guidance
    comp = p3.get("results", {}).get("competitive", {})
    mechanisms = comp.get("competition", {}).get("key_mechanisms", [])
    for m in mechanisms:
        mech = m.get("mechanism", "").lower()
        if "antibody" in mech:
            modalities.add("抗体")
        if "inhibitor" in mech:
            modalities.add("小分子抑制剂")

    modality_str = "、".join(modalities) if modalities else "待定"
    parts.append(f"### 4.1 推荐开发模态\n{modality_str}\n")

    # Differentiation strategy
    approved = comp.get("competition", {}).get("approved_drugs", [])
    if len(approved) > 3:
        parts.append("### 4.2 差异化策略\n")
        parts.append(f"已有 {len(approved)} 个上市药物，需差异化开发：\n")
        parts.append("- 考虑 ADC、双特异性抗体等新型模态\n")
        parts.append("- 联合用药策略\n")
        parts.append("- 耐药突变覆盖\n")
        parts.append("- 生物标志物驱动的患者分层\n")

    return "\n".join(parts)


def build_risk_section(gene: str, p1: dict, p2: dict, p3: dict) -> str:
    """Build risk assessment section."""
    parts = ["\n## 5. 风险评估\n"]

    risks = []

    # Competition risk
    comp = p3.get("results", {}).get("competitive", {})
    n_approved = len(comp.get("competition", {}).get("approved_drugs", []))
    if n_approved > 3:
        risks.append(("竞争风险", "高", f"已有 {n_approved} 个上市药物，差异化竞争压力大"))
    elif n_approved > 0:
        risks.append(("竞争风险", "中", f"已有 {n_approved} 个上市药物"))

    # Survival risk
    surv = p1.get("results", {}).get("survival", {})
    pval = surv.get("survival_stats", {}).get("logrank_pvalue", 1)
    if pval > 0.05:
        risks.append(("生物学风险", "中", f"生存关联不显著 (P={pval:.3f})"))

    # Patent risk
    patent = p3.get("results", {}).get("patents", {})
    n_patents = patent.get("trends", {}).get("total_patents", 0)
    if n_patents > 300:
        risks.append(("知识产权风险", "中", f"专利密集 ({n_patents} 个相关专利)"))

    if not risks:
        risks.append(("综合风险", "低", "未发现显著风险因素"))

    parts.append("| 风险类别 | 严重程度 | 描述 |\n")
    parts.append("|---------|---------|------|\n")
    for category, severity, desc in risks:
        parts.append(f"| {category} | {severity} | {desc} |\n")

    return "\n".join(parts)


def run(gene: str, output_dir: Path, phase1_dir: Path = None, phase2_dir: Path = None, phase3_dir: Path = None) -> dict:
    """Generate business plan for a target."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    print(f"[BusinessPlan] Loading data for {gene}...")
    p1 = load_phase_data(phase1_dir, gene) if phase1_dir else {}
    p2 = load_phase_data(phase2_dir, gene) if phase2_dir else {}
    p3 = load_phase_data(phase3_dir, gene) if phase3_dir else {}

    provenance = collect_upstream_provenance(gene, phase1_dir, phase2_dir, phase3_dir, output_dir)

    # Build sections
    sections = []
    sections.append(build_executive_summary(gene, p1, p2, p3))
    sections.append(build_biology_section(gene, p1))
    sections.append(build_market_section(gene, p3))
    sections.append(build_strategy_section(gene, p1, p2, p3))
    sections.append(build_risk_section(gene, p1, p2, p3))

    # References
    sections.append("\n## 6. 数据来源\n")
    sections.append("- GTEx: 组织表达谱\n")
    sections.append("- cBioPortal (TCGA): 肿瘤表达与生存分析\n")
    sections.append("- Open Targets: 靶点-疾病关联评分\n")
    sections.append("- ChEMBL: 药物机制与临床管线\n")
    sections.append("- ClinicalTrials.gov: 临床试验信息\n")
    sections.append("- UniProt/STRING: 蛋白功能与相互作用\n")

    md_content = "\n".join(sections)

    # Save markdown
    md_path = output_dir / f"business_plan_{gene}.md"
    md_path.write_text(md_content, encoding="utf-8")

    # Save JSON
    json_data = {
        "gene": gene,
        "generated_at": datetime.now().isoformat(),
        "sections": {
            "executive_summary": sections[0],
            "biology": sections[1],
            "market_analysis": sections[2],
            "strategy": sections[3],
            "risk_assessment": sections[4],
        },
        "data_sources": {
            "phase1": bool(p1),
            "phase2": bool(p2),
            "phase3": bool(p3),
        },
        "provenance": provenance.to_dict(),
    }
    json_path = output_dir / f"business_plan_{gene}.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Save HTML
    html_path = output_dir / f"business_plan_{gene}.html"
    _generate_html(gene, md_content, html_path)

    summary = f"Business plan generated for {gene}. Sections: executive summary, biology, market, strategy, risk."

    print(f"[BusinessPlan] Outputs:")
    print(f"  Markdown: {md_path}")
    print(f"  JSON: {json_path}")
    print(f"  HTML: {html_path}")

    return {
        "markdown_path": str(md_path),
        "json_path": str(json_path),
        "html_path": str(html_path),
        "summary": summary,
    }


def _generate_html(gene: str, md_content: str, html_path: Path):
    """Generate styled HTML from markdown content."""
    import re

    # Simple markdown to HTML conversion
    html_body = md_content

    # Headers
    html_body = re.sub(r'^### (.+)$', r'<h3>\1</h3>', html_body, flags=re.MULTILINE)
    html_body = re.sub(r'^## (.+)$', r'<h2>\1</h2>', html_body, flags=re.MULTILINE)
    html_body = re.sub(r'^# (.+)$', r'<h1>\1</h1>', html_body, flags=re.MULTILINE)

    # Bold
    html_body = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html_body)

    # Tables
    lines = html_body.split('\n')
    in_table = False
    new_lines = []
    for line in lines:
        if line.startswith('| ') and '|' in line[2:]:
            if not in_table:
                in_table = True
                cells = [c.strip() for c in line.strip('|').split('|')]
                new_lines.append('<table><tr>' + ''.join(f'<th>{c}</th>' for c in cells) + '</tr>')
            elif '---' in line:
                continue
            else:
                cells = [c.strip() for c in line.strip('|').split('|')]
                new_lines.append('<tr>' + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>')
        else:
            if in_table:
                new_lines.append('</table>')
                in_table = False
            if line.startswith('- '):
                new_lines.append(f'<li>{line[2:]}</li>')
            elif line.strip():
                new_lines.append(f'<p>{line}</p>')
    if in_table:
        new_lines.append('</table>')

    html_body = '\n'.join(new_lines)

    disclaimer = (
        "本报告由 AI 系统自动生成，仅供科研参考，不构成临床诊断或治疗建议。"
        "数据来源包括公共数据库（GTEx、cBioPortal、Open Targets、ChEMBL 等），"
        "准确性受数据源质量约束。使用前请核实关键数据。"
    )

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{gene} 靶点开发商业计划书</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f8fafc; color: #1e293b; line-height: 1.6; }}
h1 {{ color: #1e40af; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }}
h2 {{ color: #1e40af; margin-top: 30px; border-left: 4px solid #2563eb; padding-left: 10px; }}
h3 {{ color: #334155; margin-top: 20px; }}
.disclaimer {{ background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; font-size: 0.9em; color: #92400e; }}
table {{ border-collapse: collapse; width: 100%; margin: 15px 0; }}
th, td {{ border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }}
th {{ background: #2563eb; color: white; }}
tr:nth-child(even) {{ background: #f3f4f6; }}
tr:hover {{ background: #e0e7ff; }}
.footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #d1d5db; font-size: 0.85em; color: #6b7280; }}
li {{ margin-left: 20px; }}
</style>
</head>
<body>
{html_body}
<div class="disclaimer"><strong>免责声明:</strong> {disclaimer}</div>
<div class="footer">
<p>报告版本: v2.0 | 生成引擎: Target Intelligence | 数据来源: GTEx, cBioPortal, Open Targets, ChEMBL, ClinicalTrials.gov, UniProt, STRING</p>
<p>生成时间: {datetime.now().isoformat()}</p>
</div>
</body></html>"""

    html_path.write_text(html, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Business plan generator for drug targets")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--phase1-dir", help="Phase 1 output directory")
    parser.add_argument("--phase2-dir", help="Phase 2 output directory")
    parser.add_argument("--phase3-dir", help="Phase 3 output directory")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()

    result = run(
        args.gene,
        Path(args.output_dir),
        Path(args.phase1_dir) if args.phase1_dir else None,
        Path(args.phase2_dir) if args.phase2_dir else None,
        Path(args.phase3_dir) if args.phase3_dir else None,
    )
    print(f"\n[BusinessPlan] Done: {result['summary']}")


if __name__ == "__main__":
    main()
