#!/usr/bin/env python3
"""
Query GTEx Portal API v2 for tissue-specific gene expression.

Usage:
    python gtex_expression.py --gene EGFR [--output-dir ./output] [--top N]

Outputs:
    - gtex_{gene}_expression.json: Raw expression data
    - gtex_{gene}_expression.png: Tissue expression bar chart
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_gtex_client
from shared.visualizer import plot_tissue_expression
from shared.data_validator import DataProvenance


def search_gene(gene_symbol: str) -> dict:
    """Search for a gene in GTEx to get the stable gene ID."""
    client = get_gtex_client()
    result = client.get("reference/gene", params={
        "geneId": gene_symbol,
        "pageSize": 10,
    })
    return result


def get_median_expression(gene_id: str, dataset_id: str = "gtex_v8") -> dict:
    """Get median gene expression by tissue."""
    client = get_gtex_client()
    result = client.get("expression/medianGeneExpression", params={
        "datasetId": dataset_id,
        "gencodeId": gene_id,
        "pageSize": 200,
    })
    return result


def get_bulk_expression(gene_id: str, dataset_id: str = "gtex_v8") -> dict:
    """Get individual sample expression values for a gene."""
    client = get_gtex_client()
    result = client.get("expression/geneExpression", params={
        "datasetId": dataset_id,
        "gencodeId": gene_id,
        "pageSize": 10000,
    })
    return result


def run(gene_symbol: str, output_dir: Path, top_n: int = 30) -> dict:
    """Run GTEx expression analysis for a gene.

    Returns:
        dict with keys: expression_data, figure_path, json_path, summary
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)
    provenance.add_source("GTEx", f"median gene expression for {gene_symbol}", url="https://gtexportal.org/api/v2/")

    # Step 1: Search for gene
    print(f"[GTEx] Searching for gene: {gene_symbol}")
    search_result = search_gene(gene_symbol)

    gene_id = None
    gene_info = {}
    if "data" in search_result and search_result["data"]:
        for gene in search_result["data"]:
            if gene.get("geneSymbol", "").upper() == gene_symbol.upper():
                gene_id = gene.get("gencodeId") or gene.get("ensemblId")
                gene_info = gene
                break
        if not gene_id and search_result["data"]:
            gene_id = search_result["data"][0].get("gencodeId") or search_result["data"][0].get("ensemblId")
            gene_info = search_result["data"][0]

    if not gene_id:
        print(f"[GTEx] Gene '{gene_symbol}' not found in GTEx. Trying Ensembl ID format...")
        # Try with Ensembl ID directly if it looks like one
        if gene_symbol.startswith("ENS"):
            gene_id = gene_symbol
        else:
            return {
                "error": f"Gene '{gene_symbol}' not found in GTEx database",
                "expression_data": {},
                "figure_path": None,
                "json_path": None,
                "summary": f"ERROR: Gene {gene_symbol} not found in GTEx",
            }

    print(f"[GTEx] Found gene: {gene_info.get('geneSymbol', gene_symbol)} (ID: {gene_id})")

    # Step 2: Get median expression by tissue
    print("[GTEx] Fetching median expression by tissue...")
    median_result = get_median_expression(gene_id)

    expression_data = {}
    tissue_details = []

    if "data" in median_result:
        for entry in median_result["data"]:
            tissue = entry.get("tissueSiteDetailId", "").replace("_", " ").title()
            median_tpm = entry.get("median", 0)
            if tissue:
                expression_data[tissue] = float(median_tpm)
                tissue_details.append({
                    "tissue": tissue,
                    "median_tpm": float(median_tpm),
                })

    if not expression_data:
        print("[GTEx] No expression data returned. The gene may not be detected in GTEx.")
        return {
            "error": "No expression data found",
            "expression_data": {},
            "figure_path": None,
            "json_path": None,
            "summary": f"No GTEx expression data for {gene_symbol}",
        }

    # Sort by expression level
    sorted_tissues = sorted(expression_data.items(), key=lambda x: x[1], reverse=True)

    # Step 3: Compute Tau index (tissue specificity)
    # Tau = Σ(1 - x̂_i) / (n-1), where x̂_i = x_i / max(x)
    # Range: 0 (ubiquitous) to 1 (perfectly tissue-specific)
    max_tpm = sorted_tissues[0][1] if sorted_tissues else 0
    n_tissues = len(expression_data)
    if max_tpm > 0 and n_tissues > 1:
        normalized = [v / max_tpm for v in expression_data.values()]
        tau_index = sum(1 - x for x in normalized) / (n_tissues - 1)
    else:
        tau_index = 0.0

    # Classify specificity level
    if tau_index >= 0.8:
        specificity_level = "highly_tissue_specific"
    elif tau_index >= 0.5:
        specificity_level = "moderately_tissue_specific"
    elif tau_index >= 0.3:
        specificity_level = "low_tissue_specificity"
    else:
        specificity_level = "ubiquitous"

    high_specificity = []
    moderate = []
    low = []
    for tissue, tpm in sorted_tissues:
        if tpm >= max_tpm * 0.5:
            high_specificity.append(tissue)
        elif tpm >= max_tpm * 0.1:
            moderate.append(tissue)
        else:
            low.append(tissue)

    # Step 4: Generate visualization
    top_tissues = dict(sorted_tissues[:top_n])
    fig_path = output_dir / f"gtex_{gene_symbol}_expression.png"
    plot_tissue_expression(top_tissues, gene_symbol, fig_path, highlight_tissues=high_specificity[:5])

    # Step 5: Save JSON
    json_data = {
        "gene": gene_symbol,
        "gene_id": gene_id,
        "gene_info": {
            "symbol": gene_info.get("geneSymbol", gene_symbol),
            "name": gene_info.get("geneName", ""),
            "chromosome": gene_info.get("chromosome", ""),
        },
        "expression_by_tissue": dict(sorted_tissues),
        "tissue_specificity": {
            "tau_index": round(tau_index, 4),
            "specificity_level": specificity_level,
            "high": high_specificity,
            "moderate": moderate[:10],
            "total_tissues_detected": len([v for v in expression_data.values() if v > 0.1]),
        },
        "summary_stats": {
            "max_tpm": max_tpm,
            "median_across_tissues": sorted([v for v in expression_data.values()])[len(expression_data) // 2],
            "tissues_above_1_tpm": len([v for v in expression_data.values() if v >= 1.0]),
            "tau_index": round(tau_index, 4),
            "specificity_level": specificity_level,
        },
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"gtex_{gene_symbol}_expression.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Print summary
    print(f"\n[GTEx] Results for {gene_symbol}:")
    print(f"  Total tissues with data: {len(expression_data)}")
    print(f"  Max expression: {max_tpm:.1f} TPM in {sorted_tissues[0][0] if sorted_tissues else 'N/A'}")
    print(f"  Tau index: {tau_index:.3f} ({specificity_level})")
    print(f"  Top 5 tissues:")
    for tissue, tpm in sorted_tissues[:5]:
        print(f"    {tissue}: {tpm:.1f} TPM")
    print(f"  Tissue-specific (>{50}% max): {', '.join(high_specificity[:5])}")
    print(f"  Output: {json_path}")
    print(f"  Figure: {fig_path}")

    return {
        "expression_data": dict(sorted_tissues),
        "tissue_specificity": json_data["tissue_specificity"],
        "summary_stats": json_data["summary_stats"],
        "figure_path": str(fig_path),
        "json_path": str(json_path),
        "tau_index": round(tau_index, 4),
        "specificity_level": specificity_level,
        "summary": (
            f"{gene_symbol} is expressed in {len(expression_data)} tissues. "
            f"Highest in {sorted_tissues[0][0]} ({sorted_tissues[0][1]:.1f} TPM). "
            f"Tau index: {tau_index:.3f} ({specificity_level}). "
            f"Tissue-specific in: {', '.join(high_specificity[:3])}."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Query GTEx for tissue-specific gene expression")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--top", type=int, default=30, help="Number of top tissues to show")
    args = parser.parse_args()

    result = run(args.gene, Path(args.output_dir), args.top)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
