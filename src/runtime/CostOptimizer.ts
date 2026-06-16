import type { OptimizationSuggestion } from './CostAnalyzer.js'

export interface OptimizationPlan {
  suggestions: OptimizationSuggestion[]
  totalEstimatedSavings: number
  implementationPriority: Array<{
    suggestion: OptimizationSuggestion
    effort: 'low' | 'medium' | 'high'
    impactLevel: 'low' | 'medium' | 'high'
  }>
}

export function prioritizeOptimizations(suggestions: OptimizationSuggestion[]): OptimizationPlan {
  const totalSavings = suggestions.reduce((sum, s) => sum + s.estimatedMonthlySavings, 0)
  const priority = suggestions
    .map(s => ({
      suggestion: s,
      effort: s.category === 'cache-opportunity' ? 'low' as const : s.category === 'model-downgrade' ? 'low' as const : 'medium' as const,
      impactLevel: s.estimatedMonthlySavings > 2 ? 'high' as const : s.estimatedMonthlySavings > 0.5 ? 'medium' as const : 'low' as const,
    }))
    .sort((a, b) => {
      const effortScore = { low: 3, medium: 2, high: 1 }
      const aScore = effortScore[a.effort] * (a.suggestion.confidence * (a.suggestion.estimatedMonthlySavings + 0.01))
      const bScore = effortScore[b.effort] * (b.suggestion.confidence * (b.suggestion.estimatedMonthlySavings + 0.01))
      return bScore - aScore
    })

  return {
    suggestions,
    totalEstimatedSavings: totalSavings,
    implementationPriority: priority,
  }
}
