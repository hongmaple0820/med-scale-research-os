# Task - GenUI Draft Confirmations

Date: 2026-06-21
Level: M
Task ID: `TASK-2026-06-21-GENUI-DRAFT-CONFIRMATIONS`
Implementation status: COMPLETE
Research workflow status: CONFIRMATION_ARTIFACTS_ONLY

## Implemented

- Added `DashboardState.build_genui_review_action_confirmation`.
- Added `POST /api/genui-review-action-confirmation`.
- Added confirmation payload and manifest persistence under
  `output/dashboard_runtime/genui-action-confirmations`.
- Added workbench rendering for `medscale.genui_review_action_confirmation.v1`.
- Added reviewer confirmation controls to saved draft cards.
- Added frontend endpoint routing so draft cards save confirmations, while source cards save drafts.
- Added JSON schema documentation for confirmation envelopes.
- Added tests for successful confirmation, missing acknowledgement rejection, and endpoint
  persistence.

## Still Not Done By Machine

- No confirmation executes the proposed operation.
- No confirmation writes review approval.
- No confirmation writes terminology decisions, PubMed claims, or claim ledger entries.

## Next Human/Design Decisions

1. Define authenticated reviewer identity rather than free-form reviewer ID.
2. Define who may convert a confirmation into an execution request.
3. Add a separate execution safety review before any write endpoint exists.
