# Summary: MedSCALE Research OS thin slice

## What Changed

- Designed the product/project name: **MedSCALE Research OS** / **MedSCALE 医研操作系统**.
- Added a native MedSCALE product layer to the medical dashboard status payload as `summary.medical_research_os`.
- Added idle-state support so the product layer appears even before a pipeline run.
- Mapped upgraded research OS concepts into medical workflow language:
  - Agent collaboration -> medical research team roles, handoffs, review gates.
  - Agent Loop readiness -> six medical readiness signals and readiness score.
  - Prompt Studio -> six medical prompt templates.
  - External memory -> memory seed and learning candidate strategy.
  - Native doctor -> medical workflow runtime readiness.
- Added a new 18766 homepage panel that renders MedSCALE Research OS status, roles, gates, memory strategy, prompt templates, and next migrations.
- Added Phase 1 runtime readiness as `summary.medical_runtime_readiness` and `summary.medical_research_os.runtime_readiness`.
- Added lightweight probes for third-party memory, CodeGraph/Graphify, CLI runtime, medical skills, MCP configs, and the target medical platform.
- Added the read-only `/api/medical-research-os` plan endpoint so dashboard and future CLI surfaces can share one OS plan packet.
- Added a 18766 homepage Runtime Doctor card that shows blocked/degraded runtime capabilities to researchers.
- Added `buildTargetRuntimeReadiness()` to the TypeScript target CLI and wired it into `target doctor --json`.
- Changed local `target doctor` readiness semantics so the medical workflow no longer depends on the `scale` CLI or RTK.
- Made CodeGraph/Graphify, gbrain, medical skills, and MCP server mapping visible as optional enhanced capabilities; missing optional capabilities now degrade readiness instead of blocking the medical workflow.
- Added `target os-plan --json`, backed by the dashboard's MedSCALE OS plan builder, so the same read-only collaboration plan can be exported from CLI without starting the web server.
- Added a native `medscale` CLI entrypoint and package bin that exposes medical workflow commands directly (`medscale doctor`, `medscale os-plan`, `medscale dashboard`, etc.) while leaving `scale` as a separate governance CLI.
- Added `npm run medscale -- ...` for local development without npm linking.
- Added `buildTargetSetupPlan()` and `medscale setup` as the native plan-only capability installer/readiness surface.
- Added `medscale.setup_plan.v1` JSON covering native CLI, npx visual installer, gbrain, agentmemory, Memory Brain review flow, RTK, CodeGraph, Graphify, medical skills, MCP server map, PubMed/OpenAlex, package audit, figure refs, token/cost, and the target medical workflow.
- Added bilingual `--lang zh|en` output and platform-aware install/verify command selection for Windows, macOS, and Linux.
- Kept setup explicit and safe: it reports commands and gaps, but does not auto-install third-party tools in this phase.
- Added six explicit MedSCALE medical skill domains in `.scale/skills.json`: literature review, fact check, evidence grading, statistical review, package audit, and memory curator.
- Added `.scale/mcp-servers.yaml` as the native MedSCALE MCP server map for medical literature retrieval, fact checks, memory review, package audit, and evidence manifest query.
- Tightened runtime doctor so `medical_skills` requires the six medical domains and `mcp_surface` requires the five MedSCALE route ids before reporting ready.
- Raised current runtime doctor score from `78` to `93`; `medical_skills` and `mcp_surface` now report `PASS`.
- Added native Memory Brain review flow for learning candidates:
  - `approve` promotes promotable candidates into active Memory Brain nodes.
  - `reject` marks the candidate memory node rejected.
  - `stale` marks the candidate memory node stale.
  - `restore` returns a stale/rejected candidate to candidate review state.
- Added `.review.json` and `.review.md` audit records next to learning candidate artifacts.
- Added `medscale memory-review <action> --candidate-id <id> --json`.
- Made Memory Brain candidate JSON reading tolerant of UTF-8 BOM files commonly produced by Windows editors.
- Moved `memory-brain-review` in setup readiness from planned to ready.
- Mapped Memory Brain `.review.json` audit records into the 18766 dashboard readiness payload and researcher cards.
- Added `review_status`, reviewer, review path, promoted state, and Memory review chips for learning candidates on the homepage.
- Synced MedSCALE Research OS Memory Strategy with `approved/rejected/stale/restored/pending` so the OS panel matches delivery readiness.
- Added `/api/memory-review` to submit approve/reject/stale/restore actions from 18766 through the native `medscale memory-review` CLI.
- Added learning candidate action buttons for approve, reject, stale, and restore; each action asks for a review reason and refreshes dashboard status after completion.
- Renamed package metadata to `@hongmaple0820/med-scale-research-os` and pointed repository, bugs, homepage, README, and quickstart docs at the new GitHub repo.
- Removed the published `scale` bin from package metadata so the package exposes `medscale` as the user-facing CLI.
- Added `target-research-platform`, MedSCALE `.scale/skills.json`, `.scale/mcp-servers.yaml`, `.scale/verification.json`, `mcp-configs`, and `docs/zh` to the npm package files list.
- Replaced the Chinese and English README front pages with MedSCALE Research OS quickstart, safety boundary, current capability state, dashboard workflow, and verification instructions.
- Added `medscale setup --visual --lang zh|en` as a local visual setup guide with copy commands, capability lanes, install queue, verify queue, and safety boundaries.
- Moved `npx-visual-installer` readiness from planned to partial: local visual setup is available, while public `npx -y` still depends on the first npm publish.
- Added `medscale token record/report` backed by `.scale/model-usage/usage.jsonl`, with medical lane grouping for literature review, fact check, package audit, memory settlement, agent review, and workflow usage.
- Added a `token_cost` Runtime Doctor card and `summary.medical_research_os.token_cost` for the 18766 Token / Cost panel.
- Moved `token-cost` setup readiness from planned to partial: the ledger and panel are wired, while this workspace still has no real medical usage records.
- Added `medscale token ingest` plus package-time artifact scanning for real provider usage fields in medical workflow JSON outputs.
- Kept token ingest conservative: it records explicit token fields only, skips business cost artifacts, and deduplicates repeated scans through source metadata.
- Added `medscale.usage_envelope.v1` for LLM-backed literature review and Agent cache usage evidence.
- Added usage summaries to manuscript metadata, fact-check reports, quality gates, and delivery manifests without duplicating raw usage envelopes into the package manifest.
- Upgraded `medscale token ingest` to deduplicate repeated usage envelopes by `usage_id`.
- Promoted PubMed/OpenAlex retrieval, package audit, and figure-reference checks into native Runtime Doctor cards.
- Allowed `target-research-platform/src/output` source modules into npm pack while keeping runtime output directories excluded.
- Added `scripts/workflow/medscale-release-smoke.mjs` as a MedSCALE-specific pre-publish smoke for package identity, built CLI setup/doctor, visual setup, usage envelope ingest, and npm pack contents.
- Added `npm run smoke:medscale-release` and `npm run release:medscale` so first-commit readiness can be checked without running the heavier generic SCALE setup smoke.
- Added release readiness notes: local delivery candidate is ready, while public release should run through GitHub Actions after `NPM_TOKEN` is configured and the first commit is pushed to `main`.
- Added backend and frontend contract tests.

## Files Touched

- `target-research-platform/src/dashboard/app.py`
- `target-research-platform/src/dashboard/static/index.html`
- `target-research-platform/src/output/usage_envelope.py`
- `target-research-platform/src/output/agent_llm_provider.py`
- `target-research-platform/src/output/literature_reviewer.py`
- `target-research-platform/src/output/manuscript_generator.py`
- `target-research-platform/src/output/manuscript_fact_checker.py`
- `target-research-platform/src/output/manuscript_quality.py`
- `target-research-platform/src/output/delivery_packager.py`
- `target-research-platform/.gitignore`
- `target-research-platform/tests/test_deliverables.py`
- `target-research-platform/tests/test_manuscript_enhanced.py`
- `target-research-platform/tests/test_delivery_manifest.py`
- `src/api/medscale.ts`
- `src/cli/targetCommands.ts`
- `scripts/workflow/medscale-release-smoke.mjs`
- `src/memory/MemoryBrain.ts`
- `src/memory/MemoryReview.ts`
- `src/memory/index.ts`
- `package.json`
- `package-lock.json`
- `README.md`
- `README.en.md`
- `docs/zh/quickstart.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.scale/verification.json`
- `.scale/skills.json`
- `.scale/mcp-servers.yaml`
- `tests/cli/targetCommands.test.ts`
- `tests/cli/medscaleCli.test.ts`
- `tests/memory/MemoryReview.test.ts`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/explore.md`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/plan.md`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/verification.md`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/release-readiness.md`
- `.planning/tasks/2026-06-15-medical-workflow-upgrade/capability-gap-audit.md`

## Product Direction

Recommended name: **MedSCALE Research OS**.

Positioning: a native evidence-driven medical research operating layer that coordinates research agents, quality gates, fact checking, delivery package audit, optional third-party memory, and learning candidate review without requiring the scale CLI as the runtime entrypoint.

## Follow-up Migration Candidates

- Publish the renamed npm package and verify `npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh` on Windows, macOS, and Linux.
- Add medical prompt templates to a first-class Prompt Studio API.
- Extend runtime readiness to include PubMed/OpenAlex, package audit, and figure-reference checks.
- Wire automatic `medscale token record` calls into literature review, Agent review, fact checking, and memory settlement execution paths.
- Add a richer Memory Brain review drawer with evidence diff, conflict/freshness score, and reviewer notes history.

## Current Capability State

Latest `medscale setup --json` on this workspace reports:

- Ready: native CLI, gbrain, Memory Brain review flow, Graphify, medical skills, MCP server map, PubMed/OpenAlex, package audit, figure refs, medical workflow.
- Partial: npx visual installer, token/cost ledger, CodeGraph.
- Missing: agentmemory, RTK.
- Planned: none in the setup capability matrix.

Latest 18766 dashboard slice now reads Memory Brain review records and can submit approve/stale/rejected/restored actions from the learning candidate card. Delivery readiness and the MedSCALE OS Memory Strategy panel share the same review state.

Latest package identity slice reports:

- package name: `@hongmaple0820/med-scale-research-os`
- published bin: `medscale`
- repository: `https://github.com/hongmaple0820/med-scale-research-os`
- npm pack includes `target-research-platform/main.py`, `target-research-platform/src/dashboard/app.py`, `target-research-platform/src/output/usage_envelope.py`, `scripts/workflow/medscale-release-smoke.mjs`, `.scale/skills.json`, and `.scale/mcp-servers.yaml`
- MedSCALE release smoke reports `medscale.release_smoke.v1` with `status = passed`.
- `npm publish --dry-run --registry=https://registry.npmjs.org` passes with no runtime output, no Python bytecode caches, and package entry count `1104`.
- Actual npm publish is delegated to GitHub Actions via `.github/workflows/publish.yml`; GitHub release is blocked by missing `NPM_TOKEN` verification and the unorganized first commit.
