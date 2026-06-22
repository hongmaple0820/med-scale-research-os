# Plan - 2026-06-18-multi-source-evidence-gates

Date: 2026-06-18
Level: CRITICAL

## Scope / Boundary

- In scope:
  - strict source validity and confidence semantics;
  - GEO + TCGA DE replication gate;
  - removal of guessed fallback targets and fabricated source labels;
  - stage checkpoints and fail-fast orchestration;
  - manuscript evidence readiness, claim ledger, and contamination checks;
  - tests and researcher documentation.
- Out of scope / non-goals:
  - implementing ICGC/CPTAC/ArrayExpress clients in this change;
  - clinical decision support;
  - making a blocked KRAS run pass by weakening thresholds.

## Approach

1. Correct Stage 1 source counting and evidence status.
2. Refactor Stage 2 so GEO and TCGA are independent inputs, then compare direction/overlap before ranking.
3. Remove hard-coded candidate and pseudo-Pharos/ChEMBL fallbacks.
4. Make the full pipeline checkpointed and fail-fast.
5. Gate manuscript generation and strengthen fact checking.
6. Add regression tests reproducing the observed false positives.
7. Run focused Python tests, deliverable tests, and repository diff checks.

## Exception / Failure Paths

- Expected failure: no usable GEO matrix, positional grouping, too few controls, no shared genes, low concordance, or invalid provenance.
- Error handling: return structured `blocked` evidence status with reasons and mark downstream steps `skipped`.
- Manual recovery: choose a disease-matched cohort with explicit case/control metadata, provide another independent dataset, or fix source parsing; do not bypass the gate.

## Rollback / Fallback

- Rollback: revert only files listed in the task summary.
- Fallback: individual stage commands remain available for diagnostics, but blocked stages cannot be presented as verified.
- Disable path: no silent environment flag bypass is introduced.

## Acceptance Criteria

See `spec.md`.

## Verification

- `python -m pytest tests/test_validators.py tests/test_pipeline_integration.py tests/test_manuscript_fact_check.py tests/test_manuscript_generator.py`
- `python -m pytest tests/test_deliverables.py`
- `git diff --check`
