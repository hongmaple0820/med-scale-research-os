import type { ModelReview, CrossModelReviewResult } from './CrossModelReviewer.js'

export interface ReviewSummary {
  totalFindings: number
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
  modelAgreement: number // 0-1, how much models agree
  topIssues: Array<{ description: string; severity: string; models: string[] }>
}

export function summarizeReviews(result: CrossModelReviewResult): ReviewSummary {
  const allFindings = result.reviews.flatMap(r => r.findings)
  const bySeverity: Record<string, number> = {}
  const byCategory: Record<string, number> = {}

  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
  }

  const total = allFindings.length
  const consensusTotal = result.consensus.unanimous.length + result.consensus.majority.length
  const agreement = total > 0 ? consensusTotal / (consensusTotal + result.consensus.solo.length) : 1

  return {
    totalFindings: total,
    bySeverity,
    byCategory,
    modelAgreement: agreement,
    topIssues: [...result.consensus.unanimous, ...result.consensus.majority]
      .slice(0, 5)
      .map(f => ({
        description: f.description,
        severity: f.severity,
        models: result.reviews
          .filter(r => r.findings.some(rf => rf.description === f.description))
          .map(r => r.model),
      })),
  }
}
