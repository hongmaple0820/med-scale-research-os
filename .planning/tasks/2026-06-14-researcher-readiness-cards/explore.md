# Explore - 2026-06-14-researcher-readiness-cards

Date: 2026-06-14
Level: M

## Files Read

- `AGENTS.md`
- `README.md`
- `docs/guides/GETTING_STARTED.md`
- `docs/guides/DEVELOPMENT_WORKFLOW.md`
- `docs/workflow/README.md`
- `.scale/workspace.json`
- `target-research-platform/src/dashboard/app.py`
- `target-research-platform/src/dashboard/static/index.html`
- `target-research-platform/tests/test_deliverables.py`
- `target-research-platform/src/output/delivery_packager.py`

## Main Contradiction

18766 dashboard already attaches delivery readiness data and renders cards, but the homepage card layer still exposes many low-level fields. Researchers need a faster view of whether the manuscript is reviewable, what blocks delivery, whether the ZIP was audited, and whether memory/learning outputs are ready for follow-up.

## Current Shape

- `DashboardState.load_status()` enriches live status with manifest-backed readiness.
- `summary.delivery_readiness` contains quality findings, literature evidence, package audit, memory seed, and learning candidate data.
- `renderDeliveryReadiness()` in the static dashboard derives most labels, states, and card copy in browser JavaScript.
- `quality_gate` and `fact_check` can exist in runtime summary, but package-only status may need manifest fallback.

