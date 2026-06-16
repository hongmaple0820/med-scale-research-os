import { createHash } from 'node:crypto'
import type { ContextBudgetCategory, ContextBudgetEntry, ContextPackSection } from '../context/ContextBudget.js'

export type PromptCacheProvider = 'anthropic' | 'openai' | 'generic'

export interface PromptCachePolicyOptions {
  provider?: PromptCacheProvider | string
  allowOnDemandReuse?: boolean
}

export interface PromptCachePolicyInput extends PromptCachePolicyOptions {
  entries?: Array<Pick<ContextBudgetEntry, 'path' | 'category' | 'estimatedTokens'>>
  sections?: Array<Pick<ContextPackSection, 'id' | 'category' | 'included' | 'estimatedTokens' | 'paths'>>
}

export interface PromptCacheCandidate {
  id: string
  category: ContextBudgetCategory
  estimatedTokens: number
  paths: string[]
  reason: string
}

export interface PromptCachePolicyResult {
  provider: string
  supported: boolean
  strategy: 'anthropic-ephemeral' | 'openai-automatic' | 'usage-ledger-only'
  cacheEligibleTokens: number
  cacheEligiblePaths: string[]
  cacheKey: string
  candidates: PromptCacheCandidate[]
  usageMetrics: {
    cacheCreationInputTokens?: string
    cacheReadInputTokens?: string
    cachedTokens?: string
  }
  notes: string[]
}

const CACHEABLE_CATEGORIES = new Set<ContextBudgetCategory>(['always'])

export class PromptCachePolicy {
  resolve(input: PromptCachePolicyInput): PromptCachePolicyResult {
    const provider = normalizeProvider(input.provider)
    const candidates = resolveCandidates(input)
    const cacheEligibleTokens = candidates.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)
    const cacheEligiblePaths = Array.from(new Set(candidates.flatMap(candidate => candidate.paths))).sort()
    const notes = [
      'Only stable always-loaded context is cache-eligible by default.',
      ...(input.allowOnDemandReuse ? ['On-demand reuse was explicitly allowed for stable repeated task context.'] : []),
    ]

    return {
      provider,
      supported: provider === 'anthropic' || provider === 'openai',
      strategy: provider === 'anthropic'
        ? 'anthropic-ephemeral'
        : provider === 'openai'
          ? 'openai-automatic'
          : 'usage-ledger-only',
      cacheEligibleTokens,
      cacheEligiblePaths,
      cacheKey: cacheKey(provider, candidates),
      candidates,
      usageMetrics: usageMetrics(provider),
      notes,
    }
  }
}

export function resolvePromptCachePolicy(input: PromptCachePolicyInput): PromptCachePolicyResult {
  return new PromptCachePolicy().resolve(input)
}

export function shouldCacheContextCategory(category: ContextBudgetCategory, allowOnDemandReuse = false): boolean {
  return CACHEABLE_CATEGORIES.has(category) || (allowOnDemandReuse && category === 'on-demand')
}

function normalizeProvider(provider: PromptCachePolicyOptions['provider']): PromptCacheProvider | string {
  const value = String(provider ?? 'generic').toLowerCase()
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic'
  if (value.includes('openai') || value.includes('gpt')) return 'openai'
  return value
}

function resolveCandidates(input: PromptCachePolicyInput): PromptCacheCandidate[] {
  if (input.sections) {
    return input.sections
      .filter(section => section.included && shouldCacheContextCategory(section.category, input.allowOnDemandReuse))
      .map(section => ({
        id: section.id,
        category: section.category,
        estimatedTokens: section.estimatedTokens,
        paths: section.paths,
        reason: section.category === 'always'
          ? 'stable always-loaded context'
          : 'explicitly allowed repeated on-demand context',
      }))
      .filter(candidate => candidate.estimatedTokens > 0)
  }

  return (input.entries ?? [])
    .filter(entry => shouldCacheContextCategory(entry.category, input.allowOnDemandReuse))
    .map(entry => ({
      id: entry.path,
      category: entry.category,
      estimatedTokens: entry.estimatedTokens,
      paths: [entry.path],
      reason: entry.category === 'always'
        ? 'stable always-loaded context'
        : 'explicitly allowed repeated on-demand context',
    }))
    .filter(candidate => candidate.estimatedTokens > 0)
}

function cacheKey(provider: string, candidates: PromptCacheCandidate[]): string {
  const stablePayload = candidates
    .map(candidate => ({
      id: candidate.id,
      category: candidate.category,
      estimatedTokens: candidate.estimatedTokens,
      paths: candidate.paths.slice().sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify({ provider, candidates: stablePayload })).digest('hex')
}

function usageMetrics(provider: string): PromptCachePolicyResult['usageMetrics'] {
  if (provider === 'anthropic') {
    return {
      cacheCreationInputTokens: 'cache_creation_input_tokens',
      cacheReadInputTokens: 'cache_read_input_tokens',
    }
  }
  if (provider === 'openai') {
    return {
      cachedTokens: 'prompt_tokens_details.cached_tokens',
    }
  }
  return {}
}

