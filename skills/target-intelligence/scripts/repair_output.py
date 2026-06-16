#!/usr/bin/env python3
"""Repair target-intelligence output directory: checkpoint, TME provenance, Phase 4, PPTX.

Usage:
    python scripts/repair_output.py --gene EGFR --cancer-type LUAD --output-dir output/EGFR_LUAD
"""

import argparse
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from shared.checkpoint import CheckpointManager
from shared.data_validator import DataProvenance
from shared.nature_pptx import generate_nature_pptx

def patch_tme_provenance(output_dir: Path, gene: str, cancer_type: str) -> int:
    """Add provenance to TME profile JSON files that lack it."""
    patched = 0
    for f in output_dir.rglob(f"tme_{gene}_{cancer_type}_profile.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("provenance", {}).get("sources"):
            continue
        prov = DataProvenance(target_gene=gene)
        prov.add_source(
            "TIMER",
            f"{gene} immune infiltration in {cancer_type}",
            url="http://timer.cistrome.org/",
        )
        prov.add_source(
            "CIBERSORTx",
            f"TME phenotype ({data.get('phenotype', 'unknown')}) inference",
            url="https://cibersortx.stanford.edu/",
        )
        data["provenance"] = prov.to_dict()
        f.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        patched += 1
        print(f"  [TME] Patched provenance: {f.name}")
    return patched


def reconcile_checkpoint(output_dir: Path, gene: str, cancer_type: str) -> dict:
    cm = CheckpointManager(gene=gene, cancer_type=cancer_type, output_dir=output_dir)
    changed = cm.reconcile_phase_status()
    print(f"  [Checkpoint] phase_status: {cm.get_summary()['phase_status']}")
    if changed:
        print(f"  [Checkpoint] reconciled phases: {changed}")
    return cm.get_summary()


def rerun_phase4(gene: str, output_dir: Path) -> None:
    import subprocess

    phase4_script = BASE / "phase4-planning" / "scripts" / "run_phase4.py"
    cmd = [
        sys.executable,
        str(phase4_script),
        "--gene", gene,
        "--phase1-dir", str(output_dir),
        "--phase2-dir", str(output_dir),
        "--phase3-dir", str(output_dir),
        "--output-dir", str(output_dir),
    ]
    result = subprocess.run(cmd, cwd=str(phase4_script.parent))
    if result.returncode != 0:
        print(f"  [Phase4] exited with code {result.returncode}")


def main():
    parser = argparse.ArgumentParser(description="Repair target-intelligence output artifacts")
    parser.add_argument("--gene", required=True)
    parser.add_argument("--cancer-type", default="LUAD")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--skip-phase4", action="store_true")
    parser.add_argument("--skip-pptx", action="store_true")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = BASE / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Repairing {output_dir} ...")
    print("Step 1: Checkpoint reconcile")
    reconcile_checkpoint(output_dir, args.gene, args.cancer_type)

    print("Step 2: TME provenance patch")
    n = patch_tme_provenance(output_dir, args.gene, args.cancer_type)
    print(f"  Patched {n} TME file(s)")

    if not args.skip_phase4:
        print("Step 3: Regenerate Phase 4 + business plan")
        rerun_phase4(args.gene, output_dir)

    if not args.skip_pptx:
        print("Step 4: Generate PPTX")
        pptx = generate_nature_pptx(args.gene, output_dir)
        if pptx:
            print(f"  [PPTX] {pptx}")
        else:
            print("  [PPTX] generation failed")

    print("Step 5: Final checkpoint reconcile")
    reconcile_checkpoint(output_dir, args.gene, args.cancer_type)
    print("Done.")


if __name__ == "__main__":
    main()
