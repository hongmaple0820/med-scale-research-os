# Phase 3 Slice Plan - GEO Format Profile and Normalization Method Card

Date: 2026-06-19
Level: CRITICAL
Plan ID: `PLAN-2026-06-19-GEO-NORMALIZATION-ASSESSMENT`
Status: COMPLETE — normalization block decision awaits human review

## Scope

This slice does not normalize GSE1 expression values. It deterministically profiles the admitted
Series Matrix, records source-format assumptions, and decides whether biological normalization is
permitted.

## Rules

- A fixed adapter control cannot be promoted into a disease-analysis cohort.
- Values with a material negative fraction are treated as already centered/processed; log2
  transformation is prohibited.
- Incomplete processing metadata blocks claims of reproducible normalization.
- Heterogeneous sample source labels block automatic case/control construction.
- Probe-level `ID_REF` values cannot be compared at gene level without a separately admitted,
  versioned platform annotation mapping.
- A blocked assessment produces no normalized matrix and no target candidates.

## Output

- Versioned JSON method card and diagnostic report.
- An `analysis` artifact reviewed at the `normalization` stage.
- Explicit `review_required` status for human confirmation of the block decision.

## Rollback

- Remove `src/research_os/normalization.py` and its tests.
- Remove only the generated assessment artifact after checking it is under the current GSE1 local
  run directory.
- Keep the approved raw acquisition and append-only review history unchanged.

## Completion

- The acquisition approval was recorded with an ASCII canonical signature after preserving and
  invalidating an earlier encoding-corrupted chat signature.
- The real GSE1 matrix was profiled with deterministic rules.
- A normalization-stage analysis artifact was created with decision `blocked`.
- No normalized matrix was created.
