# Task - GenUI Action Drafts

Date: 2026-06-20
Level: M
Task ID: `TASK-2026-06-20-GENUI-ACTION-DRAFTS`
Implementation status: COMPLETE
Research workflow status: DRY_RUN_ONLY

## Implemented

- Added `DashboardState.build_genui_review_action_draft`.
- Added `POST /api/genui-review-action-draft`.
- Added snapshot validation for mapping selected IDs.
- Added snapshot validation for PubMed worksheet locators.
- Added frontend field collection, dry-run submission, and per-card draft result messages.
- Changed approved workbench controls from display-only disabled fields to fillable dry-run fields.
- Added tests for accepted mapping drafts, rejected unapproved worksheet drafts, and endpoint
  validation status.

## Still Not Done By Machine

- No dashboard action writes a review event.
- No dashboard action writes a terminology decision artifact.
- No dashboard action writes a PubMed claim record.
- No dashboard action approves or rejects medical evidence.

## Next Human/Design Decisions

1. Define reviewer authentication and audit identity.
2. Decide whether action drafts should be persisted before execution.
3. Design execution endpoints that call `TerminologyMappingDecisionRecorder` and
   `PubMedWorksheetClaimSubmitter` only after explicit reviewer confirmation.
