#!/usr/bin/env python3
"""
ToolUniverse Integration: Evidence-graded target research with 9 parallel research paths.

Evidence Grading:
- T1 (★★★): FDA-approved drugs, validated biomarkers, Phase 3 trials
- T2 (★★☆): Phase 2 trials, strong preclinical evidence, peer-reviewed publications
- T3 (★☆☆): Phase 1/early trials, preliminary data, conference abstracts
- T4 (☆☆☆): In silico predictions, in vitro only, theoretical basis

Research Paths:
1. Target Mechanism — molecular function, pathways, interactions
2. Clinical Pipeline — trials, drugs, phases
3. Biomarker Analysis — diagnostic, prognostic, predictive markers
4. Resistance Mechanisms — known resistance pathways
5. Combination Strategies — synergistic targets, combo therapies
6. Safety Profile — on-target toxicity, off-target effects
7. Patient Stratification — biomarker-defined subpopulations
8. Competitive Intelligence — key players, patent landscape
9. Translational Readiness — animal models, clinical translation
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict


# Evidence grade definitions
EVIDENCE_GRADES = {
    "T1": {"level": 1, "symbol": "★★★", "label": "High", "description": "FDA-approved, validated, Phase 3"},
    "T2": {"level": 2, "symbol": "★★☆", "label": "Moderate", "description": "Phase 2, strong preclinical, peer-reviewed"},
    "T3": {"level": 3, "symbol": "★☆☆", "label": "Low", "description": "Phase 1, preliminary, conference"},
    "T4": {"level": 4, "symbol": "☆☆☆", "label": "Very Low", "description": "In silico, in vitro, theoretical"},
}


@dataclass
class EvidenceItem:
    """A single piece of evidence with grading."""
    finding: str
    grade: str  # T1, T2, T3, T4
    source: str  # e.g., "ClinicalTrials.gov", "PubMed:12345678"
    category: str  # e.g., "clinical", "biomarker", "mechanism"
    details: dict = field(default_factory=dict)


@dataclass
class ResearchPath:
    """One of 9 parallel research paths."""
    path_id: str
    name: str
    description: str
    evidence: List[EvidenceItem] = field(default_factory=list)
    summary: str = ""

    @property
    def best_grade(self) -> str:
        """Return the strongest evidence grade in this path."""
        if not self.evidence:
            return "T4"
        grades = [e.grade for e in self.evidence]
        return min(grades, key=lambda g: EVIDENCE_GRADES[g]["level"])

    @property
    def grade_summary(self) -> str:
        """Return a summary of evidence grades."""
        counts = {}
        for e in self.evidence:
            counts[e.grade] = counts.get(e.grade, 0) + 1
        parts = []
        for g in ["T1", "T2", "T3", "T4"]:
            if g in counts:
                parts.append(f"{EVIDENCE_GRADES[g]['symbol']} {counts[g]}")
        return ", ".join(parts) if parts else "No evidence"


@dataclass
class TargetResearchProfile:
    """Complete 9-path research profile for a target."""
    gene: str
    disease: str = ""
    paths: Dict[str, ResearchPath] = field(default_factory=dict)
    overall_grade: str = "T4"
    confidence_score: float = 0.0

    def calculate_overall_grade(self):
        """Calculate overall evidence grade from all paths."""
        if not self.paths:
            self.overall_grade = "T4"
            self.confidence_score = 0.0
            return

        grade_scores = {"T1": 4, "T2": 3, "T3": 2, "T4": 1}
        total = 0
        count = 0
        for path in self.paths.values():
            if path.evidence:
                best = grade_scores.get(path.best_grade, 1)
                total += best
                count += 1

        if count == 0:
            self.overall_grade = "T4"
            self.confidence_score = 0.0
            return

        avg = total / count
        if avg >= 3.5:
            self.overall_grade = "T1"
        elif avg >= 2.5:
            self.overall_grade = "T2"
        elif avg >= 1.5:
            self.overall_grade = "T3"
        else:
            self.overall_grade = "T4"

        self.confidence_score = round(avg / 4 * 100, 1)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        self.calculate_overall_grade()
        return {
            "gene": self.gene,
            "disease": self.disease,
            "overall_grade": self.overall_grade,
            "overall_grade_info": EVIDENCE_GRADES[self.overall_grade],
            "confidence_score": self.confidence_score,
            "paths": {
                pid: {
                    "name": p.name,
                    "description": p.description,
                    "best_grade": p.best_grade,
                    "grade_summary": p.grade_summary,
                    "evidence_count": len(p.evidence),
                    "evidence": [asdict(e) for e in p.evidence],
                    "summary": p.summary,
                }
                for pid, p in self.paths.items()
            },
        }

    def to_markdown(self) -> str:
        """Generate markdown report with evidence grading."""
        self.calculate_overall_grade()
        lines = [
            f"# Target Research Profile: {self.gene}",
            f"",
            f"**Disease**: {self.disease or 'Not specified'}",
            f"**Overall Evidence Grade**: {EVIDENCE_GRADES[self.overall_grade]['symbol']} {EVIDENCE_GRADES[self.overall_grade]['label']}",
            f"**Confidence Score**: {self.confidence_score}%",
            f"",
            "---",
            "",
        ]

        for pid in sorted(self.paths.keys()):
            p = self.paths[pid]
            lines.append(f"## {p.name}")
            lines.append(f"*{p.description}*")
            lines.append(f"**Best Evidence**: {EVIDENCE_GRADES[p.best_grade]['symbol']} {EVIDENCE_GRADES[p.best_grade]['label']}")
            lines.append(f"**Evidence Summary**: {p.grade_summary}")
            lines.append("")

            if p.summary:
                lines.append(f"> {p.summary}")
                lines.append("")

            if p.evidence:
                lines.append("| Grade | Finding | Source |")
                lines.append("|-------|---------|--------|")
                for e in sorted(p.evidence, key=lambda x: EVIDENCE_GRADES[x.grade]["level"]):
                    grade_info = EVIDENCE_GRADES[e.grade]
                    lines.append(f"| {grade_info['symbol']} {grade_info['label']} | {e.finding} | {e.source} |")
                lines.append("")

        return "\n".join(lines)


def grade_clinical_trial(phase: str) -> str:
    """Grade evidence based on clinical trial phase."""
    phase_map = {
        "Phase 3": "T1",
        "Phase 4": "T1",
        "Approved": "T1",
        "Phase 2": "T2",
        "Phase 2/3": "T2",
        "Phase 1": "T3",
        "Phase 1/2": "T3",
        "Early Phase 1": "T3",
        "Not Applicable": "T4",
    }
    return phase_map.get(phase, "T4")


def grade_publication(pub_type: str) -> str:
    """Grade evidence based on publication type."""
    pub_type_lower = pub_type.lower()
    if "meta-analysis" in pub_type_lower or "systematic review" in pub_type_lower:
        return "T1"
    elif "randomized controlled trial" in pub_type_lower:
        return "T1"
    elif "clinical trial" in pub_type_lower:
        return "T2"
    elif "peer-reviewed" in pub_type_lower or "journal article" in pub_type_lower:
        return "T2"
    elif "conference" in pub_type_lower or "abstract" in pub_type_lower:
        return "T3"
    else:
        return "T3"


def grade_drug_status(status: str) -> str:
    """Grade evidence based on drug approval status."""
    status_lower = status.lower()
    if "approved" in status_lower or "fda" in status_lower:
        return "T1"
    elif "phase 3" in status_lower or "nda" in status_lower:
        return "T1"
    elif "phase 2" in status_lower:
        return "T2"
    elif "phase 1" in status_lower:
        return "T3"
    else:
        return "T4"


def build_research_profile(
    gene: str,
    disease: str,
    phase1_data: dict = None,
    phase2_data: dict = None,
    phase3_data: dict = None,
) -> TargetResearchProfile:
    """Build a 9-path research profile from existing pipeline data.

    Args:
        gene: Gene symbol
        disease: Disease name
        phase1_data: Phase 1 output (expression, survival, immune)
        phase2_data: Phase 2 output (screening, druggability)
        phase3_data: Phase 3 output (competitive, patents, literature)

    Returns:
        TargetResearchProfile with 9 research paths populated
    """
    profile = TargetResearchProfile(gene=gene, disease=disease)

    # Initialize 9 research paths
    paths = {
        "mechanism": ResearchPath("mechanism", "Target Mechanism", "Molecular function, pathways, protein interactions"),
        "clinical": ResearchPath("clinical", "Clinical Pipeline", "Active trials, approved drugs, phase distribution"),
        "biomarker": ResearchPath("biomarker", "Biomarker Analysis", "Diagnostic, prognostic, predictive biomarkers"),
        "resistance": ResearchPath("resistance", "Resistance Mechanisms", "Known resistance pathways and escape mechanisms"),
        "combination": ResearchPath("combination", "Combination Strategies", "Synergistic targets, combination therapies"),
        "safety": ResearchPath("safety", "Safety Profile", "On-target toxicity, off-target effects"),
        "stratification": ResearchPath("stratification", "Patient Stratification", "Biomarker-defined subpopulations"),
        "competitive": ResearchPath("competitive", "Competitive Intelligence", "Key players, patent landscape, market position"),
        "translational": ResearchPath("translational", "Translational Readiness", "Animal models, clinical translation status"),
    }

    # Path 1: Target Mechanism (from Phase 1 protein data)
    if phase1_data:
        protein = phase1_data.get("protein_info", {})
        if protein:
            function = protein.get("function", "")
            if function:
                paths["mechanism"].evidence.append(EvidenceItem(
                    finding=f"Protein function: {function[:150]}...",
                    grade="T2",
                    source="UniProt",
                    category="mechanism",
                    details={"accession": protein.get("accession", "")},
                ))
            pathways = protein.get("pathways", [])
            for pw in pathways[:3]:
                paths["mechanism"].evidence.append(EvidenceItem(
                    finding=f"Pathway: {pw}",
                    grade="T2",
                    source="UniProt/KEGG",
                    category="mechanism",
                ))

    # Path 2: Clinical Pipeline (from Phase 3 competitive data)
    if phase3_data:
        comp = phase3_data.get("competition", {})
        if comp:
            total_trials = comp.get("total_trials", 0)
            phase_dist = comp.get("phase_distribution", {})
            for phase, count in phase_dist.items():
                grade = grade_clinical_trial(phase)
                paths["clinical"].evidence.append(EvidenceItem(
                    finding=f"{count} {phase} trials",
                    grade=grade,
                    source="ClinicalTrials.gov",
                    category="clinical",
                    details={"count": count},
                ))

            # Approved drugs
            approved_drugs = comp.get("approved_drugs", [])
            for drug in approved_drugs[:5]:
                drug_name = drug.get("name", drug) if isinstance(drug, dict) else str(drug)
                paths["clinical"].evidence.append(EvidenceItem(
                    finding=f"Approved drug: {drug_name}",
                    grade="T1",
                    source="ChEMBL/FDA",
                    category="clinical",
                ))

    # Path 3: Biomarker Analysis (from Phase 1 survival/immune)
    if phase1_data:
        surv = phase1_data.get("survival_stats", {})
        if surv:
            hr = surv.get("cox_regression", {}).get("hazard_ratio", 0)
            pval = surv.get("cox_regression", {}).get("cox_pvalue", 1)
            if pval < 0.05:
                direction = "worse" if hr > 1 else "better"
                paths["biomarker"].evidence.append(EvidenceItem(
                    finding=f"Prognostic biomarker: HR={hr:.3f} ({direction} survival, P={pval:.2e})",
                    grade="T2",
                    source="TCGA survival analysis",
                    category="biomarker",
                    details={"hr": hr, "pval": pval},
                ))

        immune = phase1_data.get("immune_correlations", {})
        sig_cells = [k for k, v in immune.items() if isinstance(v, dict) and v.get("significant")]
        if sig_cells:
            paths["biomarker"].evidence.append(EvidenceItem(
                finding=f"Immune biomarker: correlated with {len(sig_cells)} cell types",
                grade="T2",
                source="CIBERSORTx/xCell",
                category="biomarker",
                details={"cell_types": sig_cells},
            ))

    # Path 4: Resistance Mechanisms (from literature if available)
    if phase3_data:
        lit = phase3_data.get("literature", {})
        papers = lit.get("recent_papers", [])
        resistance_papers = [p for p in papers if "resist" in p.get("title", "").lower()]
        for rp in resistance_papers[:3]:
            paths["resistance"].evidence.append(EvidenceItem(
                finding=f"Resistance study: {rp.get('title', '')[:100]}",
                grade="T2",
                source=f"PubMed:{rp.get('pmid', '')}",
                category="resistance",
            ))

    # Path 5: Combination Strategies (from trials data)
    if phase3_data:
        comp = phase3_data.get("competition", {})
        trials = comp.get("trials", [])
        combo_trials = [t for t in trials if "combination" in t.get("title", "").lower() or "combo" in t.get("title", "").lower()]
        for ct in combo_trials[:3]:
            paths["combination"].evidence.append(EvidenceItem(
                finding=f"Combination trial: {ct.get('title', '')[:100]}",
                grade=grade_clinical_trial(ct.get("phase", "")),
                source="ClinicalTrials.gov",
                category="combination",
            ))

    # Path 6: Safety Profile (from Phase 1 expression data)
    if phase1_data:
        expr = phase1_data.get("expression_by_tissue", {})
        if expr:
            # Check for off-target expression in normal tissues
            high_expr_tissues = [(t, v) for t, v in expr.items() if v > 50]
            if high_expr_tissues:
                paths["safety"].evidence.append(EvidenceItem(
                    finding=f"High expression in {len(high_expr_tissues)} normal tissues (potential on-target toxicity)",
                    grade="T2",
                    source="GTEx",
                    category="safety",
                    details={"tissues": [t for t, _ in high_expr_tissues[:5]]},
                ))

    # Path 7: Patient Stratification (from Phase 1 data)
    if phase1_data:
        surv = phase1_data.get("survival_stats", {})
        if surv:
            n_high = surv.get("n_high", 0)
            n_low = surv.get("n_low", 0)
            if n_high and n_low:
                paths["stratification"].evidence.append(EvidenceItem(
                    finding=f"Patient stratification: {n_high} high-expression vs {n_low} low-expression",
                    grade="T2",
                    source="TCGA",
                    category="stratification",
                    details={"n_high": n_high, "n_low": n_low},
                ))

    # Path 8: Competitive Intelligence (from Phase 3)
    if phase3_data:
        patents = phase3_data.get("patents", {})
        patent_trends = patents.get("trends", {})
        total_patents = patent_trends.get("total_patents", 0)
        if total_patents:
            paths["competitive"].evidence.append(EvidenceItem(
                finding=f"{total_patents} related patents filed",
                grade="T2",
                source="USPTO/Google Patents",
                category="competitive",
                details={"total": total_patents},
            ))

        key_players = comp.get("key_players", [])
        for player in key_players[:3]:
            name = player.get("company", "")
            count = player.get("trial_count", 0)
            if name:
                paths["competitive"].evidence.append(EvidenceItem(
                    finding=f"{name}: {count} trials",
                    grade="T2",
                    source="ClinicalTrials.gov",
                    category="competitive",
                ))

    # Path 9: Translational Readiness (from Phase 2 druggability)
    if phase2_data:
        druggability = phase2_data.get("druggability", {})
        if druggability:
            tdl = druggability.get("target_dev_level", "")
            if tdl:
                grade = "T1" if tdl in ["Tclin", "Tchem"] else "T3"
                paths["translational"].evidence.append(EvidenceItem(
                    finding=f"Target druggability: {tdl}",
                    grade=grade,
                    source="ChEMBL/Open Targets",
                    category="translational",
                ))

    # Generate summaries for each path
    for pid, path in paths.items():
        if path.evidence:
            t1_count = sum(1 for e in path.evidence if e.grade == "T1")
            t2_count = sum(1 for e in path.evidence if e.grade == "T2")
            if t1_count:
                path.summary = f"Strong evidence: {t1_count} T1 findings"
            elif t2_count:
                path.summary = f"Moderate evidence: {t2_count} T2 findings"
            else:
                path.summary = f"Preliminary evidence: {len(path.evidence)} findings"

    profile.paths = paths
    profile.calculate_overall_grade()
    return profile


def generate_evidence_table(profile: TargetResearchProfile) -> List[List[str]]:
    """Generate evidence table for dashboard display.

    Returns:
        List of [grade_symbol, grade_label, category, finding, source]
    """
    rows = []
    for pid in sorted(profile.paths.keys()):
        path = profile.paths[pid]
        for e in sorted(path.evidence, key=lambda x: EVIDENCE_GRADES[x.grade]["level"]):
            grade_info = EVIDENCE_GRADES[e.grade]
            rows.append([
                grade_info["symbol"],
                grade_info["label"],
                path.name,
                e.finding[:120],
                e.source,
            ])
    return rows


def save_profile(profile: TargetResearchProfile, output_dir: Path) -> Path:
    """Save research profile to JSON."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"tooluniverse_{profile.gene}_research_profile.json"
    out_path.write_text(json.dumps(profile.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path
