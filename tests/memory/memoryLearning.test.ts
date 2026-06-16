import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryFabric } from '../../src/memory/MemoryFabric.js'
import { settleMemoryLearning } from '../../src/memory/MemoryLearning.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-memory-learning-'))
  dirs.push(dir)
  return dir
}

describe('MemoryLearning', () => {
  it('settles runtime evidence into a reviewable learning candidate without leaking secrets', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    const sessionLedger = new SessionLedger({ projectDir, scaleDir })
    sessionLedger.start({ sessionId: 'SESSION-LEARN', taskId: 'TASK-LEARN', level: 'M', summary: 'Memory learning' })
    sessionLedger.append('SESSION-LEARN', {
      type: 'phase.completed',
      phase: 'verify',
      message: 'verification passed with token=raw-secret-value',
    })
    const evidence = new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-LEARN',
      sessionId: 'SESSION-LEARN',
      kind: 'command',
      title: 'targeted tests',
      status: 'passed',
      command: 'npm test -- --token raw-secret-value',
      exitCode: 0,
      summary: 'tests passed with password=raw-secret-value',
    })

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      taskId: 'TASK-LEARN',
      sessionId: 'SESSION-LEARN',
      task: 'Settle runtime evidence into durable learning',
      level: 'M',
    })

    const result = settleMemoryLearning({ projectDir, scaleDir, pack })

    expect(result.candidate.status).toBe('candidate')
    expect(result.candidate.recommendedAction).toBe('review-for-knowledge-base')
    expect(result.candidate.promotable).toBe(true)
    expect(result.candidate.evidenceIds).toContain(evidence.id)
    expect(result.candidate.sessionEventIds.length).toBeGreaterThan(0)
    expect(result.files.json).toContain('learning-candidates')
    expect(existsSync(result.files.json)).toBe(true)
    expect(existsSync(result.files.markdown)).toBe(true)

    const serialized = [
      JSON.stringify(result.candidate),
      readFileSync(result.files.json, 'utf-8'),
      readFileSync(result.files.markdown, 'utf-8'),
    ].join('\n')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('raw-secret-value')
  })

  it('blocks promotion when failed runtime evidence is still present', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-FAIL',
      sessionId: 'SESSION-FAIL',
      kind: 'command',
      title: 'full verification',
      status: 'failed',
      exitCode: 1,
      summary: 'full test suite failed',
    })

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      taskId: 'TASK-FAIL',
      sessionId: 'SESSION-FAIL',
      task: 'Settle failed runtime evidence',
      level: 'M',
    })

    const result = settleMemoryLearning({ projectDir, scaleDir, pack })

    expect(result.candidate.promotable).toBe(false)
    expect(result.candidate.recommendedAction).toBe('resolve-failures-first')
    expect(result.candidate.warnings.join('\n')).toContain('failed runtime evidence')
  })
})
