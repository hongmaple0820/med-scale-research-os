# Task - MeSH Terminology and PubMed Claim Ledger

Date: 2026-06-19
Level: CRITICAL
Task ID: `TASK-2026-06-19-TERMINOLOGY-PUBMED`
Implementation status: COMPLETE
Research workflow status: AWAITING_HUMAN_ACQUISITION_REVIEW

## Implemented

- Versioned MeSH release control with NLM terms and attribution metadata.
- Streaming gzip/XML descriptor inspection.
- Candidate resolution with `selected_id = null`.
- Explicit ambiguous/no-match statuses.
- NCBI public/API-key rate limiter.
- PubMed raw XML control, PMID/DOI/MeSH/publication-type parsing.
- Abstract section locator hashes without copying source text into claim records.
- Human-authored claim store with separated study design, risk of bias, certainty, and
  applicability.
- Pseudo-GRADE numeric fields are rejected.
- Claim reload, review gating, and tamper detection.

## Persistent Raw Artifacts

- MeSH 2026: `msa-daec5e91e73fe31ed3584305`
- PubMed PMID 10952317: `msa-b383f5e01765240aed0aab3c`

Both are at `acquisition / review_required`.

## Human Gate

Approval authorizes only these raw reference artifacts for downstream terminology-candidate and
claim-ledger contract tests. It does not select a MeSH concept, approve a medical claim, assign
GRADE certainty, or authorize public export of the PubMed abstract.
