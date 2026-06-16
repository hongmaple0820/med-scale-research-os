#!/usr/bin/env python3
"""
Phase 1 Orchestrator: Run complete target expression panorama analysis.

Usage:
    python run_phase1.py --gene EGFR --cancer-type LUAD [--output-dir ./output]

Runs all Phase 1 analyses in sequence (8 steps):
1. GTEx tissue expression
2. Protein expression validation (UniProt + STRING)
3. TCGA tumor vs normal differential expression
4. Survival analysis (KM + Cox)
5. Immune cell correlation
6. Cross-validate expression data
7. TIMER 2.0 immune infiltration
8. TME profiling
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.report_generator import TargetReport, ReportSection
from shared.tme_integration import build_tme_profile, save_tme_profile, TME_PHENOTYPES


def run(gene_symbol: str, cancer_type: str, output_dir: Path) -> dict:
    """Run complete Phase 1 analysis pipeline."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    report = TargetReport(target_gene=gene_symbol, phase="Phase 1: 靶点表达全景与预后挖掘")
    report.metadata = {
        "cancer_type": cancer_type,
        "analysis_steps": [
            "GTEx 组织表达谱",
            "蛋白表达验证 (UniProt + STRING)",
            "TCGA 差异表达分析",
            "生存分析 (KM + Cox)",
            "免疫微环境相关性",
        ],
    }

    results = {}
    figures = []

    # Step 1: GTEx Expression
    print("=" * 60)
    print("STEP 1/8: GTEx 组织表达谱")
    print("=" * 60)
    try:
        from gtex_expression import run as gtex_run
        gtex_result = gtex_run(gene_symbol, output_dir)
        results["gtex"] = gtex_result
        if gtex_result.get("figure_path"):
            figures.append(gtex_result["figure_path"])
        report.add_section(
            title="组织表达谱 (GTEx)",
            content=gtex_result.get("summary", ""),
            data=gtex_result.get("summary_stats", {}),
            figures=[gtex_result["figure_path"]] if gtex_result.get("figure_path") else [],
            provenance=gtex_result.get("provenance", {}),
        )
    except Exception as e:
        print(f"[ERROR] GTEx analysis failed: {e}")
        report.warnings.append(f"GTEx analysis failed: {e}")
        results["gtex"] = {"error": str(e)}

    # Step 2: Protein Validation (UniProt + STRING)
    print("\n" + "=" * 60)
    print("STEP 2/8: Protein Expression Validation (UniProt + STRING)")
    print("=" * 60)
    try:
        from hpa_validation import run as protein_run
        gtex_data = results.get("gtex", {}).get("expression_data", {})
        protein_result = protein_run(gene_symbol, output_dir, gtex_data=gtex_data if gtex_data else None)
        results["protein"] = protein_result
        report.add_section(
            title="蛋白表达验证 (UniProt + STRING)",
            content=protein_result.get("summary", ""),
            data={
                "protein_info": protein_result.get("protein_data", {}),
                "interactions": protein_result.get("interactions", [])[:10],
            },
            provenance=protein_result.get("provenance", {}),
        )
    except Exception as e:
        print(f"[ERROR] Protein validation failed: {e}")
        report.warnings.append(f"Protein validation failed: {e}")
        results["protein"] = {"error": str(e)}

    # Step 3: TCGA Differential Expression
    print("\n" + "=" * 60)
    print("STEP 3/8: TCGA 肿瘤差异表达分析")
    print("=" * 60)
    try:
        from tcga_analysis import run as tcga_run
        tcga_result = tcga_run(gene_symbol, cancer_type, output_dir)
        results["tcga"] = tcga_result
        report.add_section(
            title="肿瘤差异表达分析 (TCGA)",
            content=tcga_result.get("summary", ""),
            data=tcga_result.get("differential_stats", {}),
            provenance=tcga_result.get("provenance", {}),
        )
    except Exception as e:
        print(f"[ERROR] TCGA analysis failed: {e}")
        report.warnings.append(f"TCGA analysis failed: {e}")
        results["tcga"] = {"error": str(e)}

    # Step 4: Survival Analysis
    print("\n" + "=" * 60)
    print("STEP 4/8: 生存分析 (KM + Cox)")
    print("=" * 60)
    try:
        from survival_analysis import run as surv_run
        surv_result = surv_run(gene_symbol, cancer_type, output_dir)
        results["survival"] = surv_result
        if surv_result.get("figure_path"):
            figures.append(surv_result["figure_path"])
        report.add_section(
            title="预后价值分析 (生存分析)",
            content=surv_result.get("summary", ""),
            data=surv_result.get("survival_stats", {}),
            figures=[surv_result["figure_path"]] if surv_result.get("figure_path") else [],
            provenance=surv_result.get("provenance", {}),
        )
    except Exception as e:
        print(f"[ERROR] Survival analysis failed: {e}")
        report.warnings.append(f"Survival analysis failed: {e}")
        results["survival"] = {"error": str(e)}

    # Step 5: Immune Correlation
    print("\n" + "=" * 60)
    print("STEP 5/8: 免疫微环境相关性分析")
    print("=" * 60)
    try:
        from immune_correlation import run as immune_run
        immune_result = immune_run(gene_symbol, cancer_type, output_dir)
        results["immune"] = immune_result
        report.add_section(
            title="免疫微环境相关性分析",
            content=immune_result.get("summary", ""),
            data=immune_result.get("correlations", {}),
            figures=immune_result.get("figure_paths", []),
            provenance=immune_result.get("provenance", {}),
        )
    except Exception as e:
        print(f"[ERROR] Immune correlation failed: {e}")
        report.warnings.append(f"Immune correlation failed: {e}")
        results["immune"] = {"error": str(e)}

    # Step 6: Cross-validate expression data (V2)
    print("\n" + "=" * 60)
    print("STEP 6/8: Cross-validate expression data")
    print("=" * 60)
    try:
        from shared.cross_validator import CrossValidator
        cv = CrossValidator(gene=gene_symbol)
        expr_results = []
        gtex_data = results.get("gtex", {})
        if gtex_data and not gtex_data.get("error"):
            expr_data = gtex_data.get("expression_data", {})
            max_tpm = max(expr_data.values()) if expr_data else 0
            expr_results.append({
                "source": "gtex",
                "data": {"direction": "up" if max_tpm > 1 else "low"},
            })
        tcga_data = results.get("tcga", {})
        if tcga_data and not tcga_data.get("error"):
            diff_stats = tcga_data.get("differential_stats", {})
            if diff_stats:
                direction = "up" if diff_stats.get("log2fc", 0) > 0 else "down"
                expr_results.append({
                    "source": "cbioportal",
                    "data": {"direction": direction},
                })
        if expr_results:
            cv_result = cv.validate_with_matrix("expression", expr_results)
            results["cross_validation"] = cv_result
            print(f"  [CROSS-VALIDATE] Confidence: {cv_result['confidence']}")
            if cv_result.get("warning"):
                print(f"  [CROSS-VALIDATE] Warning: {cv_result['warning']}")
        else:
            print("  [CROSS-VALIDATE] Skipped: no expression data available")
    except Exception as e:
        print(f"  [CROSS-VALIDATE] Skipped: {e}")

    # Step 7: TIMER 免疫浸润（V2 新增）
    print("\n" + "="*60)
    print("STEP 7/8: TIMER 2.0 免疫浸润分析")
    print("="*60)
    try:
        from timer_immune import fetch_timer_data
        timer_result = fetch_timer_data(gene_symbol, cancer_type, output_dir)
        results["timer_immune"] = timer_result
        report.add_section(
            title="TIMER 2.0 免疫浸润分析",
            content=f"TIMER 数据获取完成，状态: {timer_result.get('status', 'unknown')}",
            data=timer_result,
            provenance=timer_result.get("provenance", {}),
        )
        print(f"  [OK] TIMER 数据获取完成，状态: {timer_result.get('status', 'unknown')}")
    except Exception as e:
        print(f"  [WARN] TIMER 数据获取失败: {e}")
        results["timer_immune"] = {
            "status": "unavailable",
            "note": f"[DATA_NOT_AVAILABLE: TIMER]: {str(e)}",
        }
        report.warnings.append(f"TIMER 数据获取失败: {e}")

    # Step 8: TME Profiling
    print("\n" + "=" * 60)
    print("STEP 8/8: TME 免疫微环境表型分析")
    print("=" * 60)
    try:
        immune_correlations = results.get("immune", {}).get("correlations", {})
        gtex_expr = results.get("gtex", {}).get("expression_by_tissue", {})

        tme_profile = build_tme_profile(
            gene=gene_symbol,
            cancer_type=cancer_type,
            immune_data=immune_correlations,
            expression_data=gtex_expr,
        )

        tme_path = save_tme_profile(tme_profile, output_dir)
        results["tme"] = tme_profile.to_dict()

        phenotype_info = TME_PHENOTYPES.get(tme_profile.phenotype, {})
        report.add_section(
            title="TME 免疫微环境表型",
            content=f"表型: {phenotype_info.get('name', tme_profile.phenotype)} | "
                    f"免疫评分: {tme_profile.immune_score:.0f}/100 | "
                    f"免疫治疗预测: {tme_profile.immunotherapy_prediction}",
            data=tme_profile.to_dict(),
            provenance=tme_profile.to_dict().get("provenance", {}),
        )

        print(f"  TME Phenotype: {phenotype_info.get('name', tme_profile.phenotype)}")
        print(f"  Immune Score: {tme_profile.immune_score:.0f}/100")
        print(f"  Immunotherapy: {tme_profile.immunotherapy_prediction}")

    except Exception as e:
        print(f"[ERROR] TME profiling failed: {e}")
        import traceback
        traceback.print_exc()
        report.warnings.append(f"TME profiling failed: {e}")

    # Generate consolidated report
    print("\n" + "=" * 60)
    print("生成报告")
    print("=" * 60)

    json_path = output_dir / f"phase1_{gene_symbol}_{cancer_type}_report.json"
    report.to_json(json_path)

    md_path = output_dir / f"phase1_{gene_symbol}_{cancer_type}_report.md"
    report.to_markdown(md_path)

    html_path = output_dir / f"phase1_{gene_symbol}_{cancer_type}_report.html"
    report.to_html(html_path)

    print(f"\nPhase 1 Report Generated:")
    print(f"  JSON: {json_path}")
    print(f"  Markdown: {md_path}")
    print(f"  HTML: {html_path}")
    print(f"  Figures: {len(figures)}")

    return {
        "results": results,
        "report_paths": {
            "json": str(json_path),
            "markdown": str(md_path),
            "html": str(html_path),
        },
        "figures": figures,
        "warnings": report.warnings,
    }


def main():
    parser = argparse.ArgumentParser(description="Phase 1: Complete target expression panorama analysis")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--cancer-type", required=True, help="TCGA cancer type (e.g., LUAD)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()

    result = run(args.gene, args.cancer_type.upper(), Path(args.output_dir))
    if result.get("warnings"):
        print(f"\nWarnings: {len(result['warnings'])}")
        for w in result["warnings"]:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
