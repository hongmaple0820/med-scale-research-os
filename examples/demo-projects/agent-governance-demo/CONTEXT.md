# CONTEXT.md

Project: Agent Governance Demo

| Term | Definition | Examples | Aliases | Source |
|------|------------|----------|---------|--------|
| OAuth state | One-time callback correlation value that binds authorization return traffic to a user session | `state-123` | callback state | `src/oauth-state.ts` |
| Consumed state | A state record that has already been used and must not be accepted again | `consumedAt: 900` | replayed state | `tests/oauth-state.test.ts` |
| Evidence | A command result or artifact that proves what was verified | `npm test`, eval report, dashboard | verification proof | SCALE workflow |

## Rejected Meanings

- Do not treat an expired state as recoverable without a new authorization flow.
- Do not treat a dashboard or eval report as a substitute for the business test.
