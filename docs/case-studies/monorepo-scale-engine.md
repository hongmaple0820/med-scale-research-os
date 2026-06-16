# Case Study: SCALE Engine Self-Hosted Monorepo Governance

## Scenario

The SCALE Engine project itself uses SCALE for self-governance — a monorepo
with TypeScript source, documentation, CI/CD, and MCP server components.

## Configuration

- Governance pack: `scale-engine-repo`
- Self-hosted: .scale/ inside the same repo
- Profile: advanced (all detectors active)

## Gate Results (Typical PR)

| Gate | Stage | Result | Duration |
|------|-------|--------|----------|
| TDD | G3 | PASS | 2.1s |
| Build | G0 | PASS | 4.3s |
| Lint | G4 | PASS | 1.8s |
| Test | G5 | PASS | 12.5s |
| Coverage | G6 | PASS (82%) | 3.2s |
| Security | G7 | PASS | 2.1s |

## Key Insights

1. Self-governance exposes design flaws early — the FSM caught 3 invalid state transitions during development
2. The Evolution Engine extracted 12 lessons, 4 promoted to active rules
3. Gate G11 (Guardrail Effectiveness) flagged 2 detectors with low trigger rates for recalibration
