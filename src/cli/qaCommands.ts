import { defineCommand } from 'citty'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserDaemon } from '../qa/BrowserDaemon.js'
import { logger } from '../core/logger.js'

async function loadQAEngine() {
  const { BrowserQACapability } = await import('../capabilities/BrowserQACapability.js')
  const { EventBus } = await import('../core/eventBus.js')
  const eventBus = new EventBus()
  return new BrowserQACapability(eventBus)
}

export const qaE2eCommand = defineCommand({
  meta: { name: 'e2e', description: 'Run browser E2E test flow' },
  args: {
    url: { type: 'string', description: 'Base URL (default: http://localhost:3000)' },
    flow: { type: 'string', description: 'Flow file path (.scale/qa/flows/*.json)' },
    'save-domain-skill': { type: 'boolean', description: 'Save successful selectors as domain skill' },
  },
  async run({ args }) {
    const baseUrl = (args.url as string) ?? 'http://localhost:3000'
    const flowDir = join(process.cwd(), '.scale', 'qa', 'flows')
    const flowPath = (args.flow as string) ?? join(flowDir, 'default.json')

    const engine = await loadQAEngine()
    let flow: any

    if (existsSync(flowPath)) {
      flow = JSON.parse(readFileSync(flowPath, 'utf-8'))
    } else {
      // Generate a default quick-smoke flow
      flow = {
        name: 'Quick Smoke',
        baseUrl,
        steps: [
          { type: 'navigate', url: baseUrl },
          { type: 'wait', selector: 'body' },
          { type: 'screenshot', fullPage: false },
        ],
      }
      if (!existsSync(flowDir)) mkdirSync(flowDir, { recursive: true })
    }

    // Try Playwright direct mode first
    const report = await engine.runWithPlaywright(flow)
    console.log(JSON.stringify(report, null, 2))
    logger.info({ passed: report.passed, steps: report.steps?.length ?? 0 }, 'QA E2E complete')
  },
})

export const qaDaemonCommand = defineCommand({
  meta: { name: 'daemon', description: 'Manage persistent browser daemon' },
  args: {
    action: { type: 'positional', required: true, description: 'start|stop|status' },
  },
  async run({ args }) {
    const daemon = new BrowserDaemon()
    const action = args.action as string

    switch (action) {
      case 'start': {
        const r = await daemon.start()
        console.log(`Daemon started (PID ${r.pid})`)
        // Keep alive
        process.on('SIGINT', () => { void daemon.stop(); process.exit(0) })
        process.on('SIGTERM', () => { void daemon.stop(); process.exit(0) })
        break
      }
      case 'stop': {
        await daemon.stop()
        console.log('Daemon stopped')
        break
      }
      case 'status': {
        const s = daemon.status()
        console.log(s.running ? `Running (PID ${s.pid})` : 'Not running')
        break
      }
      default:
        console.log('Usage: scale qa daemon <start|stop|status>')
    }
  },
})

export const qaCommand = defineCommand({
  meta: { name: 'qa', description: 'Browser QA — E2E, visual regression, daemon management' },
  subCommands: { e2e: qaE2eCommand, daemon: qaDaemonCommand },
})
