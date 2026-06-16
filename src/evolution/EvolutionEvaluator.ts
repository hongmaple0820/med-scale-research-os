// SCALE Engine — Evolution Evaluator (v0.7.0)
// Self-evolution 循环效果评估

import type { IEventBus } from '../core/eventBus.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { DetectorStatisticsTracker } from '../guardrails/DetectorEnhanced.js'
import { logger } from '../core/logger.js'

export interface EvolutionMetrics {
  lessonsProposed: number
  lessonsValidated: number
  lessonsApproved: number
  lessonsRejected: number
  lessonQualityScore: number
  rulesProposed: number
  rulesApproved: number
  rulesEnforced: number
  ruleEffectivenessScore: number
  hooksGenerated: number
  hooksDeployed: number
  hooksTriggered: number
  hookBlockingRate: number
  detectorTriggers: number
  detectorBlocks: number
  detectorWarnings: number
  detectorEffectivenessScore: number
  overallScore: number
  trend: 'improving' | 'stable' | 'declining'
}

export interface EvolutionSnapshot {
  timestamp: number
  metrics: EvolutionMetrics
}

export interface IEvolutionEvaluator {
  evaluate(): Promise<EvolutionMetrics>
  getHistory(): EvolutionSnapshot[]
  compareWithBaseline(baseline: EvolutionMetrics): Promise<{ improved: boolean; delta: Partial<EvolutionMetrics> }>
  getRecommendations(): Promise<string[]>
}

export class EvolutionEvaluator implements IEvolutionEvaluator {
  private history: EvolutionSnapshot[] = []
  private maxHistory: number
  private lastSnapshotTimestamp = 0

  constructor(
    private eventBus: IEventBus,
    // kb is reserved for future use with KB-based metrics
    _kb?: IKnowledgeBase,
    private stats?: DetectorStatisticsTracker,
    opts: { maxHistory?: number } = {},
  ) {
    this.maxHistory = opts.maxHistory ?? 30
  }

  async evaluate(): Promise<EvolutionMetrics> {
    const metrics: EvolutionMetrics = {
      lessonsProposed: await this.countEvents('lesson.proposed'),
      lessonsValidated: await this.countEvents('lesson.validated'),
      lessonsApproved: await this.countEvents('lesson.approved'),
      lessonsRejected: await this.countEvents('lesson.rejected'),
      lessonQualityScore: 0,
      rulesProposed: await this.countEvents('rule.proposed'),
      rulesApproved: await this.countEvents('rule.approved'),
      rulesEnforced: await this.countEvents('rule.enforced'),
      ruleEffectivenessScore: 0,
      hooksGenerated: await this.countEvents('hook.generated'),
      hooksDeployed: await this.countEvents('hook.deployed'),
      hooksTriggered: await this.countEvents('tool.blocked'),
      hookBlockingRate: 0,
      detectorTriggers: this.stats ? this.stats.getRecentTriggers(100).length : 0,
      detectorBlocks: this.stats ? this.stats.getRecentTriggers(100).filter(t => t.severity === 'block' || t.severity === 'deny').length : 0,
      detectorWarnings: this.stats ? this.stats.getRecentTriggers(100).filter(t => t.severity === 'warn').length : 0,
      detectorEffectivenessScore: 0,
      overallScore: 0,
      trend: 'stable',
    }

    metrics.lessonQualityScore = this.calculateLessonQuality(metrics)
    metrics.ruleEffectivenessScore = this.calculateRuleEffectiveness(metrics)
    metrics.hookBlockingRate = metrics.hooksTriggered > 0 ? metrics.detectorBlocks / metrics.hooksTriggered : 0
    metrics.detectorEffectivenessScore = this.calculateDetectorEffectiveness(metrics)
    metrics.overallScore = this.calculateOverallScore(metrics)
    metrics.trend = this.determineTrend(metrics)

    this.history.push({ timestamp: this.nextSnapshotTimestamp(), metrics })
    if (this.history.length > this.maxHistory) this.history.shift()

    this.eventBus.emit('evolution.evaluated', { score: metrics.overallScore, trend: metrics.trend })
    logger.info({ score: metrics.overallScore, trend: metrics.trend }, 'Evolution evaluated')
    return metrics
  }

  getHistory(): EvolutionSnapshot[] { return [...this.history] }

  async compareWithBaseline(baseline: EvolutionMetrics): Promise<{ improved: boolean; delta: Partial<EvolutionMetrics> }> {
    const current = await this.evaluate()
    const delta: Partial<EvolutionMetrics> = {}
    const keys: (keyof EvolutionMetrics)[] = ['overallScore', 'lessonQualityScore', 'ruleEffectivenessScore', 'detectorEffectivenessScore']
    for (const key of keys) {
      const currentVal = current[key] as number
      const baselineVal = baseline[key] as number
      const diff = currentVal - baselineVal
      // @ts-expect-error: Assigning number to optional field is intentional for delta calculation
      delta[key] = diff
    }
    const improved = delta.overallScore !== undefined && delta.overallScore > 0
    return { improved, delta }
  }

  async getRecommendations(): Promise<string[]> {
    const metrics = await this.evaluate()
    const recommendations: string[] = []
    if (metrics.lessonQualityScore < 0.5) recommendations.push('Lesson quality low. Focus on context-specific lessons.')
    if (metrics.lessonsRejected > metrics.lessonsApproved) recommendations.push('High rejection rate. Review validation criteria.')
    if (metrics.rulesProposed > 0 && metrics.rulesApproved === 0) recommendations.push('Rules proposed but none approved.')
    if (metrics.hooksGenerated > metrics.hooksDeployed) recommendations.push('Hooks not deployed. Run deployment.')
    if (metrics.detectorWarnings > metrics.detectorBlocks * 3) recommendations.push('Too many warnings. Consider stricter enforcement.')
    return recommendations
  }

  private async countEvents(type: string): Promise<number> {
    const events = await this.eventBus.query({ types: [type as any], limit: 1000 })
    return events.length
  }

  private nextSnapshotTimestamp(): number {
    const now = Date.now()
    this.lastSnapshotTimestamp = Math.max(now, this.lastSnapshotTimestamp + 1)
    return this.lastSnapshotTimestamp
  }

  private calculateLessonQuality(m: EvolutionMetrics): number {
    if (m.lessonsProposed === 0) return 0
    return (m.lessonsApproved / m.lessonsProposed) * 0.6 + (m.lessonsValidated / m.lessonsProposed) * 0.4
  }

  private calculateRuleEffectiveness(m: EvolutionMetrics): number {
    if (m.rulesApproved === 0) return 0
    return Math.min(1, m.rulesEnforced / m.rulesApproved)
  }

  private calculateDetectorEffectiveness(m: EvolutionMetrics): number {
    if (m.detectorTriggers === 0) return 0
    return Math.min(1, (m.detectorBlocks / m.detectorTriggers) * 2)
  }

  private calculateOverallScore(m: EvolutionMetrics): number {
    return m.lessonQualityScore * 0.3 + m.ruleEffectivenessScore * 0.25 + m.detectorEffectivenessScore * 0.25 + (m.hookBlockingRate > 0 ? 0.2 : 0)
  }

  private determineTrend(m: EvolutionMetrics): 'improving' | 'stable' | 'declining' {
    if (this.history.length < 2) return 'stable'
    const prev = this.history[this.history.length - 2].metrics.overallScore
    const delta = m.overallScore - prev
    if (delta > 0.05) return 'improving'
    if (delta < -0.05) return 'declining'
    return 'stable'
  }
}
