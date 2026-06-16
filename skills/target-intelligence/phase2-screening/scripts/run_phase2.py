#!/usr/bin/env python3
"""
Phase 2 Orchestrator: Multi-dimensional target screening and prioritization.

Usage:
    python run_phase2.py --disease "non-small cell lung cancer" [--output-dir ./output] [--top N]

Runs:
1. Open Targets target-disease association ranking
2. Pharos druggability classification for top targets
3. Consolidated priority report
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.report_generator import TargetReport
from shared import visualizer
from shared.preview import print_file_link


def run(disease_name: str, output_dir: Path, top_n: int = 20, gene: str = None, geo_id: str = None) -> dict:
    """Run Phase 2 target screening pipeline."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    report = TargetReport(target_gene=gene or disease_name, phase="Phase 2: 多维靶点筛选与优先级排序")
    results = {}
    step = 0
    total_steps = 2 + (1 if geo_id else 0)

    # Step 1: Open Targets prioritization
    step += 1
    print("=" * 60)
    print(f"STEP {step}/{total_steps}: Open Targets Association Ranking")
    print("=" * 60)
    try:
        from target_prioritization import run as ot_run
        ot_result = ot_run(disease_name, output_dir, top_n, gene_filter=gene)
        results["opentargets"] = ot_result
        report.add_section(
            title="Target-Disease Associations (Open Targets)",
            content=ot_result.get("summary", ""),
            data={"targets": ot_result.get("targets", [])[:10]},
        )
    except Exception as e:
        print(f"[ERROR] Open Targets analysis failed: {e}")
        report.warnings.append(f"Open Targets failed: {e}")
        results["opentargets"] = {"error": str(e)}

    # Step 2: Pharos druggability for top targets
    step += 1
    print("\n" + "=" * 60)
    print(f"STEP {step}/{total_steps}: Pharos Druggability Classification")
    print("=" * 60)
    try:
        from pharos_druggability import run as pharos_run
        targets = results.get("opentargets", {}).get("targets", [])
        druggability_results = []
        for t in targets[:10]:
            symbol = t.get("symbol", "")
            if symbol:
                print(f"\n[Pharos] Checking {symbol}...")
                try:
                    pharos_result = pharos_run(symbol, output_dir)
                    druggability_results.append(pharos_result)
                except Exception as e:
                    print(f"[Pharos] Failed for {symbol}: {e}")
                    druggability_results.append({"gene": symbol, "error": str(e)})

        results["pharos"] = druggability_results
        report.add_section(
            title="Druggability Classification (Pharos)",
            content=f"Checked {len(druggability_results)} targets",
            data={"druggability": [r.get("druggability", {}) for r in druggability_results if "druggability" in r]},
        )
    except Exception as e:
        print(f"[ERROR] Pharos analysis failed: {e}")
        report.warnings.append(f"Pharos failed: {e}")

    # Step 3 (optional): Differential expression from GEO
    if geo_id:
        step += 1
        print("\n" + "=" * 60)
        print(f"STEP {step}/{total_steps}: Differential Expression (GEO: {geo_id})")
        print("=" * 60)
        try:
            from differential_expression import run as de_run
            de_result = de_run(disease_name, geo_id, output_dir)
            results["differential_expression"] = de_result
            report.add_section(
                title=f"差异表达分析 ({geo_id})",
                content=de_result.get("summary", ""),
                data={
                    "de_summary": de_result.get("de_results", {}),
                    "top_upregulated": de_result.get("top_upregulated", []),
                    "top_downregulated": de_result.get("top_downregulated", []),
                },
                figures=[de_result["figure_path"]] if de_result.get("figure_path") else [],
            )
        except Exception as e:
            print(f"[ERROR] Differential expression failed: {e}")
            report.warnings.append(f"DE analysis failed: {e}")
            results["differential_expression"] = {"error": str(e)}

    # Generate consolidated report
    json_path = output_dir / f"phase2_{disease_name.replace(' ', '_')}_report.json"
    report.to_json(json_path)

    md_path = output_dir / f"phase2_{disease_name.replace(' ', '_')}_report.md"
    report.to_markdown(md_path)

    html_path = output_dir / f"phase2_{disease_name.replace(' ', '_')}_report.html"
    report.to_html(html_path)

    print(f"\nPhase 2 Report Generated:")
    print_file_link(json_path, "JSON")
    print_file_link(md_path, "Markdown")
    print_file_link(html_path, "HTML")

    # Build priority matrix
    priority_matrix = []
    ot_targets = results.get("opentargets", {}).get("targets", [])
    pharos_data = {r.get("gene", ""): r.get("druggability", {}) for r in results.get("pharos", []) if isinstance(r, dict)}

    for t in ot_targets:
        symbol = t.get("symbol", "")
        pharm_data = pharos_data.get(symbol, {})
        priority_matrix.append({
            "symbol": symbol,
            "name": t.get("name", ""),
            "association_score": t.get("overall_score", 0),
            "druggability_class": pharm_data.get("tclass", "Unknown"),
            "ligand_count": pharm_data.get("ligand_count", 0),
        })

    # Sort by combined score
    for pm in priority_matrix:
        class_bonus = {"Tclin": 0.3, "Tchem": 0.2, "Tbio": 0.1, "Tdark": 0}.get(pm["druggability_class"], 0)
        pm["priority_score"] = pm["association_score"] + class_bonus

    priority_matrix.sort(key=lambda x: x["priority_score"], reverse=True)

    print(f"\n{'=' * 60}")
    print(f"TARGET PRIORITY MATRIX for {disease_name}")
    print(f"{'=' * 60}")
    for i, pm in enumerate(priority_matrix[:10], 1):
        print(f"  {i}. {pm['symbol']:12s} | Score: {pm['association_score']:.3f} | {pm['druggability_class']:6s} | Ligands: {pm['ligand_count']}")

    # --- Visualizations ---
    figures = []

    # 1. Target priority bar chart (top 15)
    top_targets = priority_matrix[:15]
    if top_targets:
        try:
            priority_bar_path = output_dir / f"phase2_{disease_name.replace(' ', '_')}_priority_bar.png"
            visualizer.plot_target_priority_bar(
                targets=[t["symbol"] for t in top_targets],
                scores=[t["priority_score"] for t in top_targets],
                association_scores=[t["association_score"] for t in top_targets],
                gene=gene or disease_name,
                output_path=priority_bar_path,
            )
            figures.append(str(priority_bar_path))
            print(f"  [Figure] {priority_bar_path.name}")
        except Exception as e:
            print(f"  [Viz] Priority bar chart failed: {e}")

    # 2. Druggability classification pie chart
    druggability_classes = [t["druggability_class"] for t in priority_matrix if t["druggability_class"] != "Unknown"]
    if druggability_classes:
        try:
            druggability_pie_path = output_dir / f"phase2_{disease_name.replace(' ', '_')}_druggability.png"
            visualizer.plot_druggability_pie(
                classes=druggability_classes,
                gene=gene or disease_name,
                output_path=druggability_pie_path,
            )
            figures.append(str(druggability_pie_path))
            print(f"  [Figure] {druggability_pie_path.name}")
        except Exception as e:
            print(f"  [Viz] Druggability pie chart failed: {e}")

    # Re-generate HTML report with figures
    if figures:
        for fig in figures:
            report.add_section(title="可视化", content="", figures=[fig])
        report.to_html(html_path)

    print(f"\nPhase 2 Report Generated:")
    print_file_link(json_path, "JSON")
    print_file_link(md_path, "Markdown")
    print_file_link(html_path, "HTML")
    for fig in figures:
        print_file_link(Path(fig), "Figure")

    return {
        "results": results,
        "priority_matrix": priority_matrix,
        "report_paths": {
            "json": str(json_path),
            "markdown": str(md_path),
            "html": str(html_path),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Phase 2: Target screening and prioritization")
    parser.add_argument("--disease", required=True, help="Disease name")
    parser.add_argument("--gene", default=None, help="Gene symbol to focus on (e.g., EGFR)")
    parser.add_argument("--geo-id", default=None, help="GEO series ID for DE analysis (e.g., GSE10072)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--top", type=int, default=20, help="Number of top targets")
    args = parser.parse_args()

    run(args.disease, Path(args.output_dir), args.top, gene=args.gene, geo_id=args.geo_id)


if __name__ == "__main__":
    main()
