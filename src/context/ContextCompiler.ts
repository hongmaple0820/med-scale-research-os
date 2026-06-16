import type { ContextBudgetCategory } from './ContextBudget.js'

export interface ContextCompilerCandidate {
  id: string
  category: ContextBudgetCategory
  estimatedTokens: number
  reason: string
  paths: string[]
  required?: boolean
  basePriority?: number
}

export interface ContextCompilerInput {
  task: string
  level: string
  files: string[]
  budget: number
  candidates: ContextCompilerCandidate[]
}

export interface CompiledContextItem extends ContextCompilerCandidate {
  included: boolean
  score: number
  matchedSignals: string[]
  inclusionReason?: string
  omissionReason?: string
}

export interface CompiledContext {
  strategy: 'relevance-budget-v1'
  generatedAt: string
  budget: number
  totalCandidateTokens: number
  totalEstimatedTokens: number
  estimatedTokenSavings: number
  items: CompiledContextItem[]
}

const CATEGORY_PRIORITY: Record<ContextBudgetCategory, number> = {
  always: 500,
  evidence: 220,
  'on-demand': 160,
  archive: 80,
  generated: 20,
}

export function compileContext(input: ContextCompilerInput): CompiledContext {
  const budget = Math.max(0, Math.floor(input.budget))
  const taskSignals = taskSignalSet(input.task, input.files, input.level)
  const ranked = input.candidates
    .map(candidate => scoreCandidate(candidate, taskSignals, input))
    .sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || b.score - a.score || a.estimatedTokens - b.estimatedTokens || a.id.localeCompare(b.id))

  let totalEstimatedTokens = 0
  const items: CompiledContextItem[] = []

  for (const candidate of ranked) {
    const nextTotal = totalEstimatedTokens + candidate.estimatedTokens
    if (candidate.estimatedTokens <= 0) {
      items.push({
        ...candidate,
        included: false,
        omissionReason: 'empty-candidate',
      })
      continue
    }
    if (nextTotal > budget) {
      items.push({
        ...candidate,
        included: false,
        omissionReason: candidate.required ? 'required-over-budget' : 'budget-exceeded',
      })
      continue
    }
    totalEstimatedTokens = nextTotal
    items.push({
      ...candidate,
      included: true,
      inclusionReason: inclusionReason(candidate),
    })
  }

  const totalCandidateTokens = input.candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.estimatedTokens), 0)

  return {
    strategy: 'relevance-budget-v1',
    generatedAt: new Date().toISOString(),
    budget,
    totalCandidateTokens,
    totalEstimatedTokens,
    estimatedTokenSavings: Math.max(0, totalCandidateTokens - totalEstimatedTokens),
    items,
  }
}

function scoreCandidate(
  candidate: ContextCompilerCandidate,
  taskSignals: Set<string>,
  input: ContextCompilerInput,
): Omit<CompiledContextItem, 'included'> {
  const matchedSignals: string[] = []
  let score = CATEGORY_PRIORITY[candidate.category] + (candidate.basePriority ?? 0)
  if (candidate.required) score += 1000

  const haystack = `${candidate.id} ${candidate.reason} ${candidate.paths.join(' ')}`.toLowerCase()
  for (const signal of taskSignals) {
    if (haystack.includes(signal)) {
      score += 12
      if (matchedSignals.length < 12) matchedSignals.push(signal)
    }
  }

  const normalizedFiles = input.files.map(normalizePath).filter(Boolean)
  for (const file of normalizedFiles) {
    if (candidate.paths.some(path => path === file || path.endsWith(`/${file}`) || basename(path) === basename(file))) {
      score += 220
      matchedSignals.push(`file:${file}`)
    }
  }

  const level = input.level.toUpperCase()
  if ((level === 'L' || level === 'CRITICAL') && candidate.category === 'evidence') {
    score += 60
    matchedSignals.push('high-risk-evidence')
  }
  if ((level === 'L' || level === 'CRITICAL') && candidate.category === 'archive') {
    score += 35
    matchedSignals.push('high-risk-archive')
  }
  if (candidate.category === 'generated' && matchedSignals.length === 0) score -= 120

  return {
    ...candidate,
    score,
    matchedSignals: unique(matchedSignals),
  }
}

function inclusionReason(candidate: Omit<CompiledContextItem, 'included'>): string {
  if (candidate.required) return `${candidate.reason} Required context within budget.`
  if (candidate.matchedSignals.length > 0) return `${candidate.reason} Matched: ${candidate.matchedSignals.join(', ')}.`
  return `${candidate.reason} Selected by category priority and token budget.`
}

function taskSignalSet(task: string, files: string[], level: string): Set<string> {
  const signals = new Set<string>()
  for (const value of [task, level, ...files]) {
    const normalized = normalizePath(value).toLowerCase()
    for (const part of normalized.split(/[^a-z0-9_.\-/]+/i)) {
      const trimmed = part.trim()
      if (trimmed.length >= 3) signals.add(trimmed)
    }
    const base = basename(normalized)
    if (base.length >= 3) signals.add(base)
  }
  return signals
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
