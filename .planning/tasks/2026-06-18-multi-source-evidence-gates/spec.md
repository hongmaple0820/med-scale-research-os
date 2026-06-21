# Spec - 2026-06-18-multi-source-evidence-gates

Date: 2026-06-18
Level: CRITICAL

## What

Replace the current file-exists/single-source success semantics with staged medical evidence gates:

1. Stage 1 reports source validity and failed sub-analyses honestly.
2. Stage 2 requires an actually analyzed GEO cohort plus an independent TCGA cohort before target ranking.
3. Positional sample grouping, undersized controls, relaxed/nominal DE, and zero-overlap cross-validation block downstream conclusions.
4. Missing DE candidates never trigger a hard-coded target list.
5. Druggability output must identify the real source and may not relabel OpenTargets data as independent Pharos/ChEMBL evidence.
6. Full-pipeline execution writes checkpoints and stops at the first failed evidence gate.
7. Manuscript generation requires upstream evidence readiness, exposes a quantitative claim ledger, and detects target/disease/cancer-template contamination.

## Why

The 2026-06-18 KRAS/pancreatic-cancer run demonstrated systematic false positives:

- HPA returned zero tissues but was counted as a valid second expression source.
- Survival and immune analyses failed while Stage 1 still reported `completed` and `high`.
- GEO search metadata was treated as GEO evidence even though DE fell back to TCGA with four normal samples.
- No DE candidates triggered a fixed `CDK4/CDK6/EGFR/BRAF/KRAS` list.
- OpenTargets-derived data was presented as independent OpenTargets, Pharos, and ChEMBL scoring.
- A KRAS/pancreatic-cancer manuscript contained CDK4, HR+, breast-cancer, and TCGA-BRCA statements while fact check reported 100.

## Boundaries

- In scope: evidence-state semantics, Stage 1/2 gates, full-pipeline checkpoints, manuscript readiness/contamination checks, focused tests, operating-guide updates.
- Out of scope: adding every desired external database client, changing statistical methods to a full production-grade omics stack, or claiming clinical validity.
- Safety rule: insufficient or conflicting evidence must produce `blocked`/`partial`, never a guessed ranking or positive recommendation.

## Acceptance Criteria

- [ ] Empty/invalid HPA data cannot create high-confidence cross-validation.
- [ ] Failed survival/immune analyses are visible in Stage 1 status and confidence.
- [ ] Stage 2 ranking requires valid GEO DE and TCGA replication with explicit source comparison.
- [ ] Positional GEO grouping and TCGA control count below five block ranking.
- [ ] No fixed fallback genes are introduced when DE has no candidates.
- [ ] OpenTargets-only evidence is labeled as single-source and does not claim Pharos/ChEMBL retrieval.
- [ ] Full pipeline stops after a failed stage and writes a machine-readable checkpoint.
- [ ] Manuscript generation refuses unready upstream evidence.
- [ ] Fact check fails on unexpected TCGA cohort codes and CDK4/breast-cancer template contamination.
- [ ] Quantitative manuscript claims have source locators in a claim ledger.
