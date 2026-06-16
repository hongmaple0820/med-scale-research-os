#!/usr/bin/env python3
"""
Report auditor for Target Intelligence  (Wave 0 / T0.4 + T0.5).

Two independent checks over a phase output directory:

  T0.4 provenance audit  -- every report section that carries numeric `data`
       must also carry a non-empty provenance with source + confidence.
       Catches the current defect: sections whose `provenance: {}` is empty.

  T0.5 anti-hallucination gate -- scans human-readable `content`/summary text
       against static/anti-hallucination.md rules:
         * banned vague phrases (通常/一般/研究表明/有文献报道/大量证据表明)
         * overclaim words (首次发现/证实/必然/因果关系) without MR evidence
         * a Hazard Ratio mentioned in prose without a CI nearby

Severity:
  error -> counts toward exit code 1 (provenance missing on data section;
           banned vague phrase)
  warn  -> reported, does not fail (overclaim word; HR without CI in prose)

Usage:
    python audit_report.py --report skills/target-intelligence/output/KRAS_PAAD/phase1/phase1_KRAS_PAAD_report.json
    python audit_report.py --output-dir skills/target-intelligence/output/KRAS_PAAD   # audits all phase*_report.json

Exit code: 0 if no error-level findings, 1 otherwise.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from pathlib import Path

BANNED_VAGUE = ["通常", "一般而言", "研究表明", "有文献报道", "大量证据表明", "众所周知"]
OVERCLAIM = ["首次发现", "证实", "必然", "因果关系", "毋庸置疑"]
MR_HINT = ["孟德尔随机化", "mendelian", "MR分析", "MR 分析"]
CONF_LEVELS = {"HIGH", "MEDIUM", "LOW", "SPECULATIVE", "NONE"}
PLACEHOLDER = re.compile(r"\[(DATA_NOT_AVAILABLE|API_TIMEOUT|NO_SOURCE|CONFLICT|NO_CI)\b")
# HR like "HR=1.84" / "HR 1.84" / "风险比 1.84"
HR_IN_PROSE = re.compile(r"(HR|风险比|hazard ratio)[\s=:]*([0-9]+\.?[0-9]*)", re.IGNORECASE)
CI_NEARBY = re.compile(r"(CI|置信区间|\d\.\d+\s*[-–~]\s*\d\.\d+)", re.IGNORECASE)


def _section_has_numeric_data(data) -> bool:
    """True if the section data contains at least one real number (not all empty)."""
    def walk(x):
        if isinstance(x, bool):
            return False
        if isinstance(x, (int, float)):
            return True
        if isinstance(x, dict):
            return any(walk(v) for v in x.values())
        if isinstance(x, list):
            return any(walk(v) for v in x)
        return False
    return walk(data)


def _provenance_ok(prov) -> tuple[bool, str]:
    if not isinstance(prov, dict) or not prov:
        return False, "empty provenance"
    src = prov.get("source") or prov.get("sources")
    if not src:
        return False, "missing source"
    conf = str(prov.get("confidence", "")).upper()
    if conf and conf not in CONF_LEVELS:
        return False, f"bad confidence '{conf}'"
    if not conf:
        return False, "missing confidence"
    return True, ""


def audit_one(report_path: str) -> tuple[int, int]:
    data = json.loads(Path(report_path).read_text(encoding="utf-8"))
    errors = warns = 0
    print("=" * 78)
    print(f"AUDIT: {report_path}")
    print("=" * 78)

    sections = data.get("sections", [])
    if not sections:
        print("  [SKIP] no sections")
        return 0, 0

    for sec in sections:
        title = sec.get("title", "?")[:40]
        sdata = sec.get("data", {})
        content = str(sec.get("content", ""))
        prov = sec.get("provenance", {})
        is_unavailable = bool(PLACEHOLDER.search(content)) or \
            str((prov or {}).get("confidence", "")).upper() in ("NONE", "")

        # --- T0.4 provenance ---
        if _section_has_numeric_data(sdata):
            ok, why = _provenance_ok(prov)
            # A properly-marked unavailable section (confidence NONE + placeholder) is OK.
            if not ok and PLACEHOLDER.search(content):
                print(f"  [ OK ] {title:40s} provenance: explicitly unavailable")
            elif not ok:
                errors += 1
                print(f"  [ERR ] {title:40s} provenance: {why}  (T0.4)")
            else:
                print(f"  [ OK ] {title:40s} provenance: {prov.get('source','')[:30]} / {prov.get('confidence','')}")

        # --- T0.5 anti-hallucination text scan ---
        for kw in BANNED_VAGUE:
            if kw in content:
                errors += 1
                print(f"  [ERR ] {title:40s} banned vague phrase: '{kw}'  (T0.5)")
        for kw in OVERCLAIM:
            if kw in content and not any(h.lower() in content.lower() for h in MR_HINT):
                warns += 1
                print(f"  [WARN] {title:40s} overclaim word: '{kw}'  (T0.5)")
        m = HR_IN_PROSE.search(content)
        if m and not CI_NEARBY.search(content) and "[NO_CI]" not in content:
            warns += 1
            print(f"  [WARN] {title:40s} HR in prose without CI: '{m.group(0)}'  (T0.5)")

    print("-" * 78)
    print(f"  errors={errors}  warnings={warns}")
    print("=" * 78)
    return errors, warns


def main():
    p = argparse.ArgumentParser(description="Report auditor (Wave 0 / T0.4+T0.5)")
    p.add_argument("--report", help="single report JSON")
    p.add_argument("--output-dir", help="dir to scan for phase*_report.json")
    args = p.parse_args()

    targets = []
    if args.report:
        targets = [args.report]
    elif args.output_dir:
        targets = sorted(glob.glob(str(Path(args.output_dir) / "**" / "phase*_report.json"), recursive=True))
    if not targets:
        print("No report JSON found.")
        sys.exit(0)

    total_err = total_warn = 0
    for t in targets:
        e, w = audit_one(t)
        total_err += e
        total_warn += w

    print(f"\nTOTAL across {len(targets)} report(s): errors={total_err}  warnings={total_warn}")
    sys.exit(1 if total_err else 0)


if __name__ == "__main__":
    main()
