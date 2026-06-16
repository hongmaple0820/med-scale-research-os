import { logger } from '../core/logger.js'

export interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  description: string
  suggestion?: string
  file?: string
  line?: number
}

export interface ModelReview {
  model: string
  findings: ReviewFinding[]
  summary: string
  confidence: number // 0-1
}

export interface CrossModelReviewResult {
  reviews: ModelReview[]
  consensus: {
    unanimous: ReviewFinding[]   // all models agree
    majority: ReviewFinding[]    // ≥ majority agree
    solo: ReviewFinding[]        // single model only
  }
  overallScore: number // 0-100
  recommendation: 'approve' | 'approve_with_comments' | 'needs_work' | 'blocked'
}

export class CrossModelReviewer {
  /**
   * Aggregate reviews from multiple models into a consensus.
   * Each review contains findings — this merges and de-duplicates them.
   */
  aggregate(reviews: ModelReview[]): CrossModelReviewResult {
    const allFindings = new Map<string, { finding: ReviewFinding; models: string[] }>()

    for (const review of reviews) {
      for (const finding of review.findings) {
        // Key: category + description summary for dedup
        const key = `${finding.category}:${(finding.description ?? '').slice(0, 80)}`
        const existing = allFindings.get(key)
        if (existing) {
          existing.models.push(review.model)
          // Keep the more detailed version
          if ((finding.suggestion?.length ?? 0) > (existing.finding.suggestion?.length ?? 0)) {
            existing.finding = finding
          }
        } else {
          allFindings.set(key, { finding, models: [review.model] })
        }
      }
    }

    const modelCount = reviews.length
    const majority = Math.ceil(modelCount / 2)

    const unanimous: ReviewFinding[] = []
    const majorityList: ReviewFinding[] = []
    const solo: ReviewFinding[] = []

    for (const [, item] of allFindings) {
      if (item.models.length === modelCount) unanimous.push(item.finding)
      else if (item.models.length >= majority) majorityList.push(item.finding)
      else solo.push(item.finding)
    }

    // Score and recommendation
    const criticalCount = [...allFindings.values()].filter(f => f.finding.severity === 'critical').length
    const highCount = [...allFindings.values()].filter(f => f.finding.severity === 'high').length
    const score = Math.max(0, 100 - (criticalCount * 25) - (highCount * 10) - (solo.length * 2))

    let recommendation: CrossModelReviewResult['recommendation']
    if (criticalCount > 0 && unanimous.some(f => f.severity === 'critical')) recommendation = 'blocked'
    else if (criticalCount > 0) recommendation = 'needs_work'
    else if (highCount > 0) recommendation = 'approve_with_comments'
    else recommendation = 'approve'

    return { reviews, consensus: { unanimous, majority: majorityList, solo }, overallScore: score, recommendation }
  }

  /**
   * Generate a human-readable consensus report.
   */
  renderReport(result: CrossModelReviewResult): string {
    const lines: string[] = [
      `Cross-Model Review Report`,
      `Models: ${result.reviews.map(r => r.model).join(', ')}`,
      `Overall Score: ${result.overallScore}/100`,
      `Recommendation: ${result.recommendation.toUpperCase()}`,
      ``,
      `## Unanimous Findings (${result.consensus.unanimous.length})`,
      ...result.consensus.unanimous.map(f => `  [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`),
      ``,
      `## Majority Findings (${result.consensus.majority.length})`,
      ...result.consensus.majority.map(f => `  [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`),
      ``,
      `## Solo Findings (${result.consensus.solo.length})`,
      ...result.consensus.solo.map(f => `  [${f.severity.toUpperCase()}] ${f.category}: ${f.description} (${f.suggestion ?? 'no suggestion'})`),
    ]
    return lines.join('\n')
  }
}
