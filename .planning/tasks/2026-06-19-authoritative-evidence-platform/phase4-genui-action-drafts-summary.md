# Summary - GenUI Action Drafts

Date: 2026-06-20
Level: M

## What Changed

- The GenUI Review Workbench can now validate action drafts from UI controls.
- The dashboard exposes `medscale.genui_review_action_draft.v1` through
  `/api/genui-review-action-draft`.
- Approved mapping request cards can produce dry-run `TerminologyMappingDecisionRecorder.select`
  or `reject_all` drafts.
- Approved PubMed worksheet cards can produce dry-run `PubMedWorksheetClaimSubmitter.submit_claim`
  drafts.
- The browser now shows whether a draft is ready or blocked.

## What Did Not Change

- The dashboard remains non-mutating for medical review decisions.
- Review approval, mapping decision creation, and claim ledger writes are still separate future
  work.
- The OpenTiny GenUI SDK runtime remains deferred.

## Current State

- The workbench has moved from static review cards to safe pre-execution validation.
- The next meaningful product step is an authenticated reviewer confirmation flow.
