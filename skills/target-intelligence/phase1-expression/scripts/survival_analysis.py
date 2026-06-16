#!/usr/bin/env python3
"""
Survival analysis using TCGA clinical data via cBioPortal.

Computes Kaplan-Meier curves and Cox proportional hazards regression
by splitting samples into high/low expression groups based on median.

Verified API: https://www.cbioportal.org/api

Usage:
    python survival_analysis.py --gene EGFR --cancer-type LUAD [--output-dir ./output]

Outputs:
    - survival_{gene}_{cancer}_results.json: Survival statistics
    - survival_{gene}_{cancer}_km.png: Kaplan-Meier curve
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_cbioportal_client
from shared.data_validator import DataProvenance

# Reuse study mapping from tcga_analysis
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


def get_clinical_data(study_id: str) -> List[dict]:
    """Get clinical/survival data from cBioPortal."""
    client = get_cbioportal_client()
    try:
        patients = client.get(f"studies/{study_id}/clinical-data", params={
            "attributeId": "OS_MONTHS,OS_STATUS,DFS_MONTHS,DFS_STATUS",
            "clinicalDataType": "PATIENT",
            "pageSize": 10000,
        })
        return patients if isinstance(patients, list) else []
    except Exception as e:
        print(f"[Survival] Clinical data fetch failed: {e}")
        return []


def get_expression_for_survival(profile_id: str, sample_ids: List[str], entrez_id: int) -> Dict[str, float]:
    """Get expression values keyed by sample ID."""
    client = get_cbioportal_client()
    try:
        result = client.post(
            f"molecular-profiles/{profile_id}/molecular-data/fetch",
            json_data={
                "entrezGeneIds": [entrez_id],
                "sampleIds": sample_ids,
            },
        )
        return {item.get("sampleId", ""): float(item.get("value", 0))
                for item in result if item.get("value") is not None}
    except Exception as e:
        print(f"[Survival] Expression fetch failed: {e}")
        return {}


def get_gene_entrez_id(gene_symbol: str) -> Optional[int]:
    """Get Entrez Gene ID from cBioPortal."""
    client = get_cbioportal_client()
    try:
        result = client.get(f"genes/{gene_symbol}")
        return result.get("entrezGeneId")
    except Exception:
        return None


def compute_km_and_cox(times: np.ndarray, events: np.ndarray, groups: np.ndarray) -> dict:
    """Compute KM survival curves and Cox PH regression.

    Args:
        times: Survival times in months
        events: Event indicators (1=death, 0=censored)
        groups: Group labels (1=high expression, 0=low expression)
    """
    from lifelines import KaplanMeierFitter
    from lifelines.statistics import logrank_test
    from lifelines import CoxPHFitter

    # KM curves
    kmf_high = KaplanMeierFitter()
    mask_high = groups == 1
    kmf_high.fit(times[mask_high], event_observed=events[mask_high], label="High expression")

    kmf_low = KaplanMeierFitter()
    mask_low = groups == 0
    kmf_low.fit(times[mask_low], event_observed=events[mask_low], label="Low expression")

    # Log-rank test
    lr_result = logrank_test(times[mask_high], times[mask_low], events[mask_high], events[mask_low])

    # Median survival
    median_high = kmf_high.median_survival_time_
    median_low = kmf_low.median_survival_time_

    # Cox PH regression
    cox_result = None
    try:
        df_data = {"time": times, "event": events, "expression": groups.astype(float)}
        import pandas as pd
        df = pd.DataFrame(df_data)
        cph = CoxPHFitter()
        cph.fit(df, duration_col="time", event_col="event")
        hr = cph.hazard_ratios_["expression"]
        ci = cph.confidence_intervals_.loc["expression"]
        cox_summary = cph.summary.loc["expression"]
        cox_result = {
            "hazard_ratio": round(float(hr), 3),
            "hr_ci_lower": round(float(np.exp(ci.iloc[0])), 3),
            "hr_ci_upper": round(float(np.exp(ci.iloc[1])), 3),
            "cox_pvalue": float(cox_summary["p"]),
            "concordance_index": round(float(cph.concordance_index_), 3),
        }
    except Exception as e:
        print(f"[Survival] Cox regression failed: {e}")
        cox_result = {"error": str(e)}

    return {
        "logrank_pvalue": float(lr_result.p_value),
        "logrank_test_statistic": float(lr_result.test_statistic),
        "median_survival_high_months": round(float(median_high), 1) if not np.isinf(median_high) else None,
        "median_survival_low_months": round(float(median_low), 1) if not np.isinf(median_low) else None,
        "n_high": int(mask_high.sum()),
        "n_low": int(mask_low.sum()),
        "events_high": int(events[mask_high].sum()),
        "events_low": int(events[mask_low].sum()),
        "cox_regression": cox_result,
        "km_curve_high": {
            "timeline": kmf_high.survival_function_.index.tolist(),
            "survival_function": kmf_high.survival_function_.values.flatten().tolist(),
        },
        "km_curve_low": {
            "timeline": kmf_low.survival_function_.index.tolist(),
            "survival_function": kmf_low.survival_function_.values.flatten().tolist(),
        },
    }


def run(gene_symbol: str, cancer_type: str, output_dir: Path) -> dict:
    """Run survival analysis for a gene in a cancer type."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)
    cancer_type = cancer_type.upper()
    study_id = CANCER_STUDIES.get(cancer_type)
    if not study_id:
        return {"error": f"Unsupported cancer type: {cancer_type}"}

    provenance.add_source("cBioPortal", f"survival analysis in {cancer_type}",
                          url=f"https://www.cbioportal.org/study/summary?id={study_id}")

    # Step 1: Get gene ID
    print(f"[Survival] Looking up {gene_symbol}...")
    entrez_id = get_gene_entrez_id(gene_symbol)
    if not entrez_id:
        return {"error": f"Gene {gene_symbol} not found"}

    # Step 2: Get clinical data with survival info
    # cBioPortal returns flat records: {patientId, clinicalAttributeId, value}
    # We need to pivot by patient to get OS_MONTHS and OS_STATUS
    print(f"[Survival] Fetching clinical data for {study_id}...")
    client = get_cbioportal_client()

    # Get all clinical data (flat format)
    try:
        clinical_flat = client.get(f"studies/{study_id}/clinical-data", params={
            "clinicalDataType": "PATIENT",
            "pageSize": 100000,
        })
    except Exception as e:
        return {"error": f"Failed to fetch clinical data: {e}"}

    if not isinstance(clinical_flat, list):
        return {"error": "Unexpected clinical data format"}

    print(f"[Survival] Got {len(clinical_flat)} clinical attribute records")

    # Pivot flat records by patientId
    patient_data = {}
    for record in clinical_flat:
        pid = record.get("patientId", "")
        attr = record.get("clinicalAttributeId", "")
        val = record.get("value", "")
        if pid:
            patient_data.setdefault(pid, {})[attr] = val

    # Get patient -> sample mapping via samples endpoint
    try:
        all_samples = client.get(f"studies/{study_id}/samples", params={
            "projection": "ID",
            "pageSize": 10000,
        })
        for s in all_samples:
            pid = s.get("patientId", "")
            sid = s.get("sampleId", "")
            if pid in patient_data and sid:
                patient_data[pid].setdefault("_sampleIds", []).append(sid)
    except Exception as e:
        print(f"[Survival] Warning: Could not get patient-sample mapping: {e}")

    # Filter patients with survival data
    # OS_STATUS format: "0:LIVING" or "1:DEAD"
    valid_patients = []
    for pid, pdata in patient_data.items():
        os_months = pdata.get("OS_MONTHS", "")
        os_status = pdata.get("OS_STATUS", "")

        if not os_months or not os_status:
            continue

        try:
            time_val = float(os_months)
            # Parse "0:LIVING" or "1:DEAD" format
            if ":" in str(os_status):
                event = int(str(os_status).split(":")[0].strip())
            else:
                event = int(float(os_status))

            if time_val > 0:
                valid_patients.append({
                    "patientId": pid,
                    "sampleIds": pdata.get("_sampleIds", []),
                    "time_months": time_val,
                    "event": event,
                })
        except (ValueError, TypeError, IndexError):
            continue

    print(f"[Survival] {len(valid_patients)} patients with survival data")

    if len(valid_patients) < 20:
        return {"error": f"Too few patients with survival data: {len(valid_patients)}"}

    # Step 3: Get expression data to split groups
    # Find mRNA profile
    profiles = client.get(f"studies/{study_id}/molecular-profiles")
    profile_id = None
    for p in profiles:
        pid = p.get("molecularProfileId", "")
        if "mrna" in pid and "zscore" not in pid:
            profile_id = pid
            break

    if not profile_id:
        return {"error": "No mRNA expression profile found"}

    # Get expression for all samples
    all_sample_ids = []
    patient_to_samples = {}
    for p in valid_patients:
        sids = p.get("sampleIds", [])
        if sids:
            all_sample_ids.append(sids[0])
            patient_to_samples[p["patientId"]] = sids[0]

    print(f"[Survival] Fetching expression for {len(all_sample_ids)} samples...")
    expression_map = get_expression_for_survival(profile_id, all_sample_ids, entrez_id)

    # Assign expression values to patients and split by median
    expression_values = []
    for p in valid_patients:
        sid = patient_to_samples.get(p["patientId"])
        if sid and sid in expression_map:
            p["expression"] = expression_map[sid]
            expression_values.append(expression_map[sid])

    if len(expression_values) < 20:
        return {"error": "Insufficient expression data for survival split"}

    median_expr = float(np.median(expression_values))
    print(f"[Survival] Median expression: {median_expr:.3f}")

    # Split into high/low groups
    times_list = []
    events_list = []
    groups_list = []
    for p in valid_patients:
        if "expression" in p:
            times_list.append(p["time_months"])
            events_list.append(p["event"])
            groups_list.append(1 if p["expression"] >= median_expr else 0)

    times_arr = np.array(times_list)
    events_arr = np.array(events_list)
    groups_arr = np.array(groups_list)

    # Step 4: Compute KM and Cox
    print("[Survival] Computing Kaplan-Meier curves and Cox regression...")
    survival_stats = compute_km_and_cox(times_arr, events_arr, groups_arr)
    survival_stats["median_expression_cutoff"] = round(median_expr, 3)
    survival_stats["cutoff_method"] = "median"

    # Step 5: Generate KM plot
    fig_path = output_dir / f"survival_{gene_symbol}_{cancer_type}_km.png"
    try:
        from shared.visualizer import plot_survival_curve
        mask_high = groups_arr == 1
        mask_low = groups_arr == 0
        hr = survival_stats.get("cox_regression", {}).get("hazard_ratio")
        pval = survival_stats.get("logrank_pvalue")
        plot_survival_curve(
            times_arr[mask_high].tolist(), times_arr[mask_low].tolist(),
            events_arr[mask_high].tolist(), events_arr[mask_low].tolist(),
            gene_symbol, fig_path, cancer_type=cancer_type, hr=hr, p_value=pval,
        )
        print(f"[Survival] KM curve saved: {fig_path}")
    except Exception as e:
        print(f"[Survival] KM plot failed: {e}")
        fig_path = None

    # Step 6: Save results
    cox = survival_stats.get("cox_regression", {})
    json_data = {
        "gene": gene_symbol,
        "cancer_type": cancer_type,
        "study_id": study_id,
        "survival_stats": survival_stats,
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"survival_{gene_symbol}_{cancer_type}_results.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Summary
    hr = cox.get("hazard_ratio", "N/A")
    pval = survival_stats.get("logrank_pvalue", 1)
    n_total = survival_stats["n_high"] + survival_stats["n_low"]
    summary = (
        f"TCGA-{cancer_type}: {n_total} patients analyzed. "
        f"HR={hr} (P={pval:.2e}), "
        f"Median survival: high={survival_stats.get('median_survival_high_months', 'N/A')}mo, "
        f"low={survival_stats.get('median_survival_low_months', 'N/A')}mo."
    )

    print(f"\n[Survival] Results:")
    print(f"  Patients: {n_total} (high={survival_stats['n_high']}, low={survival_stats['n_low']})")
    print(f"  HR: {hr}, P: {pval:.2e}")
    print(f"  Output: {json_path}")

    return {
        "survival_stats": survival_stats,
        "figure_path": str(fig_path) if fig_path else None,
        "json_path": str(json_path),
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(description="Survival analysis via cBioPortal")
    parser.add_argument("--gene", required=True, help="Gene symbol")
    parser.add_argument("--cancer-type", required=True, help="TCGA cancer type (e.g., LUAD)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()
    run(args.gene, args.cancer_type.upper(), Path(args.output_dir))


if __name__ == "__main__":
    main()
