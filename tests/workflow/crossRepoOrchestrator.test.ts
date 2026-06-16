// Tests for CrossRepoOrchestrator — multi-repo git workflow coordination

import { describe, it, expect, beforeEach } from 'vitest'
import { CrossRepoOrchestrator, summarizeCrossRepoStatus } from '../../src/workflow/CrossRepoOrchestrator.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cross-repo-'))
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, '.gitkeep'), '')
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'pipe' })
}

function setupMoeProject(dir: string): void {
  // Root project
  initGitRepo(dir)

  // API sub-repo
  const apiDir = join(dir, 'services', 'api')
  mkdirSync(apiDir, { recursive: true })
  initGitRepo(apiDir)

  // Client sub-repo
  const clientDir = join(dir, 'services', 'client')
  mkdirSync(clientDir, { recursive: true })
  initGitRepo(clientDir)

  // Workspace topology config
  const scaleDir = join(dir, '.scale')
  mkdirSync(scaleDir, { recursive: true })
  writeFileSync(join(scaleDir, 'workspace.json'), JSON.stringify({
    version: 1,
    topology: 'moe',
    repositories: [
      { name: 'root', path: '.', role: 'root', required: true },
      { name: 'api', path: 'services/api', role: 'service', required: true },
      { name: 'client', path: 'services/client', role: 'service', required: true },
    ],
  }, null, 2))
}

describe('CrossRepoOrchestrator', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
    setupMoeProject(dir)
  })

  describe('branch management', () => {
    it('creates coordinated branch across repos', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      const branch = orch.createCoordinatedBranch('feature/auth-upgrade', ['api', 'client'], { createdBy: 'test' })
      expect(branch.name).toBe('feature/auth-upgrade')
      expect(branch.repos).toEqual(['api', 'client'])
      expect(branch.createdBy).toBe('test')
    })

    it('throws for unknown repos', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      expect(() => orch.createCoordinatedBranch('feature/x', ['nonexistent'])).toThrow('not found in topology')
    })

    it('lists managed branches', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/a', ['api'])
      orch.createCoordinatedBranch('feature/b', ['client'])
      expect(orch.getManagedBranches()).toHaveLength(2)
    })

    it('deletes coordinated branch and associated changes', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/temp', ['api'])
      orch.registerChange({ repoName: 'api', branch: 'feature/temp', files: [], commitShas: [], dependsOn: [], description: 'test' })
      orch.deleteCoordinatedBranch('feature/temp')
      expect(orch.getManagedBranches()).toHaveLength(0)
    })
  })

  describe('change tracking', () => {
    it('registers change for a repo', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      const change = orch.registerChange({
        repoName: 'api',
        branch: 'feature/auth',
        files: ['src/auth.ts'],
        commitShas: ['abc123'],
        dependsOn: [],
        description: 'Upgrade auth module',
      })
      expect(change.repoName).toBe('api')
      expect(change.status).toBe('planned')
    })

    it('updates change status', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.registerChange({
        repoName: 'api',
        branch: 'feature/auth',
        files: [],
        commitShas: [],
        dependsOn: [],
        description: 'test',
      })
      orch.updateChangeStatus('api', 'feature/auth', 'ready')
      const status = orch.getCrossRepoStatus()
      expect(status.activeChanges[0].status).toBe('ready')
    })

    it('persists state across instances', () => {
      const orch1 = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch1.createCoordinatedBranch('feature/persist', ['api'])
      orch1.registerChange({ repoName: 'api', branch: 'feature/persist', files: [], commitShas: [], dependsOn: [], description: 'test' })

      const orch2 = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      expect(orch2.getManagedBranches()).toHaveLength(1)
      expect(orch2.getCrossRepoStatus().activeChanges).toHaveLength(1)
    })
  })

  describe('merge planning', () => {
    it('builds merge plan with correct dependency order', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/upgrade', ['api', 'client'])

      orch.registerChange({
        repoName: 'api',
        branch: 'feature/upgrade',
        files: ['src/auth.ts'],
        commitShas: ['abc'],
        dependsOn: [],
        description: 'API auth changes',
      })
      orch.registerChange({
        repoName: 'client',
        branch: 'feature/upgrade',
        files: ['src/client.ts'],
        commitShas: ['def'],
        dependsOn: ['api'],
        description: 'Client uses new auth',
      })

      orch.updateChangeStatus('api', 'feature/upgrade', 'ready')
      orch.updateChangeStatus('client', 'feature/upgrade', 'ready')

      const plan = orch.buildMergePlan('feature/upgrade')
      expect(plan.mergeOrder).toEqual(['api', 'client'])
      expect(plan.blockers).toEqual([])
    })

    it('detects missing dependency changes', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/broken', ['client'])
      orch.registerChange({
        repoName: 'client',
        branch: 'feature/broken',
        files: [],
        commitShas: [],
        dependsOn: ['api'],
        description: 'Client needs api changes',
      })
      orch.updateChangeStatus('client', 'feature/broken', 'ready')

      const plan = orch.buildMergePlan('feature/broken')
      expect(plan.blockers.length).toBeGreaterThan(0)
      expect(plan.blockers[0]).toContain('api')
    })

    it('blocks when changes are still planned', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/wip', ['api'])
      orch.registerChange({
        repoName: 'api',
        branch: 'feature/wip',
        files: [],
        commitShas: [],
        dependsOn: [],
        description: 'Still planning',
      })

      const plan = orch.buildMergePlan('feature/wip')
      expect(plan.blockers.length).toBeGreaterThan(0)
      expect(plan.blockers[0]).toContain('planned')
    })

    it('returns empty plan for no changes', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      const plan = orch.buildMergePlan('nonexistent')
      expect(plan.changes).toEqual([])
      expect(plan.blockers.length).toBeGreaterThan(0)
    })
  })

  describe('shipCoordinated', () => {
    it('blocks ship when blockers exist', async () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/blocked', ['api'])
      orch.registerChange({
        repoName: 'api',
        branch: 'feature/blocked',
        files: [],
        commitShas: [],
        dependsOn: [],
        description: 'Not ready',
      })
      // status is 'planned' — will be a blocker

      const result = await orch.shipCoordinated('feature/blocked')
      expect(result.success).toBe(false)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('dry-run ship succeeds when no blockers', async () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/ready', ['api'])
      orch.registerChange({
        repoName: 'api',
        branch: 'feature/ready',
        files: ['src/x.ts'],
        commitShas: ['abc'],
        dependsOn: [],
        description: 'Ready to go',
      })
      orch.updateChangeStatus('api', 'feature/ready', 'ready')

      const result = await orch.shipCoordinated('feature/ready', { dryRun: true })
      expect(result.success).toBe(true)
      expect(result.steps.length).toBeGreaterThan(0)
    })
  })

  describe('getCrossRepoStatus', () => {
    it('returns comprehensive status', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      orch.createCoordinatedBranch('feature/status', ['api', 'client'])
      orch.registerChange({ repoName: 'api', branch: 'feature/status', files: [], commitShas: [], dependsOn: [], description: 'test' })

      const status = orch.getCrossRepoStatus()
      expect(status.topology).toBe('multi-repo')
      expect(status.managedBranches).toHaveLength(1)
      expect(status.activeChanges).toHaveLength(1)
      expect(status.repoStates.length).toBeGreaterThan(0)
      expect(status.recommendations.length).toBeGreaterThan(0)
    })

    it('detects dirty repos', () => {
      const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      // Make api repo dirty
      writeFileSync(join(dir, 'services', 'api', 'dirty.txt'), 'uncommitted')

      const status = orch.getCrossRepoStatus()
      const apiState = status.repoStates.find(r => r.name === 'api')
      expect(apiState?.clean).toBe(false)
    })

    it('resolves MOE sibling repositories outside the root checkout', () => {
      const parent = makeTempDir()
      const rootDir = join(parent, 'root')
      const apiDir = join(parent, 'api')
      try {
        mkdirSync(rootDir, { recursive: true })
        mkdirSync(apiDir, { recursive: true })
        initGitRepo(rootDir)
        initGitRepo(apiDir)
        mkdirSync(join(rootDir, '.scale'), { recursive: true })
        writeFileSync(join(rootDir, '.scale', 'workspace.json'), JSON.stringify({
          version: 1,
          topology: 'moe',
          repositories: [
            { name: 'root', path: '.', role: 'root', required: true },
            { name: 'api', path: '../api', role: 'external', required: true },
          ],
        }, null, 2))

        const orch = new CrossRepoOrchestrator({ projectDir: rootDir, scaleDir: join(rootDir, '.scale') })
        const status = orch.getCrossRepoStatus()

        expect(status.repoStates.find(r => r.name === 'api')).toMatchObject({
          path: '../api',
          branch: 'master',
          clean: true,
        })
      } finally {
        rmSync(parent, { recursive: true, force: true })
      }
    })
  })
})

describe('summarizeCrossRepoStatus', () => {
  it('produces readable report', () => {
    const dir = makeTempDir()
    setupMoeProject(dir)
    const orch = new CrossRepoOrchestrator({ projectDir: dir, scaleDir: join(dir, '.scale') })
    orch.createCoordinatedBranch('feature/test', ['api'])

    const text = summarizeCrossRepoStatus(orch.getCrossRepoStatus())
    expect(text).toContain('Cross-Repo Status')
    expect(text).toContain('Topology')
    expect(text).toContain('Repository States')
  })
})
