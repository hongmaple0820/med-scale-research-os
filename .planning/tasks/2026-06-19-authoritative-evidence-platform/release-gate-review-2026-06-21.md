# Review - Release Gate Readiness Fixes

Date: 2026-06-21
Level: CRITICAL

## Decision

Accept the release gate readiness fixes as a packaging and local-runtime compatibility slice.

## Findings

- Optional enhancement CLIs no longer block the local MedSCALE medical workflow when core runtime
  checks pass.
- `setup --json`, `setup --verify`, `doctor env --json`, and `medscale doctor --json` now keep
  optional enhancement gaps separate from required runtime failures.
- `release:check` explicitly builds before packaging and pins `npm audit` to the public npm
  registry used for release verification.
- Setup smoke coverage now verifies governed planning, fallback availability, and non-blocking
  optional dependencies instead of requiring every third-party enhancement CLI to install and
  initialize in the test environment.
- The changes do not add medical review execution, terminology selection, claim ledger writes, or
  approval bypass behavior.

## Residual Risks

- The full `npm run release:check` command was not re-run as one combined command after the long
  full test pass; its constituent commands were run individually and passed.
- `make preflight` remains unavailable in this Windows runtime because `make` is not installed.
- Optional provider health can still vary by developer machine, so release documentation should
  keep distinguishing degraded optional capability from broken required runtime.

## Reviewed Files

- `.gitignore`
- `package.json`
- `scripts/workflow/setup-smoke.mjs`
- `src/adapters/WorkBuddyAdapter.ts`
- `src/api/doctor.ts`
- `src/cli/targetCommands.ts`
- `src/env/EnvironmentDoctor.ts`
- `src/setup/SetupVerification.ts`
- `src/workflow/WorkflowTemplates.ts`
- `tests/api/bootstrapCli.test.ts`
- `tests/cli/targetCommands.test.ts`
- `tests/runtime/aiOsRuntime.test.ts`
- `tests/tools/toolCli.test.ts`
- `docs/EXTERNAL_REFERENCES.md`
