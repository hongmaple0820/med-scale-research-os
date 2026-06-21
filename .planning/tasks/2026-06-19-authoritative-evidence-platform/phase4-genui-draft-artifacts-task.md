# Task - GenUI Draft Artifacts

Date: 2026-06-21
Level: M
Task ID: `TASK-2026-06-21-GENUI-DRAFT-ARTIFACTS`
Implementation status: COMPLETE
Research workflow status: DRY_RUN_ARTIFACTS_ONLY

## Implemented

- Added optional `persist=true` handling to `/api/genui-review-action-draft`.
- Added dashboard-side payload and manifest writing under `output/dashboard_runtime/genui-action-drafts`.
- Added workbench rendering for `medscale.genui_review_action_draft.v1`.
- Updated the frontend to persist draft artifacts when a GenUI card action is clicked.
- Documented the GenUI action draft schema.
- Added tests for persisted draft payloads, manifests, endpoint behavior, and workbench visibility.

## Still Not Done By Machine

- No persisted draft executes its proposed operation.
- No review approval is written.
- No terminology mapping decision artifact is written by the dashboard.
- No PubMed claim record or claim ledger entry is written by the dashboard.

## Next Human/Design Decisions

1. Decide who can confirm a persisted action draft.
2. Define reviewer identity and signature requirements.
3. Add an execution endpoint only after safety review.
