import { describe, expect, it } from 'vitest'
import { runActiveRedTeam } from '../../src/guardrails/ActiveRedTeam.js'

describe('ActiveRedTeam', () => {
  it('skips when active security is not configured', async () => {
    const report = await runActiveRedTeam(undefined)

    expect(report.status).toBe('SKIPPED')
    expect(report.ok).toBe(true)
    expect(report.probes).toEqual([])
    expect(report.evidence).toContain('not enabled')
  })

  it('fails invalid enabled configuration before sending probes', async () => {
    const report = await runActiveRedTeam({
      enabled: true,
      baseUrl: 'http://localhost:3000',
      targets: [],
    }, {
      fetch: async () => {
        throw new Error('fetch should not be called for invalid config')
      },
    })

    expect(report.status).toBe('FAILED')
    expect(report.ok).toBe(false)
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('targets'),
    ]))
  })

  it('detects reflected probe payloads within configured target limits', async () => {
    const calls: string[] = []
    const report = await runActiveRedTeam({
      enabled: true,
      baseUrl: 'http://localhost:3000',
      targets: ['/api/search', '/api/users'],
      payloads: ['<scale-probe>'],
      maxRequests: 1,
      timeoutMs: 1000,
    }, {
      fetch: async (url) => {
        calls.push(String(url))
        return {
          status: 200,
          text: async () => `reflected <scale-probe>`,
        }
      },
    })

    expect(calls).toHaveLength(1)
    expect(report.status).toBe('FAILED')
    expect(report.ok).toBe(false)
    expect(report.summary.findings).toBe(1)
    expect(report.findings[0]).toEqual(expect.objectContaining({
      ruleId: 'active.reflected-payload',
      severity: 'HIGH',
      target: '/api/search',
    }))
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('active.reflected-payload'),
    ]))
  })
})
