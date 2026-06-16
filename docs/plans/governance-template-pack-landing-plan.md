# Governance Template Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scale-engine` the source of truth for workflow governance, then regenerate `project-scaffold` as the practical scaffold and validate the same governance against `netdisk-project`.

**Architecture:** Add a versioned governance template pack layer to `scale-engine`. `scale init` writes `.scale/verification.json`, `.scale/skills.json`, task artifact templates, metrics, and optional shell wrappers from one typed source, then records a lock file so downstream repos can detect drift. `project-scaffold` becomes the generated reference scaffold; `netdisk-project` becomes the Go service-matrix validation target.

**Tech Stack:** TypeScript, Node.js `fs/path`, existing `citty` CLI, existing `Vitest` suite, existing `GovernanceTemplates`, `VerificationProfile`, `TaskMetricsStore`, and `SkillPolicy` modules.

---

## Current Evidence

`scale-engine` already has the strongest implementation base:

- `src/workflow/GovernanceTemplates.ts` writes workflow templates, Mini-PRD, skill routing policy, verification matrix, metrics, and CI/hook templates.
- `src/workflow/VerificationProfile.ts` supports `services`, `service=all`, comma-separated services, Go/Python defaults, and required-service selection.
- `src/skills/routing/SkillPolicy.ts` requires Mini-PRD plus UI/API evidence for user-facing work.
- `src/workflow/TaskMetricsStore.ts` stores M/L/CRITICAL metrics in `.scale/metrics/tasks.jsonl` and renders `docs/worklog/metrics.md`.
- `src/api/cli.ts` calls `writeGovernanceTemplates()` from `scale init`, but init still lacks named template packs, project-specific service generation, lock files, and drift checks.

`project-scaffold` currently has useful governance docs and scripts, but the scaffold is not reproducibly generated from `scale-engine`.

`netdisk-project` has more realistic Go service validation, but part of the shell workflow is still hand-copied and can drift from the engine.

## Non-Goals

- Do not rewrite the artifact FSM, event store, or existing phase commands.
- Do not make `project-scaffold` the rule source. It is the generated practice scaffold, not the compiler.
- Do not force all downstream repos to install Git hooks immediately.
- Do not include reference modules such as `OpenList`, `gfast`, or `mcp-zero` in default Go service gates.
- Do not publish a new npm version until generated output is validated in at least `project-scaffold` and one real Go repo.

## File Structure

Create:

- `src/workflow/GovernanceTemplatePacks.ts`
  Defines named governance packs and their generated assets. Owns pack metadata, service presets, generated wrapper policy, and compatibility flags.

- `src/workflow/GovernanceLock.ts`
  Reads and writes `.scale/governance.lock.json`. Computes drift between the lock, generated file hashes, and current template pack version.

- `tests/workflow/governanceTemplatePacks.test.ts`
  Unit tests for pack resolution, scaffold-lite assets, Go service-matrix preset, and lock output.

- `tests/workflow/governanceLock.test.ts`
  Unit tests for lock creation, hash stability, missing generated file detection, and modified generated file detection.

Modify:

- `src/workflow/GovernanceTemplates.ts`
  Accept a `pack` option and optional services. Generate pack-specific docs, `.scale/verification.json`, `.scale/skills.json`, shell wrapper templates, and lock metadata without overwriting user-owned files by default.

- `src/workflow/index.ts`
  Export the new pack and lock modules.

- `src/api/cli.ts`
  Add `scale init --governance-pack <pack>` and `scale governance diff`. Preserve existing init behavior by defaulting to the current standard pack.

- `src/api/doctor.ts`
  Add an optional governance drift check. It should warn when generated files changed or lock metadata is missing.

- `tests/workflow/governanceTemplates.test.ts`
  Extend coverage for generated pack files, wrappers, and lock creation.

- `tests/workflow/phaseCli.test.ts`
  Add CLI-level coverage for pack selection and governance drift JSON output.

Downstream rollout targets:

- `F:\project\project-scaffold`
- `F:\project\netdisk-project-doc-governance`

## Pack Model

Use these initial packs:

| Pack | Purpose | Default behavior |
| --- | --- | --- |
| `standard` | Current generic governance output | Same behavior as current `scale init` |
| `project-scaffold` | Generated workflow practice scaffold | Writes docs, task templates, metrics, wrappers, and governance lock |
| `go-service-matrix` | Go multi-service repo governance | Writes service-aware verification matrix and Go-oriented workflow docs |
| `node-library` | npm package/library governance | Uses build/test/pack/release defaults |
| `frontend-app` | Frontend UI governance | Enables Mini-PRD, UI spec, visual review, screenshot/responsive evidence |

Pack resolution contract:

```ts
export type GovernancePackId =
  | 'standard'
  | 'project-scaffold'
  | 'go-service-matrix'
  | 'node-library'
  | 'frontend-app'

export interface GovernanceTemplatePack {
  id: GovernancePackId
  version: number
  description: string
  modeDefaults: Record<GovernanceMode, GovernancePackModeConfig>
  defaultServices?: VerificationService[]
  generatedFiles: GovernanceGeneratedFile[]
}
```

Generated files must include an ownership header:

```text
<!-- Generated by scale-engine governance pack: project-scaffold@1 -->
<!-- Edit policy: prefer editing the pack in scale-engine; local overrides should be documented. -->
```

The header is required only for generated docs and wrapper scripts, not for JSON config that must stay machine-readable.

## Lock File Contract

Write:

```text
.scale/governance.lock.json
```

Minimum schema:

```json
{
  "version": 1,
  "scalePackage": "@hongmaple0820/scale-engine",
  "scaleVersion": "0.14.0-dev",
  "pack": "project-scaffold",
  "packVersion": 1,
  "generatedAt": "2026-05-15T00:00:00.000Z",
  "files": [
    {
      "path": "docs/workflow/README.md",
      "sha256": "hex",
      "owned": true
    }
  ]
}
```

Rules:

- `owned: true` means `scale governance diff` may report drift against the pack.
- User-created worklog artifacts are never lock-owned.
- Existing files are not overwritten unless `--force` or a future `scale governance update` is used.
- Skipped existing files should still be reported in init output so users know they are local overrides.

## Task 1: Add Governance Pack Types

**Files:**

- Create: `src/workflow/GovernanceTemplatePacks.ts`
- Modify: `src/workflow/index.ts`
- Test: `tests/workflow/governanceTemplatePacks.test.ts`

- [ ] **Step 1: Write failing tests for pack resolution**

```ts
import { describe, expect, it } from 'vitest'
import { listGovernanceTemplatePacks, resolveGovernanceTemplatePack } from '../../src/workflow/GovernanceTemplatePacks.js'

describe('governance template packs', () => {
  it('lists stable pack ids', () => {
    expect(listGovernanceTemplatePacks().map(pack => pack.id)).toEqual([
      'standard',
      'project-scaffold',
      'go-service-matrix',
      'node-library',
      'frontend-app',
    ])
  })

  it('resolves project-scaffold with wrapper generation enabled', () => {
    const pack = resolveGovernanceTemplatePack('project-scaffold')
    expect(pack.id).toBe('project-scaffold')
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/workflow/new-task.sh')
    expect(pack.generatedFiles.map(file => file.path)).toContain('scripts/gates/all.sh')
  })

  it('resolves Go service matrix with language-aware required services', () => {
    const pack = resolveGovernanceTemplatePack('go-service-matrix')
    expect(pack.defaultServices?.every(service => service.type === 'go')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/workflow/governanceTemplatePacks.test.ts
```

Expected:

```text
FAIL tests/workflow/governanceTemplatePacks.test.ts
Cannot find module '../../src/workflow/GovernanceTemplatePacks.js'
```

- [ ] **Step 3: Implement pack definitions**

Create `src/workflow/GovernanceTemplatePacks.ts` with this structure:

```ts
import type { GovernanceMode } from './GovernanceTemplates.js'
import type { VerificationService } from './VerificationProfile.js'

export type GovernancePackId =
  | 'standard'
  | 'project-scaffold'
  | 'go-service-matrix'
  | 'node-library'
  | 'frontend-app'

export interface GovernanceGeneratedFile {
  path: string
  kind: 'doc' | 'template' | 'script' | 'config'
  owned: boolean
  content: string
}

export interface GovernancePackModeConfig {
  artifactGate: 'off' | 'warn' | 'block'
  skillRoutingMode: 'off' | 'warn' | 'block'
}

export interface GovernanceTemplatePack {
  id: GovernancePackId
  version: number
  description: string
  modeDefaults: Record<GovernanceMode, GovernancePackModeConfig>
  defaultServices?: VerificationService[]
  generatedFiles: GovernanceGeneratedFile[]
}

export function listGovernanceTemplatePacks(): GovernanceTemplatePack[] {
  return PACKS
}

export function resolveGovernanceTemplatePack(id: string | undefined): GovernanceTemplatePack {
  const normalized = (id || 'standard') as GovernancePackId
  const pack = PACKS.find(candidate => candidate.id === normalized)
  if (!pack) {
    const supported = PACKS.map(candidate => candidate.id).join(', ')
    throw new Error(`Unknown governance pack "${id}". Supported packs: ${supported}`)
  }
  return pack
}

const modeDefaults: GovernanceTemplatePack['modeDefaults'] = {
  minimal: { artifactGate: 'off', skillRoutingMode: 'warn' },
  standard: { artifactGate: 'warn', skillRoutingMode: 'warn' },
  critical: { artifactGate: 'block', skillRoutingMode: 'block' },
}

const PACKS: GovernanceTemplatePack[] = [
  {
    id: 'standard',
    version: 1,
    description: 'Generic SCALE governance output.',
    modeDefaults,
    generatedFiles: [],
  },
  {
    id: 'project-scaffold',
    version: 1,
    description: 'Reference project governance scaffold with workflow wrappers.',
    modeDefaults,
    generatedFiles: [
      { path: 'scripts/workflow/new-task.sh', kind: 'script', owned: true, content: workflowWrapper('new-task') },
      { path: 'scripts/workflow/explore.sh', kind: 'script', owned: true, content: workflowWrapper('explore') },
      { path: 'scripts/workflow/resume.sh', kind: 'script', owned: true, content: workflowWrapper('resume') },
      { path: 'scripts/workflow/verify.sh', kind: 'script', owned: true, content: workflowWrapper('verify') },
      { path: 'scripts/gates/all.sh', kind: 'script', owned: true, content: gateWrapper('all') },
    ],
  },
  {
    id: 'go-service-matrix',
    version: 1,
    description: 'Go multi-service repository governance.',
    modeDefaults,
    defaultServices: [
      { name: 'netdisk', path: 'amdox-go-netdisk', type: 'go', required: true },
      { name: 'auth', path: 'amdox-go-auth', type: 'go', required: true },
      { name: 'gateway', path: 'amdox-go-gateway', type: 'go', required: true },
    ],
    generatedFiles: [],
  },
  {
    id: 'node-library',
    version: 1,
    description: 'Node/npm library governance with build, test, diff, and pack checks.',
    modeDefaults,
    generatedFiles: [],
  },
  {
    id: 'frontend-app',
    version: 1,
    description: 'Frontend app governance with UI and visual evidence requirements.',
    modeDefaults,
    generatedFiles: [],
  },
]

function workflowWrapper(command: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
npx @hongmaple0820/scale-engine@latest ${command} "$@"
`
}

function gateWrapper(command: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
npx @hongmaple0820/scale-engine@latest governance-gate ${command} "$@"
`
}
```

- [ ] **Step 4: Export the module**

Modify `src/workflow/index.ts`:

```ts
export * from './GovernanceTemplatePacks.js'
```

- [ ] **Step 5: Run test and verify pass**

Run:

```bash
npx vitest run tests/workflow/governanceTemplatePacks.test.ts
```

Expected:

```text
PASS tests/workflow/governanceTemplatePacks.test.ts
```

## Task 2: Add Governance Lock and Drift Detection

**Files:**

- Create: `src/workflow/GovernanceLock.ts`
- Modify: `src/workflow/index.ts`
- Test: `tests/workflow/governanceLock.test.ts`

- [ ] **Step 1: Write failing tests for lock creation and drift**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeGovernanceDrift, writeGovernanceLock } from '../../src/workflow/GovernanceLock.js'

describe('governance lock', () => {
  it('writes hashes for owned generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-lock-'))
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'workflow\n', 'utf-8')

    const lock = writeGovernanceLock(dir, {
      pack: 'project-scaffold',
      packVersion: 1,
      files: [{ path: 'docs/workflow/README.md', owned: true }],
      scaleVersion: '0.14.0-dev',
    })

    expect(lock.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reports modified generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-lock-'))
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'workflow\n', 'utf-8')
    writeGovernanceLock(dir, {
      pack: 'project-scaffold',
      packVersion: 1,
      files: [{ path: 'docs/workflow/README.md', owned: true }],
      scaleVersion: '0.14.0-dev',
    })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'changed\n', 'utf-8')

    const drift = computeGovernanceDrift(dir)

    expect(drift.changed.map(item => item.path)).toEqual(['docs/workflow/README.md'])
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/workflow/governanceLock.test.ts
```

Expected:

```text
FAIL tests/workflow/governanceLock.test.ts
Cannot find module '../../src/workflow/GovernanceLock.js'
```

- [ ] **Step 3: Implement lock read/write/diff**

Create `src/workflow/GovernanceLock.ts`:

```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GovernancePackId } from './GovernanceTemplatePacks.js'

export interface GovernanceLockFile {
  version: 1
  scalePackage: '@hongmaple0820/scale-engine'
  scaleVersion: string
  pack: GovernancePackId
  packVersion: number
  generatedAt: string
  files: GovernanceLockEntry[]
}

export interface GovernanceLockEntry {
  path: string
  sha256: string
  owned: boolean
}

export interface GovernanceLockInput {
  pack: GovernancePackId
  packVersion: number
  scaleVersion: string
  files: Array<{ path: string; owned: boolean }>
}

export interface GovernanceDriftReport {
  lockExists: boolean
  missing: GovernanceLockEntry[]
  changed: GovernanceLockEntry[]
  clean: GovernanceLockEntry[]
}

export function writeGovernanceLock(projectDir: string, input: GovernanceLockInput): GovernanceLockFile {
  const lock: GovernanceLockFile = {
    version: 1,
    scalePackage: '@hongmaple0820/scale-engine',
    scaleVersion: input.scaleVersion,
    pack: input.pack,
    packVersion: input.packVersion,
    generatedAt: new Date().toISOString(),
    files: input.files.map(file => ({
      path: file.path,
      sha256: hashFile(join(projectDir, file.path)),
      owned: file.owned,
    })),
  }
  const target = governanceLockPath(projectDir)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
  return lock
}

export function readGovernanceLock(projectDir: string): GovernanceLockFile | null {
  const target = governanceLockPath(projectDir)
  if (!existsSync(target)) return null
  return JSON.parse(readFileSync(target, 'utf-8')) as GovernanceLockFile
}

export function computeGovernanceDrift(projectDir: string): GovernanceDriftReport {
  const lock = readGovernanceLock(projectDir)
  if (!lock) return { lockExists: false, missing: [], changed: [], clean: [] }
  const missing: GovernanceLockEntry[] = []
  const changed: GovernanceLockEntry[] = []
  const clean: GovernanceLockEntry[] = []
  for (const entry of lock.files.filter(file => file.owned)) {
    const target = join(projectDir, entry.path)
    if (!existsSync(target)) {
      missing.push(entry)
      continue
    }
    const current = hashFile(target)
    if (current !== entry.sha256) changed.push(entry)
    else clean.push(entry)
  }
  return { lockExists: true, missing, changed, clean }
}

function governanceLockPath(projectDir: string): string {
  return join(projectDir, '.scale', 'governance.lock.json')
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
```

- [ ] **Step 4: Export the module**

Modify `src/workflow/index.ts`:

```ts
export * from './GovernanceLock.js'
```

- [ ] **Step 5: Run test and verify pass**

Run:

```bash
npx vitest run tests/workflow/governanceLock.test.ts
```

Expected:

```text
PASS tests/workflow/governanceLock.test.ts
```

## Task 3: Connect Packs to Template Generation

**Files:**

- Modify: `src/workflow/GovernanceTemplates.ts`
- Modify: `tests/workflow/governanceTemplates.test.ts`

- [ ] **Step 1: Write failing test for pack-aware generation**

Add to `tests/workflow/governanceTemplates.test.ts`:

```ts
it('generates project-scaffold pack wrappers and governance lock', () => {
  const dir = makeDir()

  const result = writeGovernanceTemplates(dir, {
    mode: 'standard',
    projectName: 'Scaffold',
    pack: 'project-scaffold',
  })

  expect(result.created).toEqual(expect.arrayContaining([
    join(dir, 'scripts', 'workflow', 'new-task.sh'),
    join(dir, 'scripts', 'gates', 'all.sh'),
    join(dir, '.scale', 'governance.lock.json'),
  ]))
  expect(readFileSync(join(dir, 'scripts', 'workflow', 'new-task.sh'), 'utf-8')).toContain('@hongmaple0820/scale-engine@latest')
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/workflow/governanceTemplates.test.ts
```

Expected:

```text
FAIL tests/workflow/governanceTemplates.test.ts
Object literal may only specify known properties, and 'pack' does not exist
```

- [ ] **Step 3: Extend template options**

Modify `GovernanceTemplateOptions`:

```ts
export interface GovernanceTemplateOptions {
  mode?: GovernanceMode
  projectName?: string
  pack?: GovernancePackId
  services?: VerificationService[]
}
```

- [ ] **Step 4: Resolve the pack and service matrix**

Inside `writeGovernanceTemplates()`:

```ts
const pack = resolveGovernanceTemplatePack(options.pack)
const services = options.services ?? pack.defaultServices ?? []
```

Use `services` when creating `.scale/verification.json`.

- [ ] **Step 5: Write generated pack files**

After base templates are written:

```ts
const generatedForLock: Array<{ path: string; owned: boolean }> = []

for (const file of pack.generatedFiles) {
  const target = join(projectDir, file.path)
  writeIfMissing(result, target, generatedHeader(pack.id, pack.version, file.kind) + file.content)
  generatedForLock.push({ path: file.path, owned: file.owned })
}
```

- [ ] **Step 6: Write governance lock**

Only include files that exist after generation:

```ts
writeGovernanceLock(projectDir, {
  pack: pack.id,
  packVersion: pack.version,
  scaleVersion: packageVersion(),
  files: generatedForLock.filter(file => existsSync(join(projectDir, file.path))),
})
result.created.push(join(projectDir, '.scale', 'governance.lock.json'))
```

`packageVersion()` can read the current package version from `package.json`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/workflow/governanceTemplates.test.ts tests/workflow/governanceTemplatePacks.test.ts tests/workflow/governanceLock.test.ts
```

Expected:

```text
PASS tests/workflow/governanceTemplates.test.ts
PASS tests/workflow/governanceTemplatePacks.test.ts
PASS tests/workflow/governanceLock.test.ts
```

## Task 4: Add CLI Surface

**Files:**

- Modify: `src/api/cli.ts`
- Test: `tests/workflow/phaseCli.test.ts`

- [ ] **Step 1: Write CLI tests**

Add a CLI test that runs:

```bash
node dist/api/cli.js init --agent codex --dir <tmp> --governance-pack project-scaffold
node dist/api/cli.js governance diff --dir <tmp> --json
```

Assertions:

```ts
expect(existsSync(join(projectDir, '.scale', 'governance.lock.json'))).toBe(true)
expect(existsSync(join(projectDir, 'scripts', 'workflow', 'new-task.sh'))).toBe(true)
expect(JSON.parse(diff.stdout)).toMatchObject({ lockExists: true, changed: [], missing: [] })
```

- [ ] **Step 2: Add init argument**

In the `init` command args:

```ts
'governance-pack': {
  type: 'string',
  default: 'standard',
  description: 'Governance template pack (standard/project-scaffold/go-service-matrix/node-library/frontend-app)',
},
```

Pass it into `writeGovernanceTemplates()`:

```ts
const governance = writeGovernanceTemplates(args.dir, {
  mode: governanceModeFromScenario(args.scenario),
  projectName,
  pack: args['governance-pack'],
})
```

- [ ] **Step 3: Add governance diff command**

Add:

```ts
const governanceDiff = defineCommand({
  meta: { name: 'diff', description: 'Check generated governance files for drift' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = computeGovernanceDrift(args.dir)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    if (!report.lockExists) {
      console.log('No governance lock found. Run: scale init --governance-pack <pack>')
      return
    }
    if (report.missing.length === 0 && report.changed.length === 0) {
      console.log('Governance generated files are clean.')
      return
    }
    for (const item of report.missing) console.log(`missing: ${item.path}`)
    for (const item of report.changed) console.log(`changed: ${item.path}`)
  },
})

const governance = defineCommand({
  meta: { name: 'governance', description: 'Governance template pack tools' },
  subCommands: { diff: governanceDiff },
})
```

Register it in the root command:

```ts
governance,
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npm run build
npx vitest run tests/workflow/phaseCli.test.ts
```

Expected:

```text
PASS tests/workflow/phaseCli.test.ts
```

## Task 5: Add Doctor Governance Drift Check

**Files:**

- Modify: `src/api/doctor.ts`
- Test: `tests/api/doctor.test.ts` if present, otherwise add focused coverage in existing doctor test file.

- [ ] **Step 1: Add check behavior**

Add an optional governance check:

```ts
const drift = computeGovernanceDrift(this.projectDir)
if (!drift.lockExists) {
  return {
    name: 'Governance lock',
    status: 'warn',
    message: 'Missing .scale/governance.lock.json',
    fix: 'Run: scale init --governance-pack standard',
  }
}
if (drift.missing.length || drift.changed.length) {
  return {
    name: 'Governance drift',
    status: 'warn',
    message: `${drift.missing.length} missing, ${drift.changed.length} changed generated governance files`,
    fix: 'Run: scale governance diff',
  }
}
```

- [ ] **Step 2: Keep it advisory**

The check must be `optional: true` and `category: 'governance'`. It must not make `scale doctor` fail on existing projects.

- [ ] **Step 3: Run doctor-focused tests**

Run:

```bash
npx vitest run tests/integration/*adapter.test.ts tests/workflow/governanceLock.test.ts
```

Expected:

```text
PASS
```

## Task 6: Generate `project-scaffold` From the Pack

**Files:**

- Downstream branch: `F:\project\project-scaffold`
- Preserve: `F:\project\project-scaffold\docs\WORKFLOW_OPTIMIZATION_V2.md`

- [ ] **Step 1: Finish local scale build**

Run in `E:\project\scale-engine`:

```bash
npm run build
npx vitest run
npm pack --dry-run
```

Expected:

```text
PASS
```

- [ ] **Step 2: Create a downstream branch**

Run in `F:\project\project-scaffold`:

```bash
git switch main
git pull --ff-only
git switch -c codex/scaffold-scale-template-0515
```

Expected:

```text
Switched to a new branch 'codex/scaffold-scale-template-0515'
```

- [ ] **Step 3: Generate the scaffold governance pack**

Run from `E:\project\scale-engine` using the built local CLI:

```bash
node dist/api/cli.js init --agent codex --dir F:\project\project-scaffold --governance-pack project-scaffold --scenario standard
node dist/api/cli.js governance diff --dir F:\project\project-scaffold --json
```

Expected:

```json
{
  "lockExists": true,
  "missing": [],
  "changed": [],
  "clean": []
}
```

`clean` may contain generated wrapper files if the pack wrote new files.

- [ ] **Step 4: Review generated diff**

Run:

```bash
git -C F:\project\project-scaffold diff --stat
git -C F:\project\project-scaffold diff -- docs scripts .scale
```

Expected:

- `docs/WORKFLOW_OPTIMIZATION_V2.md` remains present.
- No old `scripts/workflow/plan.sh` is reintroduced.
- Generated wrappers point back to `@hongmaple0820/scale-engine`.
- `.scale/governance.lock.json` is present and explains ownership.

- [ ] **Step 5: Commit downstream scaffold**

Run:

```bash
git -C F:\project\project-scaffold add docs scripts .scale
git -C F:\project\project-scaffold commit -m "chore(workflow): generate scale governance scaffold"
```

Expected:

```text
[codex/scaffold-scale-template-0515 ...] chore(workflow): generate scale governance scaffold
```

## Task 7: Validate Against `netdisk-project`

**Files:**

- Downstream branch: `F:\project\netdisk-project-doc-governance`

- [ ] **Step 1: Create or refresh validation branch**

Run:

```bash
git -C F:\project\netdisk-project-doc-governance fetch origin
git -C F:\project\netdisk-project-doc-governance status --short --branch
```

Expected:

```text
## codex/doc-collab-git-docs-0515...origin/codex/doc-collab-git-docs-0515
```

- [ ] **Step 2: Generate Go service matrix governance**

Run from `E:\project\scale-engine`:

```bash
node dist/api/cli.js init --agent codex --dir F:\project\netdisk-project-doc-governance --governance-pack go-service-matrix --scenario standard
node dist/api/cli.js governance diff --dir F:\project\netdisk-project-doc-governance --json
```

Expected:

```json
{
  "lockExists": true,
  "missing": [],
  "changed": []
}
```

- [ ] **Step 3: Verify service matrix**

Inspect:

```bash
type F:\project\netdisk-project-doc-governance\.scale\verification.json
```

Expected required services:

```json
[
  { "name": "netdisk", "path": "amdox-go-netdisk", "type": "go", "required": true },
  { "name": "auth", "path": "amdox-go-auth", "type": "go", "required": true },
  { "name": "gateway", "path": "amdox-go-gateway", "type": "go", "required": true }
]
```

Expected exclusions:

```json
["OpenList", "gfast", "mcp-zero"]
```

- [ ] **Step 4: Run service-aware preflight**

Run:

```bash
node E:\project\scale-engine\dist\api\cli.js preflight --service all --project-dir F:\project\netdisk-project-doc-governance --json
```

Expected:

- Services selected: `netdisk`, `auth`, `gateway`.
- `OpenList`, `gfast`, and `mcp-zero` are not selected.
- Failures are real command failures, not missing matrix behavior.

## Task 8: Full Verification and Release Candidate

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `package.json` only when ready to release.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run build
npx vitest run
git diff --check
npm pack --dry-run
```

Expected:

```text
build passes
all tests pass
git diff --check has no whitespace errors
npm pack --dry-run includes dist output only
```

- [ ] **Step 2: Update changelog**

Add an unreleased entry:

```markdown
## Unreleased

- Added governance template packs for generated workflow scaffolds.
- Added `.scale/governance.lock.json` to detect drift in generated governance assets.
- Added `scale governance diff`.
- Added Go service-matrix scaffold support for multi-service repositories.
```

- [ ] **Step 3: Commit scale-engine work**

Run:

```bash
git add src tests docs CHANGELOG.md
git commit -m "feat: add governance template packs"
```

Expected:

```text
[codex/skill-routing-policy ...] feat: add governance template packs
```

## Acceptance Criteria

- `scale init --governance-pack project-scaffold` generates workflow docs, task templates, metrics, wrappers, `.scale/verification.json`, `.scale/skills.json`, and `.scale/governance.lock.json`.
- `scale governance diff --json` reports clean output immediately after generation.
- `scale doctor` warns, but does not fail, when governance lock or generated files drift.
- `scale init --governance-pack go-service-matrix` generates Go required services for `netdisk`, `auth`, and `gateway`.
- `scale preflight --service all` uses required services from `.scale/verification.json`.
- `project-scaffold` can be regenerated from `scale-engine` without reintroducing `scripts/workflow/plan.sh`.
- `docs/WORKFLOW_OPTIMIZATION_V2.md` remains preserved as historical design evidence in `project-scaffold`.
- `netdisk-project` excludes `OpenList`, `gfast`, and `mcp-zero` from default Go gates.
- Full `scale-engine` verification passes: `npm run build`, `npx vitest run`, `git diff --check`, `npm pack --dry-run`.

## Rollback Plan

- Revert only the `scale-engine` governance pack commits if CLI behavior regresses.
- Downstream generated scaffold commits should be independent branches and can be closed without affecting `scale-engine`.
- If wrappers are too disruptive, keep generated docs/config/lock and disable wrapper generation in the pack by setting `generatedFiles: []` for scripts before release.

## Risk Controls

| Risk | Control |
| --- | --- |
| Generated files overwrite local docs | Keep `writeIfMissing` as default; require explicit future `update` command for overwrites |
| Template pack becomes another source of drift | Lock file plus `scale governance diff` |
| Shell wrappers call npm latest unpredictably | Use `@latest` only in scaffold templates; allow pinned package version in future pack option |
| Netdisk service paths vary | Allow explicit services in CLI after this baseline lands |
| Existing repos fail doctor due missing lock | Keep governance drift checks optional warnings |
| Scope grows into full CI rollout | Keep CI templates advisory until local preflight passes |

## Completion Definition

The work is complete when `scale-engine` can generate the governance scaffold, verify its own pack output, and prove that `project-scaffold` is no longer a manually copied workflow snapshot. The downstream scaffold should become an executable example of the engine, not an independent fork of the workflow rules.
