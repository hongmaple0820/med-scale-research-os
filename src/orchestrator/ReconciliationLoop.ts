// SCALE Orchestrator — Reconciliation Loop
// 对齐 Symphony: poll → filter → isolate → dispatch → reconcile → notify → loop
// State machine: Unclaimed → Claimed → Running → RetryQueued → Released
// Startup recovery: no persistent orchestrator state — cleanup + repoll

import { EventEmitter } from 'node:events'
import { logger } from '../core/logger.js'
import type { ITrackerAdapter, TrackerIssue, IssueState } from './TrackerAdapter.js'
import type { OrchestratorPolicy } from './PolicyLoader.js'
import { WorkspaceManager, type WorkspaceState } from './WorkspaceManager.js'
import * as crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Orchestration State Machine
// ---------------------------------------------------------------------------

export type OrchestrationState = 'Unclaimed' | 'Claimed' | 'Running' | 'RetryQueued' | 'Released'

export interface DispatchRecord {
  issueId: string
  state: OrchestrationState
  workspaceId: string
  branch: string
  claimedAt: string
  lastActivityAt: string
  attempts: number
  maxAttempts: number
  turnsCompleted: number
  pid?: number
}

// ---------------------------------------------------------------------------
// Reconciliation Loop
// ---------------------------------------------------------------------------

export interface ReconciliationEvents {
  claimed: (issueId: string) => void
  dispatched: (record: DispatchRecord) => void
  completed: (issueId: string, success: boolean) => void
  retryQueued: (issueId: string, attempt: number) => void
  released: (issueId: string) => void
  error: (issueId: string, error: Error) => void
}

export declare interface ReconciliationLoop {
  on<E extends keyof ReconciliationEvents>(event: E, listener: ReconciliationEvents[E]): this
  emit<E extends keyof ReconciliationEvents>(event: E, ...args: Parameters<ReconciliationEvents[E]>): boolean
}

export class ReconciliationLoop extends EventEmitter {
  private dispatchRecords: Map<string, DispatchRecord> = new Map()
  private workspaceManager: WorkspaceManager
  private tracker: ITrackerAdapter
  private policy: OrchestratorPolicy
  private running = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    tracker: ITrackerAdapter,
    workspaceManager: WorkspaceManager,
    policy: OrchestratorPolicy,
  ) {
    super()
    this.tracker = tracker
    this.workspaceManager = workspaceManager
    this.policy = policy
  }

  /**
   * Main reconciliation tick.
   * Called on each polling interval.
   */
  async tick(): Promise<{ dispatched: number; completed: number; errors: number }> {
    let dispatched = 0
    let completed = 0
    let errors = 0

    try {
      // 1. Reconcile running: check status of active dispatches
      await this.reconcileRunning()

      // 2. Preflight validation: verify workspace safety
      this.preflightValidation()

      // 3. Fetch candidates from tracker
      const candidates = await this.fetchCandidates()

      // 4. Sort by priority
      candidates.sort((a, b) => a.priority - b.priority)

      // 5. Dispatch eligible candidates
      for (const candidate of candidates) {
        if (!this.workspaceManager.canCreate) break
        try {
          const dispatched_ = await this.dispatch(candidate)
          if (dispatched_) dispatched++
        } catch (err: any) {
          logger.error({ err, issueId: candidate.id }, 'Dispatch failed')
          this.emit('error', candidate.id, err)
          errors++
        }
      }

      // 6. Notify: emit completion events
      completed = this.emitCompletions()
    } catch (err: any) {
      logger.error({ err }, 'Reconciliation tick failed')
      errors++
    }

    return { dispatched, completed, errors }
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.running) return
    this.running = true

    // Startup recovery: clean terminal workspaces + repoll
    this.startupRecovery()

    const interval = this.policy.polling.intervalMs
    logger.info({ interval }, 'Reconciliation loop started')

    const run = async () => {
      if (!this.running) return
      const result = await this.tick()
      logger.info({ ...result, active: this.workspaceManager.activeCount }, 'Reconciliation tick')
      if (this.running) this.timer = setTimeout(run, interval)
    }

    // First tick immediately
    void run()
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    logger.info('Reconciliation loop stopped')
  }

  /**
   * Get dispatch records for status display.
   */
  getDispatchRecords(): DispatchRecord[] {
    return Array.from(this.dispatchRecords.values())
  }

  /**
   * Compute retry delay using exponential backoff.
   * delay = min(10000 * 2^(attempt-1), max_retry_backoff_ms)
   */
  computeRetryDelay(attempt: number): number {
    const base = 10000
    const exponential = base * Math.pow(2, attempt - 1)
    return Math.min(exponential, this.policy.polling.maxRetryBackoffMs)
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async startupRecovery(): Promise<void> {
    logger.info('Running startup recovery')
    this.workspaceManager.cleanupTerminal()

    // Re-fetch and re-dispatch any active work
    const candidates = await this.fetchCandidates()
    for (const c of candidates) {
      if (!this.dispatchRecords.has(c.id) && this.workspaceManager.canCreate) {
        await this.dispatch(c)
      }
    }
  }

  private preflightValidation(): void {
    const workspaces = this.workspaceManager.listActive()
    for (const ws of workspaces) {
      const safety = this.workspaceManager.verifySafety(ws.path)
      if (!safety.safe) {
        logger.error({ workspace: ws.id, violations: safety.violations }, 'Workspace safety violation')
        this.workspaceManager.updateStatus(ws.issueId, 'terminal')
      }
    }
  }

  private async fetchCandidates(): Promise<TrackerIssue[]> {
    const allIssues = await this.tracker.fetchCandidates()
    const activeStates = this.policy.tracker.activeStates
    const terminalStates = this.policy.tracker.terminalStates

    return allIssues.filter(issue => {
      // Must be in active state
      const state = issue.state as string
      if (!activeStates.includes(state)) return false
      if (terminalStates.includes(state)) return false

      // Not already dispatched (unless retryable)
      const record = this.dispatchRecords.get(issue.id)
      if (record) {
        if (record.state === 'Released') return false
        if (record.state === 'Running') return false
        if (record.state === 'RetryQueued') return record.attempts < record.maxAttempts
        if (record.state === 'Claimed') return false
      }

      // All blocked_by must be in terminal states
      if (issue.blockedBy.length > 0) {
        const allBlockersResolved = issue.blockedBy.every(blockerId => {
          const rec = this.dispatchRecords.get(blockerId)
          return rec?.state === 'Released'
        })
        if (!allBlockersResolved) return false
      }

      return true
    })
  }

  private async dispatch(issue: TrackerIssue): Promise<boolean> {
    const record = this.dispatchRecords.get(issue.id)
    const attempt = record ? record.attempts + 1 : 1
    const maxAttempts = this.policy.polling.maxAttempts

    if (attempt > maxAttempts) {
      logger.warn({ issueId: issue.id, attempts: attempt }, 'Max attempts exceeded')
      await this.tracker.updateState(issue.id, 'cancelled')
      return false
    }

    // Claim the issue
    await this.tracker.updateState(issue.id, 'in_progress')
    this.emit('claimed', issue.id)

    // Create isolated workspace
    const result = this.workspaceManager.create(issue.id)
    if (!result.success) {
      logger.error({ issueId: issue.id, error: result.error }, 'Workspace creation failed')
      await this.tracker.updateState(issue.id, 'open')
      return false
    }

    // Run beforeRun hook
    this.workspaceManager.beforeRun(issue.id)

    const dispatchRecord: DispatchRecord = {
      issueId: issue.id,
      state: 'Claimed',
      workspaceId: result.path,
      branch: result.branch,
      claimedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      attempts: attempt,
      maxAttempts,
      turnsCompleted: 0,
    }

    this.dispatchRecords.set(issue.id, dispatchRecord)
    this.emit('dispatched', dispatchRecord)

    // Transition to Running
    dispatchRecord.state = 'Running'
    this.dispatchRecords.set(issue.id, dispatchRecord)

    logger.info({ issueId: issue.id, path: result.path, branch: result.branch, attempt }, 'Issue dispatched')

    return true
  }

  private async reconcileRunning(): Promise<void> {
    for (const [id, record] of this.dispatchRecords) {
      if (record.state !== 'Running') continue

      // Check if agent process is still alive
      if (record.pid) {
        try { process.kill(record.pid, 0) } catch { /* process gone */ }
      }

      // Check if turns exhausted
      if (record.turnsCompleted >= this.policy.agent.maxTurns) {
        await this.completeIssue(id, true)
      }

      // Check timeout
      const elapsed = Date.now() - new Date(record.claimedAt).getTime()
      if (elapsed > this.policy.agent.timeoutMinutes * 60 * 1000) {
        logger.warn({ issueId: id, elapsed }, 'Agent timeout — queueing retry')
        record.state = 'RetryQueued'
        this.dispatchRecords.set(id, record)
        this.emit('retryQueued', id, record.attempts)
      }
    }
  }

  private async completeIssue(issueId: string, success: boolean): Promise<void> {
    const record = this.dispatchRecords.get(issueId)
    if (!record) return

    if (success) {
      await this.tracker.updateState(issueId, 'resolved')
      record.state = 'Released'
      this.emit('completed', issueId, true)
      this.emit('released', issueId)
    } else {
      if (record.attempts < record.maxAttempts) {
        record.state = 'RetryQueued'
        this.emit('retryQueued', issueId, record.attempts + 1)
      } else {
        await this.tracker.updateState(issueId, 'cancelled')
        record.state = 'Released'
        this.emit('completed', issueId, false)
        this.emit('released', issueId)
      }
    }

    this.dispatchRecords.set(issueId, record)
    this.workspaceManager.updateStatus(issueId, 'terminal')
    this.workspaceManager.afterRun(issueId)
  }

  private emitCompletions(): number {
    let count = 0
    for (const [id, record] of this.dispatchRecords) {
      if (record.state === 'Released' && this.workspaceManager.activeCount > 0) {
        count++
      }
    }
    return count
  }
}
