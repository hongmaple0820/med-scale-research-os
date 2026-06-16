# Resource Governance

SCALE now treats project outputs as governed resources instead of undifferentiated files.

## Problem

Engineering agents generate many useful but noisy assets:

- maintained product and architecture docs
- task plans and verification notes
- E2E reports, screenshots, videos, logs, and coverage output
- temporary scripts and scratch files
- reusable automation scripts
- API contracts and ADRs

Without lifecycle rules these files drift, conflict with the real codebase, or get committed to Git when they should be local evidence only.

## Model

`scale assets scan` classifies resources into:

| Type | Default Git policy | Lifecycle |
| --- | --- | --- |
| canonical-doc | commit | maintained |
| decision-record | commit | immutable |
| contract | commit | maintained |
| reusable-script | commit | maintained |
| task-artifact | review | task-scoped |
| evidence-report | ignore | generated |
| generated-media | review/external | generated or review-required |
| temporary | ignore | temporary |

`.scale/resource-policy.json` owns defaults such as owners, module mapping, runtime directories, and maximum Git file size.

`.scale/assets.json` is the explicit catalog for long-lived project assets and source-of-truth declarations.
Declared source-of-truth assets are checked by `assets doctor`; if the file disappears, the doctor fails. Maintained assets can also declare `lastReviewedAt` and `reviewIntervalDays` so product, architecture, workflow, and standards documents are rechecked against the current implementation instead of drifting silently:

```json
{
  "assets": [
    {
      "path": "docs/modules/auth/architecture.md",
      "type": "canonical-doc",
      "owner": "auth-team",
      "module": "auth",
      "sourceOfTruth": true,
      "lifecycle": "maintained",
      "gitPolicy": "commit",
      "lastReviewedAt": "2026-05-15",
      "reviewIntervalDays": 90
    }
  ]
}
```

## Commands

```bash
scale assets scan --json
scale assets doctor --json
scale assets settle --task-id <task-id> --artifact-dir .planning/tasks/<task>
scale init --governance-pack resource-governance
```

`assets doctor` fails when runtime evidence or external media is already tracked by Git, or when a declared source-of-truth asset is missing. It warns on large tracked files, expired temporary outputs, ownerless canonical documentation, missing non-source catalog entries, and stale maintained assets.

`assets settle` runs the same checks and appends a settlement section to `resource-impact.md` when a task artifact directory is provided.

## Finish Rule

Before finishing M/L/CRITICAL work:

1. Promote final product, API, or architecture truth into maintained docs.
2. Keep task-scoped planning, runtime contracts, reality checks, cleanup notes, raw reports, logs, screenshots, videos, and scratch scripts out of long-lived `docs/` unless deliberately promoted.
3. Run `scale assets scan --json`.
4. Run `scale assets doctor --json`.
5. Run `scale assets settle --task-id <task-id> --artifact-dir <task-dir>`.
6. Delete or archive temporary resources that are no longer needed.

## Task Artifact Boundary

New SCALE task artifacts default to `.planning/tasks/<task>/`, not `docs/worklog/tasks/<task>/`.

Every M/L/CRITICAL task should keep these three evidence files alongside the normal explore/plan/verification/review/summary set:

| File | Purpose |
| --- | --- |
| `runtime.md` | Records configuration source, topology, auth mode, and verification boundary. |
| `reality-check.md` | Separates confirmed behavior from not verified, stub/partial, credential-gated, and environment-gated claims. |
| `resource-cleanup.md` | Records which outputs stay task-scoped, which are promoted, and which should be deleted or archived. |

`docs/worklog/tasks/` remains a legacy-recognized task-artifact location for existing projects, but generated guidance now points new work to `.planning/tasks/`.
