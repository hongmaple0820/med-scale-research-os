# Phase 4 Continuation Plan - GenUI Draft Artifacts

Date: 2026-06-21
Level: M
Plan ID: `PLAN-2026-06-21-GENUI-DRAFT-ARTIFACTS`
Status: COMPLETE

## Scope

- Persist validated GenUI action drafts as audit artifacts when explicitly requested.
- Keep draft persistence separate from medical review execution.
- Make saved drafts visible in the GenUI Review Workbench.

## Boundary

- `persist=true` may write only `medscale.genui_review_action_draft.v1` payloads and matching
  `medscale.artifact_manifest.v1` manifests.
- Persisted drafts must keep `dry_run=true` and `write_enabled=false`.
- Persisted drafts must not approve review artifacts, create terminology decisions, create PubMed
  claim records, or write the claim ledger.

## Verification

- `python -m pytest tests/test_deliverables.py -q`
- `python -m py_compile src/dashboard/app.py`
- Browser smoke against `http://127.0.0.1:18766`
- Full target platform pytest before final report
