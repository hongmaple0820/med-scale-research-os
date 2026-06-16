# Engineering Standards Governance

SCALE treats project engineering rules as executable standards, not only agent instructions.

## Problem

Agents often complete the visible task while leaving behind engineering debt:

- ad-hoc debug logs in business code
- sensitive fields written to logs
- hardcoded secrets, tokens, or credentials
- raw SQL or ORM bypasses
- unsafe HTML sinks and injection risks
- empty catch blocks and type suppressions
- framework conventions ignored
- architecture boundaries bypassed
- test, integration, deployment, and release rigor skipped

These failures are hard to catch with prompt text alone. They need repeatable checks, task evidence, and release gates.

## Source Of Truth

`.scale/engineering-standards.json` defines project rules for:

- source directories
- ignored directories
- approved console/logging exceptions
- sensitive fields that must be redacted
- maximum source file size
- architecture layering checks
- warning rules that should be promoted to blocking findings

`.scale/frameworks.json` records project-specific framework, ORM, UI, and architecture conventions.
It can also declare framework or ORM imports that are not allowed:

```json
{
  "lastReviewedAt": "2026-05-15",
  "reviewIntervalDays": 90,
  "bannedImports": [
    {
      "source": "@legacy/orm",
      "replacement": "@/infrastructure/db",
      "reason": "Use the repository boundary instead of direct ORM access.",
      "severity": "fail"
    }
  ]
}
```

When `lastReviewedAt` is older than `reviewIntervalDays`, `standards doctor` emits a warning so module architecture and framework decisions are reviewed instead of drifting silently.

## Commands

```bash
scale standards scan --json
scale standards doctor --json
scale standards settle --task-id <task-id> --artifact-dir docs/worklog/tasks/<task>
scale preflight --preflight-profile full --json
scale verify <task-id> --json
```

`standards scan` reports findings without changing files.

`standards doctor` exits non-zero when blocking findings exist.

`standards settle` appends the final settlement evidence to `standards-impact.md`.

`scale hunt scan` reuses the same standards findings as a readonly proactive hunt queue. It can create diagnostic-loop input through `scale hunt diagnose <finding-id>` and can suppress accepted debt with `scale hunt ignore <finding-id> --reason "..."`. See [BACKGROUND_HUNTER.md](BACKGROUND_HUNTER.md).

`scale dependency audit` adds the supply-chain side of `G7 Security`. It audits lockfile-scoped packages for install scripts, bin scripts, deprecated packages, dynamic code execution, shell execution, and suspicious network access. See [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md).

`ActiveRedTeam` and `VisualGate` add optional dynamic verification for projects that can provide a runnable HTTP target and structured visual evidence. They are disabled unless explicitly configured. See [ACTIVE_SECURITY_VISUAL_GATES.md](ACTIVE_SECURITY_VISUAL_GATES.md).

`Evolution Shadow Mode` turns repeated gate failures into evidence-backed defects and keeps new rules in shadow mode until they have enough hits, defect evidence, rollback, and approval. See [EVOLUTION_SHADOW_MODE.md](EVOLUTION_SHADOW_MODE.md).

`scale preflight` and `scale verify` consume `.scale/verification.json`:

```json
{
  "policy": {
    "engineeringStandardsGate": "block"
  }
}
```

Supported modes:

- `off`: skip engineering standards during verification.
- `warn`: report standards findings without blocking completion.
- `block`: fail preflight or task verification when standards doctor is not OK.

## Default Blocking Rules

The first implementation blocks clear production risks:

- sensitive data in logs
- hardcoded secret-like assignments
- dynamically constructed SQL
- unsafe HTML sinks such as `innerHTML`
- dynamic code execution
- empty catch blocks
- `@ts-ignore`
- `Math.random()` for security tokens

It warns on maintainability risks:

- ad-hoc console/output logging outside approved CLI/script paths across JS/TS, Go, Python, Java, C#, and Rust
- `any` type escapes
- large source files
- direct outer-layer imports of persistence internals

Projects can ratchet warning rules into blocking rules without changing SCALE code:

```json
{
  "blockingRules": [
    "ad-hoc-console-log",
    "type-escape"
  ]
}
```

Use this after the current baseline is clean enough that the stricter rule will not block every task.

For intentional framework/runtime probes, use evidence-pattern exceptions instead of suppressing an entire file. This keeps unrelated new findings visible:

```json
{
  "allowedFindingPatterns": [
    {
      "ruleId": "ad-hoc-console-log",
      "path": "src/capabilities/InstalledSkillsIntegration.ts",
      "evidencePattern": "python3 -c .*print\\(",
      "reason": "Embedded command probes the local Python runtime."
    }
  ]
}
```

Baselines can be file-wide or line-specific. Prefer line-specific entries when suppressing legacy findings so a new violation in the same file is still visible:

```json
{
  "baselineFindings": [
    {
      "ruleId": "empty-catch",
      "path": "src/legacy/old.ts",
      "line": 42,
      "reason": "Legacy debt tracked in a dedicated hardening task."
    }
  ]
}
```

## Finish Rule

Before M/L/CRITICAL work is reported complete:

1. Run standards scan.
2. Run standards doctor.
3. Fix blocking findings or explicitly document the exception.
4. Update `standards-impact.md`.
5. Promote durable framework or architecture decisions into maintained standards docs.

When `engineeringStandardsGate` is `block`, `scale verify` updates `standards-impact.md` and prevents task completion until blocking findings are fixed or baselined with a clear reason.
