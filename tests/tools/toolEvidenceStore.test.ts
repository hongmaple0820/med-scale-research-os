import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ToolEvidenceStore } from '../../src/tools/ToolEvidenceStore.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-tool-evidence-'))
  dirs.push(dir)
  return dir
}

describe('ToolEvidenceStore', () => {
  it('writes redacted tool-run evidence under the task evidence directory', () => {
    const projectDir = makeProject()
    const store = new ToolEvidenceStore({ projectDir })

    const record = store.save({
      taskId: 'TASK-TOOLS',
      domain: 'webResearch',
      tool: 'web-access',
      adapter: 'skill',
      status: 'passed',
      sanitizedInput: {
        query: 'tool orchestration',
        token: 'secret-token-value',
        headers: {
          authorization: 'Bearer abcdef123456',
          cookie: 'sid=very-secret-cookie',
        },
      },
      command: 'web-access search --token secret-token-value',
      outputSummary: 'ok password=super-secret Authorization: Bearer abcdef123456',
      outputPaths: ['docs/worklog/tasks/TASK-TOOLS/skill-evidence.md'],
      safetyPolicy: ['read-only', 'redact-secrets'],
    })

    const file = join(projectDir, '.scale', 'evidence', 'tool-runs', 'TASK-TOOLS', `${record.id}.json`)
    expect(existsSync(file)).toBe(true)

    const raw = readFileSync(file, 'utf-8')
    expect(raw).not.toContain('secret-token-value')
    expect(raw).not.toContain('abcdef123456')
    expect(raw).not.toContain('very-secret-cookie')
    expect(raw).not.toContain('super-secret')
    expect(record.redactionApplied).toBe(true)
    expect(record.command).toContain('[REDACTED]')
    expect(record.sanitizedInput).toMatchObject({
      query: 'tool orchestration',
      token: '[REDACTED]',
      headers: {
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
      },
    })
  })

  it('lists evidence newest first and summarizes task status', () => {
    const projectDir = makeProject()
    const store = new ToolEvidenceStore({ projectDir, now: () => new Date('2026-05-16T00:00:00.000Z') })

    const failed = store.save({
      taskId: 'TASK-TOOLS',
      domain: 'ui',
      tool: 'agent-browser',
      adapter: 'browser',
      status: 'failed',
      sanitizedInput: {},
      outputSummary: 'console errors found',
      outputPaths: [],
      safetyPolicy: ['localhost-only'],
    })
    const passed = store.save({
      taskId: 'TASK-TOOLS',
      domain: 'ui',
      tool: 'frontend-design',
      adapter: 'skill',
      status: 'passed',
      sanitizedInput: {},
      outputSummary: 'design evidence collected',
      outputPaths: [],
      safetyPolicy: ['instruction-only'],
    })

    const records = store.list('TASK-TOOLS')

    expect(records.map(record => record.id)).toEqual([passed.id, failed.id])
    expect(store.summary('TASK-TOOLS')).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      ok: false,
    })
  })
})
