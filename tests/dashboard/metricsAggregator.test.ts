import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MetricsAggregator } from '../../src/dashboard/MetricsAggregator.js'
import { ModelUsageLedger } from '../../src/runtime/ModelUsageLedger.js'
import { CommandRunLedger } from '../../src/tools/CommandRunLedger.js'
import { EvidenceStore } from '../../src/workflow/EvidenceStore.js'
import { TaskMetricsStore } from '../../src/workflow/TaskMetricsStore.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('MetricsAggregator', () => {
  it('aggregates task, gate, command, and model usage metrics', () => {
    const projectDir = makeDir('scale-dashboard-project-')
    const scaleDir = makeDir('scale-dashboard-state-')
    const now = new Date('2026-05-20T00:00:00.000Z')

    new TaskMetricsStore(scaleDir).append({
      date: '2026-05-20',
      taskId: 'TASK-1',
      taskName: 'prompt cache policy',
      level: 'M',
      services: ['core'],
      filesChanged: 3,
      firstVerificationPass: true,
      fixIterations: 0,
      reworkNeeded: false,
      artifactComplete: true,
      residualRisk: 'none',
      finalGateStatus: 'passed',
    })

    new EvidenceStore(scaleDir).saveGateResult({
      gate: 'G7',
      status: 'FAILED',
      passed: false,
      evidence: 'security failed',
      evidenceItems: [],
      blockers: ['security failed'],
      durationMs: 10,
    })

    new CommandRunLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-1',
      command: 'npm test',
      cwd: projectDir,
      exitCode: 0,
      durationMs: 20,
      startedAt: now.getTime(),
      endedAt: now.getTime() + 20,
      stdout: 'line\n'.repeat(100),
      stderr: '',
    })

    new ModelUsageLedger(scaleDir).record({
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 100,
      cacheEligibleTokens: 700,
      cacheReadInputTokens: 500,
    })

    const metrics = new MetricsAggregator({
      projectDir,
      scaleDir,
      now: () => now,
    }).aggregate()

    expect(metrics.taskMetrics.total).toBe(1)
    expect(metrics.taskMetrics.recentTasks).toBe(1)
    expect(metrics.taskMetrics.recentFirstPassRate).toBe(1)
    expect(metrics.gateFailures.failed).toBe(1)
    expect(metrics.gateFailures.byGate.G7).toBe(1)
    expect(metrics.commandRuns.total).toBe(1)
    expect(metrics.commandRuns.savedEstimatedTokens).toBeGreaterThanOrEqual(0)
    expect(metrics.modelUsage.totalRecords).toBe(1)
    expect(metrics.modelUsage.cacheSavingsTokens).toBe(500)
  })
})

