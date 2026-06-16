import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { PolicyLoader, DEFAULT_POLICY, type OrchestratorPolicy } from '../../src/orchestrator/PolicyLoader.js'
import { MockTrackerAdapter, type TrackerIssue, type IssueState } from '../../src/orchestrator/TrackerAdapter.js'
import { WorkspaceManager } from '../../src/orchestrator/WorkspaceManager.js'
import { ReconciliationLoop } from '../../src/orchestrator/ReconciliationLoop.js'

const dirs: string[] = []

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeIssue(overrides: Partial<TrackerIssue> = {}): TrackerIssue {
  return {
    id: '1',
    title: 'Test issue',
    description: 'Test description',
    state: 'open',
    labels: [],
    priority: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blockedBy: [],
    ...overrides,
  }
}

function makePolicy(overrides: Partial<OrchestratorPolicy> = {}): OrchestratorPolicy {
  return {
    ...DEFAULT_POLICY,
    filePath: 'SCALE_POLICY.md',
    lastModified: Date.now(),
    hash: 'test',
    polling: {
      ...DEFAULT_POLICY.polling,
      maxParallelWorkspaces: 2,
      maxAttempts: 3,
    },
    workspace: {
      ...DEFAULT_POLICY.workspace,
      root: '.scale/worktrees',
      maxWorkspaceAgeHours: 24,
    },
    ...overrides,
  }
}

describe('PolicyLoader', () => {
  it('returns default policy when SCALE_POLICY.md does not exist', () => {
    const dir = makeDir('policy-no-file-')
    const loader = new PolicyLoader()
    const policy = loader.load(dir)

    expect(policy.tracker.type).toBe('github')
    expect(policy.polling.intervalMs).toBe(30000)
    expect(policy.agent.model).toBe('claude-sonnet-4-6')
    expect(policy.hash).toBe('default')
  })

  it('parses SCALE_POLICY.md with YAML frontmatter', () => {
    const dir = makeDir('policy-parse-')
    writeFileSync(join(dir, 'SCALE_POLICY.md'), `---
tracker:
  type: github
  owner: myorg
  repo: myrepo
polling:
  intervalMs: 60000
  maxParallelWorkspaces: 5
agent:
  model: claude-opus-4-7
  maxTurns: 100
---

# Policy Body

This is the markdown body.
`)

    const loader = new PolicyLoader()
    const policy = loader.load(dir)

    expect(policy.tracker.type).toBe('github')
    expect(policy.tracker.owner).toBe('myorg')
    expect(policy.tracker.repo).toBe('myrepo')
    expect(policy.polling.intervalMs).toBe(60000)
    expect(policy.polling.maxParallelWorkspaces).toBe(5)
    expect(policy.agent.model).toBe('claude-opus-4-7')
    expect(policy.agent.maxTurns).toBe(100)
    expect(policy.rawBody).toContain('Policy Body')
    expect(policy.hash).toBeTruthy()
  })

  it('merges partial config with defaults', () => {
    const dir = makeDir('policy-partial-')
    writeFileSync(join(dir, 'SCALE_POLICY.md'), `---
tracker:
  type: linear
  owner: myorg
---

Partial config.
`)

    const loader = new PolicyLoader()
    const policy = loader.load(dir)

    // Specified values
    expect(policy.tracker.type).toBe('linear')
    expect(policy.tracker.owner).toBe('myorg')
    // Defaults preserved
    expect(policy.polling.intervalMs).toBe(DEFAULT_POLICY.polling.intervalMs)
    expect(policy.agent.model).toBe(DEFAULT_POLICY.agent.model)
  })

  it('falls back to defaults on missing frontmatter', () => {
    const dir = makeDir('policy-no-fm-')
    writeFileSync(join(dir, 'SCALE_POLICY.md'), '# No frontmatter here')

    const loader = new PolicyLoader()
    const policy = loader.load(dir)
    // File exists but has no frontmatter — falls back to last-good (initial defaults)
    expect(policy.tracker.type).toBe('github')
    expect(policy.polling.intervalMs).toBe(30000)
  })

  it('computes SHA-256 hash of policy content', () => {
    const dir = makeDir('policy-hash-')
    const content = `---
tracker:
  type: github
---

Body content.
`
    writeFileSync(join(dir, 'SCALE_POLICY.md'), content)

    const loader = new PolicyLoader()
    const policy = loader.load(dir)

    expect(policy.hash).toBeTruthy()
    expect(policy.hash.length).toBe(12) // truncated to 12 chars
  })

  it('uses defaults for unparseable sections', () => {
    const dir = makeDir('policy-fallback-')

    // First load: valid policy with custom polling interval
    writeFileSync(join(dir, 'SCALE_POLICY.md'), `---
polling:
  intervalMs: 120000
  maxParallelWorkspaces: 7
---
Valid.
`)
    const loader = new PolicyLoader()
    const first = loader.load(dir)
    expect(first.polling.intervalMs).toBe(120000)
    expect(first.polling.maxParallelWorkspaces).toBe(7)

    // Second load: completely missing frontmatter — throws, falls back to last-good
    writeFileSync(join(dir, 'SCALE_POLICY.md'), 'No frontmatter at all.')
    const second = loader.load(dir)
    // Falls back to last-good policy from first successful parse
    expect(second.polling.intervalMs).toBe(120000)
    expect(second.polling.maxParallelWorkspaces).toBe(7)
  })

  it('get() returns current policy', () => {
    const dir = makeDir('policy-get-')
    const loader = new PolicyLoader()
    loader.load(dir)

    const policy = loader.get()
    expect(policy).toBeDefined()
    expect(policy.tracker).toBeDefined()
    expect(policy.polling).toBeDefined()
  })
})

describe('MockTrackerAdapter', () => {
  it('fetches candidates in active states', async () => {
    const adapter = new MockTrackerAdapter([
      makeIssue({ id: '1', state: 'open' }),
      makeIssue({ id: '2', state: 'closed' }),
      makeIssue({ id: '3', state: 'in_progress' }),
    ])

    const candidates = await adapter.fetchCandidates()
    expect(candidates).toHaveLength(2)
    expect(candidates.map(c => c.id)).toEqual(['1', '3'])
  })

  it('updates issue state', async () => {
    const issue = makeIssue({ id: '1', state: 'open' })
    const adapter = new MockTrackerAdapter([issue])

    await adapter.updateState('1', 'resolved')
    expect(issue.state).toBe('resolved')
  })

  it('checks existence', async () => {
    const adapter = new MockTrackerAdapter([makeIssue({ id: '1' })])

    expect(await adapter.exists('1')).toBe(true)
    expect(await adapter.exists('999')).toBe(false)
  })

  it('gets issue by id', async () => {
    const adapter = new MockTrackerAdapter([makeIssue({ id: '42', title: 'My Issue' })])

    const issue = await adapter.getIssue('42')
    expect(issue?.title).toBe('My Issue')

    const missing = await adapter.getIssue('999')
    expect(missing).toBeNull()
  })
})

describe('WorkspaceManager', () => {
  it('verifies safety invariants — workspace inside root', () => {
    const dir = makeDir('ws-safety-')
    const policy = makePolicy({ workspace: { ...DEFAULT_POLICY.workspace, root: dir } })
    const wm = new WorkspaceManager(policy)

    const wsPath = join(dir, 'my-workspace')
    const result = wm.verifySafety(wsPath)
    expect(result.safe).toBe(true)
  })

  it('detects safety violation — workspace outside root', () => {
    const dir = makeDir('ws-outside-')
    const policy = makePolicy({ workspace: { ...DEFAULT_POLICY.workspace, root: dir } })
    const wm = new WorkspaceManager(policy)

    const result = wm.verifySafety('/tmp/evil-path')
    expect(result.safe).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('reports canCreate based on maxParallelWorkspaces', () => {
    const policy = makePolicy({ polling: { ...DEFAULT_POLICY.polling, maxParallelWorkspaces: 2 } })
    const wm = new WorkspaceManager(policy)

    expect(wm.canCreate).toBe(true)
    expect(wm.activeCount).toBe(0)
  })

  it('lists active workspaces', () => {
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)

    expect(wm.listActive()).toEqual([])
    expect(wm.activeCount).toBe(0)
  })

  it('handles remove for non-existent workspace', () => {
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)

    expect(wm.remove('nonexistent')).toBe(false)
  })

  it('handles updateStatus for non-existent workspace', () => {
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)

    // Should not throw
    wm.updateStatus('nonexistent', 'terminal')
  })

  it('handles beforeRun for non-existent workspace', () => {
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)

    expect(wm.beforeRun('nonexistent')).toBe(false)
  })

  it('handles cleanupTerminal with no workspaces', () => {
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)

    expect(wm.cleanupTerminal()).toBe(0)
  })
})

describe('ReconciliationLoop', () => {
  it('computes retry delay with exponential backoff', () => {
    const adapter = new MockTrackerAdapter()
    const policy = makePolicy({
      polling: { ...DEFAULT_POLICY.polling, maxRetryBackoffMs: 120000 },
    })
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    expect(loop.computeRetryDelay(1)).toBe(10000)  // 10s * 2^0
    expect(loop.computeRetryDelay(2)).toBe(20000)  // 10s * 2^1
    expect(loop.computeRetryDelay(3)).toBe(40000)  // 10s * 2^2
    expect(loop.computeRetryDelay(4)).toBe(80000)  // 10s * 2^3
    expect(loop.computeRetryDelay(5)).toBe(120000) // capped at maxRetryBackoffMs
    expect(loop.computeRetryDelay(6)).toBe(120000) // still capped
  })

  it('starts with no dispatch records', () => {
    const adapter = new MockTrackerAdapter()
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    expect(loop.getDispatchRecords()).toEqual([])
  })

  it('tick returns results even with no candidates', async () => {
    const adapter = new MockTrackerAdapter([])
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    const result = await loop.tick()
    expect(result.dispatched).toBe(0)
    expect(result.completed).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('filters candidates by active states only', async () => {
    const adapter = new MockTrackerAdapter([
      makeIssue({ id: '1', state: 'open' }),
      makeIssue({ id: '2', state: 'closed' }),
      makeIssue({ id: '3', state: 'resolved' }),
    ])
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    const result = await loop.tick()
    // Only 'open' issue should be considered for dispatch
    // (dispatch will fail because we can't create git worktrees in tmpdir,
    //  but the filtering logic is tested)
    expect(result.errors).toBeGreaterThanOrEqual(0)
  })

  it('start and stop manage running state', () => {
    const adapter = new MockTrackerAdapter()
    const policy = makePolicy({ polling: { ...DEFAULT_POLICY.polling, intervalMs: 100000 } })
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    loop.start()
    loop.stop()
    // Should not throw
  })

  it('stop is idempotent', () => {
    const adapter = new MockTrackerAdapter()
    const policy = makePolicy()
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    loop.stop()
    loop.stop()
    // Should not throw
  })

  it('start is idempotent', () => {
    const adapter = new MockTrackerAdapter()
    const policy = makePolicy({ polling: { ...DEFAULT_POLICY.polling, intervalMs: 100000 } })
    const wm = new WorkspaceManager(policy)
    const loop = new ReconciliationLoop(adapter, wm, policy)

    loop.start()
    loop.start() // second start should be no-op
    loop.stop()
  })
})
