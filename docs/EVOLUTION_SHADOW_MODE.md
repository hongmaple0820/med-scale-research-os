# Evolution Shadow Mode

SCALE V2 keeps self-evolution useful without letting one-off failures become hard blockers too early.

## Flow

```text
Gate Failure
  -> Defect
  -> Lesson
  -> Proposed Rule
  -> Shadow Rule
  -> Candidate Hook
  -> Approved Blocking Hook
```

## Gate Failure To Defect

`GateSystem` emits `gate.failed` for failed gate results. `AutoDefectCreator` tracks consecutive failures per session and gate stage.

Default behavior:

- three consecutive failures create one `Defect`
- a passing `gate.executed` event resets the streak
- defect payload uses `rootCauseCategory=gate_failure`
- the original blockers, evidence, evidence record id, stage, and streak count are stored in defect context

This is evidence capture only. It does not change source code or generate a hook.

## Rule Maturity

New rules start in `shadow` mode. Shadow rules can record hits, but they do not block development.

Promotion requires:

- shadow hits >= 10
- at least one defect evidence id
- rollback method present
- false positive rate within threshold
- explicit approval before a blocking hook is allowed

`RuleMaturity` exposes:

- `createShadowRuleMaturity`
- `recordShadowHit`
- `evaluateRulePromotion`
- `approveRuleMaturity`

## Hook Boundary

`HookGenerator` still requires `rule.approved === true`.

For V2 rules that carry maturity metadata, it also requires:

```text
rule.maturity.stage === "approved-blocking"
```

That means proposed or shadow rules can be observed and improved, but cannot become blocking hooks until explicitly promoted.

## Current Scope

This release slice wires the core library path and gate events. CLI approval commands and persistent rule-maturity storage can be added later without changing the safety model.
