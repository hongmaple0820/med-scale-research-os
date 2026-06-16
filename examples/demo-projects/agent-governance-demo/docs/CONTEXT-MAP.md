# CONTEXT-MAP.md

Project: Agent Governance Demo

| Module | Owner | Product Doc | Architecture Doc |
| --- | --- | --- | --- |
| OAuth state verifier | SCALE demo | `README.md` | `src/oauth-state.ts` |
| Workflow evidence | SCALE demo | `README.md` | `.scale/evals/suites/workflow-baseline.json` |

## Cross-Module Rules

- Behavior changes in `src/oauth-state.ts` must update `tests/oauth-state.test.ts`.
- Workflow command changes must update `README.md`.
- Generated reports under `.scale/reports/` are review artifacts, not source of truth.
