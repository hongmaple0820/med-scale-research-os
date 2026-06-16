# Plan: MedSCALE Research OS thin slice

## Scope

Implement the first native MedSCALE product layer in the medical research workflow dashboard.

## Deliverables

1. Backend status payload
   - Add `summary.medical_research_os`.
   - Include product name, migration source, operating model, readiness score, medical agent team, prompt templates, memory strategy, and next migration steps.
   - Ensure idle status also includes this product layer.

2. Frontend 18766 homepage
   - Add a `MedSCALE Research OS` panel above delivery readiness.
   - Show score, mode, research team roles, review gates, prompt templates, memory state, and next upgrade steps.
   - Keep it read-only and researcher-oriented.

3. Tests
   - Extend dashboard backend status tests for `summary.medical_research_os`.
   - Add frontend contract checks for the new panel and renderer.

4. Verification
   - Run focused pytest suite for dashboard/delivery.
   - Run diff whitespace check.
   - If time allows, smoke `/api/status` and homepage render on 18766 or an ephemeral port.

## Phase 1 Extension: Runtime Readiness

1. Backend runtime doctor packet
   - Add `summary.medical_runtime_readiness`.
   - Probe third-party memory, CodeGraph/Graphify, native Python runtime, medical skills, MCP configs, and target platform files.
   - Keep probes lightweight and non-blocking for page refresh; do not run heavyweight setup verification inside `/api/status`.

2. Frontend researcher view
   - Add a Runtime Doctor card to the MedSCALE Research OS panel.
   - Show blocked/degraded/ready state, score, missing required signals, and per-capability details.

3. Shared OS plan
   - Expose `/api/medical-research-os` as a read-only JSON plan packet for future CLI and Prompt Studio reuse.
   - Add `target os-plan --json` to export the same plan without starting the dashboard server.

4. Target CLI doctor
   - Add a reusable TypeScript runtime readiness builder.
   - Wire it into `target doctor --json`.
   - Fail closed only when the native medical platform or Python runtime is missing.
   - Treat CodeGraph/Graphify, gbrain, medical skills, MCP server maps, and other third-party integrations as enhanced capabilities that degrade readiness but do not block the base medical workflow.

## Phase 1.1: Remove Scale Runtime Dependency

- Do not require the `scale` CLI or RTK for medical workflow readiness.
- Replace `scale target ...` user guidance with native `target-research-platform` or local source entrypoints.
- Keep MedSCALE as the product name, but make runtime language independent from SCALE Engine upgrade/source terminology.

## Phase 1.2: Native MedSCALE CLI

- Add a `medscale` package bin that points at a dedicated medical workflow CLI entrypoint.
- Expose medical commands directly as `medscale doctor`, `medscale os-plan`, `medscale dashboard`, `medscale analyze`, and related workflow commands.
- Keep `medscale target ...` as a compatibility alias only; the main user path should not require a `scale target` prefix.
- Add local development support through `npm run medscale -- <command>`.

## Phase 1.3: Native Setup And Capability Plan

- Add `medscale setup` as a plan-only installer/readiness surface for the medical workflow OS.
- Show current capability state for native CLI, npx visual installer, gbrain, agentmemory, Memory Brain review flow, RTK, CodeGraph, Graphify, medical skills, MCP server map, PubMed/OpenAlex, package audit, figure refs, token/cost, and the target medical workflow.
- Support `--lang zh|en` and platform-aware command selection for Windows, macOS, and Linux.
- Emit `medscale.setup_plan.v1` JSON for future dashboard, package installer, and release automation reuse.
- Keep third-party install actions explicit; do not auto-install system tools in this phase.

## Phase 1.4: Medical Skills And MCP Contracts

- Promote medical skills from generic governance to six explicit MedSCALE domains:
  - literature review
  - fact check
  - evidence grading
  - statistical review
  - package audit
  - memory curator
- Add `.scale/mcp-servers.yaml` as the native MedSCALE server map for:
  - medical literature retrieval
  - medical fact checking
  - memory review
  - package audit
  - evidence manifest query
- Make runtime doctor check for the actual medical skill domains and MCP route ids, not just generic config presence.
- Keep live MCP server health and gate binding as the next phase.

## Phase 1.5: Memory Brain Review Flow

- Add native Memory Brain review transitions for learning candidates:
  - approve
  - reject
  - stale
  - restore
- Write review audit records beside each learning candidate as `.review.json` and `.review.md`.
- On approve, promote evidence-backed candidates into active Memory Brain nodes through the existing MemoryBrain promotion path.
- On reject/stale/restore, update the Memory Brain node status while preserving candidate evidence and review history.
- Expose the workflow through `medscale memory-review <action> --candidate-id <id> --json`.
- Keep 18766 reviewer UI mapping as the next dashboard step.

## Phase 1.6: 18766 Memory Review Mapping

- Map Memory Brain `.review.json` audit records into `summary.delivery_readiness.learning_candidate`.
- Surface `approved`, `rejected`, `stale`, `restored`, and `pending` in the researcher-facing learning candidate card.
- Add a Memory review chip on the 18766 homepage card layer.
- Sync MedSCALE Research OS Memory Strategy with the same review state so the OS panel and delivery readiness cards agree.
- Add `/api/memory-review` as an explicit POST action endpoint that calls the native `medscale memory-review` CLI without shell string execution.
- Add 18766 learning candidate buttons for approve, reject, stale, and restore, with a required reviewer reason prompt before submission.

## Phase 1.7: Package Identity And First-Commit Readiness

- Rename npm package metadata from `@hongmaple0820/scale-engine` to `@hongmaple0820/med-scale-research-os`.
- Point repository, bugs, homepage, README, and quickstart docs at `hongmaple0820/med-scale-research-os`.
- Publish only the `medscale` binary from package metadata; keep historical `scale` internals as implementation code, not the MedSCALE user entrypoint.
- Include `target-research-platform`, MedSCALE skill contracts, MCP server map, and Chinese quickstart in the package `files` list.
- Verify `npm pack --dry-run` includes the medical Python kernel and excludes target output/log directories.

## Phase 1.8: Visual Setup Guide

- Make `medscale setup --visual --lang zh|en` a real local entrypoint instead of a planned placeholder.
- Render a researcher-facing setup guide with copy commands, capability lanes, install queue, verify queue, and safety boundaries.
- Keep the flow plan-only: it must not auto-install third-party tools or mutate system state.
- Report `npx-visual-installer` as partial until the renamed npm package is published and verified through `npx -y`.
- Add focused CLI tests for the visual setup output contract.

## Phase 1.9: Token And Cost Ledger

- Add `medscale token record` and `medscale token report` as native medical workflow commands backed by `.scale/model-usage/usage.jsonl`.
- Reuse the existing model usage ledger rather than creating a separate MedSCALE-only store.
- Add medical lane grouping for literature review, fact check, package audit, memory settlement, agent review, and workflow usage.
- Add a `token_cost` Runtime Doctor card and move setup readiness from planned to partial/ready.
- Surface `summary.medical_research_os.token_cost` and the 18766 Token / Cost card.
- Keep missing usage records as a warning/degraded signal, not a blocker for the base medical workflow.

## Phase 1.10: Artifact Token Usage Ingest

- Add `medscale token ingest` to scan medical workflow JSON artifacts for real provider usage fields.
- Only ingest artifacts that expose model token fields such as `usage.input_tokens`, `output_tokens`, or cache-token fields.
- Do not infer model usage from business cost fields such as package audit cost estimates.
- Deduplicate artifact ingestion with stable source metadata so repeated package runs do not inflate ledger totals.
- Run artifact ingestion automatically after successful `medscale package`, while keeping missing usage as a warning rather than a delivery blocker.

## Phase 1.11: Native Usage Envelope And Doctor Deep Checks

- Add `medscale.usage_envelope.v1` as the native model usage/evidence shape for medical workflow artifacts.
- Emit usage envelopes from LLM-backed literature review and Agent cache reviews when provider usage is available.
- Summarize usage in manuscript metadata, fact-check reports, quality gates, and delivery manifests without duplicating raw token records.
- Upgrade `medscale token ingest` to deduplicate repeated envelopes by `usage_id` across artifacts.
- Promote PubMed/OpenAlex retrieval, package audit, and figure-reference checks into native doctor runtime cards.

## Phase 1.12: MedSCALE Release Smoke

- Add a MedSCALE-specific release smoke that runs against the built `medscale` CLI without installing third-party tools.
- Verify package identity, single `medscale` bin, repository URL, setup JSON, visual setup, doctor cards, usage envelope ingest, and npm pack contents.
- Keep smoke writes isolated to a temporary directory so workspace token/cost ledgers are not modified.
- Include the smoke script in npm pack so published users can inspect or rerun the release checklist.
- Add `smoke:medscale-release` and `release:medscale` npm scripts for first-commit and pre-publish readiness.

## Risks

- The existing repo has many untracked files; keep edits scoped and do not touch caches/logs.
- The dashboard is currently a static HTML file with some mojibake in PowerShell output; edit UTF-8 carefully.
- Any future TypeScript orchestration should remain an optional wrapper around the native medical workflow, not a required `scale` runtime dependency.

## Rollback

Revert only these touched files:

- `target-research-platform/src/dashboard/app.py`
- `target-research-platform/src/dashboard/static/index.html`
- `target-research-platform/tests/test_deliverables.py`
- `src/api/medscale.ts`
- `src/cli/targetCommands.ts`
- `src/memory/MemoryBrain.ts`
- `src/memory/MemoryReview.ts`
- `src/memory/index.ts`
- `tests/cli/targetCommands.test.ts`
- `tests/cli/medscaleCli.test.ts`
- `tests/memory/MemoryReview.test.ts`
- `scripts/workflow/medscale-release-smoke.mjs`
- `package.json`
- `.scale/skills.json`
- `.scale/mcp-servers.yaml`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/*`
