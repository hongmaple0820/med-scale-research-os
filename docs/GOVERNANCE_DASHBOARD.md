# Governance Dashboard

Status: implemented baseline
Since: v0.25 development branch

Governance Dashboard turns existing SCALE evidence into a single reviewable HTML page. It does not replace Markdown, JSON, runtime evidence, eval records, or memory. It is a human-facing view over those sources.

## Command

```bash
scale artifact dashboard
scale artifact dashboard --task-id <task-id>
scale artifact dashboard --dir /path/to/project
scale artifact dashboard --output docs/worklog/tasks/<task-id>/artifacts/governance-dashboard.html
scale artifact dashboard --json
```

Default output:

```text
.scale/reports/governance-dashboard.html
.scale/reports/governance-dashboard-manifest.json
```

The default lifecycle is `generated-report` and the default Git policy is `ignore`. Promote or commit only dashboards that are intentionally used as reviewed task evidence or release evidence.

When `--dir` is used and `SCALE_DIR` is not set, the default `.scale` directory is resolved inside the target project directory, not inside the shell's current working directory. This matters for scaffold and multi-repo validation runs.

## Inputs

The dashboard reads existing local evidence:

| Area | Source |
| --- | --- |
| Runtime evidence | `.scale/evidence/runtime/` |
| Workflow eval | `.scale/evals/runs/` and `.scale/evals/failures/` |
| Workflow metrics | `.scale/metrics/tasks.jsonl` |
| Gate evidence | `.scale/evidence/GATE-*.json` |
| Command runs | `.scale/evidence/command-runs/` |
| Model usage | `.scale/model-usage/usage.jsonl` |
| Memory Brain | `.scale/memory/brain.sqlite` |
| Resource Governance | workspace files plus `.scale/resource-policy.json` and `.scale/assets.json` |
| HTML artifacts | task artifact manifests and rendered HTML files |

## Aggregated Metrics

V2.0 adds `MetricsAggregator` as the dashboard aggregation layer. It keeps the dashboard read-only and derives the following metrics from existing evidence:

- recent task count and first-pass rate
- average fix iterations
- gate failure distribution
- command output compression token savings
- model usage and prompt-cache savings

Each number must trace back to local JSON/JSONL evidence. If a source is absent, the dashboard reports zero rather than inventing values.

You can inspect the same model-usage ledger directly without opening the HTML dashboard:

```bash
scale token report --since-days 7
scale token report --day 2026-05-23 --json
```

## Status Model

- Runtime evidence failures are blocking.
- Memory contradictions are blocking.
- Resource Governance failures are blocking.
- Open eval failure replays are warnings, because they may be intentional baseline failures or pending improvement work.
- Missing task HTML artifacts are informational.

This keeps the dashboard useful as a review surface without turning every observation into a hard gate.

## Recommended Use

For M/L/CRITICAL work:

```bash
scale verify <task-id>
scale eval run --suite workflow-baseline
scale memory dream --json
scale artifact dashboard --task-id <task-id>
```

For release review:

```bash
scale artifact dashboard
scale artifact open --artifact-dir .scale/reports --type governance-dashboard --print-only
```

The dashboard should be attached to a release or PR only when it is deliberately selected as a review artifact. Routine generated dashboards should stay local.
