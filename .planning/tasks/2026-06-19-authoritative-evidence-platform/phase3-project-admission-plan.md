# Phase 3 Slice Plan - Research Project Admission

Date: 2026-06-19
Level: CRITICAL
Plan ID: `PLAN-2026-06-19-PROJECT-ADMISSION`
Status: COMPLETE — awaits human project definition

## Scope

Create the fail-closed contract that must be approved before any disease-project cohort discovery or
download begins.

## Required Fields

- Stable project ID and explicit research question.
- Canonical disease/condition ID.
- `NCBITaxon:9606` for the human-first V1.
- Canonical tissue ID.
- One of the seven admitted omics dimensions.
- Explicit case and control definitions.
- Minimum case/control sample thresholds.
- At least one project positive control.
- Every control must have a canonical entity ID, expected observation, and evidence URL admitted by
  the source registry.

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- secure-path-handling
- medical-provenance-modeling

## Failure Rules

- Missing or placeholder fields block submission.
- Case/control definitions must differ.
- Sample thresholds below five block submission.
- Unapproved evidence sources or URLs block submission.
- Tampered project files cannot pass the acquisition gate.
- A submitted project remains `review_required` until a human signs it.

## Rollback

- Remove `src/research_os/projects.py`, its tests, and the project template.
- Delete only generated project-definition records under the caller-provided project-admission
  directory after resolving and checking the path.
- Do not alter approved GSE1 raw or normalization-block review history.

## Completion

- TDD RED failed on missing project admission classes.
- GREEN added deterministic validation, immutable project records, integrity verification, and the
  acquisition approval gate.
- REFACTOR converted source license failures into structured admission issues.
- The unfilled project template correctly produces a blocked diagnostic; no project cohort was
  discovered or downloaded.
