# Background Hunter

Background Hunter is the readonly proactive scan layer for SCALE Engine V2.
It turns existing governance signals into an actionable hunt queue without editing application code.

## Boundary

Default behavior is intentionally conservative:

- scan only, no automatic code changes
- no automatic LLM repair
- no automatic commit or pull request
- no release bypass
- ignore decisions are explicit and written to `.scale/hunt/ignored-findings.json`

The hunter reuses existing checks instead of creating a second rule system. The first implementation consumes:

- `EngineeringStandards`
- `ReviewAnalyzer` when status and diff input are provided by callers

## Commands

```bash
scale hunt scan
scale hunt scan --json
scale hunt report
scale hunt diagnose <finding-id>
scale hunt ignore <finding-id> --reason "Accepted legacy debt tracked elsewhere"
```

`hunt scan` and `hunt report` do not modify source files. They classify findings as `open` or `ignored`.

`hunt diagnose <finding-id>` creates a normal `DiagnosticLoop` from the finding. This keeps the debugging workflow evidence-first:

- reproducible command
- expected failure
- changed files
- verification commands
- hypotheses and cleanup checklist

`hunt ignore` records the finding id and stable fingerprint. The same finding will remain visible in the report as `ignored`, but it is removed from the open queue.

## Finding Identity

Every finding gets:

- `id`: short deterministic SHA-256 id derived from the fingerprint
- `fingerprint`: stable source/rule/path/line/message tuple
- `source`: currently `engineering-standards` or `review-analyzer`
- `diagnosticInput`: ready-to-use `DiagnosticLoopInput`

This allows repeated scans to avoid noisy duplicates and lets teams explicitly accept or defer known debt.

## Recommended Flow

1. Run `scale hunt scan --json`.
2. Triage open findings.
3. For real issues, run `scale hunt diagnose <finding-id> --json`.
4. Fix through the normal plan/TDD/verify workflow.
5. For accepted legacy debt, run `scale hunt ignore <finding-id> --reason "..."`

Do not promote Background Hunter to automatic repair until the project has enough evidence that its findings are stable and low-noise.
