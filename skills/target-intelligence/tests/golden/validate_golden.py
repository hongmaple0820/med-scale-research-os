#!/usr/bin/env python3
"""
Golden-standard validation for Target Intelligence  (Wave 0 / T0.2).

Validates a phase output directory against known-correct expectations for
"textbook" targets (EGFR/LUAD, KRAS/PAAD). This turns the anti-hallucination
promise into automatic evidence: if the pipeline regresses (e.g. KRAS prognosis
HR flips below 1, GTEx tau goes out of [0,1], or the UniProt accession changes),
this fails loudly instead of silently shipping wrong numbers.

Usage:
    python validate_golden.py --gene KRAS --cancer PAAD \
        --output-dir skills/target-intelligence/output/KRAS_PAAD

Severity:
    hard  -> FAIL (process exit code 1) — unambiguous facts / sanity invariants
    soft  -> WARN (exit code unchanged) — well-established but dataset-dependent
    no data found -> SKIP

Exit code: 0 if no hard failure, 1 otherwise.
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

# (GENE, CANCER) -> list of (field, op, args, severity, note)
GOLDEN = {
    ("KRAS", "PAAD"): [
        ("gtex.tau_index",        "range",          (0.0, 1.0),   "hard", "tau 必须在 0-1"),
        ("gtex.max_tpm",          ">",              (0,),         "hard", "最大组织 TPM > 0"),
        ("gtex.tissues_detected", ">=",             (40,),        "soft", "KRAS 广谱表达(>=40 组织)"),
        ("survival.hr",           ">",              (1.0,),       "hard", "KRAS 高表达=更差预后 (PAAD)"),
        ("survival.ci",           "ci_present",     (),           "hard", "HR 必须带 95% CI 且包含点估计"),
        ("survival.pvalue",       "<",              (0.05,),      "hard", "预后差异显著"),
        ("immune.CD8_T_cell.r",   "<",              (0,),         "soft", "KRAS 免疫排斥: CD8 T 负相关"),
        ("protein.accession",     "==",             ("P01116",),  "hard", "UniProt 登录号"),
        ("protein.subcellular",   "contains_lower", ("membrane",),"hard", "KRAS 细胞膜定位"),
    ],
    ("EGFR", "LUAD"): [
        ("gtex.tau_index",        "range",          (0.0, 1.0),   "hard", "tau 必须在 0-1"),
        ("gtex.max_tpm",          ">",              (0,),         "hard", "最大组织 TPM > 0"),
        ("survival.ci",           "ci_present",     (),           "hard", "HR 必须带 95% CI"),
        ("protein.accession",     "==",             ("P00533",),  "hard", "UniProt 登录号"),
        ("protein.subcellular",   "contains_lower", ("membrane",),"hard", "EGFR 是细胞膜受体"),
    ],
}

MISSING = object()


def _load_json(path: str):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def _find(output_dir: str, pattern: str):
    hits = sorted(glob.glob(str(Path(output_dir) / "**" / pattern), recursive=True))
    return _load_json(hits[0]) if hits else None


def extract_actuals(output_dir: str) -> dict:
    """Pull comparable values out of the real phase-1 output schema."""
    a: dict = {}

    gtex = _find(output_dir, "gtex_*_expression.json")
    if gtex:
        ss = gtex.get("summary_stats", {})
        a["gtex.max_tpm"] = ss.get("max_tpm", MISSING)
        a["gtex.tau_index"] = ss.get("tau_index", MISSING)
        a["gtex.tissues_detected"] = ss.get(
            "tissues_above_1_tpm",
            gtex.get("tissue_specificity", {}).get("total_tissues_detected", MISSING),
        )

    surv = _find(output_dir, "survival_*_results.json")
    if surv:
        st = surv.get("survival_stats", {})
        cox = st.get("cox_regression", {})
        a["survival.hr"] = cox.get("hazard_ratio", MISSING)
        a["survival.hr_ci_lower"] = cox.get("hr_ci_lower", MISSING)
        a["survival.hr_ci_upper"] = cox.get("hr_ci_upper", MISSING)
        a["survival.pvalue"] = cox.get("cox_pvalue", st.get("logrank_pvalue", MISSING))

    report = _find(output_dir, "phase1_*_report.json")
    if report:
        for sec in report.get("sections", []):
            d = sec.get("data", {}) or {}
            if "protein_info" in d:
                pi = d["protein_info"]
                a["protein.accession"] = pi.get("accession", MISSING)
                a["protein.subcellular"] = pi.get("subcellular_location", MISSING)
            if "CD8_T_cell" in d:
                a["immune.CD8_T_cell.r"] = d["CD8_T_cell"].get("r", MISSING)

    return a


def _check(op: str, args: tuple, actual) -> bool:
    try:
        if op == ">":
            return actual > args[0]
        if op == "<":
            return actual < args[0]
        if op == ">=":
            return actual >= args[0]
        if op == "range":
            return args[0] <= actual <= args[1]
        if op == "==":
            return actual == args[0]
        if op == "contains_lower":
            items = actual if isinstance(actual, list) else [actual]
            return any(args[0].lower() in str(x).lower() for x in items)
    except TypeError:
        return False
    return False


def run(gene: str, cancer: str, output_dir: str) -> int:
    key = (gene.upper(), cancer.upper())
    checks = GOLDEN.get(key)
    print("=" * 72)
    print(f"GOLDEN STANDARD: {gene}/{cancer}   (dir: {output_dir})")
    print("=" * 72)
    if not checks:
        print(f"  [SKIP] no golden standard defined for {gene}/{cancer}")
        return 0

    actuals = extract_actuals(output_dir)
    hard_fail = n_pass = n_warn = n_skip = 0

    for field, op, args, severity, note in checks:
        if op == "ci_present":
            hr = actuals.get("survival.hr", MISSING)
            lo = actuals.get("survival.hr_ci_lower", MISSING)
            hi = actuals.get("survival.hr_ci_upper", MISSING)
            if MISSING in (hr, lo, hi):
                status = "SKIP"
            else:
                ok = lo <= hr <= hi
                status = "PASS" if ok else ("FAIL" if severity == "hard" else "WARN")
            actual_disp = f"HR={hr} CI=[{lo},{hi}]" if hr is not MISSING else "—"
        else:
            actual = actuals.get(field, MISSING)
            if actual is MISSING:
                status = "SKIP"
                actual_disp = "—"
            else:
                ok = _check(op, args, actual)
                status = "PASS" if ok else ("FAIL" if severity == "hard" else "WARN")
                actual_disp = str(actual)[:48]

        if status == "PASS":
            n_pass += 1
        elif status == "SKIP":
            n_skip += 1
        elif status == "WARN":
            n_warn += 1
        else:
            hard_fail += 1

        print(f"  [{status:4s}] {field:24s} {op:14s} exp={args} got={actual_disp}")
        if status in ("FAIL", "WARN"):
            print(f"         \u21b3 {note}")

    print("-" * 72)
    print(f"  PASS={n_pass}  WARN={n_warn}  SKIP={n_skip}  FAIL(hard)={hard_fail}")
    if n_skip and n_pass == 0 and hard_fail == 0:
        print("  NOTE: all SKIP - no output for this case yet; run Phase 1 first")
    print("=" * 72)
    return 1 if hard_fail else 0


def main():
    p = argparse.ArgumentParser(description="Golden-standard validation (Wave 0 / T0.2)")
    p.add_argument("--gene", required=True)
    p.add_argument("--cancer", required=True)
    p.add_argument("--output-dir", required=True)
    args = p.parse_args()
    sys.exit(run(args.gene, args.cancer, args.output_dir))


if __name__ == "__main__":
    main()
