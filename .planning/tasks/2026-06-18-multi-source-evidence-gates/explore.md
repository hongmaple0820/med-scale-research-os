# Explore - 2026-06-18-multi-source-evidence-gates

Date: 2026-06-18
Level: CRITICAL

## Files Read

- `AGENTS.md`
- `README.md`
- `docs/guides/GETTING_STARTED.md`
- `docs/guides/DEVELOPMENT_WORKFLOW.md`
- `docs/workflow/README.md`
- `.scale/workspace.json`
- `target-research-platform/main.py`
- `target-research-platform/src/analysis/stage1_expression/pipeline.py`
- `target-research-platform/src/analysis/stage2_screening/pipeline.py`
- `target-research-platform/src/analysis/stage2_screening/differential_expression.py`
- `target-research-platform/src/validators/data_provenance.py`
- `target-research-platform/src/validators/cross_validator.py`
- `target-research-platform/src/output/manuscript_generator.py`
- `target-research-platform/src/output/manuscript_fact_checker.py`
- `target-research-platform/output/**/KRAS*`

## Main Contradiction

The product advertises multi-source, anti-hallucination research, but current success checks validate that artifacts exist rather than that independent disease-matched evidence supports the claims. The resulting system can mark invalid/empty sources as consistent, continue after failed calculations, manufacture a fallback candidate set, and pass a manuscript containing a different target and disease.

## Constraints

- Preserve unrelated untracked dashboard scratch files.
- Keep existing stage commands usable for stepwise execution.
- Prefer fail-closed evidence semantics over maintaining optimistic historical outputs.
- Do not claim a database was queried independently when its values were inferred from another aggregator.
- Current shell lacks `rtk` and Git Bash; use native PowerShell and manual task artifacts.
