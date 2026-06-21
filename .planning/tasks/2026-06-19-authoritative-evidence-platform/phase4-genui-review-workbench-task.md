# Task - GenUI Review Workbench

Date: 2026-06-20
Level: M
Task ID: `TASK-2026-06-20-GENUI-REVIEW-WORKBENCH`
Implementation status: COMPLETE
Research workflow status: AWAITING_HUMAN_REVIEW

## Implemented

- Added a deterministic local GenUI-style workbench to the dashboard status payload.
- Added artifact scanning for review payloads under `manifests/*.json`.
- Added dashboard cards for:
  - `medscale.terminology_mapping_request.v1`
  - `medscale.terminology_mapping_decision.v1`
  - `medscale.pubmed_evidence_worksheet.v1`
  - `medscale.claim_record.v1`
- Added locked form controls that mirror reviewer actions without writing decisions.
- Added the frontend `GenUI Review Workbench` panel and control renderer.
- Added dashboard tests for the frontend hook, idle status payload, and populated artifact cards.

## Still Not Done By Machine

- No OpenTiny GenUI SDK dependency was installed.
- No OpenAI-compatible GenUI server was started.
- No reviewer approval, terminology mapping selection, reject-all decision, or claim submission was
  performed from the dashboard.

## Human Decisions Still Required

1. Decide whether the project should adopt OpenTiny GenUI SDK as a runtime dependency or keep this
   deterministic renderer as the default medical-review surface.
2. Approve the reviewed mapping request before selecting or rejecting candidate terminology.
3. Approve PubMed evidence worksheets before any human-authored claim is submitted.
4. Design authenticated write actions before enabling dashboard buttons.
