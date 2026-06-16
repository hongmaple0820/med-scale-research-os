# Verification: MedSCALE Research OS thin slice

Date: 2026-06-15

## Commands Run

### Focused dashboard and delivery tests

Command:

```powershell
python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py
```

Working directory:

```text
E:\project\yixue-scale-engine\target-research-platform
```

Result:

```text
33 passed in 5.09s
```

### 18766 Memory review mapping tests

Command:

```powershell
python -m pytest tests/test_deliverables.py
```

Working directory:

```text
E:\project\yixue-scale-engine\target-research-platform
```

Result:

```text
22 passed in 4.28s
```

Notes:

- The first attempt was run from `E:\project\yixue-scale-engine` and failed during collection because Python imported the repository-root `src` namespace instead of `target-research-platform/src`. Rerunning from `target-research-platform` passed.
- Coverage added for Memory Brain `.review.json` records mapping into `summary.delivery_readiness.learning_candidate`, researcher cards, MedSCALE OS Memory Strategy, and the approved/rejected/stale/restored card state branches.

### 18766 Memory review action endpoint and buttons

Command:

```powershell
python -m pytest tests/test_deliverables.py
```

Working directory:

```text
E:\project\yixue-scale-engine\target-research-platform
```

Result:

```text
24 passed in 4.15s
```

Coverage added:

- `/api/memory-review` POST endpoint.
- DashboardState wrapper around the native `medscale memory-review` CLI.
- Frontend contract for approve/reject/stale/restore action buttons.
- HTTP endpoint smoke with mocked CLI output.

### 18766 homepage inline script syntax

Command:

```powershell
node -e "const fs=require('fs'); const html=fs.readFileSync('target-research-platform/src/dashboard/static/index.html','utf8'); const match=html.match(/<script[^>]*>([\s\S]*?)<\/script>/); if(!match) throw new Error('script block missing'); new Function(match[1]); console.log('inline dashboard script ok');"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
inline dashboard script ok
```

Additional module script syntax check:

```powershell
node --check <temporary-dashboard-module.js>
```

Result: passed with no syntax errors after replacing the static import line with a stub for syntax-only checking.

### 18766 Memory review render smoke

Command: Playwright Chromium render against `http://127.0.0.1:18766/`.

Result:

```text
{'title': 'MedSCALE 医研操作系统', 'cards': 5, 'memory_review_buttons': 4, 'page_errors': [], 'screenshot': 'E:\\project\\yixue-scale-engine\\target-research-platform\\output\\dashboard_runtime\\medscale-memory-review-actions.png'}
```

The dashboard server was restarted on port `18766`; active listener PID after restart: `4996`.

### MedSCALE runtime readiness smoke

Command:

```powershell
@'
from pathlib import Path
from src.dashboard.app import DashboardState
state = DashboardState(Path.cwd()).load_status()
runtime = state['summary']['medical_runtime_readiness']
print(runtime['status'], runtime['score'])
for card in runtime['cards']:
    print(card['id'], card['state'], card['status_label'])
'@ | python -
```

Working directory:

```text
E:\project\yixue-scale-engine\target-research-platform
```

Result:

```text
degraded 78
third_party_memory pass GBRAIN READY
code_intelligence warning CODEGRAPH OPTIONAL
cli_runtime pass PYTHON READY
medical_skills warning MEDICAL DOMAINS MISSING
mcp_surface warning MCP PARTIAL
medical_workflow pass WORKFLOW READY
```

### Target CLI runtime doctor unit test

Command:

```powershell
npm test -- tests/memory/MemoryReview.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
3 files passed; 21 tests passed
```

### TypeScript typecheck and build

Commands:

```powershell
npm run typecheck
npm run build
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: both passed.

### Native `medscale setup` unit and smoke tests

Covered by:

```powershell
npm test -- tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
```

Additional smoke commands:

```powershell
npm run --silent medscale -- setup --lang en
npm run --silent medscale -- setup --json
node dist/api/medscale.js setup --json
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
medscale.setup_plan.v1
MedSCALE Research OS
degraded ready=10 partial=3 missing=2 planned=0
native-cli ready
npx-visual-installer partial
gbrain ready
agentmemory missing
memory-brain-review ready
rtk missing
graphify ready
codegraph partial
medical-skills ready
mcp-server-map ready
pubmed-openalex ready
package-audit ready
figure-refs ready
token-cost partial
medical-workflow ready
```

The built entrypoint also returned:

```text
medscale.setup_plan.v1
degraded
npx -y @hongmaple0820/med-scale-research-os setup --lang zh
```

### Package identity and npm pack smoke

Commands:

```powershell
npm install --package-lock-only --ignore-scripts
npm run typecheck
npm run build
npm run --silent medscale -- setup --json | python -c "import json,sys; d=json.load(sys.stdin); cap={c['id']:c for c in d['capabilities']}; print(d['schema']); print(d['product']); print(d['status']); print(d['commands']['visual']); print(cap['native-cli']['status']); print(cap['npx-visual-installer']['status'])"
node -e "const p=require('./package.json'); console.log(p.name); console.log(Object.keys(p.bin).join(',')); console.log(p.repository.url)"
npm pack --dry-run --json | python -c "import json,sys; p=json.load(sys.stdin)[0]; files={f['path'] for f in p['files']}; keys=['dist/api/medscale.js','README.md','README.en.md','docs/zh/quickstart.md','target-research-platform/main.py','target-research-platform/src/dashboard/app.py','target-research-platform/src/dashboard/static/index.html','target-research-platform/src/output/usage_envelope.py','.scale/skills.json','.scale/mcp-servers.yaml']; print(p['name']); print(p['entryCount']); [print(k, k in files) for k in keys]; print('has_output_log', any(x.startswith('output/') for x in files)); print('has_target_output', any(x.startswith('target-research-platform/output/') for x in files))"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
@hongmaple0820/med-scale-research-os
medscale
git+https://github.com/hongmaple0820/med-scale-research-os.git

medscale.setup_plan.v1
MedSCALE Research OS
degraded
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
ready
partial

@hongmaple0820/med-scale-research-os
1123
dist/api/medscale.js True
README.md True
README.en.md True
docs/zh/quickstart.md True
target-research-platform/main.py True
target-research-platform/src/dashboard/app.py True
target-research-platform/src/dashboard/static/index.html True
target-research-platform/src/output/usage_envelope.py True
.scale/skills.json True
.scale/mcp-servers.yaml True
has_output_log False
has_target_output False
```

Notes:

- `package.json` and `package-lock.json` now use the scoped package identity `@hongmaple0820/med-scale-research-os`.
- The published bin exposes only `medscale`; the historical `scale` bin is no longer advertised by package metadata.
- `npm pack --dry-run` includes the MedSCALE dashboard, native medical output modules, skills, MCP map, docs, and built `dist/api/medscale.js`, while excluding runtime output folders.
- The package still includes the whole `dist` tree for current runtime compatibility; a later package-slimming pass can reduce historical CLI internals once dependency boundaries are audited.

### Visual setup guide smoke

Commands:

```powershell
npm test -- tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts tests/memory/MemoryReview.test.ts
npm run typecheck
npm run build
npm run --silent medscale -- setup --visual --lang en | Select-Object -First 60
npm run --silent medscale -- setup --json | python -c "import json,sys; d=json.load(sys.stdin); cap={c['id']:c for c in d['capabilities']}; print(d['schema']); print(d['product']); print(d['status']); print(cap['npx-visual-installer']['status']); print(d['commands']['visual'])"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
3 test files passed; 21 tests passed
typecheck passed
build passed

MedSCALE Research OS Visual Setup Guide
Workspace: E:\project\yixue-scale-engine
Platform: windows
Status: degraded | ready=10 partial=3 missing=2 planned=0
Copy commands
Capability lanes
Install queue
Verify queue
Safety boundary

medscale.setup_plan.v1
MedSCALE Research OS
degraded
partial
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
```

Notes:

- `setup --visual` is plan-only and does not install third-party tools.
- `npx-visual-installer` is now partial: the local visual guide is implemented, while public `npx -y` verification waits for the first npm publish.

### Token/cost ledger and 18766 panel

Commands:

```powershell
npm test -- tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts tests/memory/MemoryReview.test.ts
npm run typecheck
npm run build
python -m pytest tests/test_deliverables.py
npm run --silent medscale -- token report --json | python -c "import json,sys; d=json.load(sys.stdin); print(d['schema']); print(d['status']); print(d['summary']['totalRecords']); print(d['usagePath'])"
npm run --silent medscale -- setup --json | python -c "import json,sys; d=json.load(sys.stdin); cap={c['id']:c for c in d['capabilities']}; runtime={c['id']:c for c in d['runtimeReadiness']['cards']}; print(d['schema']); print(d['status']); print('ready', d['summary']['ready'], 'partial', d['summary']['partial'], 'missing', d['summary']['missing'], 'planned', d['summary']['planned']); print('token-cost', cap['token-cost']['status']); print('runtime-token', runtime['token_cost']['state'], runtime['token_cost']['statusLabel'])"
npm pack --dry-run --json | python -c "import json,sys; p=json.load(sys.stdin)[0]; files={f['path'] for f in p['files']}; keys=['dist/api/medscale.js','dist/cli/targetCommands.js','target-research-platform/src/dashboard/app.py','target-research-platform/src/dashboard/static/index.html','README.md','README.en.md','docs/zh/quickstart.md']; print(p['name']); print(p['entryCount']); [print(k, k in files) for k in keys]; print('has_output_log', any(x.startswith('output/') for x in files)); print('has_target_output', any(x.startswith('target-research-platform/output/') for x in files))"
```

Temporary smoke:

```powershell
medscale token record --dir <tmp> --provider anthropic --model claude-sonnet-4 --task-id literature-review-smoke --medical-lane literature --usage-file <tmp>\usage.json --estimated-cost-usd 0.123 --timestamp 2026-06-15T10:00:00.000Z --json
medscale token report --dir <tmp> --json
```

Result:

```text
3 test files passed; 26 tests passed
typecheck passed
build passed
target-research-platform tests/test_deliverables.py: 25 passed

medscale.token_cost.v1
pending
0
E:\project\yixue-scale-engine\.scale\model-usage\usage.jsonl

medscale.setup_plan.v1
degraded
ready 10 partial 3 missing 2 planned 0
token-cost partial
runtime-token warning COST PENDING

@hongmaple0820/med-scale-research-os
1123
dist/api/medscale.js True
dist/cli/targetCommands.js True
target-research-platform/src/dashboard/app.py True
target-research-platform/src/dashboard/static/index.html True
target-research-platform/src/output/usage_envelope.py True
README.md True
README.en.md True
docs/zh/quickstart.md True
has_output_log False
has_target_output False

anthropic
1200
300
literature
medscale.token_cost.v1
ready
1
literature
1200
```

Notes:

- The temporary `token record -> token report` smoke used a throwaway directory and did not write to the workspace ledger.
- `--usage-file` now tolerates UTF-8 BOM input from Windows PowerShell, matching the Memory Brain candidate BOM hardening.
- Current workspace token/cost status is pending because no real model usage records have been written yet.
- Artifact-level token usage ingest is now wired through `medscale token ingest` and the package command. It only records explicit model token fields and skips package/business cost fields.

18766 browser smoke after restarting the dashboard on `http://127.0.0.1:18766`:

```text
token_schema=medscale.token_cost.v1
token_status=pending
runtime_has_token=True
title=靶点研究平台 — 医学研究工作台
has_token_cost_card=True
has_cost_pending=True
page_errors=[]
screenshot=E:\project\yixue-scale-engine\target-research-platform\output\dashboard_runtime\medscale-token-cost-panel.png
```

### Token/cost artifact ingest

Commands:

```powershell
npm test -- tests/cli/targetCommands.test.ts
npm run --silent medscale -- token ingest --dir <tmp> --file <tmp>\fact_check_usage.json --json
npm run --silent medscale -- token ingest --dir <tmp> --file <tmp>\fact_check_usage.json --json
npm run --silent medscale -- token ingest --dir <tmp> --file <tmp>\package_audit_cost.json --provider anthropic --json
```

Result:

```text
tests/cli/targetCommands.test.ts: 21 passed

medscale.token_ingest.v1
ready
recorded 1
duplicates 0
lane fact_check
tokens 590
ledger 1

medscale.token_ingest.v1
ready
recorded 0
duplicates 1
ledger 1

medscale.token_ingest.v1
pending
recorded 0
sources 0
ledger 0
```

Covered behavior:

- `medscale token ingest` is exposed under the native token command surface.
- Real artifact usage payloads with `usage.input_tokens`, `usage.output_tokens`, cache token fields, provider, model, and optional `estimated_cost_usd` are recorded into `.scale/model-usage/usage.jsonl`.
- Re-ingesting the same artifact is deduplicated by stable source metadata and does not inflate token/cost totals.
- Business cost-only JSON artifacts such as package audit cost estimates are ignored unless they also contain explicit model token fields.

### Native usage envelope and doctor deep checks

Commands:

```powershell
python -m py_compile src/output/usage_envelope.py src/output/agent_llm_provider.py src/output/literature_reviewer.py src/output/manuscript_generator.py src/output/manuscript_fact_checker.py src/output/manuscript_quality.py src/output/delivery_packager.py
python -m pytest tests/test_manuscript_enhanced.py tests/test_delivery_manifest.py tests/test_manuscript_fact_check.py tests/test_manuscript_quality.py tests/test_deliverables.py -q
npm test -- tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts tests/memory/MemoryReview.test.ts
npm run typecheck
npm run build
npm run --silent medscale -- token ingest --dir <tmp> --file "<tmp>\meta.json,<tmp>\manifest.json" --json
npm run --silent medscale -- setup --json
npm pack --dry-run --json
```

Working directories:

```text
E:\project\yixue-scale-engine\target-research-platform
E:\project\yixue-scale-engine
```

Result:

```text
py_compile passed
target-research-platform focused suite: 49 passed
Vitest CLI/memory suite: 3 files passed, 26 tests passed
typecheck passed
build passed

medscale.token_ingest.v1
ready
recorded 1
duplicates 1
records 1
tokens 780

medscale.setup_plan.v1
degraded
ready 10 partial 3 missing 2 planned 0
medical_retrieval pass RETRIEVAL READY
package_audit pass AUDIT READY
figure_refs pass FIGURES READY
token_cost warning COST PENDING
pubmed-openalex ready
package-audit ready
figure-refs ready
token-cost partial

@hongmaple0820/med-scale-research-os
1123
dist/api/medscale.js True
dist/cli/targetCommands.js True
target-research-platform/src/output/usage_envelope.py True
target-research-platform/src/output/literature_reviewer.py True
README.md True
README.en.md True
docs/zh/quickstart.md True
has_output_log False
has_target_output False
```

Full target-research-platform pytest:

```powershell
python -m pytest -q
```

Result: 176 passed, 3 failed, 7 warnings. The failures are existing external/fixture integration cases, not from the manuscript output changes:

- `tests/test_api_integration.py::TestOpenTargetsConnectivity::test_egfr_druggability`: response no longer contains `unique_drugs`.
- `tests/test_api_integration.py::TestClinicalTrialsConnectivity::test_egfr_trials`: returned `total_count = 0`, expected `> 10`.
- `tests/test_pipeline_integration.py::TestStage2PipelineIntegration::test_de_analysis_called`: fixture disease `test cancer` cannot map to a TCGA project code, so Stage 2 reports `success = false`.

Covered behavior:

- `medscale.usage_envelope.v1` is emitted for LLM-backed and Agent-cache literature review usage evidence.
- Manuscript metadata, fact-check reports, quality reports, and delivery manifests now carry normalized usage summaries.
- `medscale token ingest` deduplicates repeated envelopes by `usage_id`, including repeated copies across artifact files.
- Runtime Doctor now includes native PubMed/OpenAlex retrieval, package audit, and figure-reference readiness cards.
- `target-research-platform/.gitignore` keeps runtime `output/` ignored while allowing source modules under `src/output/` into npm pack.

### MedSCALE release smoke

Commands:

```powershell
npm run release:medscale
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
typecheck passed
Vitest CLI/memory suite: 3 files passed, 26 tests passed
build passed
medscale.release_smoke.v1 passed
npm pack entryCount 1104
```

The release smoke covered:

- package identity `@hongmaple0820/med-scale-research-os`
- package bin exposes only `medscale`
- repository URL points at `hongmaple0820/med-scale-research-os`
- built entrypoint `node dist/api/medscale.js`
- `medscale setup --json`
- `medscale setup --visual --lang en`
- `medscale setup --visual --lang zh`
- `medscale doctor --json`
- temporary usage envelope ingest with `recorded = 1`, `duplicates = 1`, `totalTokens = 780`
- `npm pack --dry-run --json` includes `scripts/workflow/medscale-release-smoke.mjs`, `target-research-platform/src/output/usage_envelope.py`, excludes runtime `output/` directories, and rejects Python bytecode caches.

### Publish dry-run and runtime audit

Commands:

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org
npm publish --dry-run --json --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm view @hongmaple0820/med-scale-research-os version --json
git status --short
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
npm audit --omit=dev: found 0 vulnerabilities
npm publish --dry-run: package dry-run succeeded, entryCount 1104, size 1758695, unpackedSize 8298392
usage_envelope included: True
release_smoke included: True
pycache_count: 0
pyc_count: 0
runtime_output: False
npm whoami: ENEEDAUTH, this machine is not logged in to npmjs.org
npm view package: E404, package is not currently visible on npmjs.org
git status entries: 1234
current branch: master
remote: https://github.com/hongmaple0820/med-scale-research-os.git
git log: no commits yet
```

Notes:

- `npm audit fix --omit=dev --registry=https://registry.npmjs.org` upgraded the runtime lockfile to safe production dependency versions; a follow-up `npm install --include=dev --registry=https://registry.npmjs.org` restored local dev dependencies before rerunning `npm run release:medscale`.
- Full dev audit still reports dev-only vulnerabilities after reinstalling dev dependencies; production/runtime audit with `--omit=dev` is clean.
- Actual npm publish is blocked until `npm adduser --registry=https://registry.npmjs.org` or equivalent token auth is configured and the command is run against the official npm registry rather than the current default `npmmirror`.
- GitHub delivery is blocked until the first commit is organized and pushed; this repository currently has no commits on `master`.

### Memory Brain review flow

Commands:

```powershell
npm test -- tests/memory/MemoryReview.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
npm run --silent medscale -- memory-review --help
```

Result:

```text
MemoryReview tests covered approve, reject, stale, restore, non-promotable approval blocking, redaction, and BOM-prefixed candidate JSON.
medscale memory-review help exposed: approve, reject, stale, restore.
```

Additional real CLI smoke used a temporary project with a generated learning candidate and ran:

```powershell
npm run --silent medscale -- memory-review approve --dir <tmp> --candidate-id MLC-medical-smoke --reviewer smoke --reason "quality passed" --json
```

Result:

```text
True approved active True
<tmp>\.scale\memory\learning-candidates\MLC-medical-smoke.review.json
```

### Medical skills and MCP contract validation

Commands:

```powershell
node -e "JSON.parse(require('fs').readFileSync('.scale/skills.json','utf8')); console.log('skills-json-ok')"
node -e "const fs=require('fs'); const yaml=require('js-yaml'); const d=yaml.load(fs.readFileSync('.scale/mcp-servers.yaml','utf8')); console.log(d.product); console.log(d.servers.length); console.log(d.routes['medical-literature'].config)"
npm run --silent medscale -- doctor --json | python -c "import sys,json; d=json.load(sys.stdin); print(d['runtimeReadiness']['status'], d['runtimeReadiness']['score']); [print(c['id'], c['state'], c['statusLabel']) for c in d['runtimeReadiness']['cards']]"
```

Result:

```text
skills-json-ok
MedSCALE Research OS
5
mcp-configs/fetch/config.json

degraded 93
third_party_memory pass GBRAIN READY
code_intelligence warning CODEGRAPH OPTIONAL
cli_runtime pass PYTHON READY
medical_skills pass SKILLS READY
mcp_surface pass MCP READY
medical_workflow pass WORKFLOW READY
```

### Local source `target doctor --json` smoke

Command:

```powershell
npx tsx src/api/cli.ts target doctor --json
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: exited `0`. JSON included `ok = true`, `runtimeReadiness.status = "degraded"`, `score = 78`, `code_intelligence = warning / CODEGRAPH OPTIONAL`, `cli_runtime = pass / PYTHON READY`, and `requiredMissing = []`.

### Native `medscale doctor --json` smoke

Command:

```powershell
npm run medscale -- doctor --json
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: exited `0`. JSON included `ok = true`, `runtimeReadiness.status = "degraded"`, `score = 78`, and `requiredMissing = []`.
Result: exited `0`. JSON included `ok = true`, `runtimeReadiness.status = "degraded"`, `score = 78`, `code_intelligence = warning / CODEGRAPH OPTIONAL`, `cli_runtime = pass / PYTHON READY`, and `requiredMissing = []`.

### Local source `target os-plan --json` smoke

Command:

```powershell
npx tsx src/api/cli.ts target os-plan --json | python -c "import json,sys; p=json.load(sys.stdin); print(p['schema']); print(p['product']['name']); print(p['runtime_readiness']['status'], p['runtime_readiness']['score']); print(len(p['prompt_studio']['templates']))"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
medscale.research_os.plan.v1
MedSCALE Research OS
degraded 78
6
```

### Native `medscale os-plan --json` smoke

Commands:

```powershell
npm run --silent medscale -- os-plan --json | python -c "import json,sys; p=json.load(sys.stdin); print(p['schema']); print(p['product']['name']); print(p['runtime_readiness']['status'], p['runtime_readiness']['score'])"
node dist/api/medscale.js os-plan --json | python -c "import json,sys; p=json.load(sys.stdin); print(p['schema']); print(p['product']['name']); print(p['runtime_readiness']['status'], p['runtime_readiness']['score'])"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
medscale.research_os.plan.v1
MedSCALE Research OS
degraded 78
```

Note: the first attempt used `npm run medscale -- os-plan --json | python ...` without `--silent`; it failed JSON parsing because npm printed its script banner before the command JSON. The command itself was rerun successfully with `--silent`, and the built `node dist/api/medscale.js` entrypoint also passed.

### Whitespace check

Command:

```powershell
git diff --check -- target-research-platform/src/dashboard/app.py target-research-platform/src/dashboard/static/index.html target-research-platform/tests/test_deliverables.py .planning/tasks/2026-06-15-medical-workflow-upgrade/explore.md .planning/tasks/2026-06-15-medical-workflow-upgrade/plan.md
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: passed, no output.

Because the current worktree reports the touched paths as untracked, an additional direct trailing-whitespace scan was run:

```powershell
rg -n "[ \t]+$" src\cli\targetCommands.ts src\memory\MemoryBrain.ts src\memory\MemoryReview.ts src\memory\index.ts tests\memory\MemoryReview.test.ts tests\cli\targetCommands.test.ts tests\cli\medscaleCli.test.ts .scale\skills.json .scale\mcp-servers.yaml .planning\tasks\2026-06-15-medical-workflow-upgrade\plan.md .planning\tasks\2026-06-15-medical-workflow-upgrade\summary.md .planning\tasks\2026-06-15-medical-workflow-upgrade\verification.md .planning\tasks\2026-06-15-medical-workflow-upgrade\capability-gap-audit.md
```

Result: no matches.

Additional 18766 mapping whitespace scan:

```powershell
rg -n "[ \t]+$" target-research-platform/src/dashboard/app.py target-research-platform/src/dashboard/static/index.html target-research-platform/tests/test_deliverables.py
```

Result: no matches.

Additional Memory review action whitespace scan covered:

```text
target-research-platform/src/dashboard/app.py
target-research-platform/src/dashboard/static/index.html
target-research-platform/tests/test_deliverables.py
.planning/tasks/2026-06-15-medical-workflow-upgrade/plan.md
.planning/tasks/2026-06-15-medical-workflow-upgrade/summary.md
.planning/tasks/2026-06-15-medical-workflow-upgrade/verification.md
.planning/tasks/2026-06-15-medical-workflow-upgrade/capability-gap-audit.md
```

### HTTP dashboard smoke

Command: temporary in-process `ThreadingHTTPServer` around `DashboardState` and `DashboardHandler`, then GET `/` and `/api/status`.

Working directory:

```text
E:\project\yixue-scale-engine\target-research-platform
```

Result:

```json
{
  "homepage_status": 200,
  "product": "MedSCALE Research OS",
  "cn_name": "MedSCALE 医研操作系统",
  "readiness_score": 100,
  "signal_count": 6,
  "role_count": 6,
  "template_count": 6
}
```

Note: an initial smoke attempt from the repository root failed with `ModuleNotFoundError: No module named 'src.dashboard.app'`; rerunning from `target-research-platform` passed. This was a working-directory issue, not an application failure.

### Playwright render smoke

Command: temporary dashboard server plus Python Playwright Chromium render at desktop and mobile widths.

Result:

```text
{'cards': 7, 'templates': 6, 'overflow': False, 'width': 1346, 'height': 1644, 'viewport': 'desktop'}
{'cards': 7, 'templates': 6, 'overflow': False, 'width': 296, 'height': 3344, 'viewport': 'mobile'}
```

### GitHub Actions release workflow validation

Command:

```powershell
node --input-type=module -e "import fs from 'node:fs'; import yaml from 'js-yaml'; const doc = yaml.load(fs.readFileSync('.github/workflows/publish.yml','utf8')); console.log(doc.name); console.log(Object.keys(doc.on).join(',')); console.log(JSON.stringify(doc.on.workflow_dispatch.inputs)); const steps = doc.jobs.release.steps; console.log('steps', steps.length); console.log('has_npm_token', JSON.stringify(doc).includes('secrets.NPM_TOKEN')); console.log('has_release_medscale', steps.some(step => String(step.run ?? '').includes('npm run release:medscale'))); console.log('has_create_release', JSON.stringify(doc).includes('gh release create'));"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
MedSCALE GitHub Release
release,workflow_dispatch
{"publish":{"description":"Publish to npm from GitHub Actions","required":true,"default":false,"type":"boolean"}}
steps 10
has_npm_token true
has_release_medscale true
has_create_release false
```

Historical notes:

- This was the first GitHub-driven release workflow shape.
- It was later replaced by the automatic tag-driven workflow validated below.

### Automatic tag-driven GitHub release workflow validation

Command:

```powershell
node --input-type=module -e "import fs from 'node:fs'; import yaml from 'js-yaml'; const doc = yaml.load(fs.readFileSync('.github/workflows/publish.yml','utf8')); const steps = doc.jobs.release.steps; console.log(doc.name); console.log(Object.keys(doc.on).join(',')); console.log(JSON.stringify(doc.on.push.tags)); console.log(JSON.stringify(doc.on.workflow_dispatch.inputs)); console.log('node', steps.find(s => s.name === 'Setup Node.js').with['node-version']); console.log('has_tag_metadata', steps.some(s => s.id === 'meta')); console.log('has_auto_release', steps.some(s => s.name === 'Create GitHub Release')); console.log('has_release_event', Object.hasOwn(doc.on, 'release')); console.log('has_npm_token_fallback', JSON.stringify(doc).includes('secrets.NPM_TOKEN')); console.log('has_private_provenance_guard', JSON.stringify(doc).includes('skipping npm provenance'));"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result:

```text
MedSCALE GitHub Release
push,workflow_dispatch
["v*.*.*"]
{"publish":{"description":"Publish to npm from GitHub Actions","required":true,"default":false,"type":"boolean"},"create_release":{"description":"Create GitHub Release after publish","required":true,"default":false,"type":"boolean"}}
node 22
has_tag_metadata true
has_auto_release true
has_release_event false
has_npm_token_fallback true
has_private_provenance_guard true
```

Notes:

- Future `v*.*.*` tag pushes now automatically run the release workflow.
- The workflow validates that the tag exactly matches `package.json` version.
- The workflow supports both `NPM_TOKEN` and npm Trusted Publishing / GitHub OIDC.
- The workflow skips npm provenance when the GitHub repository is private, matching npm's provenance limitation for private repositories.
- After this workflow change, `npm run release:medscale` was rerun and passed: typecheck, 3 focused Vitest files / 26 tests, build, `medscale.release_smoke.v1`, and npm pack dry-run.

### MedSCALE GitHub release gate

Command:

```powershell
npm run release:medscale
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: passed. The release gate ran typecheck, the focused MedSCALE Vitest suites, build, and `medscale.release_smoke.v1`.

### npm publish dry-run evidence

Command:

```powershell
npm publish --dry-run --json --registry=https://registry.npmjs.org
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: passed for `@hongmaple0820/med-scale-research-os@0.43.0`. The dry-run contained `1104` package entries and included `target-research-platform/src/output/usage_envelope.py`. It did not include `target-research-platform/output/`, `__pycache__/`, or Python bytecode files.

No real local npm publish was run.

### Runtime dependency audit

Command:

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: passed with `0` vulnerabilities.

### GitHub release staging hygiene

Commands:

```powershell
git diff --cached --name-only | Select-String -Pattern '(^|/)(__pycache__|\.pytest_cache|node_modules|dist|\.scale/(events|evidence|memory-provider-imports|worktrees|tmp|state|reports|resource-reports|vectors|backups)|\.db|\.sqlite|\.log|\.zip|\.tgz|target-research-platform/output/|^output/)'
git diff --cached --name-only | Select-String -Pattern '(^|/)(\.env|\.env\.|id_rsa|id_ed25519|credentials|secret|secrets|token\.json|\.npmrc)$'
git grep --cached -n -I -E "(BEGIN (RSA|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,})"
```

Working directory:

```text
E:\project\yixue-scale-engine
```

Result: all scans returned no matches after removing `skills/target-intelligence/.cache/` from the index and moving secret detector fixtures to runtime string composition.

Command:

```powershell
npm test -- tests/guardrails/gateway.test.ts tests/integration/adapter.test.ts tests/unit/OWASPDetector.test.ts
```

Result:

```text
3 files passed; 59 tests passed
```

Residual note: `git diff --cached --check` currently reports historical trailing-whitespace and blank-line issues in the large first-commit baseline. The GitHub release workflow does not run this check; focused touched-path whitespace checks passed earlier.

## Not Run

- `make gate-workflow`, `make gate-quality`, `make verify PROFILE=default`: `make` is not available in this Windows environment.
- `rtk`-prefixed commands: `rtk` is not on PATH.
- Full repository `npm test`: not run; focused CLI/memory Vitest suites passed.
- Full `target-research-platform` Python suite: run and recorded above; 176 passed, 3 existing external/fixture integration cases failed.
