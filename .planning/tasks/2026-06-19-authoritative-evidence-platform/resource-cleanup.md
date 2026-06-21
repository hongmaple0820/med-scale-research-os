# Resource Cleanup - 2026-06-19-authoritative-evidence-platform

Date: 2026-06-21
Level: CRITICAL

## New Resources

| Resource | Location | Keep / Move / Delete | Reason |
| --- | --- | --- | --- |
| Task evidence | `.planning/tasks/2026-06-18-multi-source-evidence-gates/` | Keep | Prior task evidence for the evidence-gate line of work. |
| Task evidence | `.planning/tasks/2026-06-19-authoritative-evidence-platform/` | Keep | CRITICAL task plan, verification, review, readiness, and summary evidence. |
| Architecture documents | `docs/architecture/` | Keep | Promoted architecture, audit, and ADR records for the authoritative evidence platform. |
| Target platform source | `target-research-platform/src/research_os/` | Keep | Release payload for governed source acquisition, artifacts, evidence workflow, terminology, literature, and project admission. |
| Dashboard GenUI workbench | `target-research-platform/src/dashboard/` | Keep | Release payload for local GenUI-style review cards, action drafts, and confirmations. |
| Target platform tests | `target-research-platform/tests/` | Keep | Regression evidence for the target platform and newly admitted workflows. |
| Reference controls and templates | `target-research-platform/config/` | Keep | Deterministic test/review fixtures; not currently included in the npm package. |
| Local compound todos | `.context/compound-engineering/todos/` | Keep local | Backlog/work-queue files, not part of the release payload. |
| Temporary smoke files | `.tmp-*` | Delete | Local scratch files; already removed before release staging. |

## Docs Promotion

- Promote to `docs/`:
  - `docs/architecture/MEDSCALE_AUTHORITATIVE_EVIDENCE_PLATFORM_V2.md`
  - `docs/architecture/MEDICAL_AI_GUIDE_EVIDENCE_AUDIT_2026-06-19.md`
  - `docs/architecture/adr/0001-local-first-deterministic-research-execution.md`
  - `docs/architecture/adr/0002-immutable-three-layer-provenance.md`
  - `docs/architecture/adr/0003-late-integration-evidence-matrix.md`
  - `docs/architecture/adr/0004-mandatory-human-approval-state-machine.md`
  - `docs/architecture/adr/0005-whitelist-adapter-admission-and-controls.md`
  - `docs/architecture/adr/0006-terminology-retrieval-and-evidence-methodology.md`
- Keep in `.planning/`:
  - All task-scoped explore, plan, verification, review, summary, readiness, and cleanup records.
- Keep local under `.context/`:
  - `.context/compound-engineering/todos/*`
- Delete before handoff:
  - None remaining; root `.tmp-*` scratch files were removed.

## Package Boundary

`npm pack --dry-run --json` confirmed that planning evidence, architecture documents, target
platform tests, and target platform config fixtures are not included in the npm package. The npm
package includes the target platform runtime source under `target-research-platform/src/`, including
the new `research_os` package and `validators/evidence_gate.py`.
