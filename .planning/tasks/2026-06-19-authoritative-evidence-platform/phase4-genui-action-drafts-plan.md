# Phase 4 Continuation Plan - GenUI Action Drafts

Date: 2026-06-20
Level: M
Plan ID: `PLAN-2026-06-20-GENUI-ACTION-DRAFTS`
Status: COMPLETE

## Scope

- Let the GenUI Review Workbench validate reviewer intent as a dry-run action draft.
- Keep all dashboard review actions non-mutating until authenticated reviewer write semantics are
  designed.
- Convert approved mapping requests and PubMed worksheets into executable-looking drafts that
  point to the existing Research OS entrypoints.

## Boundary

- `select` and `reject_all` drafts are allowed only for approved terminology mapping requests.
- `submit_claim` drafts are allowed only for approved PubMed evidence worksheets.
- Candidate IDs and PubMed locators must come from the reviewed artifact snapshot.
- The endpoint must return `dry_run: true` and `write_enabled: false`.
- No approval event, mapping decision artifact, claim record, or ledger write is created.

## Verification

- `python -m pytest tests/test_deliverables.py -q`
- `python -m py_compile src/dashboard/app.py`
- Browser dry-run smoke against `http://127.0.0.1:18766`
- Full target platform pytest before final report
