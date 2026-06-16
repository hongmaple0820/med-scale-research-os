import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface DaemonStatus {
  running: boolean
  pid?: number
  startedAt?: string
  requestsProcessed: number
  idleSeconds: number
}

const DAEMON_DIR = '.scale/qa'
const PID_FILE = join(DAEMON_DIR, 'daemon.pid')
const SOCK_FILE = join(DAEMON_DIR, 'daemon.sock')
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class BrowserDaemon {
  private browser: unknown = null
  private requestsProcessed = 0
  private lastActivity = Date.now()
  private idleTimer: NodeJS.Timeout | null = null

  async start(): Promise<{ success: boolean; pid: number }> {
    if (!existsSync(DAEMON_DIR)) mkdirSync(DAEMON_DIR, { recursive: true })

    if (existsSync(PID_FILE)) {
      const existingPid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10)
      try { process.kill(existingPid, 0); throw new Error(`Daemon already running (PID ${existingPid})`) } catch {}
    }

    // Write PID
    writeFileSync(PID_FILE, String(process.pid))

    // Try to get a browser context
    try {
      // @ts-ignore — optional dependency
      const pw = await import('playwright')
      this.browser = await pw.chromium.launch({ headless: true })
    } catch {
      logger.warn('Playwright not installed — daemon will use MCP fallback for each request')
    }

    this.resetIdleTimer()
    logger.info({ pid: process.pid }, 'Browser daemon started')
    return { success: true, pid: process.pid }
  }

  async stop(): Promise<{ success: boolean }> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.browser) {
      try { await (this.browser as any).close() } catch {}
    }
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    logger.info('Browser daemon stopped')
    return { success: true }
  }

  status(): DaemonStatus {
    return {
      running: existsSync(PID_FILE),
      pid: existsSync(PID_FILE) ? parseInt(readFileSync(PID_FILE, 'utf-8'), 10) : undefined,
      startedAt: undefined,
      requestsProcessed: this.requestsProcessed,
      idleSeconds: Math.floor((Date.now() - this.lastActivity) / 1000),
    }
  }

  getBrowser(): unknown {
    this.requestsProcessed++
    this.lastActivity = Date.now()
    this.resetIdleTimer()
    return this.browser
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      logger.info('Browser daemon idle timeout — shutting down')
      void this.stop()
    }, IDLE_TIMEOUT_MS)
  }
}
