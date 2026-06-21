# Review - Decision Entrypoints

Date: 2026-06-20
Level: CRITICAL

## Decision

Accept the continuation as a governance entrypoint slice.

## Findings

- The implementation preserves the reviewed candidate snapshot and refuses selected IDs outside
  that snapshot.
- The implementation records reject-all as an explicit artifact instead of treating absence of a
  selection as a hidden decision.
- Worksheet-based claim submission still delegates all claim validation to the existing
  `ClaimLedgerStore`, including exact locator hash, approved raw source, four separated assessment
  fields, and pseudo-GRADE rejection.
- Both mapping decisions and submitted claims remain review-required artifacts before downstream
  use.

## Residual Risks

- Review events are still local JSONL and single-process oriented.
- The real `melanoma` mapping and PubMed worksheet have not been decided by a human in this slice.
- A future UI/CLI should surface these entrypoints so reviewers do not need to call Python APIs
  directly.
