#!/usr/bin/env python3
"""
Query druggability classification for a drug target.

Primary: Pharos (Tclin/Tchem/Tbio/Tdark)
Fallback: Open Targets tractability data

Usage:
    python pharos_druggability.py --gene EGFR [--output-dir ./output]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import APIClient, get_opentargets_client
from shared.data_validator import DataProvenance


def search_pharos(gene_symbol: str) -> Optional[dict]:
    """Try Pharos API (may be blocked from some networks)."""
    client = APIClient(
        base_url="https://pharos.nih.gov/idg/api/v1",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )
    try:
        result = client.get("targets/search", params={"q": gene_symbol, "top": 5})
        targets = result.get("content", [])
        for t in targets:
            if t.get("gene", "").upper() == gene_symbol.upper():
                return t
        return targets[0] if targets else None
    except Exception:
        return None


def get_opentargets_druggability(gene_symbol: str) -> dict:
    """Get druggability info from Open Targets as fallback."""
    client = get_opentargets_client()

    # First get the Ensembl ID
    search_query = """
    query SearchTarget($q: String!) {
        search(queryString: $q, entityNames: ["target"], page: {index: 0, size: 3}) {
            hits { id name }
        }
    }
    """
    search_result = client.post_graphql(search_query, {"q": gene_symbol})
    hits = search_result.get("data", {}).get("search", {}).get("hits", [])

    if not hits:
        return {"error": f"Target '{gene_symbol}' not found in Open Targets"}

    target_id = hits[0]["id"]

    # Get tractability and safety
    detail_query = """
    query TargetDruggability($targetId: String!) {
        target(ensemblId: $targetId) {
            id
            approvedSymbol
            approvedName
            biotype
            functionDescriptions
            tractability {
                label
                modality
                value
            }
            safetyLiabilities {
                event
            }
        }
    }
    """
    detail_result = client.post_graphql(detail_query, {"targetId": target_id})
    target = detail_result.get("data", {}).get("target", {})

    if not target:
        return {"error": f"Details not found for {gene_symbol}"}

    # Parse tractability
    tractability = target.get("tractability", [])
    tract_map = {}
    for t in tractability:
        label = t.get("label", "")
        modality = t.get("modality", "")
        value = t.get("value", False)
        key = f"{modality}_{label}"
        tract_map[key] = value

    # Infer druggability class from tractability
    # Open Targets tractability labels: "Approved Drug", "Advanced Clinical", "Phase 1 Clinical",
    # "Structure with Ligand", "High-Quality Ligand", "Druggable Family", etc.
    sm_approved = any(t.get("value") for t in tractability if t.get("modality") == "SM" and t.get("label") == "Approved Drug")
    sm_clinical = any(t.get("value") for t in tractability if t.get("modality") == "SM" and t.get("label") in ("Advanced Clinical", "Phase 1 Clinical"))
    sm_discovery = any(t.get("value") for t in tractability if t.get("modality") == "SM" and t.get("label") in ("High-Quality Ligand", "Structure with Ligand", "Druggable Family"))
    ab_approved = any(t.get("value") for t in tractability if t.get("modality") == "AB" and t.get("label") == "Approved Drug")
    ab_clinical = any(t.get("value") for t in tractability if t.get("modality") == "AB" and t.get("label") in ("Advanced Clinical", "Phase 1 Clinical"))

    small_molecule_tractable = sm_approved or sm_clinical or sm_discovery
    antibody_tractable = ab_approved or ab_clinical

    safety = target.get("safetyLiabilities", [])

    # Classify based on tractability (mirroring Pharos Tclin/Tchem/Tbio/Tdark)
    if sm_approved or ab_approved:
        tclass = "Tclin"
        tclass_desc = "Clinically validated - approved drugs exist"
    elif sm_clinical or ab_clinical:
        tclass = "Tclin"
        tclass_desc = "Clinical stage - drugs in clinical trials"
    elif sm_discovery:
        tclass = "Tchem"
        tclass_desc = "Chemically tractable - small molecule ligands known"
    elif antibody_tractable:
        tclass = "Tbio"
        tclass_desc = "Biological target - antibody tractable"
    else:
        tclass = "Tdark"
        tclass_desc = "Dark target - limited druggability data"

    return {
        "symbol": gene_symbol,
        "name": target.get("approvedName", ""),
        "ensembl_id": target_id,
        "tclass": tclass,
        "tclass_description": tclass_desc,
        "tractability": tractability,
        "small_molecule_tractable": small_molecule_tractable,
        "antibody_tractable": antibody_tractable,
        "safety_liabilities": safety,
        "function": (target.get("functionDescriptions") or [""])[0][:300],
        "data_source": "Open Targets",
    }


def run(gene_symbol: str, output_dir: Path) -> dict:
    """Query druggability for a target.

    Returns:
        dict with keys: druggability, json_path, summary
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)

    # Try Pharos first
    print(f"[Druggability] Querying for {gene_symbol}...")
    pharos_result = search_pharos(gene_symbol)

    if pharos_result:
        print("[Druggability] Using Pharos data")
        provenance.add_source("Pharos", f"druggability for {gene_symbol}", url="https://pharos.nih.gov/")
        druggability = {
            "symbol": gene_symbol,
            "name": pharos_result.get("name", ""),
            "tclass": pharos_result.get("developmentLevel", {}).get("name", "Unknown"),
            "data_source": "Pharos",
        }
    else:
        print("[Druggability] Pharos unavailable, using Open Targets...")
        provenance.add_source("Open Targets", f"druggability for {gene_symbol}",
                              url="https://api.platform.opentargets.org/api/v4/graphql")
        druggability = get_opentargets_druggability(gene_symbol)

    if "error" in druggability:
        return {
            "error": druggability["error"],
            "druggability": None,
            "json_path": None,
            "summary": druggability["error"],
        }

    # Save
    json_data = {
        "gene": gene_symbol,
        "druggability": druggability,
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"pharos_{gene_symbol}_druggability.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n[Druggability] Results for {gene_symbol}:")
    print(f"  Classification: {druggability.get('tclass', 'N/A')}")
    print(f"  Description: {druggability.get('tclass_description', 'N/A')}")
    print(f"  SM tractable: {druggability.get('small_molecule_tractable', 'N/A')}")
    print(f"  Ab tractable: {druggability.get('antibody_tractable', 'N/A')}")
    print(f"  Data source: {druggability.get('data_source', 'N/A')}")
    print(f"  Output: {json_path}")

    return {
        "druggability": druggability,
        "json_path": str(json_path),
        "summary": (
            f"{gene_symbol}: {druggability.get('tclass', 'N/A')} - {druggability.get('tclass_description', '')}. "
            f"SM tractable: {druggability.get('small_molecule_tractable', 'N/A')}. "
            f"Ab tractable: {druggability.get('antibody_tractable', 'N/A')}."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Query target druggability classification")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()

    result = run(args.gene, Path(args.output_dir))
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
