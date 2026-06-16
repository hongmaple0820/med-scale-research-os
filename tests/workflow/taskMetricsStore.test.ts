import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskMetricsStore } from '../../src/workflow/TaskMetricsStore.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeStore(): TaskMetricsStore {
  const dir = mkdtempSync(join(tmpdir(), 'scale-metrics-'))
  dirs.push(dir)
  return new TaskMetricsStore(dir)
}

describe('TaskMetricsStore', () => {
  it('appends, lists, and summarizes task metrics', () => {
    const store = makeStore()
    store.append({
      date: '2026-05-14',
      taskId: 'TASK-1',
      taskName: 'workflow contract fix',
      level: 'M',
      services: ['core'],
      filesChanged: 4,
      firstVerificationPass: true,
      fixIterations: 0,
      reworkNeeded: false,
      artifactComplete: true,
      residualRisk: 'none',
      finalGateStatus: 'passed',
    })
    store.append({
      date: '2026-05-14',
      taskId: 'TASK-2',
      taskName: 'service matrix',
      level: 'L',
      services: ['core', 'cli'],
      filesChanged: 8,
      firstVerificationPass: false,
      fixIterations: 2,
      reworkNeeded: true,
      artifactComplete: false,
      residualRisk: '',
      finalGateStatus: 'blocked',
    })

    expect(store.list()).toHaveLength(2)
    expect(store.summarize()).toMatchObject({
      total: 2,
      firstPassRate: 0.5,
      averageFixIterations: 1,
      artifactCompletenessRate: 0.5,
      residualRiskClarityRate: 0.5,
    })
  })

  it('renders a markdown row', () => {
    const store = makeStore()

    const row = store.toMarkdownRow({
      date: '2026-05-14',
      taskId: 'TASK-1',
      taskName: 'a | b',
      level: 'M',
      services: ['api'],
      filesChanged: 1,
      firstVerificationPass: true,
      fixIterations: 0,
      reworkNeeded: false,
      artifactComplete: true,
      residualRisk: 'none',
      finalGateStatus: 'passed',
    })

    expect(row).toContain('a \\| b')
    expect(row).toContain('yes')
  })

  it('upserts verification metrics and tracks fix iterations', () => {
    const store = makeStore()

    const failed = store.recordVerification({
      taskId: 'TASK-1',
      taskName: 'workflow contract fix',
      level: 'M',
      services: ['core'],
      filesChanged: 3,
      passed: false,
      artifactComplete: false,
      residualRisk: 'verification still failing',
      finalGateStatus: 'blocked',
      date: '2026-05-14',
    })
    const passed = store.recordVerification({
      taskId: 'TASK-1',
      taskName: 'workflow contract fix',
      level: 'M',
      services: ['core'],
      filesChanged: 4,
      passed: true,
      artifactComplete: true,
      residualRisk: 'none',
      date: '2026-05-14',
    })

    expect(failed.firstVerificationPass).toBe(false)
    expect(failed.finalGateStatus).toBe('blocked')
    expect(passed.firstVerificationPass).toBe(false)
    expect(passed.fixIterations).toBe(1)
    expect(passed.reworkNeeded).toBe(true)
    expect(passed.finalGateStatus).toBe('passed')
    expect(store.list()).toHaveLength(1)
    expect(store.findByTaskId('TASK-1')).toMatchObject({ filesChanged: 4, artifactComplete: true })
  })

  it('writes an idempotent markdown metrics report', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-metrics-project-'))
    dirs.push(projectDir)
    const store = makeStore()
    store.recordVerification({
      taskId: 'TASK-1',
      taskName: 'workflow metrics',
      level: 'M',
      passed: true,
      artifactComplete: true,
      date: '2026-05-14',
    })

    const path = store.writeMarkdownReport(projectDir)
    store.writeMarkdownReport(projectDir)

    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content.match(/SCALE_METRICS:START/g)).toHaveLength(1)
    expect(content).toContain('| 2026-05-14 | workflow metrics | M |')
  })
})
