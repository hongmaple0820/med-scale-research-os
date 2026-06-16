// SCALE Engine — Execution Ledger Tests

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ExecutionLedger } from '../../src/runtime/ExecutionLedger.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-exec-ledger-'))
  dirs.push(dir)
  return dir
}

describe('ExecutionLedger', () => {
  it('records and queries events', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir, now: () => new Date('2026-05-22T00:00:00.000Z') })

    const event = ledger.record({
      agentId: 'implementer',
      sessionId: 'SESSION-1',
      type: 'agent.started',
      summary: 'Implementer agent started',
    })

    expect(event.id).toMatch(/^EXEC-/)
    expect(event.ts).toBe('2026-05-22T00:00:00.000Z')
    expect(event.agentId).toBe('implementer')

    const results = ledger.query({ agentId: 'implementer' })
    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('Implementer agent started')
  })

  it('filters by sessionId', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'a1 s1' })
    ledger.record({ agentId: 'a2', sessionId: 'S2', type: 'agent.started', summary: 'a2 s2' })
    ledger.record({ agentId: 'a1', sessionId: 'S2', type: 'tool.invoked', summary: 'a1 s2 tool' })

    const s1 = ledger.query({ sessionId: 'S1' })
    expect(s1).toHaveLength(1)
    expect(s1[0].sessionId).toBe('S1')

    const s2 = ledger.query({ sessionId: 'S2' })
    expect(s2).toHaveLength(2)
  })

  it('filters by event type', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'start' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'tool.invoked', summary: 'tool' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'gate.checked', summary: 'gate' })

    const tools = ledger.query({ type: 'tool.invoked' })
    expect(tools).toHaveLength(1)
    expect(tools[0].type).toBe('tool.invoked')
  })

  it('filters by taskId', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    ledger.record({ agentId: 'a1', sessionId: 'S1', taskId: 'T1', type: 'task.started', summary: 't1' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', taskId: 'T2', type: 'task.started', summary: 't2' })

    const t1 = ledger.query({ taskId: 'T1' })
    expect(t1).toHaveLength(1)
    expect(t1[0].taskId).toBe('T1')
  })

  it('filters by since timestamp', () => {
    const projectDir = makeProject()
    let time = 0
    const ledger = new ExecutionLedger({
      projectDir,
      now: () => new Date(`2026-05-22T00:00:${String(time++).padStart(2, '0')}.000Z`),
    })

    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'early' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'late' })

    const recent = ledger.query({ since: '2026-05-22T00:00:01.000Z' })
    expect(recent).toHaveLength(1)
    expect(recent[0].summary).toBe('late')
  })

  it('respects limit', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    for (let i = 0; i < 10; i++) {
      ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'tool.invoked', summary: `tool-${i}` })
    }

    const limited = ledger.query({ limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it('summarizes correctly', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    ledger.record({ agentId: 'a1', sessionId: 'S1', taskId: 'T1', type: 'agent.started', summary: 'start' })
    ledger.record({ agentId: 'a2', sessionId: 'S2', taskId: 'T1', type: 'tool.invoked', summary: 'tool' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'policy.violation', summary: 'violation' })

    const summary = ledger.summarize()
    expect(summary.totalEvents).toBe(3)
    expect(summary.agents).toContain('a1')
    expect(summary.agents).toContain('a2')
    expect(summary.sessions).toContain('S1')
    expect(summary.sessions).toContain('S2')
    expect(summary.taskCount).toBe(1)
    expect(summary.violationCount).toBe(1)
  })

  it('exports valid JSONL', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'start' })
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.ended', summary: 'end' })

    const jsonl = ledger.exportJsonl()
    const lines = jsonl.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('creates ledger directory on construction', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })
    expect(existsSync(ledger.getLedgerPath())).toBe(false)
    ledger.record({ agentId: 'a1', sessionId: 'S1', type: 'agent.started', summary: 'test' })
    expect(existsSync(ledger.getLedgerPath())).toBe(true)
  })

  it('handles empty query gracefully', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    expect(ledger.query()).toEqual([])
    expect(ledger.summarize().totalEvents).toBe(0)
    expect(ledger.exportJsonl()).toBe('')
  })

  it('records metadata and duration', () => {
    const projectDir = makeProject()
    const ledger = new ExecutionLedger({ projectDir })

    const event = ledger.record({
      agentId: 'a1',
      sessionId: 'S1',
      type: 'tool.invoked',
      summary: 'ran build',
      metadata: { command: 'npm run build', exitCode: 0 },
      duration: 1500,
    })

    expect(event.metadata).toEqual({ command: 'npm run build', exitCode: 0 })
    expect(event.duration).toBe(1500)
  })
})
