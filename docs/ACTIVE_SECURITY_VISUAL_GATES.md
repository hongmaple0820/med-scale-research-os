# Active Security And Visual Gates

SCALE V2 adds two optional verification layers for projects that can provide a runnable local target:

- `ActiveRedTeam`: bounded dynamic security probes for configured HTTP targets.
- `VisualGate`: structured visual review evidence for UI routes and UI specs.

Both are conditional. A library or backend project with no runtime target should not pay the cost.

## Active Security

Active security is configured under `.scale/verification.json`:

```json
{
  "security": {
    "active": {
      "enabled": true,
      "baseUrl": "http://localhost:3000",
      "startCommand": "npm run dev",
      "targets": ["/api/login", "/api/users"],
      "timeoutMs": 5000,
      "maxRequests": 20
    }
  }
}
```

Behavior:

- missing or disabled config returns `SKIPPED`
- invalid enabled config returns `FAILED` before sending probes
- probes are capped by `maxRequests`
- every request has a timeout
- reflected probe payloads are `HIGH` findings and block
- request errors and server errors are recorded as findings, but only configured blocker severity should fail the gate

The first implementation exposes `runActiveRedTeam()` as a library API. It does not start a server by itself yet. CLI orchestration can wire `startCommand` later, but startup failure must become a `FAILED` result when that runner is added.

## Visual Gate

Visual verification is configured under `.scale/verification.json`:

```json
{
  "visual": {
    "enabled": true,
    "baseUrl": "http://localhost:5173",
    "specPath": "docs/ui/UI-SPEC.md",
    "routes": ["/", "/settings"],
    "reportPath": "docs/worklog/tasks/TASK-123/visual-report.json",
    "blockingSeverities": ["critical", "high"]
  }
}
```

`VisualGate` consumes a structured report:

```json
{
  "screenshots": [
    { "route": "/", "path": "screenshots/home.png" }
  ],
  "findings": [
    {
      "severity": "high",
      "route": "/",
      "message": "Primary action overlaps the navigation bar.",
      "evidence": "overlap ratio 0.42"
    }
  ]
}
```

Behavior:

- missing or disabled config passes with a `Visual gate skipped` evidence item
- enabled config requires `baseUrl`, `specPath`, `routes`, and `reportPath`
- missing or invalid visual report fails
- default blockers are `critical` and `high`
- VLM comments may be recorded in the report, but the gate blocks only on structured severity thresholds

## Gate Numbering

`VisualGate` uses `G9` when explicitly registered. It is not registered by default because meta governance also uses the G9-G15 range. Projects should register it only in UI verification profiles or dedicated task flows.

Active security remains a security sub-check instead of a fractional gate number. It belongs under the broader G7 security lifecycle when wired into a concrete workflow.
