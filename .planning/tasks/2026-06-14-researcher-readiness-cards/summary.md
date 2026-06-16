# Summary - 2026-06-14-researcher-readiness-cards

Date: 2026-06-14
Level: M

## What Changed

- Added backend researcher-facing readiness cards for:
  - quality
  - fact check
  - package audit
  - memory seed
  - learning candidate
- Added manifest fallback for `quality_gate` and `fact_check` in dashboard status.
- Updated the 18766 homepage readiness section to render explicit card models with status labels, primary values, concise summaries, evidence rows, and next actions.
- Kept the previous frontend raw-field rendering as a compatibility fallback.
- Added tests for the new API and frontend rendering contract.

## Outcome

Researchers now get a clearer first-screen answer to: is the manuscript reviewable, is fact checking clean, is the ZIP safe to hand off, did memory seeding happen, and is there a learning candidate ready for human review.

