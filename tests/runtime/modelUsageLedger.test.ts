import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelUsageLedger, buildModelUsageInput } from '../../src/runtime/ModelUsageLedger.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeScaleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-model-usage-'))
  dirs.push(dir)
  return dir
}

describe('ModelUsageLedger', () => {
  it('records model usage and summarizes cache savings', () => {
    const ledger = new ModelUsageLedger(makeScaleDir())

    const record = ledger.record({
      provider: 'anthropic',
      model: 'claude-sonnet',
      inputTokens: 1000,
      outputTokens: 200,
      cacheEligibleTokens: 800,
      cacheCreationInputTokens: 800,
      cacheReadInputTokens: 600,
      estimatedCostUsd: 0.0012,
      metadata: { command: 'context-budget' },
    })

    expect(record.totalTokens).toBe(1200)
    expect(record.cacheSavingsTokens).toBe(600)

    ledger.record({
      provider: 'openai',
      inputTokens: 500,
      outputTokens: 50,
      cachedTokens: 300,
    })

    const summary = ledger.summarize()
    expect(summary.totalRecords).toBe(2)
    expect(summary.totalTokens).toBe(1750)
    expect(summary.cacheEligibleTokens).toBe(800)
    expect(summary.cacheCreationInputTokens).toBe(800)
    expect(summary.cacheReadInputTokens).toBe(600)
    expect(summary.cachedTokens).toBe(300)
    expect(summary.cacheSavingsTokens).toBe(900)
    expect(summary.byProvider.anthropic.records).toBe(1)
    expect(summary.byProvider.openai.cacheSavingsTokens).toBe(300)
  })

  it('normalizes provider usage payloads and reports by day, provider, and task', () => {
    const ledger = new ModelUsageLedger(makeScaleDir())

    ledger.record(buildModelUsageInput({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      usagePayload: {
        usage: {
          input_tokens: 900,
          output_tokens: 120,
          cache_creation_input_tokens: 700,
          cache_read_input_tokens: 400,
        },
      },
      timestamp: '2026-05-23T08:00:00.000Z',
    }))

    ledger.record(buildModelUsageInput({
      provider: 'openai',
      model: 'gpt-4.1',
      taskId: 'TASK-2',
      usagePayload: {
        usage: {
          prompt_tokens: 300,
          completion_tokens: 50,
          prompt_tokens_details: {
            cached_tokens: 200,
          },
        },
      },
      timestamp: '2026-05-24T08:00:00.000Z',
    }))

    const dayReport = ledger.report({ day: '2026-05-23', limit: 10 })
    expect(dayReport.summary.totalRecords).toBe(1)
    expect(dayReport.summary.totalTokens).toBe(1020)
    expect(dayReport.summary.cacheCreationInputTokens).toBe(700)
    expect(dayReport.summary.cacheReadInputTokens).toBe(400)
    expect(dayReport.byTask[0]).toMatchObject({ key: 'TASK-1', totalTokens: 1020 })
    expect(dayReport.records[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      cacheSavingsTokens: 400,
    })

    const providerSummary = ledger.summarize({ provider: 'openai' })
    expect(providerSummary.totalRecords).toBe(1)
    expect(providerSummary.totalTokens).toBe(350)
    expect(providerSummary.cachedTokens).toBe(200)
  })
})

