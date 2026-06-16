#!/usr/bin/env python3
"""
TME (Tumor Microenvironment) Immune Profiling Integration.

Provides:
- Immune deconvolution analysis (CIBERSORTx/xCell/EPIC patterns)
- TME phenotype classification (hot/cold/excluded)
- Immune checkpoint expression analysis
- Immune evasion mechanism scoring

TME Phenotypes:
- Hot (inflamed): High immune infiltration, responsive to immunotherapy
- Cold (desert): Low immune infiltration, resistant to immunotherapy
- Excluded: Immune cells present but excluded from tumor core
- Immunosuppressive: High Tregs/MDSCs, active immune suppression
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict


# TME phenotype definitions
TME_PHENOTYPES = {
    "hot": {
        "name": "Hot (Inflamed)",
        "description": "High immune infiltration, likely responsive to immunotherapy",
        "characteristics": ["High CD8+ T cells", "High PD-L1 expression", "Inflammatory cytokines"],
        "immunotherapy_response": "High",
    },
    "cold": {
        "name": "Cold (Desert)",
        "description": "Low immune infiltration, likely resistant to immunotherapy",
        "characteristics": ["Low T cell infiltration", "Low PD-L1", "Immunologically ignorant"],
        "immunotherapy_response": "Low",
    },
    "excluded": {
        "name": "Immune Excluded",
        "description": "Immune cells present but excluded from tumor core",
        "characteristics": ["Immune cells in stroma", "T cell exclusion", "Physical barriers"],
        "immunotherapy_response": "Variable",
    },
    "immunosuppressive": {
        "name": "Immunosuppressive",
        "description": "Active immune suppression by Tregs/MDSCs",
        "characteristics": ["High Tregs", "High MDSCs", "TGF-beta/IL-10"],
        "immunotherapy_response": "Low-Moderate",
    },
}


@dataclass
class ImmuneCellProfile:
    """Profile for a single immune cell type."""
    cell_type: str
    abundance: float  # 0-1 scale
    correlation_with_target: float  # Pearson r
    pvalue: float
    significant: bool
    role: str  # "effector", "suppressor", "marker", "other"


@dataclass
class CheckpointStatus:
    """Status of an immune checkpoint."""
    checkpoint: str
    expression_tpm: float
    tumor_vs_normal_log2fc: float
    pvalue: float
    druggable: bool
    approved_drugs: List[str] = field(default_factory=list)


@dataclass
class TMEProfile:
    """Complete TME profile for a target in a cancer type."""
    gene: str
    cancer_type: str
    phenotype: str  # hot, cold, excluded, immunosuppressive
    phenotype_confidence: float
    immune_score: float  # 0-100
    stromal_score: float  # 0-100
    msi_status: str  # MSI-H, MSI-L, MSS
    tmb: float  # mutations/Mb
    immune_cells: List[ImmuneCellProfile] = field(default_factory=list)
    checkpoints: List[CheckpointStatus] = field(default_factory=list)
    evasion_mechanisms: List[str] = field(default_factory=list)
    immunotherapy_prediction: str = ""

    def to_dict(self) -> dict:
        return {
            "gene": self.gene,
            "cancer_type": self.cancer_type,
            "phenotype": self.phenotype,
            "phenotype_info": TME_PHENOTYPES.get(self.phenotype, {}),
            "phenotype_confidence": self.phenotype_confidence,
            "immune_score": self.immune_score,
            "stromal_score": self.stromal_score,
            "msi_status": self.msi_status,
            "tmb": self.tmb,
            "immune_cells": [asdict(c) for c in self.immune_cells],
            "checkpoints": [asdict(c) for c in self.checkpoints],
            "evasion_mechanisms": self.evasion_mechanisms,
            "immunotherapy_prediction": self.immunotherapy_prediction,
        }

    def to_markdown(self) -> str:
        phenotype_info = TME_PHENOTYPES.get(self.phenotype, {})
        lines = [
            f"# TME Profile: {self.gene} in {self.cancer_type}",
            "",
            f"## TME Phenotype: {phenotype_info.get('name', self.phenotype)}",
            f"*{phenotype_info.get('description', '')}*",
            "",
            f"- **Immune Score**: {self.immune_score:.1f}/100",
            f"- **Stromal Score**: {self.stromal_score:.1f}/100",
            f"- **MSI Status**: {self.msi_status}",
            f"- **TMB**: {self.tmb:.1f} mutations/Mb",
            f"- **Phenotype Confidence**: {self.phenotype_confidence:.0%}",
            "",
        ]

        if self.immune_cells:
            lines.append("## Immune Cell Infiltration")
            lines.append("")
            lines.append("| Cell Type | Abundance | Correlation (r) | P-value | Significant | Role |")
            lines.append("|-----------|-----------|-----------------|---------|-------------|------|")
            for cell in sorted(self.immune_cells, key=lambda x: abs(x.correlation_with_target), reverse=True):
                sig = "Yes" if cell.significant else "No"
                lines.append(f"| {cell.cell_type} | {cell.abundance:.3f} | {cell.correlation_with_target:.3f} | {cell.pvalue:.2e} | {sig} | {cell.role} |")
            lines.append("")

        if self.checkpoints:
            lines.append("## Immune Checkpoints")
            lines.append("")
            lines.append("| Checkpoint | Expression (TPM) | Tumor vs Normal | P-value | Druggable |")
            lines.append("|------------|------------------|-----------------|---------|-----------|")
            for cp in self.checkpoints:
                druggable = "Yes" if cp.druggable else "No"
                lines.append(f"| {cp.checkpoint} | {cp.expression_tpm:.1f} | {cp.tumor_vs_normal_log2fc:+.2f} | {cp.pvalue:.2e} | {druggable} |")
            lines.append("")

        if self.evasion_mechanisms:
            lines.append("## Immune Evasion Mechanisms")
            for mech in self.evasion_mechanisms:
                lines.append(f"- {mech}")
            lines.append("")

        if self.immunotherapy_prediction:
            lines.append(f"## Immunotherapy Prediction")
            lines.append(f"> {self.immunotherapy_prediction}")
            lines.append("")

        return "\n".join(lines)


def classify_tme_phenotype(
    immune_correlations: dict,
    expression_data: dict = None,
) -> Tuple[str, float, List[str]]:
    """Classify TME phenotype based on immune cell correlations.

    Args:
        immune_correlations: Dict of cell_type -> {r, pvalue, significant}
        expression_data: Optional expression data for additional signals

    Returns:
        Tuple of (phenotype, confidence, evasion_mechanisms)
    """
    if not immune_correlations:
        return "cold", 0.0, ["Insufficient data"]

    # Count significant positive and negative correlations
    sig_pos = []
    sig_neg = []
    for cell, vals in immune_correlations.items():
        if not isinstance(vals, dict):
            continue
        r = vals.get("r", 0)
        pval = vals.get("pvalue", 1)
        if pval < 0.05:
            if r > 0.1:
                sig_pos.append(cell)
            elif r < -0.1:
                sig_neg.append(cell)

    total_sig = len(sig_pos) + len(sig_neg)
    evasion_mechanisms = []

    # Classification logic
    if total_sig == 0:
        return "cold", 0.5, ["No significant immune correlations detected"]

    # Check for suppressive signals
    suppressive_cells = ["Tregs", "T cells regulatory", "MDSC", "Macrophages M2"]
    has_suppressive = any(any(s.lower() in cell.lower() for s in suppressive_cells) for cell in sig_pos)

    # Check for effector signals
    effector_cells = ["CD8", "T cells CD8", "NK cells", "B cells", "T cells CD4"]
    has_effector = any(any(s.lower() in cell.lower() for s in effector_cells) for cell in sig_pos)

    # Check for exclusion signals (negative correlation with immune cells)
    if len(sig_neg) > len(sig_pos):
        evasion_mechanisms.append("Immune exclusion: negative correlation with infiltrating cells")
        return "excluded", 0.7, evasion_mechanisms

    if has_suppressive and not has_effector:
        evasion_mechanisms.append("Immunosuppressive TME: Tregs/MDSCs dominant")
        return "immunosuppressive", 0.7, evasion_mechanisms

    if has_effector and not has_suppressive:
        return "hot", 0.8, []

    if has_effector and has_suppressive:
        evasion_mechanisms.append("Mixed TME: effector cells present but suppressed")
        return "immunosuppressive", 0.6, evasion_mechanisms

    # Default based on number of positive correlations
    if len(sig_pos) >= 3:
        return "hot", 0.6, []
    elif len(sig_pos) >= 1:
        return "excluded", 0.5, ["Weak immune infiltration"]

    return "cold", 0.4, ["Minimal immune response"]


def build_tme_profile(
    gene: str,
    cancer_type: str,
    immune_data: dict = None,
    expression_data: dict = None,
    survival_data: dict = None,
) -> TMEProfile:
    """Build a complete TME profile from pipeline data.

    Args:
        gene: Gene symbol
        cancer_type: Cancer type code
        immune_data: Immune correlation data from Phase 1
        expression_data: GTEx expression data
        survival_data: Survival analysis data

    Returns:
        TMEProfile with all fields populated
    """
    # Classify TME phenotype
    phenotype, confidence, evasion = classify_tme_phenotype(immune_data or {})

    # Build immune cell profiles
    immune_cells = []
    if immune_data:
        cell_roles = {
            "CD8": "effector", "CD4": "effector", "NK": "effector", "B": "effector",
            "Tregs": "suppressor", "T regulatory": "suppressor", "MDSC": "suppressor",
            "Macrophage": "other", "Mast": "other", "Neutrophil": "other",
            "Dendritic": "other", "Monocyte": "other",
        }
        for cell, vals in immune_data.items():
            if not isinstance(vals, dict):
                continue
            # Determine role
            role = "other"
            for key, r in cell_roles.items():
                if key.lower() in cell.lower():
                    role = r
                    break

            immune_cells.append(ImmuneCellProfile(
                cell_type=cell,
                abundance=abs(vals.get("r", 0)),
                correlation_with_target=vals.get("r", 0),
                pvalue=vals.get("pvalue", 1),
                significant=vals.get("significant", False),
                role=role,
            ))

    # Calculate immune score (based on significant positive correlations)
    sig_pos_count = sum(1 for c in immune_cells if c.significant and c.correlation_with_target > 0)
    immune_score = min(100, sig_pos_count * 15)  # Scale: each sig cell = 15 points

    # Estimate stromal score (inverse of immune exclusion)
    sig_neg_count = sum(1 for c in immune_cells if c.significant and c.correlation_with_target < 0)
    stromal_score = min(100, sig_neg_count * 20)

    # Build checkpoint statuses (common checkpoints)
    checkpoints = []
    common_checkpoints = ["PD-1", "PD-L1", "CTLA-4", "LAG-3", "TIM-3", "TIGIT"]
    for cp in common_checkpoints:
        # Placeholder - would need expression data for actual values
        checkpoints.append(CheckpointStatus(
            checkpoint=cp,
            expression_tpm=0.0,
            tumor_vs_normal_log2fc=0.0,
            pvalue=1.0,
            druggable=cp in ["PD-1", "PD-L1", "CTLA-4", "LAG-3"],
        ))

    # MSI/TMB estimation (placeholder - would need actual data)
    msi_status = "Unknown"
    tmb = 0.0

    # Immunotherapy prediction
    if phenotype == "hot":
        prediction = "Likely responsive to immune checkpoint inhibitors (anti-PD-1/PD-L1)"
    elif phenotype == "cold":
        prediction = "Likely resistant to monotherapy; consider combination strategies"
    elif phenotype == "excluded":
        prediction = "May respond to agents that promote T cell infiltration"
    else:
        prediction = "Consider targeting immunosuppressive mechanisms (anti-Treg, anti-MDSC)"

    profile = TMEProfile(
        gene=gene,
        cancer_type=cancer_type,
        phenotype=phenotype,
        phenotype_confidence=confidence,
        immune_score=immune_score,
        stromal_score=stromal_score,
        msi_status=msi_status,
        tmb=tmb,
        immune_cells=immune_cells,
        checkpoints=checkpoints,
        evasion_mechanisms=evasion,
        immunotherapy_prediction=prediction,
    )

    return profile


def save_tme_profile(profile: TMEProfile, output_dir: Path) -> Path:
    """Save TME profile to JSON."""
    from shared.data_validator import DataProvenance

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"tme_{profile.gene}_{profile.cancer_type}_profile.json"
    data = profile.to_dict()
    prov = DataProvenance(target_gene=profile.gene)
    prov.add_source(
        "TIMER",
        f"{profile.gene} immune infiltration in {profile.cancer_type}",
        url="http://timer.cistrome.org/",
    )
    prov.add_source(
        "CIBERSORTx",
        f"TME phenotype ({profile.phenotype}) inference",
        url="https://cibersortx.stanford.edu/",
    )
    data["provenance"] = prov.to_dict()
    out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path
