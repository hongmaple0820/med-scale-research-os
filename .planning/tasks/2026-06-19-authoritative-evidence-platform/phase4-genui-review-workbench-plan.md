# Phase 4 Continuation Plan - GenUI Review Workbench

Date: 2026-06-20
Level: M
Plan ID: `PLAN-2026-06-20-GENUI-REVIEW-WORKBENCH`
Status: COMPLETE

## Trigger

The user supplied the OpenTiny GenUI SDK launch article and asked to continue. The article's key
idea is using generated UI to replace text-only AI interaction for structured forms, review
actions, and tool-parameter collection.

## Scope

- Surface existing Research OS review artifacts as deterministic UI cards in the dashboard.
- Keep the local medical governance boundary intact: no LLM-generated UI is allowed to make
  terminology or medical claim decisions.
- Use GenUI SDK concepts for the workbench shape, while deferring runtime package adoption until
  API keys, model routing, and reviewer write paths are explicitly designed.

## Boundary

- The dashboard may render mapping requests, mapping decisions, PubMed evidence worksheets, and
  claim records.
- The dashboard may show locked controls that reflect the next reviewer action.
- The dashboard may not auto-select terminology, auto-author claims, or mark review artifacts as
  approved.
- The dashboard may not require an external LLM server for the existing local smoke path.

## SDK Check

- Checked package metadata for `@opentiny/genui-sdk-vue`: latest observed version `1.2.1`.
- Checked package metadata for `@opentiny/genui-sdk-server`: latest observed version `1.2.0`.
- No dependency was added in this slice because the current Research OS dashboard is local-first
  and deterministic, while GenUI SDK runtime integration requires an OpenAI-compatible LLM service
  and explicit medical reviewer write semantics.

## Verification

- `python -m pytest tests/test_deliverables.py -q`
- `python -m py_compile src/dashboard/app.py`
- `python -m pytest -q`
- `npm test -- tests/dashboard/medicalWorkflowData.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts`
- `npm run typecheck`
- Browser smoke against `http://127.0.0.1:18766`
