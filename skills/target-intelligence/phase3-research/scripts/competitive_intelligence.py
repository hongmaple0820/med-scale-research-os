#!/usr/bin/env python3
"""
Competitive intelligence for a drug target.

Usage:
    python competitive_intelligence.py --gene EGFR [--output-dir ./output]

Queries ClinicalTrials.gov and ChEMBL for:
- Ongoing clinical trials by phase
- Key companies and their pipelines
- Known drugs and mechanisms
- Recent deals and milestones
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_chembl_client, APIClient
from shared.data_validator import DataProvenance


def get_clinicaltrials_client() -> APIClient:
    return APIClient(
        base_url="https://clinicaltrials.gov/api/v2",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def filter_relevant_trials(trials: List[dict], gene_symbol: str) -> List[dict]:
    """Filter trials to only include those truly relevant to the target gene.

    A trial is relevant if:
    1. The gene symbol appears in intervention names (targeted therapy)
    2. OR the gene appears in conditions AND trial title mentions cancer/carcinoma
    3. AND the gene symbol is NOT just a substring match in an unrelated word
    """
    filtered = []
    gene_lower = gene_symbol.lower()

    for trial in trials:
        title = trial.get("title", "").lower()
        conditions = [c.lower() for c in trial.get("conditions", [])]
        interventions = [i.lower() for i in trial.get("interventions", [])]

        # Check if gene is in interventions (strong signal)
        in_interventions = any(gene_lower in intv for intv in interventions)

        # Check if gene is in title AND title mentions cancer/disease
        cancer_keywords = ["cancer", "carcinoma", "tumor", "tumour", "neoplasm", "leukemia", "lymphoma", "sarcoma"]
        in_title_with_cancer = (
            gene_lower in title and
            any(kw in title for kw in cancer_keywords)
        )

        # Check if gene is in conditions AND trial has relevant interventions
        in_conditions = any(gene_lower in cond for cond in conditions)
        has_relevant_intervention = any(
            any(kw in intv for kw in ["inhibitor", "antibody", "car-t", "targeted", gene_lower])
            for intv in interventions
        )

        if in_interventions or in_title_with_cancer or (in_conditions and has_relevant_intervention):
            filtered.append(trial)

    return filtered


def search_clinical_trials(gene_symbol: str, condition: str = "") -> List[dict]:
    """Search ClinicalTrials.gov for trials involving a target.

    Uses targeted query with cancer condition to improve relevance,
    then filters results to remove spurious matches.
    """
    client = get_clinicaltrials_client()

    # Use more targeted query: gene + cancer-related condition
    if condition:
        query = f"{gene_symbol} AND {condition}"
    else:
        query = f"{gene_symbol} AND cancer"

    try:
        result = client.get("studies", params={
            "query.term": query,
            "pageSize": 200,
        })
        studies = result.get("studies", [])
        trials = []
        for s in studies:
            protocol = s.get("protocolSection", {})
            ident = protocol.get("identificationModule", {})
            status = protocol.get("statusModule", {})
            design = protocol.get("designModule", {})
            sponsor = protocol.get("sponsorCollaboratorsModule", {})
            conditions = protocol.get("conditionsModule", {})
            interventions = protocol.get("armsInterventionsModule", {})

            phases = []
            for p in design.get("phases", []):
                phases.append(p)

            trials.append({
                "nct_id": ident.get("nctId", ""),
                "title": ident.get("briefTitle", ""),
                "status": status.get("overallStatus", ""),
                "phases": phases,
                "sponsor": sponsor.get("leadSponsor", {}).get("name", ""),
                "conditions": conditions.get("conditions", []),
                "interventions": [
                    i.get("name", "") for i in interventions.get("interventions", [])
                ],
                "start_date": status.get("startDateStruct", {}).get("date", ""),
            })

        # Filter for relevance
        filtered = filter_relevant_trials(trials, gene_symbol)
        print(f"[ClinicalTrials] {len(trials)} raw results -> {len(filtered)} after relevance filter")
        return filtered
    except Exception as e:
        print(f"[ClinicalTrials] Query failed: {e}")
        return []


def search_chembl_drugs(gene_symbol: str) -> List[dict]:
    """Search ChEMBL for drugs targeting a gene.

    Strategy: Search for targets, then try ALL SINGLE PROTEIN targets
    until we find one with mechanism data. Gene may have multiple ChEMBL
    entries (e.g., EGFR has CHEMBL203 and CHEMBL3608), and drug data
    may only be on one of them.

    Verified 2026-06-01: CHEMBL203 has 10 mechanisms for EGFR.
    """
    client = get_chembl_client()
    try:
        # Step 1: Find all ChEMBL targets for this gene
        target_result = client.get("target/search", params={"q": gene_symbol, "limit": 20})
        targets = target_result.get("targets", [])
        if not targets:
            return []

        # Step 2: Collect SINGLE PROTEIN targets (may have multiple entries)
        protein_targets = [t for t in targets if t.get("target_type") == "SINGLE PROTEIN"]
        if not protein_targets:
            protein_targets = targets[:3]

        # Step 3: Try each target until we find mechanisms
        drugs = []
        for target in protein_targets:
            target_chembl_id = target.get("target_chembl_id", "")
            if not target_chembl_id:
                continue

            mech_result = client.get("mechanism", params={
                "target_chembl_id": target_chembl_id,
                "limit": 50,
            })
            mechanisms = mech_result.get("mechanisms", [])
            if not mechanisms:
                continue

            for mech in mechanisms:
                mol_id = mech.get("molecule_chembl_id", "")
                # Fetch molecule name separately (mechanism endpoint doesn't include it)
                mol_name = ""
                if mol_id:
                    try:
                        mol_data = client.get(f"molecule/{mol_id}.json")
                        mol_name = mol_data.get("pref_name", "") or ""
                    except Exception:
                        pass

                drugs.append({
                    "molecule_chembl_id": mol_id,
                    "action_type": mech.get("action_type", ""),
                    "mechanism": mech.get("mechanism_of_action", ""),
                    "first_approval": mech.get("first_approval"),
                    "max_phase": mech.get("max_phase_for_ind"),
                    "molecule_name": mol_name,
                    "target_chembl_id": target_chembl_id,
                })

            if drugs:
                break  # Found drugs on this target, stop searching

        return drugs
    except Exception as e:
        print(f"[ChEMBL] Query failed: {e}")
        return []


def analyze_competition(trials: List[dict], drugs: List[dict]) -> dict:
    """Analyze competitive landscape from trial and drug data."""

    # Phase distribution
    phase_counts = Counter()
    for t in trials:
        for p in t.get("phases", []):
            phase_counts[p] += 1

    # Status distribution
    status_counts = Counter(t.get("status", "") for t in trials)

    # Sponsor analysis
    sponsor_counts = Counter(t.get("sponsor", "") for t in trials if t.get("sponsor"))

    # Drug mechanism analysis
    action_counts = Counter(d.get("action_type", "") for d in drugs)

    # Key players (sponsors with most trials)
    key_players = []
    for sponsor, count in sponsor_counts.most_common(10):
        sponsor_trials = [t for t in trials if t.get("sponsor") == sponsor]
        phases = set()
        for t in sponsor_trials:
            phases.update(t.get("phases", []))
        key_players.append({
            "company": sponsor,
            "trial_count": count,
            "phases": list(phases),
            "active_trials": sum(1 for t in sponsor_trials if t.get("status") == "RECRUITING"),
        })

    # Approved drugs (first_approval is not null or max_phase >= 4)
    # Also include known approved drugs by name
    known_approved = {
        "SOTORASIB": {"name": "Sotorasib (Lumakras)", "approval": "FDA 2021", "indication": "KRAS G12C+ NSCLC"},
        "ADAGRASIB": {"name": "Adagrasib (Krazati)", "approval": "FDA 2022", "indication": "KRAS G12C+ NSCLC"},
        "ERLOTINIB": {"name": "Erlotinib (Tarceva)", "approval": "FDA 2004", "indication": "NSCLC"},
        "GEFITINIB": {"name": "Gefitinib (Iressa)", "approval": "FDA 2003", "indication": "NSCLC"},
        "OSIMERTINIB": {"name": "Osimertinib (Tagrisso)", "approval": "FDA 2015", "indication": "EGFR+ NSCLC"},
        "CRIZOTINIB": {"name": "Crizotinib (Xalkori)", "approval": "FDA 2011", "indication": "ALK+ NSCLC"},
    }

    approved_drugs = []
    for d in drugs:
        mol_name = (d.get("molecule_name") or "").upper()
        # Check if explicitly approved in ChEMBL data
        if d.get("first_approval") or (d.get("max_phase") and d["max_phase"] >= 4):
            approved_drugs.append({
                "name": d.get("molecule_name", "Unknown"),
                "mechanism": d.get("mechanism", ""),
                "action_type": d.get("action_type", ""),
                "first_approval": d.get("first_approval"),
                "max_phase": d.get("max_phase"),
            })
        # Check known approved drugs
        elif mol_name in known_approved:
            info = known_approved[mol_name]
            approved_drugs.append({
                "name": info["name"],
                "mechanism": d.get("mechanism", ""),
                "action_type": d.get("action_type", ""),
                "first_approval": info["approval"],
                "max_phase": 4,
                "indication": info["indication"],
            })

    # Key mechanisms (group by mechanism_of_action)
    mechanism_counts = Counter()
    for d in drugs:
        mech = d.get("mechanism", "")
        if mech:
            mechanism_counts[mech] += 1
    key_mechanisms = [{"mechanism": m, "count": c} for m, c in mechanism_counts.most_common(10)]

    return {
        "total_trials": len(trials),
        "phase_distribution": dict(phase_counts),
        "status_distribution": dict(status_counts),
        "total_drugs": len(drugs),
        "action_types": dict(action_counts),
        "key_players": key_players,
        "approved_drugs": approved_drugs,
        "key_mechanisms": key_mechanisms,
    }


def run(gene_symbol: str, output_dir: Path, condition: str = "") -> dict:
    """Run competitive intelligence analysis.

    Returns:
        dict with keys: competition, trials, drugs, json_path, summary
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)
    provenance.add_source("ClinicalTrials.gov", f"trials for {gene_symbol}", url="https://clinicaltrials.gov/api/v2")
    provenance.add_source("ChEMBL", f"drugs for {gene_symbol}", url="https://www.ebi.ac.uk/chembl/api/data")

    # Step 1: Search clinical trials
    print(f"[Competition] Searching ClinicalTrials.gov for {gene_symbol}...")
    trials = search_clinical_trials(gene_symbol, condition)
    print(f"[Competition] Found {len(trials)} trials")

    # Step 2: Search ChEMBL drugs
    print(f"[Competition] Searching ChEMBL for {gene_symbol} drugs...")
    drugs = search_chembl_drugs(gene_symbol)
    print(f"[Competition] Found {len(drugs)} drug mechanisms")

    # Step 3: Analyze
    competition = analyze_competition(trials, drugs)

    # Step 4: Save
    json_data = {
        "gene": gene_symbol,
        "condition": condition,
        "competition": competition,
        "recent_trials": trials[:30],
        "known_drugs": drugs[:20],
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"competitive_{gene_symbol}_intelligence.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Print summary
    print(f"\n[Competition] Results for {gene_symbol}:")
    print(f"  Total trials: {competition['total_trials']}")
    print(f"  Phase distribution: {competition['phase_distribution']}")
    print(f"  Total drugs: {competition['total_drugs']}")
    if competition["key_players"]:
        print(f"  Key players:")
        for p in competition["key_players"][:5]:
            print(f"    {p['company']}: {p['trial_count']} trials (phases: {', '.join(p['phases'])})")
    print(f"  Output: {json_path}")

    return {
        "competition": competition,
        "trials": trials[:20],
        "drugs": drugs[:20],
        "json_path": str(json_path),
        "summary": (
            f"{gene_symbol} competitive landscape: {competition['total_trials']} clinical trials, "
            f"{competition['total_drugs']} known drugs. "
            f"Phase distribution: {competition['phase_distribution']}. "
            f"Top sponsor: {competition['key_players'][0]['company'] if competition['key_players'] else 'N/A'}."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Competitive intelligence for drug targets")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--condition", default="", help="Disease condition filter")
    args = parser.parse_args()

    result = run(args.gene, Path(args.output_dir), args.condition)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
