# Release Readiness - 2026-06-21

Date: 2026-06-21
Level: CRITICAL
Scope: MedSCALE Research OS 0.44.0 release readiness

## Decision

No-Go for publishing from the current working tree.

The implementation and release gates are in a strong candidate state, but the working tree still
contains a mixed set of tracked changes and untracked feature, evidence, architecture, and test
files. Ship rules require staging reviewed files only, so publish/commit must wait until the
release payload is selected and reviewed as a single candidate set.

## Verified Gates

The following commands were run from the repository root unless noted otherwise:

```text
npm test
PASS: 169 test files, 1612 tests

npm run typecheck
PASS

npm run lint
PASS

npm run build
PASS

npm run smoke:setup
PASS

npm run smoke:providers -- --write-report
PASS; GBrain passed; Graphify remained optional/blocked and did not fail the gate

npm run smoke:medscale-release
PASS

npm audit --omit=dev --registry=https://registry.npmjs.org
PASS; 0 vulnerabilities

git diff --check
PASS; CRLF warnings only

npm pack --dry-run
PASS; package size about 1.8 MB, unpacked size about 8.5 MB, 1117 entries

npm run medscale -- doctor --json
PASS; ok=true, status=degraded, requiredMissing=[], failCount=0
```

Post-staging recovery verification after fixing Windows encoding-safe whitespace cleanup:

```text
git diff --cached --check
PASS

npm pack --dry-run --json
PASS; entryCount=1117; untracked files included in package=0

python -m compileall -q target-research-platform/src target-research-platform/main.py
PASS

npm run typecheck
PASS

npm run build
PASS

cd target-research-platform && python -m pytest tests/test_deliverables.py -q
PASS; 35 passed

npm run smoke:medscale-release
PASS

npm test -- tests/cli/targetCommands.test.ts
PASS; 23 passed
```

Target research platform verification already recorded in this task:

```text
python -m pytest -q
PASS: 238 passed, 16 deselected

python -m pytest tests/test_deliverables.py -q
PASS: 35 passed

python -m py_compile src/dashboard/app.py
PASS
```

## Release Gate Fixes

The TypeScript release gate changes make external enhancement capabilities optional instead of
blocking the local MedSCALE workflow:

- `targetCommands` no longer requires GBrain, AgentMemory, RTK, CodeGraph, or Graphify for setup
  readiness.
- `EnvironmentDoctor` and `doctor` compute overall health from non-optional checks only.
- `SetupVerification` reports optional enhancement gaps as warnings instead of blocking issues.
- `setup-smoke` verifies governed planning and fallback availability rather than requiring local
  installation of every external CLI.
- `release:check` now runs `npm run build` explicitly and uses the official npm audit registry.
- Workflow template review steps are rendered as optional where the template marks them optional.
- WorkBuddy installation detection now requires `.workbuddy/settings.json` instead of any
  `.workbuddy` directory.

## Feature Payload Candidate

The reviewed feature payload consists of the authoritative evidence platform continuation:

- governance, artifact, adapter, GEO, terminology, literature, transport, normalization, project,
  and evidence workflow modules under `target-research-platform/src/research_os/`;
- dashboard GenUI Review Workbench, action draft, persisted draft, and confirmation envelope
  endpoints and frontend controls;
- evidence-gate validators and manuscript provenance/fact-checking updates;
- schema documentation and target platform README updates;
- deterministic target-platform tests covering governance, adapters, GEO controls, terminology,
  PubMed worksheets, mapping decisions, deliverables, and validation gates.

Existing review records accept the governance foundation, decision entrypoints, GenUI review
workbench, GenUI action drafts, persisted draft artifacts, and draft confirmations. These records
remain local planning evidence and are not included in the npm package.

## Package Boundary

`npm pack --dry-run --json` confirms:

- `.planning/*` evidence is not included in the npm package.
- `docs/architecture/*` ADR/audit documents are not included in the npm package.
- `target-research-platform/tests/*` are not included in the npm package.
- `target-research-platform/config/reference_controls/*` and `config/templates/*` are not included
  in the npm package.
- `target-research-platform/src/research_os/*` is included in the npm package.

The config reference controls and project template are currently test/review fixtures rather than
runtime package files.

There are 13 currently untracked files that would be included in the npm package if published from
this working tree:

- `target-research-platform/README.md`
- `target-research-platform/src/research_os/__init__.py`
- `target-research-platform/src/research_os/adapters.py`
- `target-research-platform/src/research_os/artifacts.py`
- `target-research-platform/src/research_os/evidence_workflow.py`
- `target-research-platform/src/research_os/geo.py`
- `target-research-platform/src/research_os/governance.py`
- `target-research-platform/src/research_os/literature.py`
- `target-research-platform/src/research_os/normalization.py`
- `target-research-platform/src/research_os/projects.py`
- `target-research-platform/src/research_os/terminology.py`
- `target-research-platform/src/research_os/transport.py`
- `target-research-platform/src/validators/evidence_gate.py`

These files must either be staged and committed as part of the reviewed payload or excluded from
the package before any publish command is run.

## Not Verified

- `make preflight` could not run because `make` is not installed in the current Windows runtime.
- `npm run release:check` was not re-run as one combined command after the long full test pass; its
  constituent commands were run individually and passed.
- No Git commit, tag, push, GitHub release, or npm publish was performed.
- No real terminology decision, medical claim, review approval, or claim ledger write was created.
- OpenTiny GenUI SDK packages were inspected but not integrated as runtime dependencies.

## Required Before Ship

1. Select the final release payload from the dirty working tree.
2. Confirm whether local planning evidence, architecture ADRs, target-platform tests, and config
   fixtures should be committed with the release or kept out of the release commit.
3. Stage only reviewed files.
4. Re-run at least `git diff --check`, `npm pack --dry-run`, and either full `npm run release:check`
   or the documented constituent gate set after staging.
5. Commit, tag, push, and publish only after the staged set matches the reviewed release payload.
