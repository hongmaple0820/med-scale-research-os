#!/usr/bin/env python3
"""
Immune cell infiltration correlation analysis.

Uses cBioPortal expression data and TIMER/TISIDB-style immune scores.
Computes Spearman correlation between target gene expression and
immune cell infiltration estimates.

Usage:
    python immune_correlation.py --gene EGFR --cancer-type LUAD [--output-dir ./output]

Outputs:
    - immune_{gene}_{cancer}_correlation.json: Correlation statistics
    - immune_{gene}_{cancer}_heatmap.png: Correlation heatmap
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_cbioportal_client
from shared.data_validator import DataProvenance

# Immune cell types with ESTIMATE/ssGSEA markers
IMMUNE_CELLS = {
    "B_cell": ["CD19", "CD79A"],
    "CD4_T_cell": ["CD4", "IL7R"],
    "CD8_T_cell": ["CD8A", "CD8B"],
    "Dendritic_cell": ["ITGAX", "CD1C"],
    "Macrophage": ["CD68", "CD163"],
    "NK_cell": ["NCR1", "KLRD1"],
    "Neutrophil": ["CEACAM8", "FCGR3B"],
    "Regulatory_T_cell": ["FOXP3", "IL2RA"],
}

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


def get_gene_expression_map(profile_id: str, sample_ids: List[str], entrez_id: int) -> Dict[str, float]:
    """Get expression values keyed by sample ID."""
    client = get_cbioportal_client()
    try:
        result = client.post(
            f"molecular-profiles/{profile_id}/molecular-data/fetch",
            json_data={"entrezGeneIds": [entrez_id], "sampleIds": sample_ids},
        )
        return {item.get("sampleId", ""): float(item.get("value", 0))
                for item in result if item.get("value") is not None}
    except Exception as e:
        print(f"[Immune] Expression fetch failed: {e}")
        return {}


def compute_immune_scores(profile_id: str, sample_ids: List[str], marker_genes: Dict[str, List[str]]) -> Dict[str, Dict[str, float]]:
    """Compute immune cell scores as mean expression of marker genes per cell type."""
    client = get_cbioportal_client()

    # Get all marker gene IDs
    all_markers = []
    cell_to_entrez = {}
    for cell_type, genes in marker_genes.items():
        for g in genes:
            try:
                gene_info = client.get(f"genes/{g}")
                eid = gene_info.get("entrezGeneId")
                if eid:
                    all_markers.append(eid)
                    cell_to_entrez.setdefault(cell_type, []).append(eid)
            except Exception:
                continue

    if not all_markers:
        return {}

    # Fetch expression for all marker genes
    try:
        result = client.post(
            f"molecular-profiles/{profile_id}/molecular-data/fetch",
            json_data={"entrezGeneIds": all_markers, "sampleIds": sample_ids},
        )
    except Exception as e:
        print(f"[Immune] Marker expression fetch failed: {e}")
        return {}

    # Organize by sample and gene
    sample_gene_expr = {}
    for item in result:
        sid = item.get("sampleId", "")
        eid = item.get("entrezGeneId")
        val = item.get("value")
        if sid and eid and val is not None:
            sample_gene_expr.setdefault(sid, {})[eid] = float(val)

    # Compute mean score per cell type per sample
    cell_scores = {}
    for cell_type, entrez_ids in cell_to_entrez.items():
        scores = {}
        for sid in sample_ids:
            vals = [sample_gene_expr.get(sid, {}).get(eid, 0) for eid in entrez_ids if eid in sample_gene_expr.get(sid, {})]
            if vals:
                scores[sid] = float(np.mean(vals))
        cell_scores[cell_type] = scores

    return cell_scores


def run(gene_symbol: str, cancer_type: str, output_dir: Path) -> dict:
    """Run immune correlation analysis."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)
    cancer_type = cancer_type.upper()
    study_id = CANCER_STUDIES.get(cancer_type)
    if not study_id:
        return {"error": f"Unsupported cancer type: {cancer_type}"}

    provenance.add_source("cBioPortal", f"immune correlation in {cancer_type}",
                          url=f"https://www.cbioportal.org/study/summary?id={study_id}")

    client = get_cbioportal_client()

    # Step 1: Get gene ID and mRNA profile
    print(f"[Immune] Setting up for {gene_symbol} in {cancer_type}...")
    try:
        gene_info = client.get(f"genes/{gene_symbol}")
        entrez_id = gene_info.get("entrezGeneId")
    except Exception:
        return {"error": f"Gene {gene_symbol} not found"}

    profiles = client.get(f"studies/{study_id}/molecular-profiles")
    profile_id = None
    for p in profiles:
        pid = p.get("molecularProfileId", "")
        if "mrna" in pid and "zscore" not in pid:
            profile_id = pid
            break

    if not profile_id:
        return {"error": "No mRNA expression profile found"}

    # Step 2: Get tumor sample IDs
    print("[Immune] Getting tumor samples...")
    try:
        samples = client.get(f"studies/{study_id}/samples", params={"projection": "DETAILED"})
        tumor_ids = [s.get("sampleId", "") for s in samples
                     if "NORMAL" not in s.get("sampleType", "").upper()]
    except Exception as e:
        return {"error": f"Failed to get samples: {e}"}

    if len(tumor_ids) < 30:
        return {"error": f"Too few tumor samples: {len(tumor_ids)}"}

    # Limit to 500 samples for API efficiency
    if len(tumor_ids) > 500:
        tumor_ids = tumor_ids[:500]

    print(f"[Immune] Analyzing {len(tumor_ids)} tumor samples")

    # Step 3: Get target gene expression
    print(f"[Immune] Fetching {gene_symbol} expression...")
    target_expr = get_gene_expression_map(profile_id, tumor_ids, entrez_id)

    # Step 4: Compute immune cell scores
    print("[Immune] Computing immune cell scores...")
    cell_scores = compute_immune_scores(profile_id, tumor_ids, IMMUNE_CELLS)

    # Step 5: Compute Spearman correlations
    print("[Immune] Computing Spearman correlations...")
    correlations = {}
    common_samples = set(target_expr.keys())

    for cell_type, scores in cell_scores.items():
        shared = sorted(common_samples & set(scores.keys()))
        if len(shared) < 20:
            correlations[cell_type] = {
                "r": None, "pvalue": None, "n_samples": len(shared),
                "status": "insufficient data",
            }
            continue

        x = np.array([target_expr[s] for s in shared])
        y = np.array([scores[s] for s in shared])

        rho, pval = stats.spearmanr(x, y)
        correlations[cell_type] = {
            "r": round(float(rho), 4),
            "pvalue": float(pval),
            "n_samples": len(shared),
            "method": "Spearman",
        }

    # Step 6: Multiple testing correction (Benjamini-Hochberg)
    pvals = [v["pvalue"] for v in correlations.values() if v.get("pvalue") is not None]
    if pvals:
        try:
            from statsmodels.stats.multitest import multipletests
            _, adj_pvals, _, _ = multipletests(pvals, method="fdr_bh")
        except ImportError:
            # Fallback: simple Benjamini-Hochberg implementation
            n = len(pvals)
            sorted_idx = sorted(range(n), key=lambda i: pvals[i])
            adj_pvals = [0.0] * n
            cummin = 1.0
            for rank_down in range(n):
                rank = n - rank_down
                i = sorted_idx[rank - 1]
                val = min(cummin, pvals[i] * n / rank)
                adj_pvals[i] = val
                cummin = min(cummin, val)

        idx = 0
        for cell_type, data in correlations.items():
            if data.get("pvalue") is not None:
                data["adj_pvalue"] = round(float(adj_pvals[idx]), 6)
                data["significant"] = bool(data["adj_pvalue"] < 0.05)
                idx += 1

    # Step 7: Generate heatmap
    fig_path = None
    try:
        from shared.visualizer import plot_correlation_heatmap
        cell_names = list(correlations.keys())
        r_values = [[correlations[c].get("r", 0) or 0] for c in cell_names]
        fig_path = output_dir / f"immune_{gene_symbol}_{cancer_type}_heatmap.png"
        plot_correlation_heatmap(
            r_values, cell_names, [gene_symbol], fig_path,
            title=f"{gene_symbol} vs Immune Cell Infiltration ({cancer_type})",
        )
        print(f"[Immune] Heatmap saved: {fig_path}")
    except Exception as e:
        print(f"[Immune] Heatmap generation failed: {e}")

    # Step 8: Save results
    json_data = {
        "gene": gene_symbol,
        "cancer_type": cancer_type,
        "study_id": study_id,
        "immune_correlations": correlations,
        "n_samples_analyzed": len(tumor_ids),
        "method": "Spearman correlation with Benjamini-Hochberg FDR correction",
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"immune_{gene_symbol}_{cancer_type}_correlation.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Summary
    sig_cells = [c for c, v in correlations.items() if v.get("significant")]
    summary_parts = [f"Immune correlation analysis for {gene_symbol} in {cancer_type}."]
    if sig_cells:
        details = []
        for c in sig_cells:
            r = correlations[c]["r"]
            p = correlations[c]["adj_pvalue"]
            direction = "positive" if r > 0 else "negative"
            details.append(f"{c} (r={r:.3f}, {direction}, Padj={p:.4f})")
        summary_parts.append(f"Significant correlations: {'; '.join(details)}.")
    else:
        summary_parts.append("No significant immune cell correlations after FDR correction.")

    print(f"\n[Immune] Results:")
    print(f"  Samples analyzed: {len(tumor_ids)}")
    if sig_cells:
        print(f"  Significant: {', '.join(sig_cells)}")
    print(f"  Output: {json_path}")

    return {
        "correlations": correlations,
        "figure_paths": [str(fig_path)] if fig_path else [],
        "json_path": str(json_path),
        "summary": " ".join(summary_parts),
    }


def main():
    parser = argparse.ArgumentParser(description="Immune cell correlation analysis")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--cancer-type", required=True, help="TCGA cancer type (e.g., LUAD)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()
    result = run(args.gene, args.cancer_type.upper(), Path(args.output_dir))
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
