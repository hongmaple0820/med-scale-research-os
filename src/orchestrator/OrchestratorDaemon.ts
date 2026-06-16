// SCALE Orchestrator — Daemon
// 对齐 Symphony: long-running daemon with poll loop + workspace lifecycle
// Manages: start, stop, status, signal handling, graceful shutdown

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import { PolicyLoader } from './PolicyLoader.js'
import { WorkspaceManager } from './WorkspaceManager.js'
import { ReconciliationLoop } from './ReconciliationLoop.js'
import { GitHubTrackerAdapter, MockTrackerAdapter, type ITrackerAdapter, type IssueState } from './TrackerAdapter.js'

// ---------------------------------------------------------------------------
// PID file management (for daemon lifecycle)
// ---------------------------------------------------------------------------

const DAEMON_DIR = '.scale/orchestrator'
const PID_FILE = join(DAEMON_DIR, 'daemon.pid')
const LOG_FILE = join(DAEMON_DIR, 'daemon.log')

export interface DaemonStatus {
  running: boolean
  pid?: number
  startedAt?: string
  policyPath: string
  policyHash: string
  activeWorkspaces: number
  totalDispatched: number
  activeIssues: string[]
  lastTickAt?: string
  uptime?: number
}

export class OrchestratorDaemon {
  private policyLoader = new PolicyLoader()
  private workspaceManager: WorkspaceManager | null = null
  private reconciliationLoop: ReconciliationLoop | null = null
  private tracker: ITrackerAdapter | null = null
  private projectDir: string
  private startedAt: string | null = null

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir
  }

  /**
   * Start the daemon.
   */
  async start(): Promise<{ success: boolean; pid: number; reason?: string }> {
    // Ensure daemon directory
    if (!existsSync(DAEMON_DIR)) mkdirSync(DAEMON_DIR, { recursive: true })

    // Check if already running
    if (existsSync(PID_FILE)) {
      const existingPid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10)
      try { process.kill(existingPid, 0); return { success: false, pid: existingPid, reason: 'Daemon already running' } } catch { /* stale PID */ }
    }

    // Load policy
    const policy = this.policyLoader.load(this.projectDir)
    this.policyLoader.watch(this.projectDir)

    // Create tracker adapter
    this.tracker = this.createTracker(policy)

    // Create workspace manager
    this.workspaceManager = new WorkspaceManager(policy)

    // Create reconciliation loop
    this.reconciliationLoop = new ReconciliationLoop(this.tracker, this.workspaceManager, policy)

    // Wire up events
    this.reconciliationLoop.on('dispatched', (record) => {
      logger.info({ issueId: record.issueId, workspace: record.workspaceId, attempt: record.attempts }, 'Task dispatched')
    })

    this.reconciliationLoop.on('completed', (issueId, success) => {
      logger.info({ issueId, success }, 'Task completed')
    })

    this.reconciliationLoop.on('released', (issueId) => {
      this.workspaceManager?.updateStatus(issueId, 'terminal')
    })

    this.reconciliationLoop.on('error', (issueId, error) => {
      logger.error({ issueId, err: error }, 'Task error')
    })

    // Start the loop
    this.reconciliationLoop.start()
    this.startedAt = new Date().toISOString()

    // Write PID
    writeFileSync(PID_FILE, String(process.pid))

    // Signal handling for graceful shutdown
    const shutdown = () => { void this.stop(); process.exit(0) }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Append to log
    writeFileSync(LOG_FILE, `${this.startedAt} — Daemon started (PID ${process.pid})\n`, { flag: 'a' })

    logger.info({ pid: process.pid, policy: policy.hash }, 'Orchestrator daemon started')
    return { success: true, pid: process.pid }
  }

  /**
   * Stop the daemon gracefully.
   */
  async stop(): Promise<{ success: boolean }> {
    if (this.reconciliationLoop) this.reconciliationLoop.stop()

    if (this.workspaceManager) {
      this.workspaceManager.cleanupTerminal()
    }

    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    this.startedAt = null

    const timestamp = new Date().toISOString()
    writeFileSync(LOG_FILE, `${timestamp} — Daemon stopped\n`, { flag: 'a' })

    logger.info('Orchestrator daemon stopped')
    return { success: true }
  }

  /**
   * Get current daemon status.
   */
  status(): DaemonStatus {
    const records = this.reconciliationLoop?.getDispatchRecords() ?? []
    const activeRecords = records.filter(r => r.state === 'Running')
    const activeWorkspaces = this.workspaceManager?.listActive() ?? []

    const uptime = this.startedAt
      ? Date.now() - new Date(this.startedAt).getTime()
      : undefined

    return {
      running: existsSync(PID_FILE),
      pid: existsSync(PID_FILE) ? parseInt(readFileSync(PID_FILE, 'utf-8'), 10) : undefined,
      startedAt: this.startedAt ?? undefined,
      policyPath: join(this.projectDir, 'SCALE_POLICY.md'),
      policyHash: this.policyLoader.get().hash,
      activeWorkspaces: activeWorkspaces.length,
      totalDispatched: records.length,
      activeIssues: activeRecords.map(r => r.issueId),
      lastTickAt: records[0]?.lastActivityAt,
      uptime,
    }
  }

  /**
   * Read daemon log.
   */
  readLog(lines: number = 50): string {
    if (!existsSync(LOG_FILE)) return '(no log)'
    const entries = readFileSync(LOG_FILE, 'utf-8').trim().split('\n')
    return entries.slice(-lines).join('\n')
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private createTracker(policy: ReturnType<typeof this.policyLoader.get>): ITrackerAdapter {
    switch (policy.tracker.type) {
      case 'github':
        return new GitHubTrackerAdapter({
          type: 'github',
          owner: policy.tracker.owner,
          repo: policy.tracker.repo,
          activeStates: policy.tracker.activeStates as IssueState[],
          terminalStates: policy.tracker.terminalStates as IssueState[],
          priorityLabels: policy.polling.priorityLabels,
        })
      case 'linear':
      case 'jira':
        logger.warn(`${policy.tracker.type} tracker not yet implemented — using mock`)
        return new MockTrackerAdapter()
      default:
        return new MockTrackerAdapter()
    }
  }
}
