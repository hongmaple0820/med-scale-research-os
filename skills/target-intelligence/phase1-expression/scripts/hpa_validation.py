#!/usr/bin/env python3
"""
Protein-level validation using UniProt + STRING databases.

Replaces the non-functional HPA validation (HPA has no public REST API).
Uses:
- UniProt REST API for protein function, domains, subcellular location
- STRING API for protein-protein interaction network

Verified APIs (2026-06-01):
- UniProt: rest.uniprot.org (canonical EGFR = P00533)
- STRING: string-db.org/api (species 9606 = human)

Usage:
    python hpa_validation.py --gene EGFR [--output-dir ./output]
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_uniprot_client, get_string_client
from shared.data_validator import DataProvenance


def query_uniprot(gene_symbol: str) -> dict:
    """Query UniProt for canonical protein information."""
    client = get_uniprot_client()
    try:
        result = client.get("uniprotkb/search", params={
            "query": f"gene:{gene_symbol} AND organism_id:9606 AND reviewed:true",
            "format": "json",
            "size": 1,
        })
        entries = result.get("results", [])
        if not entries:
            return {}

        entry = entries[0]
        protein_desc = entry.get("proteinDescription", {})
        rec_name = protein_desc.get("recommendedName", {})
        full_name = rec_name.get("fullName", {}).get("value", "")

        # Extract subcellular location
        subcellular = []
        for comment in entry.get("comments", []):
            if comment.get("commentType") == "SUBCELLULAR LOCATION":
                for loc in comment.get("subcellularLocations", []):
                    loc_val = loc.get("location", {}).get("value", "")
                    if loc_val:
                        subcellular.append(loc_val)

        # Extract function description
        function_text = ""
        for comment in entry.get("comments", []):
            if comment.get("commentType") == "FUNCTION":
                texts = comment.get("texts", [])
                if texts:
                    function_text = texts[0].get("value", "")
                break

        # Extract domains
        domains = []
        for feature in entry.get("features", []):
            if feature.get("type") in ("DOMAIN", "REGION", "SIGNAL", "TRANSMEM"):
                domains.append({
                    "type": feature.get("type"),
                    "description": feature.get("description", ""),
                    "start": feature.get("location", {}).get("start", {}).get("value"),
                    "end": feature.get("location", {}).get("end", {}).get("value"),
                })

        return {
            "accession": entry.get("primaryAccession"),
            "protein_name": full_name,
            "gene_name": gene_symbol,
            "organism": "Homo sapiens",
            "sequence_length": entry.get("sequence", {}).get("length"),
            "subcellular_location": subcellular,
            "function": function_text[:500] if function_text else "",
            "domains": domains[:10],
            "uniprot_url": f"https://www.uniprot.org/uniprot/{entry.get('primaryAccession')}",
        }
    except Exception as e:
        print(f"[Protein] UniProt query failed: {e}")
        return {}


def query_string_interactions(gene_symbol: str, limit: int = 20) -> List[dict]:
    """Query STRING for protein-protein interactions."""
    client = get_string_client()
    try:
        result = client.get("json/network", params={
            "identifiers": gene_symbol,
            "species": 9606,
            "limit": limit,
        })
        interactions = []
        for item in result:
            partner = item.get("preferredName_B", "")
            if partner == gene_symbol:
                partner = item.get("preferredName_A", "")
            interactions.append({
                "partner": partner,
                "score": round(float(item.get("score", 0)), 4),
                "nscore": round(float(item.get("nscore", 0)), 4),
                "escore": round(float(item.get("escore", 0)), 4),
                "dscore": round(float(item.get("dscore", 0)), 4),
                "tscore": round(float(item.get("tscore", 0)), 4),
            })
        return sorted(interactions, key=lambda x: x["score"], reverse=True)
    except Exception as e:
        print(f"[Protein] STRING query failed: {e}")
        return []


def run(gene_symbol: str, output_dir: Path, gtex_data: dict = None) -> dict:
    """Run protein-level validation using UniProt + STRING."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)

    # Step 1: UniProt protein info
    print(f"[Protein] Querying UniProt for {gene_symbol}...")
    provenance.add_source("UniProt", f"protein info for {gene_symbol}", url="https://rest.uniprot.org/")
    uniprot_data = query_uniprot(gene_symbol)

    if not uniprot_data:
        print(f"[Protein] {gene_symbol} not found in UniProt (reviewed entries)")
        return {
            "protein_data": {},
            "interactions": [],
            "figure_path": None,
            "json_path": None,
            "summary": f"Protein data for {gene_symbol} not found in UniProt.",
        }

    print(f"[Protein] Found: {uniprot_data.get('accession')} - {uniprot_data.get('protein_name')}")
    print(f"  Subcellular: {', '.join(uniprot_data.get('subcellular_location', []))}")

    # Step 2: STRING interactions
    print(f"[Protein] Querying STRING for {gene_symbol} interactions...")
    provenance.add_source("STRING", f"PPI network for {gene_symbol}", url="https://string-db.org/")
    interactions = query_string_interactions(gene_symbol)

    if interactions:
        print(f"[Protein] Found {len(interactions)} interactions")
        top3 = interactions[:3]
        for i in top3:
            print(f"  {i['partner']}: {i['score']:.3f}")

    # Step 3: Save results
    json_data = {
        "gene": gene_symbol,
        "protein_info": uniprot_data,
        "interactions": interactions,
        "n_interactions": len(interactions),
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"protein_{gene_symbol}_validation.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Summary
    location_str = ", ".join(uniprot_data.get("subcellular_location", [])[:3])
    top_partners = ", ".join([i["partner"] for i in interactions[:5]])
    summary = (
        f"{gene_symbol} protein: {uniprot_data.get('protein_name', 'N/A')} "
        f"(UniProt: {uniprot_data.get('accession', 'N/A')}). "
        f"Subcellular: {location_str or 'N/A'}. "
        f"Function: {uniprot_data.get('function', '')[:200]}. "
        f"Top interactors: {top_partners or 'N/A'}."
    )

    print(f"\n[Protein] Output: {json_path}")

    return {
        "protein_data": uniprot_data,
        "interactions": interactions,
        "figure_path": None,
        "json_path": str(json_path),
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(description="Protein validation via UniProt + STRING")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()
    result = run(args.gene, Path(args.output_dir))
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
