# Summary - GenUI Draft Confirmations

Date: 2026-06-21
Level: M

## What Changed

- Persisted GenUI drafts can now receive a separate reviewer confirmation envelope.
- The confirmation envelope records reviewer ID, role, rationale, acknowledgement, and the proposed
  operation snapshot.
- The frontend can save confirmations from draft cards.
- JSON schema documentation now includes `medscale.genui_review_action_confirmation.v1`.

## What Did Not Change

- Confirmations are not approvals.
- Confirmations do not execute operations.
- Confirmations do not create medical decisions or claims.

## Current State

- The GenUI path now has three auditable layers: source review artifact, dry-run action draft, and
  draft confirmation envelope.
- The next safe step is authenticated reviewer identity and an execution-readiness gate, not direct
  medical writes.
