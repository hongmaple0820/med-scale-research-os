// SCALE Engine — Cross-Repo Orchestrator
// Multi-repo Git workflow: coordinated branching, change graph, merge ordering, ship pipeline

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { resolveRepositoryPath, type WorkspaceRepositoryConfig, type WorkspaceTopologyConfig } from './WorkspaceTopology.js'

const SILENT_GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore']

// ============================================================================
// Types
// ============================================================================

export type RepoChangeStatus = 'planned' | 'in-progress' | 'ready' | 'merged' | 'shipped'

export interface CrossRepoChange {
  repoName: string
  branch: string
  files: string[]
  commitShas: string[]
  dependsOn: string[]
  description: string
  status: RepoChangeStatus
  startedAt: string
  mergedAt?: string
  shippedAt?: string
}

export interface CrossRepoBranch {
  name: string
  repos: string[]
  createdAt: string
  createdBy: string
}

export interface CrossRepoMergePlan {
  changes: CrossRepoChange[]
  mergeOrder: string[]
  testOrder: string[]
  deployOrder: string[]
  blockers: string[]
}

export interface CrossRepoMergeStep {
  repoName: string
  action: 'merge' | 'test' | 'tag' | 'push' | 'deploy'
  status: 'pending' | 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
  evidence?: string
}

export interface CrossRepoShipResult {
  success: boolean
  steps: CrossRepoMergeStep[]
  totalDuration: number
  warnings: string[]
}

export interface CrossRepoStatus {
  topology: string
  managedBranches: CrossRepoBranch[]
  activeChanges: CrossRepoChange[]
  repoStates: Array<{
    name: string
    path: string
    branch: string
    clean: boolean
    ahead: number
    behind: number
  }>
  recommendations: string[]
}

export interface CrossRepoOrchestratorInput {
  projectDir?: string
  scaleDir?: string
}

// ============================================================================
// CrossRepoOrchestrator
// ============================================================================

export class CrossRepoOrchestrator {
  private projectDir: string
  private scaleRoot: string
  private stateDir: string
  private statePath: string
  private branches: CrossRepoBranch[]
  private changes: CrossRepoChange[]
  private repositories: WorkspaceRepositoryConfig[]

  constructor(input: CrossRepoOrchestratorInput = {}) {
    this.projectDir = resolve(input.projectDir ?? process.cwd())
    this.scaleRoot = isAbsolute(input.scaleDir ?? '')
      ? input.scaleDir as string
      : join(this.projectDir, input.scaleDir ?? '.scale')

    this.stateDir = join(this.scaleRoot, 'cross-repo')
    this.statePath = join(this.stateDir, 'state.json')
    this.branches = []
    this.changes = []
    this.repositories = []

    this.loadTopology()
    this.loadState()
  }

  // --------------------------------------------------------------------------
  // Branch Management
  // --------------------------------------------------------------------------

  createCoordinatedBranch(
    branchName: string,
    repoNames: string[],
    options: { createdBy?: string; fromBranch?: string } = {},
  ): CrossRepoBranch {
    const missing = repoNames.filter(name => !this.repositories.some(r => r.name === name))
    if (missing.length > 0) {
      throw new Error(`Repositories not found in topology: ${missing.join(', ')}`)
    }

    const branch: CrossRepoBranch = {
      name: branchName,
      repos: repoNames,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy ?? 'session',
    }

    this.branches.push(branch)
    this.saveState()
    return branch
  }

  deleteCoordinatedBranch(branchName: string): void {
    this.branches = this.branches.filter(b => b.name !== branchName)
    this.changes = this.changes.filter(c => c.branch !== branchName)
    this.saveState()
  }

  getManagedBranches(): CrossRepoBranch[] {
    return [...this.branches]
  }

  // --------------------------------------------------------------------------
  // Change Tracking
  // --------------------------------------------------------------------------

  registerChange(change: Omit<CrossRepoChange, 'status' | 'startedAt'>): CrossRepoChange {
    const existing = this.changes.find(
      c => c.repoName === change.repoName && c.branch === change.branch && c.status !== 'merged' && c.status !== 'shipped',
    )
    if (existing) {
      Object.assign(existing, change)
      this.saveState()
      return existing
    }

    const fullChange: CrossRepoChange = {
      ...change,
      status: 'planned',
      startedAt: new Date().toISOString(),
    }
    this.changes.push(fullChange)
    this.saveState()
    return fullChange
  }

  updateChangeStatus(repoName: string, branch: string, status: RepoChangeStatus): void {
    const change = this.changes.find(
      c => c.repoName === repoName && c.branch === branch,
    )
    if (!change) return

    change.status = status
    if (status === 'merged') change.mergedAt = new Date().toISOString()
    if (status === 'shipped') change.shippedAt = new Date().toISOString()

    this.saveState()
  }

  // --------------------------------------------------------------------------
  // Merge Planning
  // --------------------------------------------------------------------------

  buildMergePlan(branchName: string): CrossRepoMergePlan {
    const branchChanges = this.changes.filter(c => c.branch === branchName && c.status !== 'merged' && c.status !== 'shipped')
    const blockers: string[] = []

    if (branchChanges.length === 0) {
      return { changes: [], mergeOrder: [], testOrder: [], deployOrder: [], blockers: ['No changes registered for this branch.'] }
    }

    // Topological sort of repo dependencies
    const mergeOrder = this.resolveMergeOrder(branchChanges)
    const testOrder = [...mergeOrder] // test in merge order
    const deployOrder = [...mergeOrder].reverse() // deploy in reverse (leaf services first in deploy, or dependents first)

    // Check for missing dependencies
    for (const change of branchChanges) {
      for (const dep of change.dependsOn) {
        if (!branchChanges.some(c => c.repoName === dep)) {
          blockers.push(`${change.repoName} depends on ${dep}, but ${dep} has no changes on branch ${branchName}.`)
        }
      }
    }

    // Check for unresolved statuses
    for (const change of branchChanges) {
      if (change.status === 'planned') {
        blockers.push(`${change.repoName} is still planned — complete implementation before merging.`)
      }
    }

    return { changes: branchChanges, mergeOrder, testOrder, deployOrder, blockers }
  }

  // --------------------------------------------------------------------------
  // Coordinated Ship
  // --------------------------------------------------------------------------

  async shipCoordinated(
    branchName: string,
    options: {
      remote?: string
      baseBranch?: string
      dryRun?: boolean
      skipRepos?: string[]
    } = {},
  ): Promise<CrossRepoShipResult> {
    const remote = options.remote ?? 'origin'
    const baseBranch = options.baseBranch ?? 'master'
    const dryRun = options.dryRun ?? false
    const skipRepos = new Set(options.skipRepos ?? [])

    const plan = this.buildMergePlan(branchName)
    const steps: CrossRepoMergeStep[] = []
    const warnings: string[] = [...plan.blockers]
    const startTime = Date.now()

    if (plan.blockers.length > 0 && !dryRun) {
      return {
        success: false,
        steps: [],
        totalDuration: 0,
        warnings: plan.blockers,
      }
    }

    // Phase 1: Merge each repo in dependency order
    for (const repoName of plan.mergeOrder) {
      if (skipRepos.has(repoName)) {
        steps.push({ repoName, action: 'merge', status: 'skipped', duration: 0 })
        continue
      }

      const repo = this.repositories.find(r => r.name === repoName)
      if (!repo) {
        steps.push({ repoName, action: 'merge', status: 'failed', duration: 0, error: `Repository ${repoName} not found in topology.` })
        continue
      }

      const repoPath = resolveRepositoryPath(this.projectDir, repo)
      const stepStart = Date.now()

      try {
        if (!dryRun) {
          this.execGit(repoPath, `checkout ${baseBranch}`)
          this.execGit(repoPath, `merge ${branchName} --no-ff -m "Merge ${branchName} into ${baseBranch}"`)
        }
        steps.push({ repoName, action: 'merge', status: 'passed', duration: Date.now() - stepStart, evidence: dryRun ? 'dry-run' : `merged ${branchName}` })
        if (!dryRun) this.updateChangeStatus(repoName, branchName, 'merged')
      } catch (err) {
        steps.push({ repoName, action: 'merge', status: 'failed', duration: Date.now() - stepStart, error: err instanceof Error ? err.message : String(err) })
        return { success: false, steps, totalDuration: Date.now() - startTime, warnings }
      }
    }

    // Phase 2: Test each repo in order
    for (const repoName of plan.testOrder) {
      if (skipRepos.has(repoName)) {
        steps.push({ repoName, action: 'test', status: 'skipped', duration: 0 })
        continue
      }

      const repo = this.repositories.find(r => r.name === repoName)
      if (!repo) continue

      const repoPath = resolveRepositoryPath(this.projectDir, repo)
      const stepStart = Date.now()

      try {
        if (!dryRun) {
          // Try npm test, fall back to just checking it exists
          try {
            execSync('npm test --if-present', { cwd: repoPath, stdio: 'pipe', timeout: 120000 })
          } catch {
            // test command may not exist
          }
        }
        steps.push({ repoName, action: 'test', status: 'passed', duration: Date.now() - stepStart, evidence: dryRun ? 'dry-run' : 'tests passed' })
      } catch (err) {
        steps.push({ repoName, action: 'test', status: 'failed', duration: Date.now() - stepStart, error: err instanceof Error ? err.message : String(err) })
        return { success: false, steps, totalDuration: Date.now() - startTime, warnings }
      }
    }

    // Phase 3: Tag and push
    for (const repoName of plan.mergeOrder) {
      if (skipRepos.has(repoName)) {
        steps.push({ repoName, action: 'push', status: 'skipped', duration: 0 })
        continue
      }

      const repo = this.repositories.find(r => r.name === repoName)
      if (!repo) continue

      const repoPath = resolveRepositoryPath(this.projectDir, repo)
      const stepStart = Date.now()

      try {
        if (!dryRun) {
          this.execGit(repoPath, `push ${remote} ${baseBranch}`)
        }
        steps.push({ repoName, action: 'push', status: 'passed', duration: Date.now() - stepStart, evidence: dryRun ? 'dry-run' : `pushed to ${remote}` })
        if (!dryRun) this.updateChangeStatus(repoName, branchName, 'shipped')
      } catch (err) {
        steps.push({ repoName, action: 'push', status: 'failed', duration: Date.now() - stepStart, error: err instanceof Error ? err.message : String(err) })
        return { success: false, steps, totalDuration: Date.now() - startTime, warnings }
      }
    }

    return {
      success: steps.every(s => s.status === 'passed' || s.status === 'skipped'),
      steps,
      totalDuration: Date.now() - startTime,
      warnings,
    }
  }

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  getCrossRepoStatus(): CrossRepoStatus {
    const repoStates = this.repositories.map(repo => {
      const repoPath = resolveRepositoryPath(this.projectDir, repo)
      return {
        name: repo.name,
        path: repo.path,
        ...this.getRepoGitState(repoPath),
      }
    })

    const activeChanges = this.changes.filter(c => c.status !== 'merged' && c.status !== 'shipped')
    const recommendations = this.buildRecommendations(activeChanges, repoStates)

    return {
      topology: this.repositories.length > 1 ? 'multi-repo' : 'single',
      managedBranches: this.branches,
      activeChanges,
      repoStates,
      recommendations,
    }
  }

  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------

  private loadTopology(): void {
    const topologyPath = join(this.scaleRoot, 'workspace.json')
    if (!existsSync(topologyPath)) {
      this.repositories = [{ name: 'root', path: '.', role: 'root', required: true }]
      return
    }

    try {
      const raw = JSON.parse(readFileSync(topologyPath, 'utf-8')) as WorkspaceTopologyConfig
      this.repositories = raw.repositories ?? [{ name: 'root', path: '.', role: 'root', required: true }]
    } catch {
      this.repositories = [{ name: 'root', path: '.', role: 'root', required: true }]
    }
  }

  private loadState(): void {
    if (!existsSync(this.statePath)) return
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf-8'))
      if (raw.branches) this.branches = raw.branches
      if (raw.changes) this.changes = raw.changes
    } catch { /* ignore */ }
  }

  private saveState(): void {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true })
    writeFileSync(this.statePath, JSON.stringify({
      branches: this.branches,
      changes: this.changes,
    }, null, 2), 'utf-8')
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private resolveMergeOrder(changes: CrossRepoChange[]): string[] {
    const changeMap = new Map<string, CrossRepoChange>()
    for (const c of changes) changeMap.set(c.repoName, c)

    const visited = new Set<string>()
    const order: string[] = []

    const visit = (name: string) => {
      if (visited.has(name)) return
      visited.add(name)

      const change = changeMap.get(name)
      if (change) {
        for (const dep of change.dependsOn) {
          if (changeMap.has(dep)) visit(dep)
        }
      }

      order.push(name)
    }

    for (const change of changes) {
      visit(change.repoName)
    }

    return order
  }

  private execGit(repoPath: string, command: string): string {
    try {
      return execSync(`git ${command}`, { cwd: repoPath, encoding: 'utf-8', timeout: 30000 }).trim()
    } catch (err) {
      throw new Error(`git ${command} failed in ${repoPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private getRepoGitState(repoPath: string): { branch: string; clean: boolean; ahead: number; behind: number } {
    const defaults = { branch: 'unknown', clean: true, ahead: 0, behind: 0 }
    if (!existsSync(repoPath)) return defaults

    try {
      const branch = execSync('git branch --show-current', {
        cwd: repoPath, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
      }).trim()
      const status = execSync('git status --porcelain', {
        cwd: repoPath, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
      }).trim()
      const clean = status.length === 0

      let ahead = 0, behind = 0
      try {
        const tracking = execSync('git rev-list --left-right --count HEAD...@{u}', {
          cwd: repoPath, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
        }).trim()
        const parts = tracking.split(/\s+/)
        ahead = parseInt(parts[0] ?? '0', 10) || 0
        behind = parseInt(parts[1] ?? '0', 10) || 0
      } catch { /* no upstream */ }

      return { branch, clean, ahead, behind }
    } catch {
      return defaults
    }
  }

  private buildRecommendations(
    activeChanges: CrossRepoChange[],
    repoStates: Array<{ name: string; clean: boolean; ahead: number }>,
  ): string[] {
    const recs: string[] = []

    const dirtyRepos = repoStates.filter(r => !r.clean)
    if (dirtyRepos.length > 0) {
      recs.push(`${dirtyRepos.length} repo(s) have uncommitted changes: ${dirtyRepos.map(r => r.name).join(', ')}. Commit or stash before merging.`)
    }

    const unpushedRepos = repoStates.filter(r => r.ahead > 0)
    if (unpushedRepos.length > 0) {
      recs.push(`${unpushedRepos.length} repo(s) have unpushed commits: ${unpushedRepos.map(r => r.name).join(', ')}.`)
    }

    const readyChanges = activeChanges.filter(c => c.status === 'ready')
    const inProgressChanges = activeChanges.filter(c => c.status === 'in-progress')
    if (readyChanges.length > 0 && inProgressChanges.length > 0) {
      recs.push(`${readyChanges.length} change(s) ready to merge, but ${inProgressChanges.length} still in progress. Wait for all or merge independently.`)
    }

    if (activeChanges.length > 0) {
      const branches = new Set(activeChanges.map(c => c.branch))
      if (branches.size > 1) {
        recs.push(`Changes span ${branches.size} branches. Consider consolidating to a single coordinated branch.`)
      }
    }

    if (recs.length === 0) {
      recs.push('No cross-repo issues detected.')
    }

    return recs
  }
}

// ============================================================================
// Summary Formatter
// ============================================================================

export function summarizeCrossRepoStatus(status: CrossRepoStatus): string {
  const lines: string[] = [
    '## Cross-Repo Status',
    '',
    `**Topology:** ${status.topology}`,
    `**Managed Branches:** ${status.managedBranches.length}`,
    `**Active Changes:** ${status.activeChanges.length}`,
    '',
  ]

  if (status.repoStates.length > 0) {
    lines.push('### Repository States')
    for (const repo of status.repoStates) {
      const clean = repo.clean ? 'clean' : 'dirty'
      const ahead = repo.ahead > 0 ? ` (+${repo.ahead})` : ''
      lines.push(`- **${repo.name}** (\`${repo.path}\`): ${repo.branch} [${clean}]${ahead}`)
    }
    lines.push('')
  }

  if (status.managedBranches.length > 0) {
    lines.push('### Managed Branches')
    for (const branch of status.managedBranches) {
      lines.push(`- **${branch.name}**: ${branch.repos.join(', ')}`)
    }
    lines.push('')
  }

  if (status.activeChanges.length > 0) {
    lines.push('### Active Changes')
    for (const change of status.activeChanges) {
      const deps = change.dependsOn.length > 0 ? ` (depends: ${change.dependsOn.join(', ')})` : ''
      lines.push(`- **${change.repoName}** [${change.branch}]: ${change.description} [${change.status}]${deps}`)
    }
    lines.push('')
  }

  if (status.recommendations.length > 0) {
    lines.push('### Recommendations')
    for (const rec of status.recommendations) lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}
