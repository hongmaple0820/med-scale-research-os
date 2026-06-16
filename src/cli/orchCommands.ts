import { defineCommand } from 'citty'
import { OrchestratorDaemon } from '../orchestrator/OrchestratorDaemon.js'
import { PolicyLoader } from '../orchestrator/PolicyLoader.js'
import { logger } from '../core/logger.js'

// ---------------------------------------------------------------------------
// scale orch start
// ---------------------------------------------------------------------------

export const orchStartCommand = defineCommand({
  meta: {
    name: 'start',
    description: 'Start the SCALE Orchestrator daemon for autonomous issue processing',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    foreground: { type: 'boolean', default: false, description: 'Run in foreground (blocking)' },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const daemon = new OrchestratorDaemon(projectDir)

    console.log('SCALE Orchestrator — Starting daemon\n')

    const result = await daemon.start()
    if (!result.success) {
      console.log(`  ${result.reason ?? 'Failed to start'}`)
      return
    }

    console.log(`  PID: ${result.pid}`)
    console.log(`  Config: SCALE_POLICY.md`)
    console.log(`  Poll interval: 30s`)
    console.log(`  Max parallel: 3`)
    console.log()

    if (args.foreground) {
      console.log('  Running in foreground. Press Ctrl+C to stop.\n')
      // Keep alive in foreground
      await new Promise(() => {}) // never resolve — wait for SIGINT
    } else {
      console.log('  Daemon running in background.')
      console.log('  Use: scale orch status | scale orch stop | scale orch log\n')
    }
  },
})

// ---------------------------------------------------------------------------
// scale orch stop
// ---------------------------------------------------------------------------

export const orchStopCommand = defineCommand({
  meta: {
    name: 'stop',
    description: 'Stop the SCALE Orchestrator daemon gracefully',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const daemon = new OrchestratorDaemon(projectDir)

    console.log('Stopping SCALE Orchestrator...')
    const result = await daemon.stop()
    console.log(result.success ? '  Daemon stopped' : '  Daemon was not running')
  },
})

// ---------------------------------------------------------------------------
// scale orch status
// ---------------------------------------------------------------------------

export const orchStatusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show SCALE Orchestrator daemon status and active workspaces',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const daemon = new OrchestratorDaemon(projectDir)
    const status = daemon.status()

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    console.log('SCALE Orchestrator Status\n')
    console.log(`  Running:    ${status.running ? '✅ Yes' : '❌ No'}`)
    if (status.pid) console.log(`  PID:        ${status.pid}`)
    if (status.startedAt) console.log(`  Started:    ${status.startedAt}`)
    if (status.uptime) console.log(`  Uptime:     ${Math.round(status.uptime / 60000)} minutes`)
    console.log(`  Policy:     ${status.policyPath} (hash: ${status.policyHash})`)
    console.log(`  Workspaces: ${status.activeWorkspaces} active`)
    console.log(`  Dispatched: ${status.totalDispatched} total`)

    if (status.activeIssues.length > 0) {
      console.log('\n  Active issues:')
      for (const id of status.activeIssues) {
        console.log(`    → #${id}`)
      }
    }

    console.log()
  },
})

// ---------------------------------------------------------------------------
// scale orch log
// ---------------------------------------------------------------------------

export const orchLogCommand = defineCommand({
  meta: {
    name: 'log',
    description: 'Show recent SCALE Orchestrator daemon log entries',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    lines: { type: 'string', default: '50', description: 'Number of recent log lines' },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const daemon = new OrchestratorDaemon(projectDir)
    const lines = parseInt(String(args.lines ?? 50), 10) || 50

    console.log('SCALE Orchestrator Log\n')
    console.log(daemon.readLog(lines))
    console.log()
  },
})

// ---------------------------------------------------------------------------
// scale orch (parent)
// ---------------------------------------------------------------------------

export const orchCommand = defineCommand({
  meta: {
    name: 'orch',
    description: 'SCALE Orchestrator — Declarative daemon-based orchestration',
  },
  subCommands: {
    start: orchStartCommand,
    stop: orchStopCommand,
    status: orchStatusCommand,
    log: orchLogCommand,
  },
})
