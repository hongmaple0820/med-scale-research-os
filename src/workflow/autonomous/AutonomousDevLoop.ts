// SCALE Engine — Autonomous Development Loop
// Cron 触发的自主开发循环：读取 worklog → QA → 修复 → 开发 → 更新
// 设计参考：z.ai 模式 + Baton System + SelfImproveEngine
// 灵感来源：用户分享的 z.ai 自主开发循环模式（cron 每 15 分钟）

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { IEventBus } from '../../core/eventBus.js'
import { logger } from '../../core/logger.js'
import { WorklogManager, type WorklogEntry, type WorklogState, type TaskStatus } from './WorklogManager.js'

// ============================================================================
// Types
// ============================================================================

export interface DevLoopConfig {
  /** Base directory for .scale artifacts */
  scaleDir: string
  /** Path to worklog markdown file */
  worklogPath: string
  /** Path to baton directory for cross-session persistence */
  batonPath: string
  /** Max defects to fix per run (prevents session timeout) */
  maxDefectsPerRun: number
  /** Max features to develop per run */
  maxFeaturesPerRun: number
  /** Command to run QA tests */
  qaCommand: string
  /** Working directory for QA command execution */
  cwd: string
}

export interface QAResult {
  passed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
  failures: QAFailure[]
  duration: number
  rawOutput: string
}

export interface QAFailure {
  testName: string
  file: string
  error: string
}

export interface FixResult {
  entryId: string
  success: boolean
  description: string
  filesChanged: string[]
}

export interface DevResult {
  entryId: string
  success: boolean
  description: string
  filesChanged: string[]
}

export interface LoopState {
  runId: string
  startedAt: string
  phase: 'read_worklog' | 'run_qa' | 'fix_defects' | 'develop_features' | 'update_worklog' | 'write_baton' | 'complete'
  worklogState?: WorklogState
  qaResult?: QAResult
  fixResults: FixResult[]
  devResult?: DevResult
  errors: string[]
}

export interface LoopResult {
  runId: string
  success: boolean
  duration: number
  phase: LoopState['phase']
  qaPassed: boolean
  defectsFixed: number
  featureProgressed: boolean
  errors: string[]
  nextAction: string
}

// ============================================================================
// Default Config
// ============================================================================

export function createDefaultConfig(overrides?: Partial<DevLoopConfig>): DevLoopConfig {
  return {
    scaleDir: '.scale',
    worklogPath: '.scale/worklog.md',
    batonPath: '.scale/baton',
    maxDefectsPerRun: 3,
    maxFeaturesPerRun: 1,
    qaCommand: 'npx vitest run',
    cwd: process.cwd(),
    ...overrides,
  }
}

// ============================================================================
// Autonomous Dev Loop
// ============================================================================

export class AutonomousDevLoop {
  private config: DevLoopConfig
  private eventBus: IEventBus
  private worklogManager: WorklogManager

  constructor(eventBus: IEventBus, config?: Partial<DevLoopConfig>) {
    this.config = createDefaultConfig(config)
    this.eventBus = eventBus
    this.worklogManager = new WorklogManager(this.config.worklogPath)
  }

  // ─────────────────────────────────────────────────────────────
  // Main Loop
  // ─────────────────────────────────────────────────────────────

  /** Execute the autonomous development loop */
  async run(): Promise<LoopResult> {
    const runId = `AUTO-${Date.now()}`
    const startedAt = Date.now()

    const state: LoopState = {
      runId,
      startedAt: new Date(startedAt).toISOString(),
      phase: 'read_worklog',
      fixResults: [],
      errors: [],
    }

    logger.info({ runId }, 'Autonomous dev loop started')
    this.eventBus.emit('autonomous.loop.start', { runId, timestamp: state.startedAt })

    try {
      // Step 1: Read worklog
      state.worklogState = this.readWorklog()
      this.eventBus.emit('autonomous.worklog.read', {
        runId,
        total: state.worklogState.entries.length,
        pending: state.worklogState.totalPending,
      })

      // Step 2: Run QA
      state.phase = 'run_qa'
      state.qaResult = this.runQA()

      // Step 3: Fix defects (if QA failed)
      if (!state.qaResult.passed) {
        state.phase = 'fix_defects'
        state.fixResults = await this.fixDefects(state.qaResult)
      }

      // Step 4: Develop next feature (if QA passed or defects fixed)
      const qaPassing = state.qaResult.passed || state.fixResults.some(r => r.success)
      if (qaPassing) {
        state.phase = 'develop_features'
        const pending = this.worklogManager.getByStatus(state.worklogState, 'pending')
        if (pending.length > 0) {
          state.devResult = await this.developFeatures(pending)
        }
      }

      // Step 5: Update worklog
      state.phase = 'update_worklog'
      state.worklogState = this.updateWorklogState(state)

      // Step 6: Write baton
      state.phase = 'write_baton'
      this.writeBaton(state)

      state.phase = 'complete'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      state.errors.push(msg)
      logger.error({ runId, error: msg, phase: state.phase }, 'Loop error')
      this.eventBus.emit('autonomous.loop.error', { runId, error: msg, phase: state.phase })

      // Still write baton on error for recovery
      try {
        this.writeBaton(state)
      } catch {
        // swallow baton write error
      }
    }

    const duration = Date.now() - startedAt
    const result = this.buildResult(state, duration)

    logger.info({ runId, duration, phase: result.phase }, 'Autonomous dev loop finished')
    this.eventBus.emit('autonomous.loop.end', { runId, result })

    return result
  }

  // ─────────────────────────────────────────────────────────────
  // Step 1: Read Worklog
  // ─────────────────────────────────────────────────────────────

  private readWorklog(): WorklogState {
    const state = this.worklogManager.read()
    logger.info({ pending: state.totalPending, done: state.totalDone }, 'Worklog loaded')
    return state
  }

  // ─────────────────────────────────────────────────────────────
  // Step 2: Run QA
  // ─────────────────────────────────────────────────────────────

  private runQA(): QAResult {
    const startTime = Date.now()

    try {
      const output = execSync(this.config.qaCommand, {
        cwd: this.config.cwd,
        encoding: 'utf-8',
        timeout: 120_000, // 2 minute timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      return this.parseQAOutput(output, Date.now() - startTime)
    } catch (err) {
      // execSync throws on non-zero exit code
      const execErr = err as { stdout?: string; stderr?: string; status?: number }
      const output = (execErr.stdout || '') + '\n' + (execErr.stderr || '')
      const result = this.parseQAOutput(output, Date.now() - startTime)
      result.passed = false
      return result
    }
  }

  /** Parse QA output into structured result */
  private parseQAOutput(output: string, duration: number): QAResult {
    const failures: QAFailure[] = []

    // Vitest output pattern: "FAIL  tests/path.test.ts > test name"
    const failPattern = /FAIL\s+(.+?\.test\.\w+).*?>\s*(.+?)(?:\n|$)/g
    let match: RegExpExecArray | null

    while ((match = failPattern.exec(output)) !== null) {
      failures.push({
        file: match[1].trim(),
        testName: match[2].trim(),
        error: '', // detailed error extracted below
      })
    }

    // Extract test counts from vitest summary
    // Pattern: "Tests  2 failed | 44 passed (46)"
    const countMatch = output.match(
      /Tests\s+(?:(\d+)\s+failed\s*[|])?\s*(\d+)\s+passed\s*\((\d+)\)/
    )

    let totalTests = 0
    let passedTests = 0
    let failedTests = 0

    if (countMatch) {
      failedTests = parseInt(countMatch[1] || '0', 10)
      passedTests = parseInt(countMatch[2], 10)
      totalTests = parseInt(countMatch[3], 10)
    }

    // Also match: "✓ N tests" / "✗ N tests" / "↓ N tests"
    const passMatch = output.match(/[✓✔]\s*(\d+)\s+passed/)
    const failMatch = output.match(/[✗✘✕]\s*(\d+)\s+failed/)
    if (passMatch && !countMatch) passedTests = parseInt(passMatch[1], 10)
    if (failMatch && !countMatch) failedTests = parseInt(failMatch[1], 10)
    if (!countMatch && (passMatch || failMatch)) {
      totalTests = passedTests + failedTests
    }

    return {
      passed: failedTests === 0 && totalTests > 0,
      totalTests,
      passedTests,
      failedTests,
      failures,
      duration,
      rawOutput: output.slice(0, 2000), // cap output size
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 3: Fix Defects
  // ─────────────────────────────────────────────────────────────

  private async fixDefects(qa: QAResult): Promise<FixResult[]> {
    const results: FixResult[] = []
    const maxFixes = Math.min(qa.failures.length, this.config.maxDefectsPerRun)

    for (let i = 0; i < maxFixes; i++) {
      const failure = qa.failures[i]
      logger.info({ file: failure.file, test: failure.testName }, 'Attempting defect fix')

      this.eventBus.emit('autonomous.defect.detected', {
        file: failure.file,
        testName: failure.testName,
        error: failure.error,
      })

      // Record defect for SelfImproveEngine integration
      const fixResult: FixResult = {
        entryId: `DEFECT-${i + 1}`,
        success: false,
        description: `Fix failing test: ${failure.testName} in ${failure.file}`,
        filesChanged: [],
      }

      // In a real autonomous loop, this would invoke an AI agent to fix the defect.
      // For the framework, we record the defect and emit events for external handlers.
      this.eventBus.emit('autonomous.defect.fix_requested', {
        file: failure.file,
        testName: failure.testName,
        runId: qa.rawOutput.slice(0, 100),
      })

      results.push(fixResult)
    }

    return results
  }

  // ─────────────────────────────────────────────────────────────
  // Step 4: Develop Features
  // ─────────────────────────────────────────────────────────────

  private async developFeatures(pending: WorklogEntry[]): Promise<DevResult | undefined> {
    const nextTask = this.worklogManager.getNextTask({ entries: pending } as WorklogState)
    if (!nextTask) return undefined

    logger.info({ taskId: nextTask.id, desc: nextTask.description }, 'Feature development started')
    this.eventBus.emit('autonomous.feature.start', {
      taskId: nextTask.id,
      description: nextTask.description,
      priority: nextTask.priority,
    })

    // In a real autonomous loop, this would invoke an AI agent.
    // For the framework, we record the task and emit events.
    const devResult: DevResult = {
      entryId: nextTask.id,
      success: false,
      description: nextTask.description,
      filesChanged: [],
    }

    this.eventBus.emit('autonomous.feature.delegated', {
      taskId: nextTask.id,
      description: nextTask.description,
    })

    return devResult
  }

  // ─────────────────────────────────────────────────────────────
  // Step 5: Update Worklog
  // ─────────────────────────────────────────────────────────────

  private updateWorklogState(state: LoopState): WorklogState {
    let worklog = state.worklogState ?? this.worklogManager.read()

    // Mark fixed defects
    for (const fix of state.fixResults) {
      if (fix.success) {
        // Find matching entry by description
        const match = worklog.entries.find(
          e => e.type === 'bug' && e.status === 'pending' && fix.description.includes(e.description)
        )
        if (match) {
          worklog = this.worklogManager.markDone(worklog, match.id, 'Fixed by autonomous loop')
        }
      }
    }

    // Update feature status
    if (state.devResult) {
      if (state.devResult.success) {
        worklog = this.worklogManager.markDone(
          worklog,
          state.devResult.entryId,
          'Completed by autonomous loop'
        )
      } else {
        worklog = this.worklogManager.markInProgress(worklog, state.devResult.entryId)
      }
    }

    // Write updated worklog
    this.worklogManager.write(worklog)

    return worklog
  }

  // ─────────────────────────────────────────────────────────────
  // Step 6: Write Baton (Cross-Session Persistence)
  // ─────────────────────────────────────────────────────────────

  private writeBaton(state: LoopState): void {
    const batonDir = this.config.batonPath
    if (!existsSync(batonDir)) {
      mkdirSync(batonDir, { recursive: true })
    }

    // Write current-session.md
    const sessionContent = this.buildBatonSession(state)
    writeFileSync(join(batonDir, 'current-session.md'), sessionContent, 'utf-8')

    // Write next-prompt.md — the critical continuation file
    const nextPrompt = this.buildNextPrompt(state)
    writeFileSync(join(batonDir, 'next-prompt.md'), nextPrompt, 'utf-8')

    logger.info({ runId: state.runId, phase: state.phase }, 'Baton written')
    this.eventBus.emit('autonomous.baton.written', { runId: state.runId })
  }

  private buildBatonSession(state: LoopState): string {
    const worklog = state.worklogState
    return `---
session_id: ${state.runId}
status: ${state.phase}
started: ${state.startedAt}
updated: ${new Date().toISOString()}
qa_passed: ${state.qaResult?.passed ?? 'unknown'}
fixes_attempted: ${state.fixResults.length}
fixes_succeeded: ${state.fixResults.filter(r => r.success).length}
errors: ${state.errors.length}
---

# Autonomous Dev Loop: ${state.runId}

Phase: ${state.phase}
QA: ${state.qaResult?.passed ? 'PASSED' : 'FAILED'} (${state.qaResult?.passedTests}/${state.qaResult?.totalTests})
Defects Fixed: ${state.fixResults.filter(r => r.success).length}/${state.fixResults.length}
Feature: ${state.devResult ? (state.devResult.success ? 'DONE' : 'IN_PROGRESS') : 'none'}
${worklog ? `Worklog: ${worklog.totalPending} pending, ${worklog.totalDone} done` : ''}
${state.errors.length > 0 ? `\nErrors:\n${state.errors.map(e => `- ${e}`).join('\n')}` : ''}
`
  }

  private buildNextPrompt(state: LoopState): string {
    const qaStatus = state.qaResult?.passed ? 'PASS' : 'FAIL'
    const hasErrors = state.errors.length > 0

    let prompt = `---
session_id: ${state.runId}
status: ${state.phase}
next_action: ${this.determineNextAction(state)}
---

# Autonomous Dev Loop — Next Step

Run: ${state.runId}
Phase: ${state.phase}
QA: ${qaStatus} (${state.qaResult?.passedTests ?? 0}/${state.qaResult?.totalTests ?? 0})

`

    if (hasErrors) {
      prompt += `## Errors from Last Run\n${state.errors.map(e => `- ${e}`).join('\n')}\n\n`
    }

    if (!state.qaResult?.passed && state.qaResult?.failures.length) {
      prompt += `## Failing Tests\n`
      for (const f of state.qaResult.failures.slice(0, 5)) {
        prompt += `- ${f.testName} (${f.file})\n`
      }
      prompt += '\n'
    }

    const nextAction = this.determineNextAction(state)
    prompt += `## Recommended Action\n`

    switch (nextAction) {
      case 'FIX_DEFECTS':
        prompt += 'QA is failing. Fix the failing tests listed above, then re-run QA.\n'
        break
      case 'DEVELOP_FEATURE':
        prompt += 'QA is passing. Pick the next pending task from the worklog and implement it.\n'
        break
      case 'REVIEW_AND_EVOLVE':
        prompt += 'Tasks complete. Run evolution loop to extract lessons from this session.\n'
        break
      case 'RECOVER':
        prompt += 'Last run had errors. Investigate and retry.\n'
        break
      default:
        prompt += 'Check worklog for next action.\n'
    }

    return prompt
  }

  private determineNextAction(state: LoopState): string {
    if (state.errors.length > 0) return 'RECOVER'
    if (!state.qaResult?.passed) return 'FIX_DEFECTS'
    if (state.worklogState && state.worklogState.totalPending > 0) return 'DEVELOP_FEATURE'
    return 'REVIEW_AND_EVOLVE'
  }

  // ─────────────────────────────────────────────────────────────
  // Result Builder
  // ─────────────────────────────────────────────────────────────

  private buildResult(state: LoopState, duration: number): LoopResult {
    return {
      runId: state.runId,
      success: state.errors.length === 0,
      duration,
      phase: state.phase,
      qaPassed: state.qaResult?.passed ?? false,
      defectsFixed: state.fixResults.filter(r => r.success).length,
      featureProgressed: state.devResult?.success ?? false,
      errors: state.errors,
      nextAction: this.determineNextAction(state),
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────

  getConfig(): DevLoopConfig { return this.config }
  getWorklogManager(): WorklogManager { return this.worklogManager }
}
