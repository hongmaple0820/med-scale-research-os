import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandRunLedger } from '../../src/tools/CommandRunLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('CommandRunLedger', () => {
  it('records compressed command output without storing the full raw stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-command-ledger-'))
    dirs.push(dir)
    const ledger = new CommandRunLedger({ projectDir: dir })
    const stdout = Array.from({ length: 160 }, (_, index) => `noise line ${index}`).join('\n')

    const record = ledger.record({
      taskId: 'task/one',
      gate: 'G5',
      command: 'npm test -- --token secret-value',
      cwd: dir,
      exitCode: 0,
      durationMs: 42,
      startedAt: Date.UTC(2026, 4, 20, 1, 2, 3),
      endedAt: Date.UTC(2026, 4, 20, 1, 2, 4),
      stdout,
      stderr: '',
    })

    const evidenceDir = join(dir, '.scale', 'evidence', 'command-runs', 'task-one')
    expect(existsSync(join(evidenceDir, `${record.id}.json`))).toBe(true)
    expect(record.command).toContain('[REDACTED]')
    expect(record.rawSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(record.rawTail.length).toBeLessThanOrEqual(2000)
    expect(record.compressedOutput.length).toBeLessThan(stdout.length)
    expect(record.savedEstimatedTokens).toBeGreaterThan(0)

    const saved = JSON.parse(readFileSync(join(evidenceDir, `${record.id}.json`), 'utf-8'))
    expect(saved.command).toContain('[REDACTED]')
    expect(saved.rawSha256).toBe(record.rawSha256)
    expect(saved.rawOutput).toBeUndefined()
  })

  it('summarizes token savings across task command runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-command-ledger-summary-'))
    dirs.push(dir)
    const ledger = new CommandRunLedger({ projectDir: dir })

    for (let index = 0; index < 2; index += 1) {
      ledger.record({
        taskId: 'task-two',
        command: 'npm run lint',
        cwd: dir,
        exitCode: index,
        durationMs: 10,
        startedAt: Date.now(),
        endedAt: Date.now() + 10,
        stdout: Array.from({ length: 120 }, (_, line) => `lint noise ${index}-${line}`).join('\n'),
        stderr: index === 1 ? 'error lint failed' : '',
      })
    }

    const summary = ledger.summary('task-two')
    expect(readdirSync(join(dir, '.scale', 'evidence', 'command-runs', 'task-two'))).toHaveLength(2)
    expect(summary.total).toBe(2)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.savedEstimatedTokens).toBeGreaterThan(0)
    expect(summary.ok).toBe(false)
  })
})
