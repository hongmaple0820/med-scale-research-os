#!/usr/bin/env python3
"""
TCGA tumor vs normal differential expression analysis using cBioPortal.

Uses cBioPortal REST API to get mRNA expression data and compute
differential expression (tumor vs normal) with statistical tests.

Verified API: https://www.cbioportal.org/api
Study: luad_tcga_pan_can_atlas_2018
Profile: luad_tcga_pan_can_atlas_2018_rna_seq_v2_mrna

Usage:
    python tcga_analysis.py --gene EGFR --cancer-type LUAD [--output-dir ./output]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from scipy import stats
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_cbioportal_client
from shared.data_validator import DataProvenance

# Verified cBioPortal study IDs (2026-06-01)
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


def get_gene_entrez_id(gene_symbol: str) -> Optional[int]:
    """Get Entrez Gene ID from cBioPortal."""
    client = get_cbioportal_client()
    try:
        result = client.get(f"genes/{gene_symbol}")
        return result.get("entrezGeneId")
    except Exception as e:
        print(f"[TCGA] Gene lookup failed for {gene_symbol}: {e}")
        return None


def get_mrna_profile_id(study_id: str) -> Optional[str]:
    """Find the mRNA expression profile for a study."""
    client = get_cbioportal_client()
    try:
        profiles = client.get(f"studies/{study_id}/molecular-profiles")
        for p in profiles:
            if "mrna" in p.get("molecularProfileId", "").lower() and "zscore" not in p.get("molecularProfileId", "").lower():
                return p["molecularProfileId"]
        # Fallback: look for any RNA profile
        for p in profiles:
            if "rna" in p.get("molecularAlterationType", "").lower():
                return p["molecularProfileId"]
    except Exception as e:
        print(f"[TCGA] Profile lookup failed: {e}")
    return None


def get_sample_ids(study_id: str) -> Tuple[List[str], List[str]]:
    """Get tumor and normal sample IDs from a study."""
    client = get_cbioportal_client()
    try:
        samples = client.get(f"studies/{study_id}/samples", params={"projection": "DETAILED"})
        tumor_ids = []
        normal_ids = []
        for s in samples:
            sid = s.get("sampleId", "")
            stype = s.get("sampleType", "").upper()
            if "NORMAL" in stype or "SOLID TISSUE NORMAL" in stype:
                normal_ids.append(sid)
            else:
                tumor_ids.append(sid)
        return tumor_ids, normal_ids
    except Exception as e:
        print(f"[TCGA] Sample lookup failed: {e}")
        return [], []


def get_expression_data(profile_id: str, sample_ids: List[str], entrez_id: int) -> List[float]:
    """Get expression values for a gene across samples."""
    client = get_cbioportal_client()
    try:
        # Use the discrete molecular data endpoint
        result = client.post(
            f"molecular-profiles/{profile_id}/molecular-data/fetch",
            json_data={
                "entrezGeneIds": [entrez_id],
                "sampleIds": sample_ids,
            },
        )
        values = []
        for item in result:
            val = item.get("value")
            if val is not None and not np.isnan(val):
                values.append(float(val))
        return values
    except Exception as e:
        print(f"[TCGA] Expression data fetch failed: {e}")
        return []


def bh_correction(pvalues: List[float]) -> List[float]:
    """Benjamini-Hochberg FDR correction."""
    n = len(pvalues)
    if n == 0:
        return []
    indexed = sorted(enumerate(pvalues), key=lambda x: x[1])
    adj = [0.0] * n
    cummin = 1.0
    for rank_down in range(n):
        rank = n - rank_down
        idx = indexed[rank - 1][0]
        val = min(cummin, pvalues[idx] * n / rank)
        adj[idx] = val
        cummin = min(cummin, val)
    return adj


def compute_differential(tumor_vals: List[float], normal_vals: List[float]) -> dict:
    """Compute differential expression statistics.

    Uses Mann-Whitney U test (non-parametric) and log2 fold change.
    Includes Benjamini-Hochberg adjusted p-value.
    """
    if len(tumor_vals) < 5 or len(normal_vals) < 5:
        return {"error": "Insufficient samples", "n_tumor": len(tumor_vals), "n_normal": len(normal_vals)}

    tumor_arr = np.array(tumor_vals)
    normal_arr = np.array(normal_vals)

    # Mann-Whitney U test (non-parametric, doesn't assume normality)
    u_stat, p_value = stats.mannwhitneyu(tumor_arr, normal_arr, alternative='two-sided')

    # Log2 fold change (add small pseudocount to avoid log(0))
    pseudocount = 0.01
    mean_tumor = np.mean(tumor_arr)
    mean_normal = np.mean(normal_arr)
    log2fc = np.log2((mean_tumor + pseudocount) / (mean_normal + pseudocount))

    # Effect size (rank-biserial correlation)
    n1, n2 = len(tumor_arr), len(normal_arr)
    effect_size = 1 - (2 * u_stat) / (n1 * n2)

    # BH-adjusted p-value (single test: adjusted = raw, but we compute it for schema consistency)
    adj_pvalue = bh_correction([p_value])[0]

    return {
        "n_tumor": n1,
        "n_normal": n2,
        "mean_tumor": round(float(mean_tumor), 3),
        "mean_normal": round(float(mean_normal), 3),
        "median_tumor": round(float(np.median(tumor_arr)), 3),
        "median_normal": round(float(np.median(normal_arr)), 3),
        "log2fc": round(float(log2fc), 4),
        "pvalue": float(p_value),
        "adj_pvalue": float(adj_pvalue),
        "u_statistic": float(u_stat),
        "effect_size": round(float(effect_size), 4),
        "test": "Mann-Whitney U",
    }


def run(gene_symbol: str, cancer_type: str, output_dir: Path) -> dict:
    """Run TCGA differential expression analysis via cBioPortal."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)
    cancer_type = cancer_type.upper()
    study_id = CANCER_STUDIES.get(cancer_type)
    if not study_id:
        return {"error": f"Unsupported cancer type: {cancer_type}. Supported: {list(CANCER_STUDIES.keys())}"}

    provenance.add_source("cBioPortal", f"differential expression in {cancer_type}",
                          url=f"https://www.cbioportal.org/study/summary?id={study_id}")

    # Step 1: Get gene Entrez ID
    print(f"[TCGA] Looking up {gene_symbol} Entrez Gene ID...")
    entrez_id = get_gene_entrez_id(gene_symbol)
    if not entrez_id:
        return {"error": f"Gene {gene_symbol} not found in cBioPortal"}

    print(f"[TCGA] Entrez Gene ID: {entrez_id}")

    # Step 2: Find mRNA expression profile
    print(f"[TCGA] Finding mRNA profile for {study_id}...")
    profile_id = get_mrna_profile_id(study_id)
    if not profile_id:
        return {"error": f"No mRNA expression profile found for {study_id}"}

    print(f"[TCGA] Using profile: {profile_id}")

    # Step 3: Get sample IDs (tumor vs normal)
    print("[TCGA] Getting sample IDs...")
    tumor_ids, normal_ids = get_sample_ids(study_id)
    print(f"[TCGA] Found {len(tumor_ids)} tumor samples, {len(normal_ids)} normal samples")

    if not tumor_ids:
        return {"error": "No tumor samples found"}

    # Step 4: Get expression data
    print("[TCGA] Fetching tumor expression data...")
    tumor_vals = get_expression_data(profile_id, tumor_ids, entrez_id)
    print(f"[TCGA] Got {len(tumor_vals)} tumor expression values")

    normal_vals = []
    if normal_ids:
        print("[TCGA] Fetching normal expression data...")
        normal_vals = get_expression_data(profile_id, normal_ids, entrez_id)
        print(f"[TCGA] Got {len(normal_vals)} normal expression values")

    # Step 5: Compute differential expression
    if normal_vals:
        print("[TCGA] Computing differential expression (Mann-Whitney U test)...")
        diff_stats = compute_differential(tumor_vals, normal_vals)
    else:
        diff_stats = {
            "n_tumor": len(tumor_vals),
            "n_normal": 0,
            "mean_tumor": round(float(np.mean(tumor_vals)), 3) if tumor_vals else 0,
            "median_tumor": round(float(np.median(tumor_vals)), 3) if tumor_vals else 0,
            "note": "No normal samples available for comparison",
            "test": "descriptive only",
        }

    # Step 6: Save results
    json_data = {
        "gene": gene_symbol,
        "entrez_gene_id": entrez_id,
        "cancer_type": cancer_type,
        "study_id": study_id,
        "molecular_profile_id": profile_id,
        "differential_expression": diff_stats,
        "data_portal": f"https://www.cbioportal.org/patient?studyId={study_id}&caseId={gene_symbol}",
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"tcga_{gene_symbol}_{cancer_type}_differential.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Build summary
    if "error" in diff_stats:
        summary = f"TCGA-{cancer_type}: Insufficient data for differential expression analysis."
    elif diff_stats.get("n_normal", 0) == 0:
        summary = (
            f"TCGA-{cancer_type}: {diff_stats['n_tumor']} tumor samples. "
            f"Mean expression: {diff_stats['mean_tumor']}. No normal samples for comparison."
        )
    else:
        direction = "upregulated" if diff_stats["log2fc"] > 0 else "downregulated"
        significance = "significantly" if diff_stats["pvalue"] < 0.05 else "not significantly"
        summary = (
            f"TCGA-{cancer_type}: {diff_stats['n_tumor']} tumor vs {diff_stats['n_normal']} normal samples. "
            f"{gene_symbol} is {significance} {direction} in tumor "
            f"(log2FC={diff_stats['log2fc']:.2f}, P={diff_stats['pvalue']:.2e}). "
            f"Mean tumor: {diff_stats['mean_tumor']:.1f}, Mean normal: {diff_stats['mean_normal']:.1f}."
        )

    print(f"\n[TCGA] Results for {gene_symbol} in {cancer_type}:")
    print(f"  Tumor samples: {diff_stats.get('n_tumor', 0)}")
    print(f"  Normal samples: {diff_stats.get('n_normal', 0)}")
    if "log2fc" in diff_stats:
        print(f"  log2FC: {diff_stats['log2fc']:.4f}")
        print(f"  P-value: {diff_stats['pvalue']:.2e}")
    print(f"  Output: {json_path}")

    return {
        "differential_stats": diff_stats,
        "figure_path": None,
        "json_path": str(json_path),
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(description="TCGA differential expression via cBioPortal")
    parser.add_argument("--gene", required=True, help="Gene symbol")
    parser.add_argument("--cancer-type", required=True, help="TCGA cancer type (e.g., LUAD)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()
    run(args.gene, args.cancer_type.upper(), Path(args.output_dir))


if __name__ == "__main__":
    main()
