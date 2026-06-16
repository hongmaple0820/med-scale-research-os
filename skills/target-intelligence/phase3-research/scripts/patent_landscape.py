#!/usr/bin/env python3
"""
Patent landscape analysis for a drug target.

Multi-source fallback strategy:
1. USPTO PEDS API (primary)
2. Lens.org free API (fallback)
3. Google Patents web scraping (fallback)
4. Agent-level deep-research skill (last resort, via SKILL.md instructions)

Usage:
    python patent_landscape.py --gene EGFR [--output-dir ./output]
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.api_client import APIClient, get_lens_client
from shared.data_validator import DataProvenance


def get_uspto_client() -> APIClient:
    return APIClient(
        base_url="https://developer.uspto.gov/ibd-api/v1",
        headers={"Accept": "application/json"},
        cache_ttl=86400,
    )


def search_uspto(query: str, rows: int = 50) -> List[dict]:
    """Search USPTO PEDS API."""
    client = get_uspto_client()
    try:
        result = client.get("patent/application", params={
            "searchText": query,
            "rows": rows,
            "start": 0,
        })
        return result.get("response", {}).get("docs", [])
    except Exception as e:
        print(f"[Patent] USPTO failed: {e}")
        return []


def search_lens(query: str, rows: int = 50) -> List[dict]:
    """Search Lens.org free patent API."""
    client = get_lens_client()
    try:
        result = client.post("", json_data={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"title": query}},
                        {"match": {"type": "patent"}},
                    ]
                }
            },
            "size": rows,
            "_source": ["title", "date_published", "biblio.inventors", "biblio.applicants", "lens_id"],
        })
        hits = result.get("hits", {}).get("hits", [])
        patents = []
        for h in hits:
            src = h.get("_source", {})
            biblio = src.get("biblio", {})
            applicants = biblio.get("applicants", [])
            inventors = biblio.get("inventors", [])
            patents.append({
                "title": src.get("title", ""),
                "date": src.get("date_published", ""),
                "assignee": applicants[0].get("name", "") if applicants else "",
                "inventors": [i.get("name", "") for i in inventors[:3]],
                "lens_id": src.get("lens_id", ""),
                "source": "lens.org",
            })
        return patents
    except Exception as e:
        print(f"[Patent] Lens.org failed: {e}")
        return []


def search_openalex(gene: str, rows: int = 50) -> List[dict]:
    """Search OpenAlex for drug development / patent-related scholarly works. Free API, no key needed."""
    try:
        import requests
        url = "https://api.openalex.org/works"
        params = {
            "search": f"{gene} drug development patent inhibitor antibody",
            "per_page": rows,
            "select": "id,title,publication_year,authorships,primary_location,cited_by_count",
        }
        resp = requests.get(url, params=params, timeout=30,
                           headers={"Accept": "application/json"})
        if resp.status_code != 200:
            print(f"[Patent] OpenAlex returned {resp.status_code}")
            return []

        data = resp.json()
        total = data.get("meta", {}).get("count", 0)
        results = data.get("results", [])
        patents = []
        for w in results:
            authors = w.get("authorships", [])
            assignee = ""
            if authors:
                # Try to get institution name
                inst = authors[0].get("institutions", [])
                if inst:
                    assignee = inst[0].get("display_name", "")
                else:
                    assignee = authors[0].get("author", {}).get("display_name", "")
            patents.append({
                "title": w.get("title", ""),
                "date": str(w.get("publication_year", "")),
                "assignee": assignee,
                "patent_number": w.get("id", "").split("/")[-1],
                "cited_by": w.get("cited_by_count", 0),
                "source": "openalex",
            })
        print(f"[Patent] OpenAlex: {len(patents)} works (from {total} total)")
        return patents
    except Exception as e:
        print(f"[Patent] OpenAlex failed: {e}")
        return []


def search_google_patents_scrape(gene: str, rows: int = 50) -> List[dict]:
    """Google Patents is a SPA - cannot scrape with simple HTTP.

    Returns empty list. Agent must use Playwright to render the page.
    See SKILL.md for Playwright fallback instructions.
    """
    print("[Patent] Google Patents is a SPA (requires Playwright). Marking for agent fallback.")
    return []


def normalize_patent(p: dict, source: str = "uspto") -> dict:
    """Normalize patent data from different sources to a common format."""
    if source == "uspto":
        title = p.get("inventionTitle", [""])[0] if isinstance(p.get("inventionTitle"), list) else p.get("inventionTitle", "")
        assignee = p.get("assigneeEntityName", [""])[0] if isinstance(p.get("assigneeEntityName"), list) else p.get("assigneeEntityName", "")
        return {
            "title": title,
            "filing_date": p.get("filingDate", ""),
            "assignee": assignee,
            "patent_number": p.get("applicationNumber", ""),
            "cpc_codes": p.get("cpcClassificationCode", []),
            "source": "USPTO",
        }
    elif source == "lens":
        return {
            "title": p.get("title", ""),
            "filing_date": p.get("date", ""),
            "assignee": p.get("assignee", ""),
            "inventors": p.get("inventors", []),
            "patent_number": p.get("lens_id", ""),
            "source": "Lens.org",
        }
    elif source == "google":
        return {
            "title": p.get("title", ""),
            "filing_date": p.get("date", ""),
            "assignee": p.get("assignee", ""),
            "patent_number": p.get("patent_number", ""),
            "source": "Google Patents",
        }
    return p


def search_patents(gene: str, rows: int = 50) -> tuple:
    """Multi-source patent search with fallback chain.

    Returns:
        (patents_list, data_source_name)
    """
    # Source 1: USPTO PEDS API
    query = f'"{gene}" AND ("therapeutic" OR "drug" OR "antibody" OR "inhibitor")'
    patents = search_uspto(query, rows)
    if patents:
        print(f"[Patent] USPTO: {len(patents)} patents")
        return [normalize_patent(p, "uspto") for p in patents], "USPTO"

    # Source 2: OpenAlex (free, no key needed)
    print("[Patent] USPTO unavailable. Trying OpenAlex...")
    patents = search_openalex(gene, rows)
    if patents:
        return [normalize_patent(p, "lens") for p in patents], "OpenAlex"

    # Source 3: Lens.org (needs API key, may fail with 401)
    print("[Patent] Trying Lens.org fallback...")
    patents = search_lens(f"{gene} therapeutic", rows)
    if patents:
        print(f"[Patent] Lens.org: {len(patents)} patents")
        return [normalize_patent(p, "lens") for p in patents], "Lens.org"

    # Source 4: Agent-level fallback (Playwright)
    print("[Patent] All programmatic sources failed.")
    print("[AGENT ACTION] Use Playwright to search Google Patents:")
    print(f"  https://patents.google.com/?q={gene}+therapeutic+antibody+inhibitor")
    return [], "agent_fallback_needed"


def analyze_patent_trends(patents: List[dict]) -> dict:
    """Analyze patent filing trends."""
    year_counts = Counter()
    assignee_counts = Counter()
    cpc_codes = Counter()

    for p in patents:
        date = p.get("filing_date", "") or p.get("date", "")
        if date and len(str(date)) >= 4:
            year_counts[str(date)[:4]] += 1

        assignee = p.get("assignee", "")
        if assignee:
            assignee_counts[assignee] += 1

        codes = p.get("cpc_codes", [])
        if isinstance(codes, str):
            codes = [codes]
        for c in codes:
            if c:
                cpc_codes[c] += 1

    return {
        "year_distribution": dict(sorted(year_counts.items())),
        "top_assignees": dict(assignee_counts.most_common(15)),
        "top_cpc_codes": dict(cpc_codes.most_common(10)),
        "total_patents": len(patents),
    }


def run(gene_symbol: str, output_dir: Path) -> dict:
    """Run patent landscape analysis with multi-source fallback."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    provenance = DataProvenance(target_gene=gene_symbol)

    print(f"[Patent] Searching for {gene_symbol} related patents...")
    patents, data_source = search_patents(gene_symbol, rows=100)

    provenance.add_source("Patent Search", f"patents for {gene_symbol}", url=data_source)

    # Analyze trends
    trends = analyze_patent_trends(patents)

    # Save results
    json_data = {
        "gene": gene_symbol,
        "data_source": data_source,
        "patent_trends": trends,
        "sample_patents": patents[:20],
        "agent_fallback_needed": len(patents) == 0,
        "provenance": provenance.to_dict(),
    }

    json_path = output_dir / f"patent_{gene_symbol}_landscape.json"
    json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n[Patent] Results for {gene_symbol}:")
    print(f"  Data source: {data_source}")
    print(f"  Total patents: {trends['total_patents']}")
    if trends["top_assignees"]:
        print(f"  Top assignees:")
        for name, count in list(trends["top_assignees"].items())[:5]:
            print(f"    {name}: {count}")

    return {
        "patents": patents[:20],
        "trends": trends,
        "data_source": data_source,
        "json_path": str(json_path),
        "agent_fallback_needed": len(patents) == 0,
        "summary": (
            f"Found {trends['total_patents']} patents related to {gene_symbol} (source: {data_source}). "
            f"Top assignee: {list(trends['top_assignees'].keys())[0] if trends['top_assignees'] else 'N/A'}."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Patent landscape analysis for drug targets")
    parser.add_argument("--gene", required=True, help="Gene symbol (e.g., EGFR)")
    parser.add_argument("--output-dir", default="./output", help="Output directory")
    args = parser.parse_args()

    result = run(args.gene, Path(args.output_dir))
    if result.get("agent_fallback_needed"):
        print("\n[AGENT ACTION NEEDED] All patent APIs failed.")
        print("Agent should invoke deep-research or Playwright skill to search:")
        print(f"  - Google Patents: https://patents.google.com/?q={args.gene}+therapeutic")
        print(f"  - Lens.org: https://www.lens.org/lens/search/patent/list?q={args.gene}")
        sys.exit(2)  # Special exit code: agent fallback needed


if __name__ == "__main__":
    main()
