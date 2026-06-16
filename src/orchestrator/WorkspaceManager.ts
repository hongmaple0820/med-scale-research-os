// SCALE Orchestrator — Workspace Manager
// 对齐 Symphony: git worktree isolation + lifecycle hooks + safety invariants
// Path: <workspace.root>/<sanitized_issue_identifier>
// Safety: agent cwd ⊆ workspace, workspace ⊆ root, name sanitation

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, normalize, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { logger } from '../core/logger.js'
import type { OrchestratorPolicy } from './PolicyLoader.js'

export interface WorkspaceState {
  id: string
  issueId: string
  branch: string
  path: string
  createdAt: string
  lastActivityAt: string
  agentPid?: number
  status: 'active' | 'idle' | 'terminal'
  turnsCompleted: number
}

export interface WorkspaceCreateResult {
  success: boolean
  path: string
  branch: string
  error?: string
}

// ---------------------------------------------------------------------------
// Safety invariants (aligned with Symphony)
// ---------------------------------------------------------------------------

const ALLOWED_CHARS_RE = /^[A-Za-z0-9._-]+$/

function sanitizeName(name: string): string {
  // Replace any chars NOT in the allowlist with underscores
  const sanitized = name.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!sanitized || sanitized.length > 64) {
    return `ws-${Date.now().toString(36)}`
  }
  return sanitized
}

function assertSafety(workspacePath: string, root: string, expectedAgentCwd?: string): void {
  const normalizedWs = normalize(resolve(workspacePath))
  const normalizedRoot = normalize(resolve(root))

  // Invariant 1: workspace path must be under configured root
  if (!normalizedWs.startsWith(normalizedRoot)) {
    throw new Error(`SAFETY: Workspace "${normalizedWs}" is outside root "${normalizedRoot}"`)
  }

  // Invariant 2: workspace name must pass sanitization
  const name = basename(normalizedWs)
  if (!ALLOWED_CHARS_RE.test(name)) {
    throw new Error(`SAFETY: Workspace name "${name}" contains disallowed characters`)
  }

  // Invariant 3: if agent cwd is known, it must be inside workspace
  if (expectedAgentCwd) {
    const normalizedCwd = normalize(resolve(expectedAgentCwd))
    if (!normalizedCwd.startsWith(normalizedWs)) {
      throw new Error(`SAFETY: Agent cwd "${normalizedCwd}" is outside workspace "${normalizedWs}"`)
    }
  }
}

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

export class WorkspaceManager {
  private workspaces: Map<string, WorkspaceState> = new Map()
  private policy: OrchestratorPolicy

  constructor(policy: OrchestratorPolicy) {
    this.policy = policy
  }

  /**
   * Create a git worktree for an issue.
   */
  create(issueId: string, baseBranch: string = 'master'): WorkspaceCreateResult {
    const root = resolve(this.policy.workspace.root)
    if (!existsSync(root)) mkdirSync(root, { recursive: true })

    const safeId = sanitizeName(issueId)
    const branch = `scale/${safeId}-${Date.now().toString(36)}`
    const wsPath = join(root, safeId)

    // Safety check before creation
    try { assertSafety(wsPath, root) } catch (err: any) {
      return { success: false, path: wsPath, branch, error: err.message }
    }

    // If worktree already exists, reuse it
    if (existsSync(wsPath)) {
      logger.info({ issueId, path: wsPath }, 'Worktree already exists, reusing')
      const ws = this.workspaces.get(safeId)
      if (ws) return { success: true, path: wsPath, branch: ws.branch }
      return { success: true, path: wsPath, branch }
    }

    try {
      // Run lifecycle hook: after_create
      if (this.policy.hooks.afterCreate) {
        execSync(this.policy.hooks.afterCreate, {
          env: { ...process.env, SCALE_ISSUE_ID: issueId, SCALE_WORKSPACE: wsPath, SCALE_BRANCH: branch },
          timeout: 30000,
        })
      }

      // Create git worktree
      execSync(`git worktree add "${wsPath}" -b "${branch}"`, {
        cwd: process.cwd(),
        timeout: 30000,
      })

      const ws: WorkspaceState = {
        id: safeId,
        issueId,
        branch,
        path: wsPath,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: 'active',
        turnsCompleted: 0,
      }

      this.workspaces.set(safeId, ws)
      logger.info({ issueId, path: wsPath, branch }, 'Worktree created')
      return { success: true, path: wsPath, branch }
    } catch (err: any) {
      logger.error({ err, issueId, path: wsPath }, 'Failed to create worktree')
      return { success: false, path: wsPath, branch, error: String(err) }
    }
  }

  /**
   * Run before agent dispatch.
   */
  beforeRun(issueId: string): boolean {
    const safeId = sanitizeName(issueId)
    const ws = this.workspaces.get(safeId)
    if (!ws) return false

    try {
      if (this.policy.hooks.beforeRun) {
        execSync(this.policy.hooks.beforeRun, {
          env: { ...process.env, SCALE_ISSUE_ID: issueId, SCALE_WORKSPACE: ws.path },
          timeout: 10000,
        })
      }
      ws.lastActivityAt = new Date().toISOString()
      this.workspaces.set(safeId, ws)
      return true
    } catch (err) {
      logger.warn({ err, issueId }, 'beforeRun hook failed')
      return false
    }
  }

  /**
   * Run after agent completes a turn.
   */
  afterRun(issueId: string): void {
    const safeId = sanitizeName(issueId)
    const ws = this.workspaces.get(safeId)
    if (!ws) return

    ws.turnsCompleted++
    ws.lastActivityAt = new Date().toISOString()

    if (this.policy.hooks.afterRun) {
      try {
        execSync(this.policy.hooks.afterRun, {
          env: { ...process.env, SCALE_ISSUE_ID: issueId, SCALE_WORKSPACE: ws.path, SCALE_TURN: String(ws.turnsCompleted) },
          timeout: 10000,
        })
      } catch { /* best-effort */ }
    }

    this.workspaces.set(safeId, ws)
  }

  /**
   * Clean up and remove a worktree.
   */
  remove(issueId: string, force: boolean = false): boolean {
    const safeId = sanitizeName(issueId)
    const ws = this.workspaces.get(safeId)
    if (!ws) return false

    try {
      if (this.policy.hooks.beforeRemove) {
        execSync(this.policy.hooks.beforeRemove, {
          env: { ...process.env, SCALE_ISSUE_ID: issueId, SCALE_WORKSPACE: ws.path, SCALE_BRANCH: ws.branch },
          timeout: 10000,
        })
      }
    } catch { /* best effort */ }

    try {
      execSync(`git worktree remove "${ws.path}" ${force ? '--force' : ''}`, {
        cwd: process.cwd(),
        timeout: 15000,
      })
    } catch {
      // If git worktree remove fails, try manual cleanup
      if (force) {
        try { rmSync(ws.path, { recursive: true, force: true }) } catch { /* ignore */ }
      } else {
        return false
      }
    }

    this.workspaces.delete(safeId)
    logger.info({ issueId, path: ws.path }, 'Worktree removed')
    return true
  }

  /**
   * Remove worktrees in terminal state.
   */
  cleanupTerminal(): number {
    let cleaned = 0
    for (const [id, ws] of this.workspaces) {
      if (ws.status === 'terminal') {
        if (this.remove(ws.issueId, true)) cleaned++
      }
    }
    // Also clean old workspaces by age
    const maxAgeMs = this.policy.workspace.maxWorkspaceAgeHours * 60 * 60 * 1000
    const now = Date.now()
    for (const [id, ws] of this.workspaces) {
      const age = now - new Date(ws.lastActivityAt).getTime()
      if (age > maxAgeMs && ws.status === 'idle') {
        ws.status = 'terminal'
        if (this.remove(ws.issueId, true)) cleaned++
      }
    }
    return cleaned
  }

  /**
   * Verify safety invariants for a workspace.
   */
  verifySafety(workspacePath: string, agentCwd?: string): { safe: boolean; violations: string[] } {
    try {
      assertSafety(workspacePath, this.policy.workspace.root, agentCwd)
      return { safe: true, violations: [] }
    } catch (err: any) {
      return { safe: false, violations: [err.message] }
    }
  }

  /**
   * Get all active workspaces.
   */
  listActive(): WorkspaceState[] {
    return Array.from(this.workspaces.values()).filter(w => w.status !== 'terminal')
  }

  /**
   * Get workspace count.
   */
  get activeCount(): number {
    return this.listActive().length
  }

  /**
   * Check if we can create more workspaces.
   */
  get canCreate(): boolean {
    return this.activeCount < this.policy.polling.maxParallelWorkspaces
  }

  /**
   * Mark a workspace as idle or terminal.
   */
  updateStatus(issueId: string, status: WorkspaceState['status']): void {
    const safeId = sanitizeName(issueId)
    const ws = this.workspaces.get(safeId)
    if (ws) {
      ws.status = status
      ws.lastActivityAt = new Date().toISOString()
      this.workspaces.set(safeId, ws)
    }
  }
}
