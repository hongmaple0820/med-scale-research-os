# MedSCALE Research OS Capability Gap Audit

Date: 2026-06-15

## Scope

Audit the upgraded SCALE Engine workflow in `E:\project\scale-engine` against the current medical research workflow in `E:\project\yixue-scale-engine`, focusing on capabilities that should strengthen MedSCALE Research OS rather than directly copying the previous workflow wholesale.

Commands and evidence checked:

- `scale setup --verify --pack full --json`
- `scale upgrade check --dir . --json`
- `scale upgrade plan --dir . --json`
- `scale ai-os doctor --dir . --json`
- `Get-Command gbrain codegraph graphify rtk scale bun uv python node`
- `Test-Path` checks for Agent Collaboration, Agent Loop, Prompt Studio, setup verification, and MCP modules.
- Local configs under `.scale/`, `mcp-configs/`, `src/cli/targetCommands.ts`, and the reference `CHANGELOG.md`.

## Executive Summary

MedSCALE Research OS already has the beginning of a medical research dashboard layer and target CLI primitives for manuscript, package, memory seed, and learning candidates. The biggest missing capabilities are not UI polish; they are the runtime trust layer around the workflow:

- gbrain/Memory Brain review now has seed/import primitives, native approve/reject/stale/restore audit transitions, 18766 read-only state mapping, and in-dashboard action buttons backed by the native CLI.
- CodeGraph/Graphify/RTK are configured in policy but are not fully available or initialized in the current environment.
- Agent collaboration planning and Agent Loop readiness from the upgraded workflow are not present as first-class source modules.
- The medical workflow has no dedicated setup doctor that fails closed on missing third-party capabilities.
- MCP and skills are still generic; there is no medical-specific skill/tool contract for literature evidence, clinical fact checking, package audit, memory curation, and manuscript quality review.
- AI OS evidence is stale and appears to point to the reference repo path, so it should not be trusted as current MedSCALE evidence.

## Capability Gaps

### 1. Source Upgrade Gap

Reference SCALE Engine is at the 0.50.x upgrade line, while this repository still reports package version `0.43.0`. The globally installed `scale` CLI is `0.50.3`, so the local source and available CLI are out of sync.

Missing in current source:

- `src/workflow/AgentCollaborationPlanner.ts`
- `src/workflow/AgentLoopReadiness.ts`
- `src/dashboard/spa/pages/prompts.js`

Impact for MedSCALE:

The dashboard can display an OS layer, but the underlying source does not yet provide upgraded 0.50-style planning, readiness scoring, prompt studio, handoff gates, or read-only plan preview as governed primitives.

### 2. Third-Party Runtime Gap

Environment check:

- `gbrain`: installed
- `graphify`: installed, but setup verification reports `needs-init`
- `codegraph`: missing
- `rtk`: missing
- `scale`: installed
- `bun`, `uv`, `python`, `node`: installed

`scale setup --verify --pack full --json` reports missing governed capabilities:

- `awesome-design-md`
- `ui-ux-pro-max`
- `rtk`
- `graphify`
- `codegraph`

Impact for MedSCALE:

The medical workflow cannot honestly present itself as having third-party memory, code intelligence, graph knowledge, command wrapping, and UI/design skills fully wired. These should be visible as readiness blockers or degraded signals in the MedSCALE dashboard and doctor command.

### 3. Memory Gap

Current memory config is external-first with `gbrain` before `scale-local`, `agentmemory` disabled, external writes disabled, and evidence required.

Existing target workflow has:

- Memory seed command path.
- Learning candidate command path.
- Package options for `--seed-memory`, `--settle-learning`, and `--ingest-memory-brain`.

Missing or partial MedSCALE capabilities:

- Provider recall surfaced inside the medical research flow.
- Rich 18766 Memory Brain review drawer with evidence diff, conflict/freshness score, and reviewer notes history. Basic approve/reject/stale/restore action controls are now present.
- Exportable memory review packets.
- Fact freshness and conflict scoring.
- Claim-to-evidence memory provenance.
- Medical-specific memory namespaces for PICO, trial, guideline, evidence table, manuscript decision, and contraindication notes.

Impact:

The workflow can write or stage memory-like artifacts, but it does not yet behave like a governed medical research memory system.

### 4. Skills Gap

`.scale/skills.json` defines generic domains such as UI, web research, browser automation, E2E, desktop automation, and external CLI.

Missing MedSCALE skill domains:

- Literature search strategy.
- PubMed/OpenAlex evidence triage.
- Clinical guideline comparison.
- Biostatistics and evidence grading.
- Medical fact check.
- Manuscript quality review.
- Package audit.
- Memory curator.
- Learning candidate reviewer.

Impact:

The product can say “quality / fact check / package audit / memory seed / learning candidate”, but the workflow does not yet bind those states to governed medical skills with required evidence artifacts.

### 5. MCP Gap

`mcp-configs/` includes general MCP configs such as context7, fetch, filesystem, github, memory, playwright, postgres, puppeteer, and sequential-thinking. `.scale/mcp-servers.yaml` is absent.

Missing MedSCALE MCP surface:

- Medical literature search/retrieval MCP route.
- Evidence manifest/query MCP route.
- Fact-check claim MCP route.
- Memory review MCP route.
- Package audit MCP route.
- Runtime MCP status/doctor output for the dashboard.

Impact:

MCP exists as an ecosystem folder, but the medical workflow has no first-class MCP contract that a researcher or agent can depend on.

### 6. CLI Gap

Current target CLI has:

- `analyze`
- `manuscript`
- `remember`
- `learn`
- `package`
- `status`
- `doctor`
- `dashboard`

Missing upgraded CLI commands:

- `target os-plan`
- `target prompt` or `target prompts`
- `target setup verify --json`
- `target agent plan --json`
- `target mcp doctor`
- `target memory review`
- `target token record/report`
- `target upgrade check`

Impact:

Important OS concepts are visible in the dashboard, but researchers do not yet have stable CLI affordances for inspecting, exporting, or verifying the same operating model.

### 7. Dashboard Gap

The current medical dashboard now has a MedSCALE Research OS view, but it is still a static-dashboard slice.

Missing upgraded dashboard capabilities:

- Prompt Studio page and templates as copy/download artifacts.
- Read-only Agent Collaboration JSON plan preview.
- Agent Loop readiness meter based on real runtime signals.
- Memory Brain review actions.
- Provider recall panel.
- Token/cost visibility.
- Knowledge/document previews.
- CodeGraph/Graphify evidence graph status.
- Auto-port/multi-project launch surface.

Impact:

The home card layer can show the intended research model, but it does not yet expose the operational controls a researcher would expect.

### 8. AI OS Evidence Gap

`scale ai-os doctor --dir . --json` reports warning status and stale benchmark evidence. Run history paths point to `E:\project\scale-engine\.scale\ai-os\runs\...`, not the MedSCALE repo path.

Impact:

MedSCALE should not reuse that evidence as current proof. It needs its own AI OS run, benchmark, and adoption evidence under this workspace.

### 9. Verification Gap

`.scale/verification.json` default profile focuses on Node build/lint/vitest checks. It does not include medical workflow Python tests or `target-research-platform` verification.

Missing verification coverage:

- Target Python pytest suite.
- Medical dashboard smoke.
- PubMed/OpenAlex enrichment tests.
- Memory seed and learning candidate tests.
- Package audit tests.
- Setup doctor third-party dependency tests.

Impact:

The medical workflow can regress while the default SCALE verification still passes.

### 10. Third-Party Governance Gap

`scale upgrade check` reports third-party policy in check-only mode, with multiple capabilities requiring manual review and one high-risk blocked entry.

Needs MedSCALE decision:

- Required: gbrain, graphify, codegraph, rtk, playwright/browser automation, fetch/search tools.
- Optional: design/UI enhancement skills.
- Blocked or excluded: high-risk desktop CUA unless explicitly approved for a medical workflow.

Impact:

The workflow needs a product-level allowlist/denylist, not just generic SCALE policy.

## Recommended Roadmap

### Phase 1: MedSCALE Setup Doctor

Add a MedSCALE-specific setup/doctor surface that reads setup verification and fails closed for required research capabilities:

- gbrain available and healthy enough for recall.
- Graphify installed and hooks initialized.
- CodeGraph CLI available or explicitly degraded.
- RTK available for command wrapping.
- PubMed/OpenAlex/search dependencies available.
- Python target tests discoverable.
- MCP configs present and validated.

### Phase 2: Medical Agent Collaboration Plan

Port the upgraded Agent Collaboration and Agent Loop ideas as MedSCALE primitives:

- `target os-plan --json`
- `target prompts`
- `/api/medical-research-os`
- Roles, handoffs, review gates, token reserve, termination criteria.
- Researcher-facing plan preview.

### Phase 3: Memory Brain Review

Promote memory seed and learning candidates into governed memory review:

- Approve/reject/stale/restore transitions. Completed in native CLI and audit records.
- Evidence packet export.
- Conflict/freshness scoring.
- Provider recall panel.
- Medical namespaces for evidence, guideline, trial, claim, manuscript, and package.

### Phase 4: Medical Skills And MCP

Add a medical skill/tool contract:

- Literature reviewer.
- Clinical fact checker.
- Evidence grader.
- Biostatistics reviewer.
- Manuscript reviewer.
- Package auditor.
- Memory curator.

Expose MCP/status hooks for literature search, fact checks, memory review, package audit, and evidence manifests.

### Phase 5: Researcher Dashboard Upgrade

Make the 18766 home card layer operational:

- Real readiness status instead of static cards.
- Prompt Studio-style templates.
- Quality/fact/package/memory/learning states.
- Token/cost and provider recall.
- Evidence graph and document previews.
- Clear degraded/blocked states for missing third-party capabilities.

## Immediate Native MedSCALE Actions To Consider

Use the native medical workflow entrypoints for current setup and status checks:

```powershell
npm run medscale -- doctor --json
npm run medscale -- setup --lang zh
npm run medscale -- setup --lang en
npm run medscale -- setup --json
npm run medscale -- os-plan --json
node dist/api/medscale.js setup --json
```

Third-party remediation remains explicit and should be reviewed before execution:

```powershell
graphify install --platform codex
graphify hook status
npm install -g @colbymchenry/codegraph
codegraph init -i
cargo install --git https://github.com/rtk-ai/rtk
rtk init -g --codex
```

Historical `scale setup` / `scale ai-os` commands are useful as reference evidence from the source workflow, but they are not the MedSCALE Research OS runtime entrypoint.

## 2026-06-15 Addendum: Native Medical Workflow Decision

After review, MedSCALE Research OS should not require the `scale` CLI or RTK as the medical workflow runtime. The product may still learn from the upgraded workflow concepts, but the medical workflow should run through native target-research-platform and MedSCALE entrypoints.

Updated interpretation:

- Required for base workflow: Python runtime, target-research-platform files, requirements, tests, dashboard/status layer.
- Enhanced but optional: gbrain, CodeGraph/Graphify, medical skills, MCP server maps, token/cost reporting.
- Missing optional capabilities should degrade readiness and produce researcher-facing next actions, not block the base medical workflow.
- CLI/user guidance should prefer native commands such as `medscale doctor`, `medscale os-plan --json`, `medscale dashboard`, or `npm run medscale -- <command>` during local development, rather than `scale target ...`.

## 2026-06-15 Addendum: Native Setup Planner

`medscale setup` now emits `medscale.setup_plan.v1` as a plan-only capability matrix with bilingual output and platform-aware install/verify commands for Windows, macOS, and Linux.

Current workspace state from `npm run --silent medscale -- setup --json`:

- Ready: native CLI, gbrain, Memory Brain review flow, Graphify, medical skills, MCP server map, PubMed/OpenAlex, package audit, medical workflow.
- Partial: token/cost ledger, CodeGraph, figure refs.
- Missing: agentmemory, RTK.
- Partial: npx visual installer, token/cost ledger, CodeGraph, figure refs.
- Planned: none in the setup capability matrix.

This changes the answer to the third-party capability question:

- Memory provider: gbrain is ready; agentmemory is not enabled.
- Memory Brain review: approve/reject/stale/restore is available through `medscale memory-review` and writes `.review.json/.review.md` audit records.
- RTK: not present and optional.
- Third-party skills: six MedSCALE medical domains are configured for literature review, fact check, evidence grading, statistical review, package audit, and memory curator.
- Code map/knowledge base: Graphify is ready, CodeGraph is partial.
- CLI: native `medscale` is ready.
- MCP: native MedSCALE server map is present for literature retrieval, fact checks, memory review, package audit, and evidence manifest query; live MCP health remains the next step.
- npx visual installation: `medscale setup --visual --lang zh|en` is implemented locally; public `npx -y` verification still depends on npm publication.
- Cross-platform support: setup plan now selects Windows or Unix install/verify commands and supports Chinese/English output.

## 2026-06-15 Addendum: Medical Skills And MCP Contracts

The workflow now includes:

- `.scale/skills.json` medical domains:
  - `medicalLiteratureReview`
  - `medicalFactCheck`
  - `medicalEvidenceGrading`
  - `medicalStatisticalReview`
  - `medicalPackageAudit`
  - `medicalMemoryCurator`
- `.scale/mcp-servers.yaml` route ids:
  - `medical-literature`
  - `medical-fact-check`
  - `medical-memory-review`
  - `medical-package-audit`
  - `medical-evidence-manifest`

Runtime readiness now checks these explicit contracts. Current `medscale doctor --json` reports:

```text
degraded 93
medical_skills pass SKILLS READY
mcp_surface pass MCP READY
```

## 2026-06-15 Addendum: Memory Brain Review Flow

Native MedSCALE now includes a review state machine for Memory Brain learning candidates:

- `medscale memory-review approve --candidate-id <id> --json`
- `medscale memory-review reject --candidate-id <id> --json`
- `medscale memory-review stale --candidate-id <id> --json`
- `medscale memory-review restore --candidate-id <id> --json`

Review actions write:

- `.scale/memory/learning-candidates/<candidate>.review.json`
- `.scale/memory/learning-candidates/<candidate>.review.md`

Behavior:

- `approve` promotes evidence-backed promotable candidates to active Memory Brain memory.
- `reject` marks the Memory Brain candidate node rejected.
- `stale` marks the candidate stale when evidence is superseded.
- `restore` returns stale/rejected candidates to candidate status for renewed review.
- Candidate and review JSON loading tolerates UTF-8 BOM files from Windows editors.

## 2026-06-15 Addendum: 18766 Memory Review Mapping

The 18766 dashboard now maps Memory Brain review records into the researcher view:

- `summary.delivery_readiness.learning_candidate.review_status`
- `review_ready`
- `review_path`
- `review_markdown_path`
- `reviewer`
- `review_node_status`
- `promoted`

The learning candidate card now distinguishes:

- `approved`: pass / approved / ready for future recall
- `rejected`: fail / excluded from long-term knowledge
- `stale`: warning / evidence needs update
- `restored`: warning / restored for another review cycle
- `pending`: no review record yet

The MedSCALE Research OS Memory Strategy panel uses the same state, so delivery readiness and OS loop readiness now agree.

18766 now also exposes approve/reject/stale/restore buttons on the learning candidate card. These buttons POST to `/api/memory-review`, which runs the existing `medscale memory-review` CLI with fixed action arguments and writes the same `.review.json/.review.md` audit records. Remaining gap: upgrade the simple prompt-based action flow into a richer review drawer with evidence diff and reviewer notes history.

## 2026-06-15 Addendum: Package Identity And First-Commit Readiness

The npm and documentation identity has been moved from the historical `scale-engine` package to the MedSCALE product package:

- Package name: `@hongmaple0820/med-scale-research-os`
- Repository: `hongmaple0820/med-scale-research-os`
- Published bin: `medscale`
- Product name: `MedSCALE Research OS`
- Chinese product name: `MedSCALE 医研操作系统`

The package manifest no longer exposes a published `scale` bin. Local historical source and compiled CLI internals may still exist in the repository because MedSCALE is being carved out of the upgraded workflow foundation, but researcher-facing docs and npm package metadata now route through `medscale`.

`npm pack --dry-run --json` now confirms the package contains the medical workflow kernel:

- Built CLI entrypoint: `dist/api/medscale.js`
- 18766 dashboard server and static assets.
- Target research platform scripts and Python source.
- MedSCALE medical skills: `.scale/skills.json`
- MedSCALE MCP map: `.scale/mcp-servers.yaml`
- Bilingual docs and quickstart.

Remaining release gaps:

- The package has not been published to npm, so `npx -y @hongmaple0820/med-scale-research-os ...` is still an unverified distribution channel even though the local `setup --visual` guide is implemented.
- The package intentionally includes the full `dist` tree for runtime compatibility. A later slimming pass should verify whether historical compiled CLI internals can be excluded without breaking `medscale` subcommands.
- The first Git commit and push to `hongmaple0820/med-scale-research-os.git` are still pending user approval.

## 2026-06-15 Addendum: Token And Cost Ledger

MedSCALE now has a native token/cost reporting surface:

- `medscale token record`
- `medscale token report`
- Shared ledger path: `.scale/model-usage/usage.jsonl`
- 18766 OS payload: `summary.medical_research_os.token_cost`
- Runtime Doctor card: `token_cost`

The report groups usage into medical lanes:

- literature review
- medical fact check
- package audit
- memory settlement
- agent review
- workflow

Current workspace state:

- `token-cost` setup capability is partial, not planned.
- Runtime Doctor reports `token_cost = warning / COST PENDING` because this workspace has no real model usage records yet.
- Artifact-level automatic ingestion is now available through `medscale token ingest` and successful `medscale package` runs.
- `medscale.usage_envelope.v1` now gives LLM-backed literature review and Agent cache artifacts a native provider/model/usage shape.
- The remaining gap is live provider coverage: fact check, package audit, agent review, and memory settlement should emit explicit provider usage when they call real external models.
- PubMed/OpenAlex retrieval, package audit, and figure-reference checks are now native doctor runtime cards rather than setup-only placeholders.
