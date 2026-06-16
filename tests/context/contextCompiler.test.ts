import { describe, expect, it } from 'vitest'
import { compileContext } from '../../src/context/ContextCompiler.js'

describe('ContextCompiler', () => {
  it('keeps required context first and omits lower-priority candidates when budget is tight', () => {
    const compiled = compileContext({
      task: 'Fix OAuth callback bug with runtime evidence',
      level: 'M',
      files: ['src/auth/oauth.ts'],
      budget: 150,
      candidates: [
        {
          id: 'always-core',
          category: 'always',
          estimatedTokens: 50,
          reason: 'Core governance rules.',
          paths: ['AGENTS.md'],
          required: true,
        },
        {
          id: 'runtime-evidence',
          category: 'evidence',
          estimatedTokens: 70,
          reason: 'Evidence is needed for verification claims.',
          paths: ['.scale/evidence/oauth-runtime.json'],
        },
        {
          id: 'planning-archive',
          category: 'archive',
          estimatedTokens: 90,
          reason: 'Historical plans may be relevant.',
          paths: ['docs/plans/old-plan.md'],
        },
      ],
    })

    expect(compiled.totalEstimatedTokens).toBe(120)
    expect(compiled.estimatedTokenSavings).toBe(90)
    expect(compiled.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'always-core', included: true }),
      expect.objectContaining({ id: 'runtime-evidence', included: true }),
      expect.objectContaining({ id: 'planning-archive', included: false, omissionReason: 'budget-exceeded' }),
    ]))
  })

  it('boosts candidates that directly match changed files', () => {
    const compiled = compileContext({
      task: 'Review payment validation',
      level: 'L',
      files: ['src/payments/validate.ts'],
      budget: 120,
      candidates: [
        {
          id: 'generic-evidence',
          category: 'evidence',
          estimatedTokens: 80,
          reason: 'General runtime evidence.',
          paths: ['.scale/evidence/general.json'],
        },
        {
          id: 'payment-context',
          category: 'on-demand',
          estimatedTokens: 80,
          reason: 'Payment validation domain context.',
          paths: ['src/payments/validate.ts'],
        },
      ],
    })

    const payment = compiled.items.find(item => item.id === 'payment-context')
    const generic = compiled.items.find(item => item.id === 'generic-evidence')
    expect(payment?.score).toBeGreaterThan(generic?.score ?? 0)
    expect(payment?.included).toBe(true)
    expect(generic?.included).toBe(false)
    expect(payment?.matchedSignals).toContain('file:src/payments/validate.ts')
  })
})
