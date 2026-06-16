# SCALE Tool Orchestration Product Plan

Status: review draft
Owner: engineering governance
Date: 2026-05-15

## 1. Product Positioning

SCALE should become an executable engineering governance engine for human plus agent delivery. It should not be a large prompt pack. Its value is to make agent behavior observable, governable, repeatable, and measurable across single repositories, monorepos, polyrepos, submodule workspaces, and MOE-style multi-repository engineering environments.

The next product milestone is Tool Orchestration Governance: SCALE detects task intent, selects the right skills, MCP servers, browser automation tools, desktop automation tools, and external CLIs, executes or requires them through a governed path, stores evidence, and blocks delivery when required evidence is missing.

## 2. Core Users

| User | Need | Success Signal |
| --- | --- | --- |
| Human owner | Keep agents aligned with engineering standards and branch rules | The owner can review evidence instead of reading long chat logs |
| Coding agent | Know which workflow, tools, and standards apply to the task | The agent receives a short executable plan and knows the next command |
| Reviewer | Verify that code, docs, tests, resources, and tool evidence match the task | Review output is severity-ranked and file-scoped |
| Release manager | Prevent unsafe ship in dirty MOE or submodule workspaces | `scale ship` blocks unreviewed, dirty, or unpushed child work |
| Platform maintainer | Improve governance rules over time without adding noise | Repeated failures become reviewed rules, tests, or template updates |

## 3. Problems To Solve

1. Agents can ignore project standards, framework rules, logging/redaction policy, ORM conventions, and UI/UX expectations unless those rules are executable.
2. Skills, MCP servers, and external CLIs are often listed in documentation but not actively selected, executed, or evidenced.
3. Browser, E2E, desktop automation, and external-agent reviews are useful but can introduce security and side-effect risks without policy controls.
4. Large projects generate many assets: canonical docs, task artifacts, temporary reports, screenshots, videos, scripts, generated media, ADRs, and contracts. Without lifecycle rules, the repository becomes noisy and stale.
5. MOE-style workspaces can hide dirty or unpushed child repositories behind a clean root repository.
6. Self-evolution can create low-quality rules if every lesson is promoted automatically without review and regression tests.

## 4. Product Goals

1. Make tool choice explicit and auditable for M/L/CRITICAL work.
2. Convert skill recommendations into executable tool plans with evidence.
3. Make UI/UX, browser, E2E, desktop, external CLI, security, standards, and resource-governance checks first-class workflow domains.
4. Keep S-level work lightweight.
5. Preserve existing engineering velocity by providing concise summaries before full JSON reports.
6. Make generated governance packs reusable through `scale init`.
7. Turn repeated delivery failures into reviewed improvements to rules, templates, scripts, or tests.

## 5. Non-Goals

1. Do not replace Codex, Claude Code, Gemini CLI, OpenCode, Playwright, or MCP tools.
2. Do not execute destructive desktop or browser actions without explicit policy and confirmation.
3. Do not require all projects to use every skill or MCP server.
4. Do not commit temporary evidence, screenshots, videos, or generated reports unless resource policy marks them as retained.
5. Do not auto-promote self-evolution lessons into blocking rules without review.

## 6. Product Capabilities

### 6.1 Intent-Aware Tool Plan

SCALE should classify each task into domains:

- UI/UX design
- web research
- browser automation
- E2E testing
- desktop automation
- external CLI or external agent review
- API or contract design
- database or migration work
- security-sensitive work
- documentation and ADR work
- resource governance
- engineering standards
- release and ship

For each domain, SCALE generates:

- required skills
- recommended skills
- required MCP or CLI capabilities
- required artifacts
- required verification evidence
- safety boundaries
- fallback if a tool is unavailable

### 6.2 Governed Tool Execution

SCALE should support three execution modes:

| Mode | Behavior | Use Case |
| --- | --- | --- |
| advisory | Generate tool plan and warnings only | S-level or early adoption |
| evidence-required | Do not block tool absence, but block missing evidence for required domains | default M/L work |
| block | Required tool or evidence failure blocks verify/review/ship | CRITICAL or mature teams |

### 6.3 Evidence Ledger

Every governed tool run records:

- task id
- domain
- tool name and version
- command or MCP tool id
- sanitized input summary
- output path or summary
- exit code or tool status
- duration
- safety policy applied
- redaction status
- artifact paths

### 6.4 UI/UX Quality Gate

For frontend work, SCALE should require:

- Mini-PRD with target user and core scenario
- UI spec with information architecture, interaction states, responsive breakpoints, and accessibility notes
- design skill evidence from `frontend-design`, `ui-ux-pro-max`, or equivalent local skill
- browser screenshot evidence
- console and network checks
- visual review findings

### 6.5 Web, Browser, And Desktop Automation

SCALE should combine:

- `web-access` for source-driven web lookup and citations
- `agent-browser` for browser automation, network evidence, screenshots, auth-safe sessions, allowlists, and action policies
- Chrome DevTools MCP for console, network, DOM, and performance inspection
- Playwright or webapp-testing for repeatable E2E flows
- CUA or desktop automation only under strict policy, with screenshot evidence and side-effect boundaries

### 6.6 Engineering Standards Gate

SCALE should enforce language and framework profiles:

- TypeScript/React: no unsafe `any`, no uncontrolled console output, component boundaries, accessibility, state management conventions
- Java/Spring: logging redaction, controller/service/repository layering, transaction boundaries, ORM conventions, exception handling
- Go/go-zero: explicit error handling, API contracts, middleware boundaries, structured logging
- Python/FastAPI: type hints, dependency injection conventions, security headers, test coverage

### 6.7 Resource Governance

SCALE should classify every generated asset:

| Asset | Default Lifecycle | Default Git Policy |
| --- | --- | --- |
| canonical module docs | maintained | commit |
| ADR | immutable | commit |
| API contract | maintained | commit |
| task artifact | task-scoped | review |
| E2E report | temporary | ignore |
| screenshot/video evidence | generated | ignore or external |
| reusable script | maintained | commit |
| temporary script | temporary | ignore |
| baseline/debt report | reviewed | review |

### 6.8 Self-Evolution

The product loop should be:

Defect -> Lesson -> Candidate rule -> Human review -> Rule/template/script/test -> Regression verification -> Governance pack update.

Self-evolution is useful only when it produces stable, tested improvements. It should not create noisy rules from one-off failures.

## 7. User Flows

### Flow A: New Project Governance Init

1. User runs `scale init --governance-pack <pack>`.
2. SCALE detects stack, topology, tools, and existing docs.
3. SCALE generates minimal governance files, service matrix, skills policy, standards policy, resource policy, and workflow README.
4. SCALE runs `scale doctor` and prints a concise setup status.

Acceptance criteria:

- Existing project files are not overwritten without drift notes.
- Generated docs explain ownership and update triggers.
- Missing tools are warnings unless the selected pack marks them required.

### Flow B: M-Level Feature Task

1. User runs `scale task new`.
2. SCALE creates task artifacts and classifies intent.
3. SCALE generates `skill-plan.md`.
4. Agent executes implementation.
5. SCALE verifies tests, standards, resource impact, browser/UI evidence if applicable.
6. SCALE review records findings.
7. SCALE ship stages only reviewed files.

Acceptance criteria:

- Required artifacts cannot remain placeholders.
- Verification evidence cites real commands and exit codes.
- Ship blocks unreviewed files and dirty child repositories.

### Flow C: UI Feature

1. Mini-PRD and UI spec are created.
2. Design skills produce design direction and implementation constraints.
3. Browser automation captures screenshots, console logs, and network evidence.
4. Visual review records layout, accessibility, responsive, and design-system findings.

Acceptance criteria:

- At least desktop and mobile screenshots exist.
- Console errors are either fixed or listed as residual risk.
- UI text does not overlap or clip in reviewed viewports.

### Flow D: MOE Workspace Ship

1. SCALE resolves `.scale/workspace.json`.
2. Root and child repositories are inspected.
3. Dirty, ahead, or no-upstream child repositories become blockers according to finish policy.
4. Only reviewed root files are staged.

Acceptance criteria:

- A clean root cannot hide dirty child repositories.
- User receives a short `workspace finish --summary` path before full JSON.

## 8. Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Tool evidence completeness | Required tool evidence present for M/L/CRITICAL tasks | >= 90% after 10 tasks |
| First-pass verification rate | First full verification succeeds | baseline first, then improve |
| Review escape rate | Issues found after review/ship | trend down |
| Workflow bypass count | M/L tasks shipped outside governed path | trend to 0 |
| Resource noise count | Temporary/generated files tracked by mistake | trend to 0 |
| Standards regression count | New blocking standards findings introduced | trend to 0 |
| Self-evolution precision | Reviewed candidate rules accepted | >= 60% after tuning |

## 9. Release Slices

| Slice | Product Outcome |
| --- | --- |
| P0 Tool plan enforcement | M/L tasks produce skill/tool plans and evidence requirements |
| P1 Tool execution ledger | Tool runs are recorded with redacted evidence |
| P2 Browser/UI evidence gate | UI and browser tasks have screenshots, console, and network proof |
| P3 Standards profiles | Java/Go/React profiles catch framework and logging issues |
| P4 Resource settle | Task completion classifies docs, reports, media, and scripts |
| P5 Self-evolution review loop | Failures become reviewed governance improvements |

## 10. Open Review Questions

1. Should `evidence-required` become the default for all M tasks immediately, or should mature projects opt in?
2. Which tools are mandatory in the default pack: `web-access`, `agent-browser`, Playwright, Chrome DevTools MCP, or only a subset?
3. Should desktop automation be disabled by default unless a project explicitly enables it?
4. Should evidence files be committed, ignored, or exported outside Git by default?
5. Should self-evolution rule promotion require one human approval or two independent task failures?
