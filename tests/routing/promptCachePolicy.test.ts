import { describe, expect, it } from 'vitest'
import { resolvePromptCachePolicy, shouldCacheContextCategory } from '../../src/routing/PromptCachePolicy.js'

describe('PromptCachePolicy', () => {
  it('marks only always-loaded entries as cache-eligible by default', () => {
    const result = resolvePromptCachePolicy({
      provider: 'anthropic',
      entries: [
        { path: 'AGENTS.md', category: 'always', estimatedTokens: 120 },
        { path: 'docs/CONTEXT_BUDGET.md', category: 'on-demand', estimatedTokens: 500 },
        { path: '.scale/evidence/run.json', category: 'evidence', estimatedTokens: 300 },
      ],
    })

    expect(result.provider).toBe('anthropic')
    expect(result.supported).toBe(true)
    expect(result.strategy).toBe('anthropic-ephemeral')
    expect(result.cacheEligibleTokens).toBe(120)
    expect(result.cacheEligiblePaths).toEqual(['AGENTS.md'])
    expect(result.usageMetrics.cacheCreationInputTokens).toBe('cache_creation_input_tokens')
    expect(result.usageMetrics.cacheReadInputTokens).toBe('cache_read_input_tokens')
  })

  it('records OpenAI automatic cache metrics without pretending to mark blocks', () => {
    const result = resolvePromptCachePolicy({
      provider: 'openai',
      sections: [
        { id: 'always-core', category: 'always', included: true, estimatedTokens: 250, paths: ['AGENTS.md'] },
        { id: 'runtime-evidence', category: 'evidence', included: true, estimatedTokens: 900, paths: ['.scale/evidence/a.json'] },
      ],
    })

    expect(result.strategy).toBe('openai-automatic')
    expect(result.cacheEligibleTokens).toBe(250)
    expect(result.usageMetrics.cachedTokens).toBe('prompt_tokens_details.cached_tokens')
  })

  it('allows on-demand cache candidates only when explicitly enabled', () => {
    expect(shouldCacheContextCategory('on-demand')).toBe(false)
    expect(shouldCacheContextCategory('on-demand', true)).toBe(true)

    const result = resolvePromptCachePolicy({
      provider: 'generic',
      allowOnDemandReuse: true,
      entries: [
        { path: 'docs/SKILL_RADAR.md', category: 'on-demand', estimatedTokens: 400 },
      ],
    })

    expect(result.supported).toBe(false)
    expect(result.strategy).toBe('usage-ledger-only')
    expect(result.cacheEligibleTokens).toBe(400)
  })
})

