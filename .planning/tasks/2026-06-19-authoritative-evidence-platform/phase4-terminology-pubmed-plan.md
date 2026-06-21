# Phase 4 Slice Plan - MeSH Terminology and PubMed Claim Ledger

Date: 2026-06-19
Level: CRITICAL
Plan ID: `PLAN-2026-06-19-TERMINOLOGY-PUBMED`
Status: COMPLETE — raw MeSH and PubMed artifacts await human acquisition review

## Scope

- Admit the official NLM MeSH 2026 descriptor release as a versioned terminology artifact.
- Resolve terminology candidates without auto-selecting a canonical concept.
- Retrieve one official PubMed XML record under the NCBI rate-limit contract.
- Parse stable metadata and original-text locators.
- Accept human-authored claims only when they bind to an approved source artifact and exact locator
  hash.
- Keep study design, risk of bias, certainty, and applicability separate.

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- secure-path-handling
- medical-provenance-modeling
- XML-streaming

## Failure Rules

- Checksum, byte count, release profile, or fixed descriptor drift blocks MeSH admission.
- Candidate resolution never assigns a selected ID.
- Ambiguous terms enter `human_review_required`.
- PubMed requests without an API key are spaced at least 0.34 seconds apart.
- PMID mismatch or missing original-text locator blocks claim submission.
- Numeric pseudo-GRADE fields are rejected.
- Raw terminology and literature artifacts require human acquisition approval before claims.

## Rollback

- Remove the terminology/literature modules, controls, and tests.
- Delete only generated local terminology/literature output after resolved-path checks.
- Preserve all existing GSE1 and project-admission records.

## Completion

- TDD RED failed before terminology/literature contracts existed.
- GREEN added controlled MeSH release admission, candidate resolution without auto-selection,
  NCBI rate limiting, PubMed locator hashing, and human-authored claim admission.
- REFACTOR added claim reload/tamper verification and silent-short-read Range continuation.
- The first live MeSH attempt stopped at 599,829 bytes; no artifact was admitted.
- The bounded resume implementation then passed the full MeSH and PubMed live controls.
- Persistent raw artifacts remain `review_required`; no mapping selection or claim was created.
