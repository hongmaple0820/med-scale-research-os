// SCALE Cortex — Governance ROI Metrics
// 对齐 ECC: multi-hook governance ROI measurement
// Tracks: gate pass rates, token costs, instinct hit rate, auto-fix success, savings

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import type { Instinct } from './InstinctExtractor.js'

export interface GovernanceMetrics {
  // Gate metrics
  gates: {
    totalRuns: number
    passRate: number
    failRate: number
    avgDurationMs: number
    byGate: Record<string, { runs: number; passed: number; avgTokens: number }>
  }
  // Instinct metrics
  instincts: {
    totalExtracted: number
    totalInjected: number
    totalApplied: number
    hitRate: number
    byConfidence: Record<string, { count: number; hitRate: number }>
  }
  // Cost metrics
  cost: {
    totalTokens: number
    totalCost: number
    avgTokensPerGate: number
    estimatedSavingsFromCaching: number
    estimatedSavingsFromInstincts: number
  }
  // Auto-fix metrics
  autoFix: {
    totalAttempts: number
    successRate: number
    avgAttemptsPerFix: number
    totalTimeSavedMinutes: number
  }
  // Trends (last 7 days vs previous 7 days)
  trends: {
    passRateDelta: number
    costDelta: number
    instinctHitRateDelta: number
  }
  period: { start: string; end: string }
}

// ---------------------------------------------------------------------------
// GovernanceMetricsCalculator
// ---------------------------------------------------------------------------

export class GovernanceMetricsCalculator {
  private scaleDir: string

  constructor(scaleDir: string = join(process.cwd(), '.scale')) {
    this.scaleDir = scaleDir
  }

  /**
   * Compute full governance metrics from observation logs and instinct store.
   */
  compute(instincts: Instinct[], lookbackDays: number = 30): GovernanceMetrics {
    const observations = this.loadObservations(lookbackDays)
    const prevObservations = this.loadObservationsRange(lookbackDays, lookbackDays * 2)

    // Gates
    const gateMetrics = this.computeGateMetrics(observations)

    // Instincts
    const instinctMetrics = this.computeInstinctMetrics(instincts)

    // Cost
    const cost = this.computeCostMetrics(observations, instinctMetrics)

    // Auto-fix
    const autoFix = this.computeAutoFixMetrics(observations)

    // Trends
    const trends = this.computeTrends(observations, prevObservations, instinctMetrics)

    return {
      gates: gateMetrics,
      instincts: instinctMetrics,
      cost,
      autoFix,
      trends,
      period: {
        start: new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10),
      },
    }
  }

  /**
   * Render metrics as a terminal report.
   */
  render(metrics: GovernanceMetrics): string {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`
    const usd = (n: number) => `$${n.toFixed(2)}`

    return [
      'SCALE Cortex — Governance ROI Report',
      `Period: ${metrics.period.start} → ${metrics.period.end}`,
      '',
      '═══ Gate Performance ═══',
      `  Total runs:    ${metrics.gates.totalRuns}`,
      `  Pass rate:     ${pct(metrics.gates.passRate)}`,
      `  Fail rate:     ${pct(metrics.gates.failRate)}`,
      `  Avg duration:  ${metrics.gates.avgDurationMs}ms`,
      '',
      '═══ Instinct Performance ═══',
      `  Extracted:     ${metrics.instincts.totalExtracted}`,
      `  Injected:      ${metrics.instincts.totalInjected}`,
      `  Applied:       ${metrics.instincts.totalApplied}`,
      `  Hit rate:      ${pct(metrics.instincts.hitRate)}`,
      '',
      '═══ Cost Analysis ═══',
      `  Total tokens:  ${metrics.cost.totalTokens.toLocaleString()}`,
      `  Total cost:    ${usd(metrics.cost.totalCost)}`,
      `  Avg token/gate: ${Math.round(metrics.cost.avgTokensPerGate).toLocaleString()}`,
      `  Saved (cache):  ${usd(metrics.cost.estimatedSavingsFromCaching)}`,
      `  Saved (instinct): ${usd(metrics.cost.estimatedSavingsFromInstincts)}`,
      '',
      '═══ Auto-Fix ═══',
      `  Attempts:      ${metrics.autoFix.totalAttempts}`,
      `  Success rate:  ${pct(metrics.autoFix.successRate)}`,
      `  Avg attempts:  ${metrics.autoFix.avgAttemptsPerFix.toFixed(1)}`,
      `  Time saved:    ${metrics.autoFix.totalTimeSavedMinutes} min`,
      '',
      '═══ Trends (△ vs previous period) ═══',
      `  Pass rate:     ${metrics.trends.passRateDelta > 0 ? '+' : ''}${pct(metrics.trends.passRateDelta)}`,
      `  Cost:          ${metrics.trends.costDelta > 0 ? '+' : ''}${usd(metrics.trends.costDelta)}`,
      `  Instinct hit:  ${metrics.trends.instinctHitRateDelta > 0 ? '+' : ''}${pct(metrics.trends.instinctHitRateDelta)}`,
      '',
      `ROI Score: ${this.computeROIScore(metrics)}/100`,
    ].join('\n')
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private loadObservations(lookbackDays: number): any[] {
    return this.loadObservationsRange(0, lookbackDays)
  }

  private loadObservationsRange(startDaysAgo: number, endDaysAgo: number): any[] {
    const obsDir = join(this.scaleDir, 'observations')
    if (!existsSync(obsDir)) return []

    const start = Date.now() - endDaysAgo * 86400000
    const end = Date.now() - startDaysAgo * 86400000

    const results: any[] = []
    try {
      for (const file of readdirSync(obsDir)) {
        if (!file.endsWith('.jsonl')) continue
        const lines = readFileSync(join(obsDir, file), 'utf-8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const obs = JSON.parse(line)
            const ts = new Date(obs.timestamp).getTime()
            if (ts >= start && ts < end) results.push(obs)
          } catch { /* skip */ }
        }
      }
    } catch (err) { logger.warn({ err }, 'Failed to load observations') }
    return results
  }

  private computeGateMetrics(observations: any[]): GovernanceMetrics['gates'] {
    const byGate: Record<string, { runs: number; passed: number; avgTokens: number }> = {}
    let totalRuns = 0
    let totalPassed = 0
    let totalDuration = 0

    for (const obs of observations) {
      totalRuns++
      if (obs.gateStatus === 'PASS') totalPassed++

      if (obs.gateName) {
        if (!byGate[obs.gateName]) byGate[obs.gateName] = { runs: 0, passed: 0, avgTokens: 0 }
        byGate[obs.gateName].runs++
        if (obs.gateStatus === 'PASS') byGate[obs.gateName].passed++
        byGate[obs.gateName].avgTokens += obs.tokensUsed ?? 0
      }
      totalDuration += obs.durationMs ?? 0
    }

    // Finalize averages
    for (const gate of Object.values(byGate)) {
      gate.avgTokens = gate.runs > 0 ? Math.round(gate.avgTokens / gate.runs) : 0
    }

    return {
      totalRuns,
      passRate: totalRuns > 0 ? totalPassed / totalRuns : 0,
      failRate: totalRuns > 0 ? (totalRuns - totalPassed) / totalRuns : 0,
      avgDurationMs: totalRuns > 0 ? Math.round(totalDuration / totalRuns) : 0,
      byGate,
    }
  }

  private computeInstinctMetrics(instincts: Instinct[]): GovernanceMetrics['instincts'] {
    const byConfidence: Record<string, { count: number; hitRate: number }> = {
      'near-certain (0.9)': { count: 0, hitRate: 0 },
      'strong (0.7)': { count: 0, hitRate: 0 },
      'moderate (0.5)': { count: 0, hitRate: 0 },
      'tentative (0.3)': { count: 0, hitRate: 0 },
    }

    for (const i of instincts) {
      const bucket = i.confidence >= 0.9 ? 'near-certain (0.9)' :
        i.confidence >= 0.7 ? 'strong (0.7)' :
        i.confidence >= 0.5 ? 'moderate (0.5)' : 'tentative (0.3)'
      byConfidence[bucket].count++
      byConfidence[bucket].hitRate += i.hitRate
    }

    for (const bucket of Object.values(byConfidence)) {
      bucket.hitRate = bucket.count > 0 ? bucket.hitRate / bucket.count : 0
    }

    const totalApplied = instincts.reduce((sum, i) => sum + i.appliedCount, 0)
    const totalObs = instincts.reduce((sum, i) => sum + i.observations, 0)

    return {
      totalExtracted: instincts.length,
      totalInjected: instincts.filter(i => i.confidence >= 0.7).length,
      totalApplied,
      hitRate: totalObs > 0 ? totalApplied / totalObs : 0,
      byConfidence,
    }
  }

  private computeCostMetrics(
    observations: any[],
    _instinctMetrics: GovernanceMetrics['instincts'],
  ): GovernanceMetrics['cost'] {
    const totalTokens = observations.reduce((sum, o) => sum + (o.tokensUsed ?? 0), 0)
    const totalCost = observations.reduce((sum, o) => sum + (o.estimatedCostUsd ?? 0), 0)

    return {
      totalTokens,
      totalCost,
      avgTokensPerGate: observations.length > 0 ? totalTokens / observations.length : 0,
      estimatedSavingsFromCaching: totalCost * 0.15,   // ~15% from caching
      estimatedSavingsFromInstincts: totalCost * 0.10,  // ~10% from instinct prevention
    }
  }

  private computeAutoFixMetrics(observations: any[]): GovernanceMetrics['autoFix'] {
    const autoFixObs = observations.filter(o => o.gateName?.includes('auto-fix'))
    const successes = autoFixObs.filter(o => o.gateStatus === 'PASS').length
    const totalAttempts = autoFixObs.length

    return {
      totalAttempts,
      successRate: totalAttempts > 0 ? successes / totalAttempts : 0,
      avgAttemptsPerFix: totalAttempts > 0 ? totalAttempts / Math.max(successes, 1) : 0,
      totalTimeSavedMinutes: successes * 5, // ~5 min saved per auto-fix
    }
  }

  private computeTrends(
    current: any[],
    previous: any[],
    instinctMetrics: GovernanceMetrics['instincts'],
  ): GovernanceMetrics['trends'] {
    const currentPassRate = current.length > 0
      ? current.filter(o => o.gateStatus === 'PASS').length / current.length
      : 0
    const prevPassRate = previous.length > 0
      ? previous.filter(o => o.gateStatus === 'PASS').length / previous.length
      : 0

    const currentCost = current.reduce((s, o) => s + (o.estimatedCostUsd ?? 0), 0)
    const prevCost = previous.reduce((s, o) => s + (o.estimatedCostUsd ?? 0), 0)

    return {
      passRateDelta: currentPassRate - prevPassRate,
      costDelta: currentCost - prevCost,
      instinctHitRateDelta: 0, // Requires historical hit rate data
    }
  }

  private computeROIScore(metrics: GovernanceMetrics): number {
    let score = 50 // baseline

    // Gate pass rate contributes up to 20 points
    score += Math.round(metrics.gates.passRate * 20)

    // Instinct hit rate contributes up to 15 points
    score += Math.round(metrics.instincts.hitRate * 15)

    // Auto-fix success contributes up to 10 points
    score += Math.round(metrics.autoFix.successRate * 10)

    // Positive cost savings contribute up to 5 points
    if (metrics.cost.estimatedSavingsFromCaching > 0) score += 3
    if (metrics.cost.estimatedSavingsFromInstincts > 0) score += 2

    return Math.min(100, Math.max(0, score))
  }
}
