# MOE Workspace Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MOE-style multi-repository workspaces a first-class SCALE Engine topology instead of an implicit workspace cleanup edge case.

**Architecture:** Add a typed workspace topology config under `.scale/workspace.json`, resolve it from `WorkspaceTopology`, and reuse it from workspace lifecycle and verification selection. Add a `moe-workspace` governance pack that generates the topology template, documentation, and service/repository governance defaults without breaking existing non-MOE projects.

**Tech Stack:** TypeScript, Node.js `fs/path`, existing `citty` CLI, `execa`, Vitest, existing `GovernanceTemplatePacks`, `GovernanceTemplates`, `VerificationProfile`, and `WorkspaceLifecycle` modules.

---

### Task 1: Workspace Topology Model

**Files:**
- Create: `src/workflow/WorkspaceTopology.ts`
- Modify: `src/workflow/index.ts`
- Test: `tests/workflow/workspaceTopology.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadWorkspaceTopology, resolveWorkspaceTopology } from '../../src/workflow/WorkspaceTopology.js'

let dirs: string[] = []

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-moe-topology-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.scale'), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of dirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe('WorkspaceTopology', () => {
  it('falls back to a single-repository topology when no config exists', () => {
    const dir = makeProject()

    const topology = resolveWorkspaceTopology({ projectDir: dir })

    expect(topology.topology).toBe('single')
    expect(topology.repositories).toEqual([
      expect.objectContaining({ name: 'root', path: '.', role: 'root', required: true }),
    ])
  })

  it('loads MOE topology repositories, service bindings, and finish policy', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'workspace.json'), JSON.stringify({
      version: 1,
      topology: 'moe',
      repositories: [
        { name: 'root', path: '.', role: 'root', required: true },
        { name: 'common', path: 'packages/common', role: 'submodule', required: true, services: ['common-api'] },
      ],
      finishPolicy: {
        requireCleanRepositories: true,
        requirePushedBranches: true,
        requireRootPointerUpdate: true,
      },
    }, null, 2))

    const topology = loadWorkspaceTopology(dir)

    expect(topology?.topology).toBe('moe')
    expect(topology?.repositories[1]).toMatchObject({
      name: 'common',
      role: 'submodule',
      services: ['common-api'],
    })
    expect(topology?.finishPolicy?.requireRootPointerUpdate).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workspaceTopology.test.ts`

Expected: FAIL because `WorkspaceTopology.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a typed module with `WorkspaceTopologyKind = 'single' | 'monorepo' | 'polyrepo' | 'submodule-workspace' | 'moe'`, repository roles, optional branch/finish policies, `loadWorkspaceTopology()`, `resolveWorkspaceTopology()`, and `workspaceTopologyTemplate()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workflow/workspaceTopology.test.ts`

Expected: PASS.

### Task 2: MOE Governance Pack

**Files:**
- Modify: `src/workflow/GovernanceTemplatePacks.ts`
- Modify: `src/workflow/GovernanceTemplates.ts`
- Test: `tests/workflow/governanceTemplatePacks.test.ts`
- Test: `tests/workflow/governanceTemplates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add expectations that pack ids include `moe-workspace`, that resolving the pack returns generated files for `.scale/workspace.json` and `docs/workflow/moe-workspace.md`, and that `writeGovernanceTemplates()` creates those files.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/workflow/governanceTemplatePacks.test.ts tests/workflow/governanceTemplates.test.ts`

Expected: FAIL because `moe-workspace` is not supported.

- [ ] **Step 3: Implement the pack**

Add `moe-workspace` to `GovernancePackId`, pack list, CLI description, generated files, and workflow README guidance.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow/governanceTemplatePacks.test.ts tests/workflow/governanceTemplates.test.ts`

Expected: PASS.

### Task 3: Workspace Lifecycle Uses Topology

**Files:**
- Modify: `src/workflow/WorkspaceLifecycle.ts`
- Test: `tests/workflow/workspaceLifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a test that writes `.scale/workspace.json` with a configured child repository path that is deeper than normal nested discovery and expects `inspectWorkspaceLifecycle()` to include it when it is a Git repository. Add a second test that MOE finish policy reports a root pointer update warning when configured child repositories changed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workspaceLifecycle.test.ts`

Expected: FAIL because lifecycle discovery does not read `.scale/workspace.json`.

- [ ] **Step 3: Implement lifecycle integration**

Load `resolveWorkspaceTopology()` inside `inspectWorkspaceLifecycle()`, inspect configured repositories in addition to `.gitmodules` and nested `.git` discovery, de-duplicate by absolute path, and add MOE-specific finish policy warnings/blockers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workflow/workspaceLifecycle.test.ts`

Expected: PASS.

### Task 4: CLI Surface

**Files:**
- Modify: `src/api/cli.ts`
- Test: `tests/workflow/workspaceCli.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for `scale workspace map --dir <project> --json` and `scale workspace map --dir <project> --write --json`, asserting JSON includes topology and that `--write` creates `.scale/workspace.json`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow/workspaceCli.test.ts`

Expected: FAIL because `workspace map` does not exist.

- [ ] **Step 3: Implement command**

Add `workspace map` to the existing `workspace` command group. It should resolve topology by default and write a starter topology config when `--write` is passed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workflow/workspaceCli.test.ts`

Expected: PASS.

### Task 5: Verification and Documentation

**Files:**
- Modify: `docs/05-ROADMAP.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the change**

Add concise notes that MOE workspaces now have explicit topology config, generated governance pack output, and workspace map/finish integration.

- [ ] **Step 2: Run targeted tests**

Run: `npx vitest run tests/workflow/workspaceTopology.test.ts tests/workflow/governanceTemplatePacks.test.ts tests/workflow/governanceTemplates.test.ts tests/workflow/workspaceLifecycle.test.ts tests/workflow/workspaceCli.test.ts`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm run build`, `npm run lint`, `npx vitest run --testTimeout=30000`, and `git diff --check`.

Expected: PASS.
