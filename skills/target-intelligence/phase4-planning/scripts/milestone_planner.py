#!/usr/bin/env python3
"""
Data-driven milestone planner for drug target development.

Reads Phase 1-3 outputs and generates adjusted milestone timelines
based on actual target characteristics (expression, druggability,
competition, patent landscape).

Usage:
    python milestone_planner.py --gene EGFR --phase1-dir ../output --phase2-dir ../output --phase3-dir ../output [--output-dir ./output]

Outputs:
    - milestones_{gene}.json: Milestone timeline with adjustments
    - milestones_{gene}.png: Timeline visualization
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.data_validator import DataProvenance


# Base timelines by modality (months from project start)
MODALITY_TIMELINES = {
    "antibody": {
        "discovery": 12,
        "lead_optimization": 12,
        "preclinical": 18,
        "phase1": 18,
        "phase2": 24,
        "phase3": 36,
        "approval": 18,
        "total": 138,
    },
    "small_molecule": {
        "discovery": 12,
        "hit_to_lead": 12,
        "lead_optimization": 12,
        "preclinical": 18,
        "phase1": 12,
        "phase2": 24,
        "phase3": 36,
        "approval": 18,
        "total": 144,
    },
    "kinase_inhibitor": {
        "discovery": 9,
        "hit_to_lead": 9,
        "lead_optimization": 12,
        "preclinical": 15,
        "phase1": 12,
        "phase2": 18,
        "phase3": 30,
        "approval": 18,
        "total": 123,
    },
    "bispecific": {
        "discovery": 15,
        "lead_optimization": 15,
        "preclinical": 21,
        "phase1": 24,
        "phase2": 30,
        "phase3": 36,
        "approval": 18,
        "total": 159,
    },
    "adc": {
        "discovery": 12,
        "conjugation_optimization": 12,
        "preclinical": 21,
        "phase1": 18,
        "phase2": 24,
        "phase3": 36,
        "approval": 18,
        "total": 141,
    },
    "default": {
        "discovery": 12,
        "optimization": 12,
        "preclinical": 18,
        "phase1": 18,
        "phase2": 24,
        "phase3": 36,
        "approval": 18,
        "total": 138,
    },
}


def load_phase_data(phase_dir: Path, gene: str, phase_name: str) -> dict:
    """Load phase output data from JSON files."""
    if not phase_dir or not phase_dir.exists():
        return {}

    merged = {}
    for f in sorted(phase_dir.glob(f"*{gene}*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))

            if "survival_stats" in data:
                merged.setdefault("results", {})["survival"] = {
                    "survival_stats": data["survival_stats"],
                    "summary": data.get("summary", ""),
                }
            elif "expression_by_tissue" in data:
                merged.setdefault("results", {})["gtex"] = {
                    "summary": data.get("summary", ""),
                }
            elif "competition" in data:
                merged.setdefault("results", {})["competitive"] = {
                    "competition": data["competition"],
                    "total_trials": data.get("total_trials", 0),
                }
            elif "patent_trends" in data:
                merged.setdefault("results", {})["patents"] = {
                    "trends": data["patent_trends"],
                }
            elif "targets" in data and "disease" in data:
                merged["targets"] = data["targets"]
                merged["gene_detail"] = data.get("gene_detail", {})
            elif "druggability" in data:
                merged.setdefault("druggability", {})[data.get("gene", "")] = data["druggability"]
        except Exception:
            continue

    # Also try phase-specific report files
    for f in sorted(phase_dir.glob(f"phase{phase_name}*report*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if "results" in data:
                merged.setdefault("results", {}).update(data["results"])
        except Exception:
            continue

    return merged


def load_all_phase_data(gene: str, phase1_dir: Path, phase2_dir: Path, phase3_dir: Path) -> dict:
    """Load data from all three phases."""
    return {
        "phase1": load_phase_data(phase1_dir, gene, "1"),
        "phase2": load_phase_data(phase2_dir, gene, "2"),
        "phase3": load_phase_data(phase3_dir, gene, "3"),
    }


def detect_modality(phase2_data: dict, phase3_data: dict) -> str:
    """Detect recommended modality from Phase 2-3 data."""
    modalities_present = set()

    # Check druggability from pharos data
    druggability = phase2_data.get("druggability", {})
    for gene, ddata in druggability.items():
        if ddata.get("sm_tractable") or ddata.get("small_molecule_tractable"):
            modalities_present.add("small_molecule")
        if ddata.get("ab_tractable") or ddata.get("antibody_tractable"):
            modalities_present.add("antibody")

    # Check phase2 for tractability
    gene_detail = phase2_data.get("gene_detail", {})
    tractability = gene_detail.get("tractability", [])
    for t in tractability:
        if t.get("value"):
            modality = t.get("modality", "").lower()
            label = t.get("label", "").lower()
            if "antibody" in modality or "antibody" in label:
                modalities_present.add("antibody")
            if "small molecule" in modality or "small" in label:
                modalities_present.add("small_molecule")
            if "kinase" in label:
                modalities_present.add("kinase_inhibitor")

    # Check phase3 for existing drug mechanisms
    competition = phase3_data.get("results", {}).get("competitive", {})
    comp_data = competition.get("competition", {})
    mechanisms = comp_data.get("key_mechanisms", [])
    for m in mechanisms:
        mech = m.get("mechanism", "").lower()
        if "antibody" in mech or "mab" in mech:
            modalities_present.add("antibody")
        if "inhibitor" in mech:
            modalities_present.add("kinase_inhibitor")

    if "antibody" in modalities_present and "small_molecule" in modalities_present:
        return "bispecific"
    if "antibody" in modalities_present:
        return "antibody"
    if "kinase_inhibitor" in modalities_present:
        return "kinase_inhibitor"
    if "small_molecule" in modalities_present:
        return "small_molecule"

    return "default"


def compute_adjustments(gene: str, phase1: dict, phase2: dict, phase3: dict) -> List[dict]:
    """Compute data-driven timeline adjustments."""
    adjustments = []

    # Adjustment 1: Competition density
    competition = phase3.get("results", {}).get("competitive", {})
    n_trials = competition.get("total_trials", 0)
    n_mechanisms = len(competition.get("competition", {}).get("key_mechanisms", []))

    if n_trials > 200 or n_mechanisms > 15:
        adjustments.append({
            "factor": "competition_density",
            "description": f"Highly competitive field ({n_trials} trials, {n_mechanisms} mechanisms). Add 3 months for differentiation strategy.",
            "months_delta": 3,
            "phase_affected": "discovery",
        })
    elif n_trials < 20 and n_mechanisms < 3:
        adjustments.append({
            "factor": "low_competition",
            "description": f"Low competition ({n_trials} trials, {n_mechanisms} mechanisms). May reduce discovery phase by 3 months.",
            "months_delta": -3,
            "phase_affected": "discovery",
        })

    # Adjustment 2: Druggability from Open Targets
    targets = phase2.get("targets", [])
    gene_score = None
    for t in targets:
        if t.get("symbol", "").upper() == gene.upper():
            gene_score = t.get("overall_score", 0)
            break

    gene_detail = phase2.get("gene_detail", {})
    if not gene_score and gene_detail:
        gene_score = gene_detail.get("overall_score", 0)

    if gene_score and gene_score > 0.8:
        adjustments.append({
            "factor": "high_disease_association",
            "description": f"Strong disease association (score={gene_score:.3f}). Prioritize clinical development.",
            "months_delta": -3,
            "phase_affected": "preclinical",
        })
    elif gene_score and gene_score < 0.3:
        adjustments.append({
            "factor": "weak_disease_association",
            "description": f"Weak disease association (score={gene_score:.3f}). Add 6 months for additional validation.",
            "months_delta": 6,
            "phase_affected": "discovery",
        })

    # Adjustment 3: Survival signal strength
    survival_data = phase1.get("results", {}).get("survival", {})
    survival_stats = survival_data.get("survival_stats", {})
    hr = survival_stats.get("cox_regression", {}).get("hazard_ratio")
    if hr:
        if hr > 2.0:
            adjustments.append({
                "factor": "strong_prognostic_signal",
                "description": f"Strong prognostic signal (HR={hr}). High clinical rationale — accelerate development.",
                "months_delta": -3,
                "phase_affected": "phase1",
            })
        elif hr < 1.2 and hr > 0.8:
            adjustments.append({
                "factor": "weak_prognostic_signal",
                "description": f"Weak prognostic signal (HR={hr}). Consider companion diagnostic development.",
                "months_delta": 3,
                "phase_affected": "preclinical",
            })

    # Adjustment 4: Patent density
    patent_data = phase3.get("results", {}).get("patents", {})
    n_patents = patent_data.get("trends", {}).get("total_patents", 0)
    if n_patents > 500:
        adjustments.append({
            "factor": "dense_patent_landscape",
            "description": f"Dense patent landscape ({n_patents} patents). Add 6 months for freedom-to-operate analysis.",
            "months_delta": 6,
            "phase_affected": "discovery",
        })

    # Adjustment 5: Existing approved drugs
    approved_drugs = competition.get("competition", {}).get("approved_drugs", [])
    if len(approved_drugs) > 3:
        adjustments.append({
            "factor": "established_market",
            "description": f"{len(approved_drugs)} approved drugs on market. Focus on differentiation (next-gen, ADC, combo).",
            "months_delta": 0,
            "phase_affected": "strategy",
            "recommendation": "differentiation_required",
        })

    return adjustments


def generate_milestones(modality: str, adjustments: List[dict], start_date: datetime = None) -> List[dict]:
    """Generate adjusted milestone timeline."""
    if start_date is None:
        start_date = datetime.now()

    base = MODALITY_TIMELINES.get(modality, MODALITY_TIMELINES["default"]).copy()

    # Apply adjustments
    total_delta = 0
    for adj in adjustments:
        delta = adj.get("months_delta", 0)
        total_delta += delta
        phase = adj.get("phase_affected", "discovery")
        if phase in base:
            base[phase] = max(3, base[phase] + delta)

    base["total"] = sum(v for k, v in base.items() if k != "total")

    # Build milestone list
    milestones = []
    current_date = start_date
    phase_order = [k for k in base if k != "total"]

    for phase in phase_order:
        months = base[phase]
        end_date = current_date + timedelta(days=months * 30)
        milestones.append({
            "phase": phase.replace("_", " ").title(),
            "start_date": current_date.strftime("%Y-%m"),
            "end_date": end_date.strftime("%Y-%m"),
            "duration_months": months,
            "description": _get_phase_description(phase, modality),
        })
        current_date = end_date

    return milestones


def _get_phase_description(phase: str, modality: str) -> str:
    """Get human-readable description for a development phase."""
    descriptions = {
        "discovery": "Target validation, assay development, hit identification",
        "hit_to_lead": "Hit confirmation, selectivity profiling, initial SAR",
        "lead_optimization": "Potency, selectivity, ADMET optimization",
        "optimization": "Lead optimization and characterization",
        "conjugation_optimization": "ADC conjugation chemistry and linker optimization",
        "preclinical": "GLP toxicology, PK/PD, CMC, IND-enabling studies",
        "phase1": "First-in-human, dose escalation, safety/PK",
        "phase2": "Dose expansion, efficacy signals, biomarker validation",
        "phase3": "Pivotal efficacy trials, registration",
        "approval": "NDA/BLA submission and review",
        "strategy": "Strategic planning and differentiation",
    }
    return descriptions.get(phase, f"{phase.replace('_', ' ').title()} activities")


def extract_risks(gene: str, phase1: dict, phase2: dict, phase3: dict) -> List[dict]:
    """Extract risk factors from all phase data."""
    risks = []

    # Competition risk
    competition = phase3.get("results", {}).get("competitive", {})
    n_approved = len(competition.get("competition", {}).get("approved_drugs", []))
    if n_approved > 3:
        risks.append({
            "category": "competition",
            "severity": "high",
            "description": f"{n_approved} approved drugs targeting this pathway. Differentiation is critical.",
            "mitigation": "Focus on next-generation modality (ADC, bispecific, allosteric inhibitor)",
        })

    # Expression risk
    gtex_data = phase1.get("results", {}).get("gtex", {})
    if gtex_data.get("tissue_specific"):
        tissues = gtex_data.get("tissue_specific", [])
        if len(tissues) < 2:
            risks.append({
                "category": "safety",
                "severity": "medium",
                "description": "Limited tissue specificity may indicate on-target toxicity risk.",
                "mitigation": "Develop tissue-targeted delivery or conditional activation strategy",
            })

    # Patent risk
    patent_data = phase3.get("results", {}).get("patents", {})
    n_patents = patent_data.get("trends", {}).get("total_patents", 0)
    if n_patents > 300:
        top_assignees = patent_data.get("trends", {}).get("top_assignees", {})
        risks.append({
            "category": "ip",
            "severity": "medium",
            "description": f"Dense patent landscape ({n_patents} patents). Key holders: {', '.join(list(top_assignees.keys())[:3])}.",
            "mitigation": "Commission freedom-to-operate analysis before lead optimization",
        })

    # Survival data risk
    survival_data = phase1.get("results", {}).get("survival", {})
    surv_stats = survival_data.get("survival_stats", {})
    pval = surv_stats.get("logrank_pvalue", 1)
    if pval > 0.05:
        risks.append({
            "category": "biology",
            "severity": "medium",
            "description": f"Survival association not significant (P={pval:.3f}). Target may lack strong clinical rationale.",
            "mitigation": "Validate with additional cohorts or consider stratification by molecular subtype",
        })

    if not risks:
        risks.append({
            "category": "general",
            "severity": "low",
            "description": "No major risks identified from available data.",
            "mitigation": "Standard risk management approach",
        })

    return risks


def run(gene: str, output_dir: Path, phase1_dir: Path = None, phase2_dir: Path = None, phase3_dir: Path = None) -> dict:
    """Run milestone planning for a target."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene)
    provenance.add_source("Internal", "Data-driven milestone planning from Phase 1-3 outputs")

    # Load all phase data
    print(f"[Milestone] Loading data for {gene}...")
    phase_data = load_all_phase_data(gene, phase1_dir, phase2_dir, phase3_dir)

    # Detect modality
    modality = detect_modality(phase_data["phase2"], phase_data["phase3"])
    print(f"[Milestone] Recommended modality: {modality}")

    # Compute adjustments
    adjustments = compute_adjustments(
        gene, phase_data["phase1"], phase_data["phase2"], phase_data["phase3"]
    )
    print(f"[Milestone] {len(adjustments)} adjustment factors identified")
    for adj in adjustments:
        delta = adj.get("months_delta", 0)
        sign = "+" if delta > 0 else ""
        print(f"  {adj['factor']}: {sign}{delta}mo ({adj['phase_affected']})")

    # Generate milestones
    milestones = generate_milestones(modality, adjustments)

    # Extract risks
    risks = extract_risks(gene, phase_data["phase1"], phase_data["phase2"], phase_data["phase3"])

    # Build result
    json_data = {
        "gene": gene,
        "modality": modality,
        "adjustments": adjustments,
        "milestones": milestones,
        "risks": risks,
        "total_timeline_months": milestones[-1]["end_date"] if milestones else "N/A",
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"milestones_{gene}.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Generate timeline visualization
    fig_path = None
    try:
        fig_path = output_dir / f"milestones_{gene}_timeline.png"
        _plot_timeline(gene, milestones, fig_path)
    except Exception as e:
        print(f"[Milestone] Timeline plot failed: {e}")

    # Summary
    total_months = milestones[-1]["end_date"] if milestones else "N/A"
    summary = (
        f"Milestone plan for {gene} ({modality}): {len(milestones)} phases, "
        f"estimated completion {total_months}. "
        f"{len(adjustments)} data-driven adjustments applied. "
        f"{len(risks)} risk factors identified."
    )

    print(f"\n[Milestone] Timeline:")
    for m in milestones:
        print(f"  {m['phase']}: {m['start_date']} to {m['end_date']} ({m['duration_months']}mo)")

    return {
        "milestones": milestones,
        "modality": modality,
        "adjustments": adjustments,
        "risks": risks,
        "figure_path": str(fig_path) if fig_path else None,
        "json_path": str(json_path),
        "summary": summary,
    }


def _plot_timeline(gene: str, milestones: List[dict], fig_path: Path):
    """Plot Gantt-style timeline chart."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    fig, ax = plt.subplots(figsize=(14, 6))

    colors = {
        "Discovery": "#3b82f6",
        "Hit To Lead": "#6366f1",
        "Lead Optimization": "#8b5cf6",
        "Optimization": "#8b5cf6",
        "Conjugation Optimization": "#a855f7",
        "Preclinical": "#f59e0b",
        "Phase1": "#ef4444",
        "Phase2": "#10b981",
        "Phase3": "#06b6d4",
        "Approval": "#22c55e",
        "Strategy": "#64748b",
    }

    y_labels = []
    for i, m in enumerate(milestones):
        phase_name = m["phase"]
        y_labels.append(f"{phase_name} ({m['duration_months']}mo)")
        color = colors.get(phase_name, "#94a3b8")

        start = datetime.strptime(m["start_date"], "%Y-%m")
        end = datetime.strptime(m["end_date"], "%Y-%m")
        duration = (end - start).days

        ax.barh(i, duration, left=(start - datetime.now()).days, height=0.6,
                color=color, alpha=0.8, edgecolor="white", linewidth=0.5)

    ax.set_yticks(range(len(y_labels)))
    ax.set_yticklabels(y_labels, fontsize=9)
    ax.set_xlabel("Months from now")
    ax.set_title(f"{gene} Development Milestone Timeline ({milestones[0]['phase'].split()[0]} modality)",
                 fontsize=12, fontweight="bold")
    ax.invert_yaxis()
    ax.grid(axis="x", alpha=0.3)

    plt.tight_layout()
    fig.savefig(fig_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[Milestone] Timeline saved: {fig_path}")


def main():
    parser = argparse.ArgumentParser(description="Data-driven milestone planner")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--phase1-dir", help="Directory containing Phase 1 outputs")
    parser.add_argument("--phase2-dir", help="Directory containing Phase 2 outputs")
    parser.add_argument("--phase3-dir", help="Directory containing Phase 3 outputs")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()

    run(
        args.gene,
        Path(args.output_dir),
        Path(args.phase1_dir) if args.phase1_dir else None,
        Path(args.phase2_dir) if args.phase2_dir else None,
        Path(args.phase3_dir) if args.phase3_dir else None,
    )


if __name__ == "__main__":
    main()
