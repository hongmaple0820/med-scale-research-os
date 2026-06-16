# Plan - 2026-06-14-researcher-readiness-cards

Date: 2026-06-14
Level: M

## Scope / Boundary

- In scope: 18766 medical dashboard homepage delivery-readiness cards, backend status mapping, focused Python tests.
- In scope: quality gate, fact check, package audit, memory seed, and learning candidate researcher cards.
- Out of scope / non-goals: changing the medical pipeline, package format, memory import behavior, or external provider integrations.

## Approach

1. Add backend helpers that normalize manifest/runtime fields into researcher-facing card models.
2. Let `/api/status` expose `summary.delivery_readiness.researcher_cards`.
3. Update the homepage renderer to prefer card models and keep a compatibility fallback.
4. Add assertions for card states, titles, values, and manifest fallback.

## Exception / Failure Paths

- Expected failure: dashboard status may not have a manifest yet; cards should show a pending/empty state.
- Error handling: malformed JSON should continue to fall back to idle status or empty readiness, matching current behavior.
- Manual recovery: if generated cards regress, the frontend fallback can still render from raw readiness fields.

## Rollback / Fallback

- Rollback: revert changes in `target-research-platform/src/dashboard/app.py`, `target-research-platform/src/dashboard/static/index.html`, and tests.
- Fallback: keep the existing raw-card rendering path when `researcher_cards` is absent.
- Disable path: remove `researcher_cards` from `delivery_readiness` without changing status API shape used by older clients.

## Acceptance Criteria

- `/api/status` returns five explicit researcher cards for quality, fact check, package audit, memory seed, and learning candidate.
- Cards use researcher-oriented labels, status text, summary copy, and evidence bullets.
- Homepage card layer renders the explicit card model instead of recomputing all domain copy.
- Existing delivery readiness fields remain available for compatibility.

## Verification

- `python -m pytest target-research-platform/tests/test_deliverables.py`
- `git diff --check`

