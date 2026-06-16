#!/usr/bin/env python3
"""
Phase 3 Orchestrator: Deep research and competitive landscape analysis.

Usage:
    python run_phase3.py --gene EGFR [--condition "lung cancer"] [--output-dir ./output]

Runs:
1. Target mechanism (UniProt, KEGG via Open Targets)
2. Clinical pipeline (ClinicalTrials.gov)
3. Patent landscape (USPTO)
4. Competitive intelligence (ClinicalTrials.gov + ChEMBL)
5. Literature review (PubMed)
6. Consolidated report
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.report_generator import TargetReport
from shared import visualizer
from shared.preview import print_file_link
from shared.tooluniverse_integration import build_research_profile, save_profile, EVIDENCE_GRADES


def run(gene_symbol: str, output_dir: Path, condition: str = "") -> dict:
    """Run Phase 3 deep research pipeline."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    report = TargetReport(target_gene=gene_symbol, phase="Phase 3: Deep Research & Competitive Landscape")
    results = {}

    # Step 1: Competitive Intelligence (trials + drugs)
    print("=" * 60)
    print("STEP 1/4: Clinical Pipeline & Drug Intelligence")
    print("=" * 60)
    try:
        from competitive_intelligence import run as ci_run
        ci_result = ci_run(gene_symbol, output_dir, condition)
        results["competitive"] = ci_result
        report.add_section(
            title="Clinical Pipeline & Competitive Landscape",
            content=ci_result.get("summary", ""),
            data=ci_result.get("competition", {}),
        )
    except Exception as e:
        print(f"[ERROR] Competitive intelligence failed: {e}")
        report.warnings.append(f"Competitive intelligence failed: {e}")
        results["competitive"] = {"error": str(e)}

    # Step 2: Patent Landscape
    print("\n" + "=" * 60)
    print("STEP 2/4: Patent Landscape")
    print("=" * 60)
    try:
        from patent_landscape import run as patent_run
        patent_result = patent_run(gene_symbol, output_dir)
        results["patents"] = patent_result
        report.add_section(
            title="Patent Landscape",
            content=patent_result.get("summary", ""),
            data=patent_result.get("trends", {}),
        )
    except Exception as e:
        print(f"[ERROR] Patent analysis failed: {e}")
        report.warnings.append(f"Patent analysis failed: {e}")
        results["patents"] = {"error": str(e)}

    # Step 3: Literature Summary
    print("\n" + "=" * 60)
    print("STEP 3/4: Literature Search")
    print("=" * 60)
    try:
        from shared.api_client import get_pubmed_client
        client = get_pubmed_client()

        # Search PubMed
        search_result = client.get("esearch.fcgi", params={
            "db": "pubmed",
            "term": f"{gene_symbol} drug target",
            "retmax": 20,
            "sort": "relevance",
            "retmode": "json",
        })

        pmids = search_result.get("esearchresult", {}).get("idlist", [])
        total_count = int(search_result.get("esearchresult", {}).get("count", 0))

        # Fetch abstracts
        papers = []
        if pmids:
            fetch_result = client.get("esummary.fcgi", params={
                "db": "pubmed",
                "id": ",".join(pmids[:10]),
                "retmode": "json",
            })
            for pmid in pmids[:10]:
                paper_info = fetch_result.get("result", {}).get(pmid, {})
                if isinstance(paper_info, dict):
                    papers.append({
                        "pmid": pmid,
                        "title": paper_info.get("title", ""),
                        "source": paper_info.get("source", ""),
                        "pubdate": paper_info.get("pubdate", ""),
                    })

        lit_result = {
            "total_publications": total_count,
            "recent_papers": papers,
            "query": f"{gene_symbol} drug target",
        }
        results["literature"] = lit_result
        report.add_section(
            title="Literature Overview",
            content=f"Found {total_count} publications for '{gene_symbol} drug target'",
            data=lit_result,
        )
    except Exception as e:
        print(f"[ERROR] Literature search failed: {e}")
        report.warnings.append(f"Literature search failed: {e}")

    # Step 4: Evidence-Graded Research Profile (ToolUniverse)
    print("\n" + "=" * 60)
    print("STEP 4/4: Evidence-Graded Research Profile")
    print("=" * 60)
    try:
        # Load Phase 1 data for cross-phase integration
        phase1_data = {}
        for f in output_dir.glob(f"phase1_{gene_symbol}_*_report.json"):
            try:
                p1_report = json.loads(f.read_text(encoding="utf-8"))
                for sec in p1_report.get("sections", []):
                    sd = sec.get("data", {})
                    if not sd or not isinstance(sd, dict):
                        continue
                    if "cox_regression" in sd:
                        phase1_data["survival_stats"] = sd
                    immune_keys = [k for k, v in sd.items() if isinstance(v, dict) and "r" in v]
                    if immune_keys:
                        phase1_data["immune_correlations"] = sd
                break
            except Exception:
                continue

        # Load GTEx expression
        for f in output_dir.glob(f"gtex_{gene_symbol}_expression.json"):
            try:
                gtex = json.loads(f.read_text(encoding="utf-8"))
                phase1_data["expression_by_tissue"] = gtex.get("expression_by_tissue", {})
                break
            except Exception:
                continue

        # Load protein info
        for f in output_dir.glob(f"protein_{gene_symbol}_validation.json"):
            try:
                prot = json.loads(f.read_text(encoding="utf-8"))
                phase1_data["protein_info"] = prot.get("protein_info", {})
                break
            except Exception:
                continue

        # Build research profile
        profile = build_research_profile(
            gene=gene_symbol,
            disease=condition,
            phase1_data=phase1_data,
            phase3_data=results,
        )

        # Save profile
        profile_path = save_profile(profile, output_dir)
        results["research_profile"] = profile.to_dict()

        # Add to report
        profile_dict = profile.to_dict()
        grade_info = EVIDENCE_GRADES[profile_dict["overall_grade"]]
        report.add_section(
            title="Evidence-Graded Research Profile",
            content=f"Overall: {grade_info['symbol']} {grade_info['label']} (Confidence: {profile_dict['confidence_score']}%)",
            data=profile_dict,
        )

        print(f"  Overall Grade: {grade_info['symbol']} {grade_info['label']}")
        print(f"  Confidence: {profile_dict['confidence_score']}%")
        for pid, pdata in profile_dict["paths"].items():
            if pdata["evidence_count"] > 0:
                print(f"    {pdata['name']}: {pdata['grade_summary']}")

    except Exception as e:
        print(f"[ERROR] Research profile generation failed: {e}")
        import traceback
        traceback.print_exc()
        report.warnings.append(f"Research profile failed: {e}")

    # --- Visualizations ---
    figures = []

    # 1. Key players bar chart
    competition = results.get("competitive", {}).get("competition", {})
    key_players = competition.get("key_players", [])
    if key_players:
        try:
            players_dict = {}
            for p in key_players[:12]:
                name = p.get("company", "")
                count = p.get("trial_count", p.get("trials", 0))
                if name:
                    players_dict[name] = count
            if players_dict:
                players_path = output_dir / f"phase3_{gene_symbol}_key_players.png"
                visualizer.plot_key_players_bar(
                    players=players_dict, gene=gene_symbol, output_path=players_path)
                figures.append(str(players_path))
                print(f"  [Figure] {players_path.name}")
        except Exception as e:
            print(f"  [Viz] Key players chart failed: {e}")

    # 2. Patent trend chart
    patent_raw = results.get("patents", {})
    patent_trends = patent_raw.get("trends", {})
    year_dist = patent_trends.get("year_distribution", {})
    if not year_dist:
        # Try alternate structures
        pt = patent_trends.get("patent_trends", {})
        if isinstance(pt, dict):
            year_dist = pt.get("year_distribution", {})
        if not year_dist:
            # Direct access from raw patent data
            pt2 = patent_raw.get("patent_trends", {})
            if isinstance(pt2, dict):
                year_dist = pt2.get("year_distribution", {})
    if year_dist:
        try:
            trend_path = output_dir / f"phase3_{gene_symbol}_patent_trend.png"
            visualizer.plot_patent_trend(year_dist, gene_symbol, trend_path)
            figures.append(str(trend_path))
            print(f"  [Figure] {trend_path.name}")
        except Exception as e:
            print(f"  [Viz] Patent trend chart failed: {e}")

    # Generate report
    json_path = output_dir / f"phase3_{gene_symbol}_report.json"
    report.to_json(json_path)

    md_path = output_dir / f"phase3_{gene_symbol}_report.md"
    report.to_markdown(md_path)

    # Add figures to report and re-generate HTML
    if figures:
        report.add_section(title="可视化", content="", figures=figures)

    html_path = output_dir / f"phase3_{gene_symbol}_report.html"
    report.to_html(html_path)

    print(f"\nPhase 3 Report Generated:")
    print_file_link(json_path, "JSON")
    print_file_link(md_path, "Markdown")
    print_file_link(html_path, "HTML")
    for fig in figures:
        print_file_link(Path(fig), "Figure")

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
    parser = argparse.ArgumentParser(description="Phase 3: Deep research and competitive landscape")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--condition", default="", help="Disease condition filter")
    args = parser.parse_args()

    run(args.gene, Path(args.output_dir), args.condition)


if __name__ == "__main__":
    main()
