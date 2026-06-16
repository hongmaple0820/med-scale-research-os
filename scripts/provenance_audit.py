#!/usr/bin/env python3
"""Provenance audit for target-intelligence outputs.

Verifies that each data-bearing JSON file in an output module carries a
non-empty provenance with at least one source. This is the code-level trust
gate behind the dashboard's "数据来源" display (roadmap Wave 0 / T0.4).

Usage:
    python scripts/provenance_audit.py <module>             # audit one module
    python scripts/provenance_audit.py --all                # audit every module
    python scripts/provenance_audit.py <module> --min 0.8   # fail if < 80% covered

Exit code 2 when coverage < --min (default 0.0 = report only).
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "skills" / "target-intelligence" / "output"

# data-bearing keys the dashboard renders -> human label
DATA_KEYS = {
    "expression_by_tissue": "表达谱 (GTEx)",
    "survival_stats": "生存分析",
    "immune_correlations": "免疫相关性",
    "phenotype": "TME 表型",
    "protein_info": "蛋白信息",
    "competition": "竞争格局",
    "patent_trends": "专利趋势",
    "milestones": "里程碑",
    "cell_types": "免疫浸润 (TIMER)",
}


def has_sources(prov) -> bool:
    """True if a provenance dict carries at least one usable source."""
    if not isinstance(prov, dict):
        return False
    if isinstance(prov.get("sources"), list) and prov["sources"]:
        return True
    return bool(prov.get("source") or prov.get("api_url"))


def audit_module(mod_dir: Path):
    rows = []
    for fp in sorted(mod_dir.rglob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        present = [k for k in DATA_KEYS if k in data]
        if not present:
            continue  # not a data file the dashboard reads
        rows.append({
            "file": str(fp.relative_to(mod_dir)),
            "data": ", ".join(DATA_KEYS[k] for k in present),
            "provenance": has_sources(data.get("provenance")),
        })
    return rows


def main():
    ap = argparse.ArgumentParser(description="Audit provenance coverage of target-intelligence outputs")
    ap.add_argument("module", nargs="?", help="module name under skills/target-intelligence/output/")
    ap.add_argument("--all", action="store_true", help="audit every module")
    ap.add_argument("--min", type=float, default=0.0, help="minimum coverage gate, 0-1 (default 0 = report only)")
    args = ap.parse_args()

    if args.all:
        mods = sorted(d for d in OUTPUT_DIR.iterdir() if d.is_dir())
    elif args.module:
        mods = [OUTPUT_DIR / args.module]
    else:
        ap.error("provide a module name or --all")

    total = covered = 0
    for mdir in mods:
        if not mdir.exists():
            print(f"[skip] {mdir.name}: not found")
            continue
        rows = audit_module(mdir)
        if not rows:
            print(f"\n=== {mdir.name} ===  (no data files)")
            continue
        cov = sum(1 for r in rows if r["provenance"])
        total += len(rows)
        covered += cov
        print(f"\n=== {mdir.name} ===  provenance {cov}/{len(rows)} = {cov / len(rows) * 100:.0f}%")
        for r in rows:
            mark = "OK  " if r["provenance"] else "MISS"
            print(f"  [{mark}] {r['file']:<46} {r['data']}")

    if total:
        rate = covered / total
        print(f"\nTOTAL provenance coverage: {covered}/{total} = {rate * 100:.0f}%")
        if rate < args.min:
            print(f"GATE FAIL: coverage {rate * 100:.0f}% < min {args.min * 100:.0f}%")
            sys.exit(2)
    print("OK")


if __name__ == "__main__":
    main()
