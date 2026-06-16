"""
TIMER 2.0 immune infiltration via the canonical TIMER2 bulk estimation file.

Data source (verified 2026-06-06):
  http://timer.cistrome.org/infiltration_estimation_for_tcga.csv.gz
  - 11070 TCGA samples x 119 infiltration columns (6 deconvolution methods)
  - First column 'cell_type' is actually the TCGA sample barcode (TCGA-OR-A5J1-01)
  - TIMER-method columns (exact header):
      'B cell_TIMER', 'T cell CD4+_TIMER', 'T cell CD8+_TIMER',
      'Neutrophil_TIMER', 'Macrophage_TIMER', 'Myeloid dendritic cell_TIMER'

Cancer-type filtering: the bulk file has NO cancer-type column, so we intersect
its barcodes with the cancer study's sample barcodes from cBioPortal
(e.g. luad_tcga_pan_can_atlas_2018). Verified overlap: LUAD = 510 samples.

History / bugfix (2026-06-06): the previous version pointed at a non-existent
UCSC Xena dataset ('TCGA.{cancer}.sampleMap/TIMER_immune_estimation') which
never existed -> always 403/404, plus a guessed '/api/v2/estimate' endpoint that
is not a real TIMER2 API. Both removed; replaced with the canonical bulk file
+ cBioPortal cohort intersection.

Usage:
    python timer_immune.py --gene KRAS --cancer-type PAAD [--output-dir ./output]
"""

import argparse
import csv
import gzip
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TIMER_CELL_TYPES = [
    "B_cell",
    "CD4_T_cell",
    "CD8_T_cell",
    "Neutrophil",
    "Macrophage",
    "Dendritic_cell",
]

# Canonical TIMER column header -> our normalized cell-type key (verified 2026-06-06)
TIMER_COLUMN_MAP = {
    "B_cell": "B cell_TIMER",
    "CD4_T_cell": "T cell CD4+_TIMER",
    "CD8_T_cell": "T cell CD8+_TIMER",
    "Neutrophil": "Neutrophil_TIMER",
    "Macrophage": "Macrophage_TIMER",
    "Dendritic_cell": "Myeloid dendritic cell_TIMER",
}

TIMER2_BULK_URLS = [
    "http://timer.cistrome.org/infiltration_estimation_for_tcga.csv.gz",
    "https://timer.cistrome.org/infiltration_estimation_for_tcga.csv.gz",
]

# cBioPortal study id per TCGA cancer code (mirror of survival_analysis.CANCER_STUDIES)
CANCER_STUDIES = {
    "LUAD": "luad_tcga_pan_can_atlas_2018",
    "LUSC": "lusc_tcga_pan_can_atlas_2018",
    "BRCA": "brca_tcga_pan_can_atlas_2018",
    "COAD": "coadread_tcga_pan_can_atlas_2018",
    "LIHC": "lihc_tcga_pan_can_atlas_2018",
    "STAD": "stad_tcga_pan_can_atlas_2018",
    "PRAD": "prad_tcga_pan_can_atlas_2018",
    "THCA": "thca_tcga_pan_can_atlas_2018",
    "KIRC": "kirc_tcga_pan_can_atlas_2018",
    "BLCA": "blca_tcga_pan_can_atlas_2018",
    "HNSC": "hnsc_tcga_pan_can_atlas_2018",
    "OV": "ov_tcga_pan_can_atlas_2018",
    "GBM": "gbm_tcga_pan_can_atlas_2018",
    "PAAD": "paad_tcga_pan_can_atlas_2018",
    "SKCM": "skcm_tcga_pan_can_atlas_2018",
    "UCEC": "ucec_tcga_pan_can_atlas_2018",
}

CACHE_DIR = Path(__file__).parent.parent.parent / ".cache"
BULK_CACHE = CACHE_DIR / "timer2_tcga.csv.gz"

REQUEST_TIMEOUT = 60
MAX_RETRIES = 6
RETRY_DELAY = 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_transient(exc: Exception) -> bool:
    s = type(exc).__name__ + " " + str(exc)
    return any(k in s for k in (
        "ConnectionError", "ConnectionReset", "reset", "RemoteDisconnected",
        "Timeout", "timed out", "ProtocolError",
    ))


def _download_bulk() -> Path | None:
    """Download + cache the TIMER2 bulk estimation file. Returns path or None."""
    if BULK_CACHE.exists() and BULK_CACHE.stat().st_size > 1_000_000:
        return BULK_CACHE
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for url in TIMER2_BULK_URLS:
        for attempt in range(MAX_RETRIES):
            try:
                r = requests.get(url, timeout=REQUEST_TIMEOUT, stream=True)
                if r.status_code != 200:
                    break  # try next url
                tmp = BULK_CACHE.with_suffix(".part")
                total = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(65536):
                        f.write(chunk)
                        total += len(chunk)
                if total < 1_000_000:
                    continue  # truncated, retry
                tmp.replace(BULK_CACHE)
                print(f"[TIMER] bulk file cached: {total} bytes")
                return BULK_CACHE
            except Exception as e:
                if _is_transient(e) and attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                break
    return None


def _get_cancer_sample_barcodes(cancer_type: str):
    """Return (set_of_15char_barcodes, study_id) for the cancer's cBioPortal study."""
    study_id = CANCER_STUDIES.get(cancer_type.upper())
    if not study_id:
        return None, None

    samples = None
    # Prefer the shared client (retry + cache); fall back to raw requests.
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from shared.api_client import get_cbioportal_client
        client = get_cbioportal_client()
        samples = client.get(
            f"studies/{study_id}/samples",
            params={"projection": "ID", "pageSize": 100000},
        )
    except Exception:
        for attempt in range(MAX_RETRIES):
            try:
                r = requests.get(
                    f"https://www.cbioportal.org/api/studies/{study_id}/samples",
                    params={"projection": "ID", "pageSize": 100000},
                    timeout=40, headers={"Accept": "application/json"},
                )
                r.raise_for_status()
                samples = r.json()
                break
            except Exception as e:
                if _is_transient(e) and attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                break

    if not samples:
        return None, study_id
    barcodes = {s.get("sampleId", "")[:15].upper() for s in samples if s.get("sampleId")}
    return (barcodes or None), study_id


def _aggregate_timer(bulk_path: Path, sample_barcodes: set):
    """Parse bulk csv, filter rows to sample_barcodes, aggregate 6 TIMER cell types."""
    values = {ct: [] for ct in TIMER_CELL_TYPES}
    with gzip.open(bulk_path, "rt", encoding="utf-8", errors="replace") as g:
        reader = csv.reader(g)
        header = next(reader)
        col_idx = {ct: header.index(col) for ct, col in TIMER_COLUMN_MAP.items() if col in header}
        if not col_idx:
            return None, "TIMER columns not found in bulk header"
        for row in reader:
            if not row:
                continue
            bc = row[0][:15].upper()
            if bc not in sample_barcodes:
                continue
            for ct, idx in col_idx.items():
                if idx < len(row):
                    try:
                        values[ct].append(float(row[idx]))
                    except ValueError:
                        pass

    scores = {}
    for ct, vals in values.items():
        if vals:
            scores[ct] = {
                "mean": round(statistics.mean(vals), 6),
                "median": round(statistics.median(vals), 6),
                "std": round(statistics.stdev(vals), 6) if len(vals) > 1 else 0.0,
                "n_samples": len(vals),
            }
    return (scores or None), None


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def fetch_timer_data(gene: str, cancer_type: str, output_dir: str = None) -> dict:
    """
    Fetch TIMER 2.0 immune infiltration for a cancer cohort.

    Returns the per-cell-type TIMER deconvolution scores aggregated over the
    cancer's samples, with provenance. Honest [DATA_NOT_AVAILABLE] on failure.
    """
    cancer_type = cancer_type.upper()
    result = {
        "gene": gene,
        "cancer_type": cancer_type,
        "cell_types": [],
        "method": "TIMER 2.0 (deconvolution)",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provenance": {
            "source": "TIMER2.0 (timer.cistrome.org bulk estimation)",
            "api_url": TIMER2_BULK_URLS[0],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "confidence": "LOW",
            "notes": [
                "TIMER infiltration is per-sample (TME composition); aggregated over the cancer cohort",
                "Cohort = cBioPortal study samples intersected with TIMER barcodes",
            ],
        },
    }

    bulk = _download_bulk()
    if not bulk:
        return _unavailable(result, gene, cancer_type, output_dir,
                            "TIMER2 bulk file unreachable (timer.cistrome.org)", None)

    barcodes, study_id = _get_cancer_sample_barcodes(cancer_type)
    if not barcodes:
        return _unavailable(result, gene, cancer_type, output_dir,
                            f"cancer cohort barcodes unavailable for {cancer_type}",
                            f"study={study_id}")

    scores, err = _aggregate_timer(bulk, barcodes)
    if not scores:
        return _unavailable(result, gene, cancer_type, output_dir,
                            err or "no overlapping samples between TIMER and cohort",
                            f"study={study_id}")

    n = max((s["n_samples"] for s in scores.values()), default=0)
    result["status"] = "ok"
    result["provenance"]["confidence"] = "HIGH"
    result["provenance"]["study_id"] = study_id
    result["provenance"]["samples"] = n
    result["provenance"]["notes"].append(f"Aggregated {n} {cancer_type} samples with TIMER data")
    for ct in TIMER_CELL_TYPES:
        if ct in scores:
            result["cell_types"].append({"cell_type": ct, **scores[ct], "method": "TIMER"})

    _save_result(result, gene, cancer_type, output_dir)
    return result


def _unavailable(result: dict, gene: str, cancer_type: str, output_dir, reason: str, detail) -> dict:
    result["status"] = "unavailable"
    result["provenance"]["confidence"] = "NONE"
    result["note"] = f"[DATA_NOT_AVAILABLE: TIMER] {reason}" + (f" ({detail})" if detail else "")
    result["provenance"]["error"] = reason
    result["provenance"]["manual_url"] = "https://timer.cistrome.org/"
    _save_result(result, gene, cancer_type, output_dir)
    return result


def _save_result(result: dict, gene: str, cancer_type: str, output_dir: str = None):
    """Save result JSON to output_dir if specified."""
    if output_dir:
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        output_file = out_path / f"timer_{gene}_{cancer_type}_immune.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"[OK] TIMER data saved: {output_file}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="TIMER 2.0 immune infiltration data retrieval",
        epilog=(
            "Note: TIMER immune scores represent tumor microenvironment composition "
            "(per-sample), aggregated over the cancer cohort."
        ),
    )
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g. KRAS)")
    parser.add_argument("--cancer-type", required=True, help="TCGA cancer type code (e.g. PAAD)")
    parser.add_argument("--output-dir", default=None, help="Output directory for JSON results")
    args = parser.parse_args()

    result = fetch_timer_data(args.gene, args.cancer_type, args.output_dir)
    print(json.dumps(result, indent=2, ensure_ascii=False))

    if result["status"] != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
