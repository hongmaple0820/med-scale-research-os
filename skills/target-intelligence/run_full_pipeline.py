#!/usr/bin/env python3
"""
Full Pipeline Orchestrator: Run all 4 phases of target intelligence analysis.

Usage:
    python run_full_pipeline.py --gene EGFR --disease "lung adenocarcinoma" [--output-dir ./output] [--resume]

Runs:
1. Phase 1: Expression panorama & prognosis (5 parallel sub-tasks)
2. Phase 2: Multi-dimensional screening & prioritization (3 parallel sub-tasks)
3. Phase 3: Deep research & competitive landscape (4 parallel sub-tasks)
4. Phase 4: Business plan & milestone planning (sequential)

Features:
- Checkpoint persistence: --resume to continue from last checkpoint
- Cross-validation: each data point verified against 2+ sources
- Provenance tracking: every numerical value has source attribution
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from shared.api_client import APIGate
from shared.checkpoint import CheckpointManager
from shared.preview import generate_summary_dashboard, print_file_link, open_in_browser, print_dashboard_hint


def run_phase_script(phase_dir: str, script_name: str, args: list, output_dir: Path) -> dict:
    """Run a phase script as a subprocess."""
    script_path = BASE / phase_dir / "scripts" / script_name
    cmd = [sys.executable, str(script_path)] + args + ["--output-dir", str(output_dir)]
    print(f"  Running: {' '.join(cmd[:6])}...")
    result = subprocess.run(cmd, capture_output=False, text=True, cwd=str(BASE))
    return {"returncode": result.returncode}


def run(gene: str, disease: str, output_dir: Path, resume: bool = False, open_browser: bool = False) -> dict:
    """Run the complete 4-phase pipeline.

    Args:
        gene: Gene symbol (e.g., EGFR)
        disease: Disease name (e.g., 'lung adenocarcinoma')
        output_dir: Output directory path
        resume: If True, skip completed steps from checkpoint
        open_browser: If True, open dashboard in browser after completion
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    start_time = time.time()
    warnings = []

    # Derive cancer_type from disease (simplified mapping)
    cancer_type_map = {
        "lung adenocarcinoma": "LUAD",
        "lung squamous cell carcinoma": "LUSC",
        "breast invasive carcinoma": "BRCA",
        "colon adenocarcinoma": "COAD",
        "liver hepatocellular carcinoma": "LIHC",
        "stomach adenocarcinoma": "STAD",
        "kidney renal clear cell carcinoma": "KIRC",
        "thyroid carcinoma": "THCA",
        "prostate adenocarcinoma": "PRAD",
        "glioblastoma multiforme": "GBM",
    }
    cancer_type = cancer_type_map.get(disease.lower(), "LUAD")

    # Initialize checkpoint manager
    checkpoint = CheckpointManager(gene=gene, cancer_type=cancer_type, output_dir=output_dir)
    if resume:
        summary = checkpoint.get_summary()
        print(f"Resuming from checkpoint: {summary['completed_steps']} steps completed")
        print(f"  Phase status: {summary['phase_status']}")
    else:
        checkpoint.reset()
        print("Starting fresh pipeline (use --resume to continue from checkpoint)")

    # Pre-flight: API availability check
    print("\nPre-flight: Checking API availability...")
    api_status = APIGate.print_report()
    unavailable = [name for name, info in api_status.items() if info["status"] != "ok"]
    if unavailable:
        print(f"  Warning: {len(unavailable)} APIs unavailable: {', '.join(unavailable)}")
        print("  Pipeline will use fallback data sources where possible.")
        warnings.append(f"APIs unavailable at startup: {', '.join(unavailable)}")

    # Phase 1
    print("\n" + "=" * 70)
    print("PHASE 1/4: 靶点表达全景与预后挖掘")
    print("=" * 70)
    if checkpoint.is_step_completed("phase1"):
        print("  [SKIP] Phase 1 already completed (checkpoint)")
        r1 = {"returncode": 0}
    else:
        checkpoint.set_phase_status("1", "running")
        r1 = run_phase_script("phase1-expression", "run_phase1.py",
                              ["--gene", gene, "--cancer-type", cancer_type], output_dir)
        if r1["returncode"] == 0:
            checkpoint.mark_step_completed("phase1")
            checkpoint.set_phase_status("1", "completed")
        else:
            checkpoint.set_phase_status("1", "error")
            if checkpoint.reconcile_phase_status("1"):
                warnings.append("Phase 1 exited non-zero but artifacts present — status reconciled to completed")
            else:
                warnings.append("Phase 1 had errors")

    # Phase 2
    print("\n" + "=" * 70)
    print("PHASE 2/4: 多维靶点筛选与优先级排序")
    print("=" * 70)
    if checkpoint.is_step_completed("phase2"):
        print("  [SKIP] Phase 2 already completed (checkpoint)")
        r2 = {"returncode": 0}
    else:
        checkpoint.set_phase_status("2", "running")
        r2 = run_phase_script("phase2-screening", "run_phase2.py",
                              ["--disease", disease, "--gene", gene], output_dir)
        if r2["returncode"] == 0:
            checkpoint.mark_step_completed("phase2")
            checkpoint.set_phase_status("2", "completed")
        else:
            checkpoint.set_phase_status("2", "error")
            if checkpoint.reconcile_phase_status("2"):
                warnings.append("Phase 2 exited non-zero but artifacts present — status reconciled to completed")
            else:
                warnings.append("Phase 2 had errors")

    # Phase 3
    print("\n" + "=" * 70)
    print("PHASE 3/4: 靶点深度调研与赛道格局分析")
    print("=" * 70)
    if checkpoint.is_step_completed("phase3"):
        print("  [SKIP] Phase 3 already completed (checkpoint)")
        r3 = {"returncode": 0}
    else:
        checkpoint.set_phase_status("3", "running")
        r3 = run_phase_script("phase3-research", "run_phase3.py",
                              ["--gene", gene, "--condition", disease], output_dir)
        if r3["returncode"] == 0:
            checkpoint.mark_step_completed("phase3")
            checkpoint.set_phase_status("3", "completed")
        else:
            checkpoint.set_phase_status("3", "error")
            if checkpoint.reconcile_phase_status("3"):
                warnings.append("Phase 3 exited non-zero but artifacts present — status reconciled to completed")
            else:
                warnings.append("Phase 3 had errors")

    # Phase 4
    print("\n" + "=" * 70)
    print("PHASE 4/4: 商业计划与里程碑规划")
    print("=" * 70)
    if checkpoint.is_step_completed("phase4"):
        print("  [SKIP] Phase 4 already completed (checkpoint)")
        r4 = {"returncode": 0}
    else:
        checkpoint.set_phase_status("4", "running")
        r4 = run_phase_script("phase4-planning", "run_phase4.py",
                              ["--gene", gene, "--phase1-dir", str(output_dir),
                               "--phase2-dir", str(output_dir), "--phase3-dir", str(output_dir)],
                              output_dir)
        if r4["returncode"] == 0:
            checkpoint.mark_step_completed("phase4")
            checkpoint.set_phase_status("4", "completed")
        else:
            checkpoint.set_phase_status("4", "error")
            if checkpoint.reconcile_phase_status("4"):
                warnings.append("Phase 4 exited non-zero but artifacts present — status reconciled to completed")
            else:
                warnings.append("Phase 4 had errors")

    checkpoint.reconcile_phase_status()

    elapsed = time.time() - start_time

    # List all outputs
    all_files = sorted(output_dir.rglob("*"))
    all_files = [f for f in all_files if f.is_file()]
    print(f"\n{'=' * 70}")
    print(f"FULL PIPELINE COMPLETE: {gene} in {disease}")
    print(f"{'=' * 70}")
    print(f"  Time: {elapsed:.0f}s")
    print(f"  Output files: {len(all_files)}")
    for f in all_files:
        size_kb = f.stat().st_size / 1024
        print(f"    {f.name} ({size_kb:.1f} KB)")
    if warnings:
        print(f"  Warnings: {len(warnings)}")
        for w in warnings:
            print(f"    - {w}")

    # Final checkpoint summary
    final_summary = checkpoint.get_summary()
    print(f"  Checkpoint: {final_summary['completed_steps']} steps completed")

    # Generate summary dashboard
    dashboard_path = generate_summary_dashboard(output_dir, gene, disease)

    # Print clickable file links
    print(f"\n{'=' * 70}")
    print(f"OUTPUT FILES")
    print(f"{'=' * 70}")
    print_file_link(dashboard_path, "Dashboard")
    for f in all_files:
        if f.suffix.lower() in (".html", ".pdf", ".docx", ".md"):
            print_file_link(f, f.stem.split("_")[0].upper())

    # Auto-open dashboard if requested
    if open_browser:
        open_in_browser(dashboard_path)

    print_dashboard_hint()

    return {
        "output_dir": str(output_dir),
        "elapsed_seconds": round(elapsed, 1),
        "files": [str(f) for f in all_files],
        "dashboard": str(dashboard_path),
        "warnings": warnings,
        "checkpoint": final_summary,
    }


def main():
    parser = argparse.ArgumentParser(description="Full 4-phase target intelligence pipeline")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--disease", required=True, help="Disease name (e.g., 'lung adenocarcinoma')")
    parser.add_argument("--output-dir", default=None, help="Output directory (default: ./output/{gene})")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--open", action="store_true", help="Open dashboard in browser after completion")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else Path("output") / args.gene
    run(args.gene, args.disease, output_dir, resume=args.resume, open_browser=args.open)


if __name__ == "__main__":
    main()
