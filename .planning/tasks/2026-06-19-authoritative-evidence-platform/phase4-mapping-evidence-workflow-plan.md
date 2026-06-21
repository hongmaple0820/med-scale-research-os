# Phase 4 Slice Plan - Mapping Queue and Evidence Worksheet

Date: 2026-06-19
Level: CRITICAL
Plan ID: `PLAN-2026-06-19-MAPPING-EVIDENCE-WORKFLOW`
Status: COMPLETE — mapping and evidence worksheet await human review

## Scope

- Convert an approved MeSH raw artifact into a human terminology-mapping queue item.
- Convert an approved PubMed raw artifact into an evidence review worksheet.
- Preserve `selected_id = null`, `claim_text = null`, and all evidence judgments as unassessed.
- Require separate review stages before a mapping decision or claim can be created.

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- medical-provenance-modeling

## Failure Rules

- Unapproved or tampered raw parents block both workflows.
- Mapping candidates must come from the exact approved terminology bytes.
- No queue builder accepts a selected canonical ID.
- Evidence worksheets cannot copy abstract prose or create claims.
- Study design, risk of bias, certainty, and applicability remain empty human fields.
- Mapping artifacts use the normalization review stage.
- Evidence worksheets use the intelligence review stage.

## Rollback

- Remove the mapping/worksheet builders and tests.
- Delete only generated derived artifacts under the terminology-literature local output after
  checking resolved paths.
- Keep approved raw MeSH/PubMed artifacts and their append-only review history.

## Completion

- TDD RED failed before the builders existed.
- GREEN created an unselected mapping request and a blank evidence worksheet from approved raw
  parents.
- Both outputs preserve lineage, hashes, and mandatory review stages.
- No terminology decision and no medical claim were created.
