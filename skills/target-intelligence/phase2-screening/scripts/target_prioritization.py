#!/usr/bin/env python3
"""
Target prioritization using Open Targets Platform GraphQL API.

Usage:
    python target_prioritization.py --disease "non-small cell lung cancer" [--output-dir ./output] [--top N]

Outputs:
    - target_priority_{disease}.json: Ranked target list with scores
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import get_opentargets_client
from shared.data_validator import DataProvenance


def search_disease(disease_name: str) -> List[dict]:
    """Search Open Targets for a disease."""
    client = get_opentargets_client()
    query = """
    query SearchDisease($q: String!) {
        search(queryString: $q, entityNames: ["disease"], page: {index: 0, size: 10}) {
            hits {
                id
                name
                entity
                description
            }
        }
    }
    """
    result = client.post_graphql(query, {"q": disease_name})
    return result.get("data", {}).get("search", {}).get("hits", [])


def get_target_disease_associations(disease_id: str, size: int = 50) -> List[dict]:
    """Get ranked target-disease associations from Open Targets."""
    client = get_opentargets_client()
    query = """
    query TargetAssociations($diseaseId: String!, $size: Int!) {
        disease(efoId: $diseaseId) {
            id
            name
            associatedTargets(page: {index: 0, size: $size}) {
                count
                rows {
                    target {
                        id
                        approvedSymbol
                        approvedName
                        biotype
                        functionDescriptions
                        geneticConstraint {
                            constraintType
                            score
                            exp
                            obs
                            oe
                            oeLower
                            oeUpper
                        }
                    }
                    score
                    datatypeScores {
                        id
                        score
                    }
                }
            }
        }
    }
    """
    result = client.post_graphql(query, {"diseaseId": disease_id, "size": size})
    disease = result.get("data", {}).get("disease", {})
    associations = disease.get("associatedTargets", {})
    return associations.get("rows", [])


def get_drug_details(ensembl_id: str) -> dict:
    """Fetch knownDrugs for a single target (lazy, called only for top-N)."""
    client = get_opentargets_client()
    query = """
    query DrugDetails($ensemblId: String!) {
        target(ensemblId: $ensemblId) {
            id
            approvedSymbol
            knownDrugs(size: 50) {
                uniqueDrugs
                rows {
                    drug { name id maximumClinicalTrialPhase }
                    phase
                    status
                    disease { name id }
                }
            }
        }
    }
    """
    result = client.post_graphql(query, {"ensemblId": ensembl_id})
    return result.get("data", {}).get("target", {})


def get_target_tractability(target_id: str) -> dict:
    """Get tractability data for a target."""
    client = get_opentargets_client()
    query = """
    query TargetTractability($targetId: String!) {
        target(ensemblId: $targetId) {
            id
            approvedSymbol
            tractability {
                label
                modality
                value
            }
            safetyLiabilities {
                event
                effects {
                    direction
                    dosing
                }
                biosamples {
                    tissueLabel
                }
            }
        }
    }
    """
    result = client.post_graphql(query, {"targetId": target_id})
    return result.get("data", {}).get("target", {})


def get_target_drugs(target_id: str) -> List[dict]:
    """Get drug candidates for a target."""
    client = get_opentargets_client()
    query = """
    query TargetDrugs($targetId: String!) {
        target(ensemblId: $targetId) {
            id
            approvedSymbol
            drugAndClinicalCandidates {
                count
                rows {
                    drug {
                        id
                        name
                        description
                    }
                }
            }
        }
    }
    """
    result = client.post_graphql(query, {"targetId": target_id})
    target = result.get("data", {}).get("target", {})
    return target.get("drugAndClinicalCandidates", {})


def get_gene_target_info(gene_symbol: str) -> Optional[dict]:
    """Get target info for a specific gene from Open Targets."""
    client = get_opentargets_client()

    # Step 1: Search for the gene to get its Ensembl ID
    search_query = """
    query SearchTarget($q: String!) {
        search(queryString: $q, entityNames: ["target"], page: {index: 0, size: 5}) {
            hits {
                id
                name
                entity
            }
        }
    }
    """
    search_result = client.post_graphql(search_query, {"q": gene_symbol})
    hits = search_result.get("data", {}).get("search", {}).get("hits", [])

    # Find exact match
    target_id = None
    target_name = None
    for h in hits:
        if h.get("entity") == "target":
            target_id = h["id"]
            target_name = h.get("name", "")
            break

    if not target_id and hits:
        target_id = hits[0]["id"]
        target_name = hits[0].get("name", "")

    if not target_id:
        return None

    # Step 2: Get detailed target info using Ensembl ID
    # Note: Open Targets API only supports id, name, description, synonyms on drug type
    detail_query = """
    query TargetDetail($targetId: String!) {
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
            drugAndClinicalCandidates {
                count
                rows {
                    drug {
                        id
                        name
                        description
                    }
                }
            }
        }
    }
    """
    detail_result = client.post_graphql(detail_query, {"targetId": target_id})
    target = detail_result.get("data", {}).get("target")
    if target:
        return target

    # Minimal fallback
    return {"id": target_id, "approvedSymbol": gene_symbol, "approvedName": target_name}


def run(disease_name: str, output_dir: Path, top_n: int = 30, gene_filter: str = None, top_drugs: int = 5) -> dict:
    """Run target prioritization for a disease.

    Args:
        disease_name: Disease name to search
        output_dir: Output directory
        top_n: Number of top targets to retrieve
        gene_filter: If set, also look up this specific gene's association with the disease
        top_drugs: Number of top targets to fetch knownDrugs for (lazy, avoids slow bulk query)

    Returns:
        dict with keys: targets, json_path, summary
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=f"disease:{disease_name}")
    provenance.add_source("Open Targets", f"target-disease associations for {disease_name}",
                          url="https://api.platform.opentargets.org/api/v4/graphql")

    # Step 1: Search for disease
    print(f"[OpenTargets] Searching for disease: {disease_name}")
    diseases = search_disease(disease_name)

    if not diseases:
        return {
            "error": f"Disease '{disease_name}' not found in Open Targets",
            "targets": [],
            "json_path": None,
            "summary": f"Disease '{disease_name}' not found",
        }

    disease = diseases[0]
    disease_id = disease["id"]
    disease_name_resolved = disease["name"]
    print(f"[OpenTargets] Found: {disease_name_resolved} (ID: {disease_id})")

    # Step 2: Get target associations
    print(f"[OpenTargets] Fetching target associations (top {top_n})...")
    associations = get_target_disease_associations(disease_id, top_n)

    targets = []
    for assoc in associations:
        target = assoc.get("target", {})
        target_id = target.get("id", "")

        # Extract datatype scores
        datatype_scores = {}
        for ds in assoc.get("datatypeScores", []):
            datatype_scores[ds.get("id", "")] = ds.get("score", 0)

        target_entry = {
            "target_id": target_id,
            "symbol": target.get("approvedSymbol", ""),
            "name": target.get("approvedName", ""),
            "overall_score": assoc.get("score", 0),
            "datatype_scores": datatype_scores,
            "function": (target.get("functionDescriptions") or [""])[0][:200],
        }

        # 遗传约束数据
        genetic_constraint = target.get("geneticConstraint", [])
        gc_scores = {}
        for gc in (genetic_constraint or []):
            if gc.get("constraintType") == "pLI":
                gc_scores["pLI"] = gc.get("score")
            elif gc.get("constraintType") == "LOEUF":
                gc_scores["LOEUF"] = gc.get("score")
        target_entry["genetic_constraint"] = {
            **gc_scores,
            "provenance": {
                "source": "Open Targets Platform",
                "confidence": "HIGH",
            }
        }

        targets.append(target_entry)
        print(f"  {target_entry['symbol']}: score={target_entry['overall_score']:.4f}")

    # Step 2b: Lazy drug details for top-N targets only
    if top_drugs > 0 and targets:
        fetch_count = min(top_drugs, len(targets))
        print(f"[OpenTargets] Fetching drug details for top {fetch_count} targets...")
        for t in targets[:fetch_count]:
            target_id = t["target_id"]
            try:
                drug_info = get_drug_details(target_id)
                t["knownDrugs"] = drug_info.get("knownDrugs", {})
                drug_count = t["knownDrugs"].get("uniqueDrugs", 0)
                print(f"  {t['symbol']}: {drug_count} unique drugs")
            except Exception as e:
                print(f"  {t['symbol']}: drug query failed ({e})")
                t["knownDrugs"] = {"uniqueDrugs": 0, "rows": []}

    # Step 3: Save results
    json_data = {
        "disease": {
            "name": disease_name_resolved,
            "id": disease_id,
            "query": disease_name,
        },
        "targets": targets,
        "total_targets": len(targets),
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"target_priority_{disease_name.replace(' ', '_')}.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Print summary
    print(f"\n[OpenTargets] Top targets for {disease_name_resolved}:")
    for i, t in enumerate(targets[:10], 1):
        print(f"  {i}. {t['symbol']} ({t['name'][:40]}): {t['overall_score']:.4f}")

    top3_symbols = ", ".join(t["symbol"] for t in targets[:3])
    top3_scores = ", ".join(f"{t['overall_score']:.3f}" for t in targets[:3])

    result = {
        "disease": json_data["disease"],
        "targets": targets,
        "json_path": str(json_path),
        "summary": (
            f"Found {len(targets)} target candidates for {disease_name_resolved}. "
            f"Top 3: {top3_symbols} (scores: {top3_scores})."
        ),
    }

    # Step 4: If gene_filter specified, get detailed info for that gene
    if gene_filter:
        print(f"\n[OpenTargets] Looking up target details for {gene_filter}...")
        try:
            gene_info = get_gene_target_info(gene_filter)
        except Exception as e:
            print(f"[OpenTargets] Gene lookup failed: {e}")
            gene_info = None
        if gene_info:
            # Find gene in the ranked list
            rank = None
            gene_score = None
            for i, t in enumerate(targets, 1):
                if t["symbol"].upper() == gene_filter.upper():
                    rank = i
                    gene_score = t["overall_score"]
                    break

            gene_detail = {
                "symbol": gene_info.get("approvedSymbol", gene_filter),
                "name": gene_info.get("approvedName", ""),
                "target_id": gene_info.get("id", ""),
                "rank_in_disease": rank,
                "overall_score": gene_score,
                "function": (gene_info.get("functionDescriptions") or [""])[0][:300],
                "tractability": [
                    {"label": t.get("label"), "modality": t.get("modality"), "value": t.get("value")}
                    for t in (gene_info.get("tractability") or [])
                ],
                "drug_candidates": gene_info.get("drugAndClinicalCandidates", {}),
            }
            result["gene_detail"] = gene_detail
            if rank and gene_score is not None:
                result["summary"] += f" {gene_filter} ranked #{rank} with score {gene_score:.4f}."
            else:
                result["summary"] += f" {gene_filter} not in top {top_n} disease-associated targets."
            json_data["gene_detail"] = gene_detail

            # Re-save with gene detail
            json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[OpenTargets] Gene detail saved for {gene_filter}")
        else:
            print(f"[OpenTargets] Gene {gene_filter} not found in Open Targets")
            result["gene_detail"] = {"error": f"Gene {gene_filter} not found"}

    print(f"\n[OpenTargets] Summary: {result['summary']}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Target prioritization using Open Targets")
    parser.add_argument("--disease", required=True, help="Disease name (e.g., 'non-small cell lung cancer')")
    parser.add_argument("--gene", default=None, help="Gene symbol to look up in detail (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    parser.add_argument("--top", type=int, default=30, help="Number of top targets to retrieve")
    parser.add_argument("--top-drugs", type=int, default=5, help="Number of top targets to fetch drug details for (0 to skip)")
    args = parser.parse_args()

    result = run(args.disease, Path(args.output_dir), args.top, gene_filter=args.gene, top_drugs=args.top_drugs)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
