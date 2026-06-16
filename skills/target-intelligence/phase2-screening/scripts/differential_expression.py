#!/usr/bin/env python3
"""
Differential expression analysis using GEO data.

Usage:
    python differential_expression.py --disease "non-small cell lung cancer" --geo-id GSE10072 [--output-dir ./output]

Downloads expression data from GEO, runs differential analysis with pyDESeq2,
and identifies significantly up/down-regulated genes.
"""

import argparse
import json
import sys
import tempfile
import gzip
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_pubmed_client
from shared.data_validator import DataProvenance
from shared.visualizer import plot_volcano


def fetch_geo_series_matrix(geo_id: str, output_dir: Path) -> Optional[Path]:
    """Download GEO series matrix file."""
    import requests

    geo_id = geo_id.upper().replace("GSE", "")
    url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/GSE{geo_id[:-3]}nnn/GSE{geo_id}/matrix/GSE{geo_id}_series_matrix.txt.gz"
    output_path = output_dir / f"GSE{geo_id}_series_matrix.txt.gz"

    print(f"[GEO] Downloading {url}...")
    try:
        resp = requests.get(url, timeout=120, stream=True)
        resp.raise_for_status()
        with open(output_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"[GEO] Downloaded to {output_path} ({output_path.stat().st_size / 1024:.0f} KB)")
        return output_path
    except Exception as e:
        print(f"[GEO] Download failed: {e}")
        # Try alternative URL format
        url2 = f"https://ftp.ncbi.nlm.nih.gov/geo/series/GSE{geo_id[:-3]}nnn/GSE{geo_id}/matrix/GSE{geo_id}_series_matrix.txt"
        try:
            resp = requests.get(url2, timeout=120, stream=True)
            resp.raise_for_status()
            output_path2 = output_dir / f"GSE{geo_id}_series_matrix.txt"
            with open(output_path2, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return output_path2
        except Exception as e2:
            print(f"[GEO] Alternative download also failed: {e2}")
            return None


def parse_series_matrix(filepath: Path) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """Parse GEO series matrix file into expression matrix and sample labels.

    Returns:
        (expression_df, sample_to_group)
        expression_df: genes x samples
        sample_to_group: {sample_id: "tumor"/"normal"}
    """
    open_fn = gzip.open if filepath.suffix == ".gz" else open
    lines = []
    with open_fn(filepath, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("!") or line.startswith("^") or line.startswith("#"):
                lines.append(line.strip())
            elif line.strip():
                # Data line
                lines.append(line.strip())

    # Extract sample characteristics
    sample_ids = []
    sample_chars = {}
    for line in lines:
        if line.startswith("!Sample_geo_accession"):
            sample_ids = [x.strip('"') for x in line.split("\t")[1:]]
        if line.startswith("!Sample_characteristics_ch1"):
            parts = [x.strip('"') for x in line.split("\t")[1:]]
            for i, p in enumerate(parts):
                if i < len(sample_ids):
                    if sample_ids[i] not in sample_chars:
                        sample_chars[sample_ids[i]] = []
                    sample_chars[sample_ids[i]].append(p.lower())

    # Classify samples as tumor/normal
    sample_to_group = {}
    for sid in sample_ids:
        chars = sample_chars.get(sid, [])
        chars_str = " ".join(chars)
        if any(k in chars_str for k in ["tumor", "cancer", "malignant", "carcinoma", "adenocarcinoma"]):
            sample_to_group[sid] = "tumor"
        elif any(k in chars_str for k in ["normal", "healthy", "control", "adjacent", "non-tumor", "benign"]):
            sample_to_group[sid] = "normal"
        else:
            sample_to_group[sid] = "unknown"

    # Parse expression data
    data_lines = [l for l in lines if not l.startswith("!") and not l.startswith("^") and not l.startswith("#")]
    if not data_lines:
        return pd.DataFrame(), sample_to_group

    header = data_lines[0].split("\t")
    if header[0].startswith("ID"):
        data_lines = data_lines[1:]

    rows = []
    for line in data_lines:
        parts = line.split("\t")
        if len(parts) > 1:
            rows.append(parts)

    if not rows:
        return pd.DataFrame(), sample_to_group

    # Build dataframe
    df = pd.DataFrame(rows)
    # First column is probe ID, rest are sample values
    n_samples = len(sample_ids)
    if df.shape[1] < n_samples + 1:
        n_samples = df.shape[1] - 1

    expr_data = df.iloc[:, 1:n_samples + 1].apply(pd.to_numeric, errors="coerce")
    expr_data.columns = sample_ids[:n_samples]
    expr_data.index = df.iloc[:, 0]

    # Drop rows with all NaN
    expr_data = expr_data.dropna(how="all")

    return expr_data, sample_to_group


def run_deseq2_analysis(
    counts: pd.DataFrame,
    groups: Dict[str, str],
) -> pd.DataFrame:
    """Run differential expression using pyDESeq2.

    Args:
        counts: genes x samples expression matrix (raw counts or log-transformed)
        groups: {sample_id: "tumor"/"normal"}

    Returns:
        DataFrame with columns: gene, log2fc, pvalue, padj
    """
    try:
        from pydeseq2.dds import DeseqDataSet
        from pydeseq2.ds import DeseqStats
    except ImportError:
        print("[DESeq2] pyDESeq2 not installed, using scipy t-test fallback")
        return _fallback_ttest(counts, groups)

    # Filter to tumor and normal only
    valid_samples = [s for s in counts.columns if groups.get(s) in ("tumor", "normal")]
    if len(valid_samples) < 6:
        print("[DESeq2] Too few valid samples, using t-test fallback")
        return _fallback_ttest(counts, groups)

    counts_filtered = counts[valid_samples].copy()
    counts_filtered = counts_filtered.fillna(0)

    # Ensure integer counts for DESeq2
    counts_filtered = counts_filtered.apply(lambda x: x.astype(int) if x.dtype != int else x)
    counts_filtered = counts_filtered.clip(lower=0)

    # Create metadata
    metadata = pd.DataFrame({
        "condition": [groups[s] for s in valid_samples],
    }, index=valid_samples)
    metadata["condition"] = pd.Categorical(metadata["condition"], categories=["normal", "tumor"])

    try:
        dds = DeseqDataSet(
            counts=counts_filtered.T,  # DESeq2 expects samples x genes
            metadata=metadata,
            design="~condition",
        )
        dds.deseq2()
        stat_res = DeseqStats(dds, contrast=["condition", "tumor", "normal"])
        stat_res.summary()

        results = stat_res.results_df.copy()
        results = results.reset_index()
        results.columns = ["gene", "log2fc", "stat", "pvalue", "padj"]
        return results
    except Exception as e:
        print(f"[DESeq2] pyDESeq2 failed: {e}, using t-test fallback")
        return _fallback_ttest(counts, groups)


def _fallback_ttest(counts: pd.DataFrame, groups: Dict[str, str]) -> pd.DataFrame:
    """Fallback differential analysis using scipy t-test."""
    from scipy import stats

    tumor_samples = [s for s in counts.columns if groups.get(s) == "tumor"]
    normal_samples = [s for s in counts.columns if groups.get(s) == "normal"]

    results = []
    for gene in counts.index:
        tumor_vals = counts.loc[gene, tumor_samples].dropna().values.astype(float)
        normal_vals = counts.loc[gene, normal_samples].dropna().values.astype(float)

        if len(tumor_vals) < 3 or len(normal_vals) < 3:
            continue

        # log2FC (assuming data is already log-transformed or we log-transform)
        mean_tumor = np.mean(tumor_vals)
        mean_normal = np.mean(normal_vals)

        # If values are large (raw counts), log-transform
        if mean_tumor > 100 or mean_normal > 100:
            tumor_vals = np.log2(tumor_vals + 1)
            normal_vals = np.log2(normal_vals + 1)
            mean_tumor = np.mean(tumor_vals)
            mean_normal = np.mean(normal_vals)

        log2fc = mean_tumor - mean_normal
        t_stat, p_val = stats.ttest_ind(tumor_vals, normal_vals, equal_var=False)

        results.append({
            "gene": gene,
            "log2fc": log2fc,
            "stat": t_stat,
            "pvalue": p_val,
            "padj": p_val,  # Will be corrected below
        })

    df = pd.DataFrame(results)
    if not df.empty:
        # BH correction
        from scipy.stats import rankdata
        ranked = rankdata(df["pvalue"].values)
        n = len(ranked)
        df["padj"] = df["pvalue"].values * n / ranked
        df["padj"] = df["padj"].clip(upper=1.0)

    return df


def run(disease_name: str, geo_id: Optional[str], output_dir: Path, top_n: int = 50) -> dict:
    """Run differential expression analysis.

    Returns:
        dict with keys: de_results, top_up, top_down, figure_path, json_path, summary
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=f"disease:{disease_name}")
    provenance.add_source("GEO", f"differential expression for {disease_name}", url="https://www.ncbi.nlm.nih.gov/geo/")

    if not geo_id:
        return {
            "error": "GEO series ID required (e.g., --geo-id GSE10072)",
            "de_results": None,
            "summary": "GEO ID not provided",
        }

    # Step 1: Download data
    print(f"[GEO] Fetching {geo_id}...")
    matrix_path = fetch_geo_series_matrix(geo_id, output_dir)
    if not matrix_path:
        return {
            "error": f"Failed to download {geo_id}",
            "de_results": None,
            "summary": f"Download failed for {geo_id}",
        }

    # Step 2: Parse
    print("[GEO] Parsing expression matrix...")
    expr_df, sample_groups = parse_series_matrix(matrix_path)

    n_tumor = sum(1 for v in sample_groups.values() if v == "tumor")
    n_normal = sum(1 for v in sample_groups.values() if v == "normal")
    print(f"[GEO] Found {expr_df.shape[0]} genes x {expr_df.shape[1]} samples ({n_tumor} tumor, {n_normal} normal)")

    if expr_df.empty or n_tumor < 3 or n_normal < 3:
        return {
            "error": f"Insufficient data: {n_tumor} tumor, {n_normal} normal samples",
            "de_results": None,
            "summary": f"Insufficient samples in {geo_id}",
        }

    # Step 3: Run differential expression
    print("[GEO] Running differential expression analysis...")
    de_results = run_deseq2_analysis(expr_df, sample_groups)

    if de_results.empty:
        return {
            "error": "DE analysis produced no results",
            "de_results": None,
            "summary": "DE analysis failed",
        }

    # Step 4: Classify results
    sig_up = de_results[(de_results["log2fc"] > 1) & (de_results["padj"] < 0.05)]
    sig_down = de_results[(de_results["log2fc"] < -1) & (de_results["padj"] < 0.05)]

    # Step 5: Generate volcano plot
    fig_path = output_dir / f"volcano_{geo_id}.png"
    genes = de_results["gene"].tolist()
    log2fc = de_results["log2fc"].tolist()
    pvalues = de_results["padj"].tolist()

    try:
        plot_volcano(genes, log2fc, pvalues, fig_path, title=f"Volcano Plot: {geo_id} ({disease_name})")
    except Exception as e:
        print(f"[GEO] Volcano plot failed: {e}")
        fig_path = None

    # Step 6: Save results
    top_up_genes = sig_up.nlargest(top_n, "log2fc")[["gene", "log2fc", "padj"]].to_dict("records")
    top_down_genes = sig_down.nsmallest(top_n, "log2fc")[["gene", "log2fc", "padj"]].to_dict("records")

    json_data = {
        "disease": disease_name,
        "geo_id": geo_id,
        "sample_counts": {"tumor": n_tumor, "normal": n_normal, "total": expr_df.shape[1]},
        "de_summary": {
            "total_genes_tested": len(de_results),
            "significant_up": len(sig_up),
            "significant_down": len(sig_down),
            "fc_threshold": 1.0,
            "padj_threshold": 0.05,
        },
        "top_upregulated": top_up_genes[:20],
        "top_downregulated": top_down_genes[:20],
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"de_{geo_id}_results.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Save full DE table
    de_table_path = output_dir / f"de_{geo_id}_full.csv"
    de_results.to_csv(de_table_path, index=False)

    print(f"\n[GEO] Results for {disease_name} ({geo_id}):")
    print(f"  Genes tested: {len(de_results)}")
    print(f"  Significantly upregulated (log2FC>1, padj<0.05): {len(sig_up)}")
    print(f"  Significantly downregulated (log2FC<-1, padj<0.05): {len(sig_down)}")
    if top_up_genes:
        print(f"  Top upregulated: {', '.join(g['gene'] for g in top_up_genes[:5])}")
    if top_down_genes:
        print(f"  Top downregulated: {', '.join(g['gene'] for g in top_down_genes[:5])}")
    print(f"  Output: {json_path}")

    return {
        "de_results": {
            "total_genes": len(de_results),
            "significant_up": len(sig_up),
            "significant_down": len(sig_down),
        },
        "top_upregulated": top_up_genes[:10],
        "top_downregulated": top_down_genes[:10],
        "figure_path": str(fig_path) if fig_path else None,
        "json_path": str(json_path),
        "de_table_path": str(de_table_path),
        "summary": (
            f"Differential expression in {disease_name} ({geo_id}): "
            f"{len(sig_up)} upregulated, {len(sig_down)} downregulated genes "
            f"(log2FC>1, padj<0.05). "
            f"Top up: {', '.join(g['gene'] for g in top_up_genes[:3])}."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Differential expression analysis from GEO data")
    parser.add_argument("--disease", required=True, help="Disease name")
    parser.add_argument("--geo-id", help="GEO series ID (e.g., GSE10072)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--top", type=int, default=50, help="Number of top genes to report")
    args = parser.parse_args()

    result = run(args.disease, args.geo_id, Path(args.output_dir), args.top)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
