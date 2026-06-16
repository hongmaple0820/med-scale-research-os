#!/usr/bin/env python3
"""
Phase 4 Orchestrator: Business plan and milestone planning.

Usage:
    python run_phase4.py --gene EGFR --phase1-dir ../output --phase2-dir ../output --phase3-dir ../output [--output-dir ./output]

Runs:
1. Milestone planning (data-driven timeline)
2. Business plan generation
3. Consolidated report
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.report_generator import TargetReport
from shared.preview import print_file_link, open_in_browser, print_dashboard_hint
from shared.nature_bridge import save_paper_input
from shared.nature_pptx import generate_nature_pptx


def _format_expression_content(gtex: dict) -> str:
    expr = gtex.get("expression_by_tissue", {})
    if not expr:
        return ""
    stats = gtex.get("summary_stats", {})
    tau = stats.get("tau_index")
    level = stats.get("specificity_level", "")
    top = sorted(expr.items(), key=lambda x: x[1], reverse=True)[:5]
    top_str = "、".join(f"{t} ({v:.1f} TPM)" for t, v in top)
    lines = [
        f"GTEx 共检测 {len(expr)} 个组织，最高表达：{top_str}。",
    ]
    if tau is not None:
        lines.append(f"Tau 指数 {tau:.3f}（{level or '组织特异性待评估'}）。")
    return "\n".join(lines)


def _format_survival_content(surv: dict) -> str:
    stats = surv.get("survival_stats", surv)
    if not stats:
        return ""
    cox = stats.get("cox_regression", {})
    hr = cox.get("hazard_ratio")
    pval = stats.get("logrank_pvalue") or cox.get("cox_pvalue")
    n = stats.get("n_high", 0) + stats.get("n_low", 0)
    med_h = stats.get("median_survival_high_months")
    med_l = stats.get("median_survival_low_months")
    sig = pval is not None and pval < 0.05
    lines = [f"TCGA-LUAD 队列 n={n}。"]
    if hr is not None and pval is not None:
        lines.append(f"Cox HR={hr:.3f}，log-rank P={pval:.3f}。")
        lines.append(
            "高表达与预后显著相关。" if sig else "预后关联未达统计学显著，不宜单独作为预后标志物。"
        )
    if med_h and med_l:
        lines.append(f"中位生存：高表达 {med_h:.1f} 月 vs 低表达 {med_l:.1f} 月。")
    return "\n".join(lines)


def _format_immune_content(gene: str, immune: dict) -> str:
    if not immune:
        return ""
    sig_cells = [
        k for k, v in immune.items()
        if isinstance(v, dict) and v.get("pvalue", 1) < 0.05
    ]
    lines = []
    if sig_cells:
        lines.append(f"与 {gene} 表达显著相关的免疫细胞：{', '.join(sig_cells[:6])}。")
    for key in ("immune_correlations", "cell_types"):
        if key in immune and isinstance(immune[key], dict):
            sub_sig = [k for k, v in immune[key].items() if isinstance(v, dict) and v.get("pvalue", 1) < 0.05]
            if sub_sig:
                lines.append(f"TIMER 显著相关细胞：{', '.join(sub_sig[:6])}。")
    if not lines:
        lines.append("免疫浸润与靶点表达的相关性需结合 TME 表型综合解读。")
    return "\n".join(lines)


def _load_phase1_data(gene: str, phase1_dir: Path, output_dir: Path) -> dict:
    """Load Phase 1 report and expression data for dashboard charts."""
    data = {"expression": {}, "survival": {}, "immune": {}}
    search_dirs = [d for d in [phase1_dir, output_dir] if d]
    for d in search_dirs:
        # Load Phase 1 report JSON
        for f in d.glob(f"phase1_{gene}_*_report.json"):
            try:
                report = json.loads(f.read_text(encoding="utf-8"))
                for sec in report.get("sections", []):
                    sd = sec.get("data", {})
                    if not sd or not isinstance(sd, dict):
                        continue
                    # Survival: has KM curve or Cox regression
                    if "km_curve_high" in sd or "cox_regression" in sd:
                        data["survival"] = sd
                    # Immune: cell type keys with "r" sub-key (but not metadata keys)
                    immune_keys = [
                        k for k, v in sd.items()
                        if isinstance(v, dict) and "r" in v and "pvalue" in v
                    ]
                    if immune_keys:
                        data["immune"] = sd
                break
            except Exception:
                continue
        # Load GTEx expression data
        for f in d.glob(f"gtex_{gene}_expression.json"):
            try:
                gtex = json.loads(f.read_text(encoding="utf-8"))
                data["expression"] = gtex.get("expression_by_tissue", {})
                break
            except Exception:
                continue
    return data


def run(gene: str, output_dir: Path, phase1_dir: Path = None, phase2_dir: Path = None, phase3_dir: Path = None) -> dict:
    """Run Phase 4 business plan pipeline."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    report = TargetReport(target_gene=gene, phase="Phase 4: 商业计划与里程碑规划")
    results = {}

    # Load Phase 1 data for dashboard charts
    phase1_data = _load_phase1_data(gene, phase1_dir, output_dir)

    # Load raw JSON for richer section text
    gtex_raw = {}
    for d in [phase1_dir, output_dir]:
        if not d:
            continue
        for f in Path(d).glob(f"gtex_{gene}_expression.json"):
            try:
                gtex_raw = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass
    surv_raw = phase1_data["survival"]
    for d in [phase1_dir, output_dir]:
        if not d:
            continue
        for f in Path(d).glob("survival_*_results.json"):
            try:
                surv_raw = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass

    # Inject Phase 1 data into report for chart extraction
    if phase1_data["expression"]:
        report.add_section(
            title="表达谱数据",
            content=_format_expression_content(gtex_raw) if gtex_raw else "",
            data={"expression_by_tissue": phase1_data["expression"]},
            provenance=gtex_raw.get("provenance", {}),
        )
    if phase1_data["survival"]:
        report.add_section(
            title="生存分析数据",
            content=_format_survival_content(surv_raw),
            data=phase1_data["survival"],
            provenance=surv_raw.get("provenance", {}),
        )
    if phase1_data["immune"]:
        report.add_section(
            title="免疫数据",
            content=_format_immune_content(gene, phase1_data["immune"]),
            data=phase1_data["immune"],
        )

    # Step 1: Milestone Planning
    print("=" * 60)
    print("STEP 1/3: 里程碑规划")
    print("=" * 60)
    try:
        from milestone_planner import run as milestone_run
        milestone_result = milestone_run(gene, output_dir, phase1_dir, phase2_dir, phase3_dir)
        results["milestones"] = milestone_result
        report.add_section(
            title="里程碑规划",
            content=milestone_result.get("summary", ""),
            data={
                "modality": milestone_result.get("modality"),
                "adjustments": milestone_result.get("adjustments", []),
                "risks": milestone_result.get("risks", []),
            },
            figures=[milestone_result["figure_path"]] if milestone_result.get("figure_path") else [],
        )
    except Exception as e:
        print(f"[ERROR] Milestone planning failed: {e}")
        import traceback
        traceback.print_exc()
        report.warnings.append(f"Milestone planning failed: {e}")
        results["milestones"] = {"error": str(e)}

    # Step 2: Business Plan
    print("\n" + "=" * 60)
    print("STEP 2/3: 商业计划书生成")
    print("=" * 60)
    try:
        from business_plan import run as bp_run
        bp_result = bp_run(gene, output_dir, phase1_dir, phase2_dir, phase3_dir)
        results["business_plan"] = bp_result
        report.add_section(
            title="商业计划书",
            content=bp_result.get("summary", ""),
            data={},
        )
    except Exception as e:
        print(f"[ERROR] Business plan generation failed: {e}")
        import traceback
        traceback.print_exc()
        report.warnings.append(f"Business plan generation failed: {e}")
        results["business_plan"] = {"error": str(e)}

    # Step 3: Generate Nature-style PPT
    print("\n" + "=" * 60)
    print("STEP 3/3: 生成 Nature 风格 PPT")
    print("=" * 60)
    try:
        pptx_path = generate_nature_pptx(gene, output_dir)
        if pptx_path:
            print_file_link(pptx_path, "PPTX")
        else:
            report.warnings.append("PPTX generation failed")
    except Exception as e:
        print(f"[ERROR] PPTX generation failed: {e}")
        report.warnings.append(f"PPTX generation failed: {e}")

    # Generate consolidated report (all formats)
    json_path = output_dir / f"phase4_{gene}_report.json"
    report.to_json(json_path)

    md_path = output_dir / f"phase4_{gene}_report.md"
    report.to_markdown(md_path)

    html_path = output_dir / f"phase4_{gene}_report.html"
    report.to_html(html_path)

    interactive_path = output_dir / f"phase4_{gene}_dashboard.html"
    report.to_interactive_html(interactive_path)

    # PDF/DOCX — report failures explicitly
    pdf_path = output_dir / f"phase4_{gene}_report.pdf"
    pdf_result = report.to_pdf(pdf_path)
    if not pdf_result:
        report.warnings.append("PDF export failed — install weasyprint: pip install weasyprint")

    docx_path = output_dir / f"phase4_{gene}_report.docx"
    docx_result = report.to_docx(docx_path)
    if not docx_result:
        report.warnings.append("DOCX export failed — install python-docx: pip install python-docx")

    print(f"\nPhase 4 Report Generated:")
    print_file_link(json_path, "JSON")
    print_file_link(md_path, "Markdown")
    print_file_link(html_path, "HTML")
    print_file_link(interactive_path, "Dashboard")
    if pdf_result:
        print_file_link(pdf_path, "PDF")
    if docx_result:
        print_file_link(docx_path, "DOCX")

    print_dashboard_hint()

    return {
        "results": results,
        "report_paths": {
            "json": str(json_path),
            "markdown": str(md_path),
            "html": str(html_path),
        },
        "warnings": report.warnings,
    }


def main():
    parser = argparse.ArgumentParser(description="Phase 4: Business plan and milestone planning")
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
    if result.get("warnings"):
        print(f"\nWarnings: {len(result['warnings'])}")
        for w in result["warnings"]:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
