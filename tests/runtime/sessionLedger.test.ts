import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-session-ledger-'))
  dirs.push(dir)
  return dir
}

describe('SessionLedger', () => {
  it('starts, appends, and ends a redacted runtime session', () => {
    const projectDir = makeProject()
    const ledger = new SessionLedger({ projectDir, now: () => new Date('2026-05-18T00:00:00.000Z') })

    const session = ledger.start({
      sessionId: 'SESSION-1',
      taskId: 'TASK-1',
      agent: 'codex',
      level: 'M',
      summary: 'runtime evidence rollout',
    })
    const event = ledger.append(session.sessionId, {
      type: 'tool.used',
      message: 'ran build',
      data: {
        token: 'raw-token',
        command: 'npm run build',
      },
    })
    const ended = ledger.end(session.sessionId, 'completed', 'done')

    expect(session.status).toBe('active')
    expect(event.redactionApplied).toBe(true)
    expect(ended.status).toBe('completed')
    expect(ledger.current()).toMatchObject({ sessionId: 'SESSION-1', status: 'completed' })
    expect(existsSync(ledger.sessionFile('SESSION-1'))).toBe(true)

    const events = ledger.listEvents('SESSION-1')
    expect(events.map(item => item.type)).toEqual(['session.started', 'tool.used', 'session.ended'])
    expect(JSON.stringify(events)).not.toContain('raw-token')
  })
})
