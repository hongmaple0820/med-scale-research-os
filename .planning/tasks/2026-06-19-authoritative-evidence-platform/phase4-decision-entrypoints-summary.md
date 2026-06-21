# Summary - Decision Entrypoints

Date: 2026-06-20
Level: CRITICAL

## What Changed

- Added executable decision entrypoints for the Phase 4 pending human decisions.
- `TerminologyMappingDecisionRecorder` can persist a human-selected candidate or an explicit
  reject-all decision.
- The terminology recorder only accepts IDs already present in an approved mapping request
  candidate snapshot.
- `PubMedWorksheetClaimSubmitter` can submit human-authored claims through an approved worksheet
  locator into the existing claim ledger.
- The JSON schema documentation now includes the review artifact contracts for mapping requests,
  mapping decisions, PubMed worksheets, and claim records.

## What Did Not Change

- The machine still does not choose canonical medical terminology.
- The machine still does not author medical claims.
- Mapping decisions and claim records remain review-required before downstream use.
- Approved reject-all mapping decisions still cannot be consumed as canonical selections.

## Current State

- Real `melanoma -> MeSH:D008545` selection remains pending human decision.
- Real PubMed claim creation remains pending human-authored claim text, stance, and four-part
  evidence assessment.
- The executable path now exists for those decisions once a reviewer supplies them.
