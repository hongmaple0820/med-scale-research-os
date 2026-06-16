// SCALE Engine — Governance ROI Report (v0.35.0)
// End-to-end governance ROI metrics: token cost vs quality vs gate friction

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { TaskMetricsStore, type TaskMetricRecord } from './TaskMetricsStore.js'
import { ModelUsageLedger } from '../runtime/ModelUsageLedger.js'
import { EvidenceStore } from './EvidenceStore.js'

export interface GovernanceCostMetrics {
  totalTokensUsed: number
  tokensByPhase: Record<string, number>
  estimatedCostUsd?: number
  contextCompilerSavings: number
  cacheHitSavings: number
}

export interface GovernanceQualityMetrics {
  firstPassRate: number
  averageFixIterations: number
  gatePassRate: number
  evidenceCompletenessRate: number
  securityFindingsCount: number
  resolvedSecurityFindings: number
}

export interface GovernanceFrictionMetrics {
  totalGateChecks: number
  gateBlocks: number
  averageGateLatencyMs: number
  skippedPhases: number
  manualOverrides: number
}

export interface GovernanceRoiSummary {
  cost: GovernanceCostMetrics
  quality: GovernanceQualityMetrics
  friction: GovernanceFrictionMetrics
  roi: {
    tokenEfficiency: number
    gateEfficiency: number
    overallScore: number
  }
  recommendations: string[]
}

export interface GovernanceRoiInput {
  projectDir?: string
  scaleDir?: string
  sinceDays?: number
}

export interface RoiDelta {
  costDelta: Partial<GovernanceCostMetrics>
  qualityDelta: Partial<GovernanceQualityMetrics>
  frictionDelta: Partial<GovernanceFrictionMetrics>
  roiDelta: {
    tokenEfficiencyChange: number
    gateEfficiencyChange: number
    overallScoreChange: number
  }
  summary: string
}

export function collectGovernanceRoi(input: GovernanceRoiInput = {}): GovernanceRoiSummary {
  const projectDir = resolve(input.projectDir ?? process.cwd())
  const scaleRoot = isAbsolute(input.scaleDir ?? '')
    ? input.scaleDir as string
    : join(projectDir, input.scaleDir ?? '.scale')

  const taskMetrics = collectTaskMetrics(scaleRoot)
  const costMetrics = collectCostMetrics(scaleRoot)
  const frictionMetrics = collectFrictionMetrics(scaleRoot, taskMetrics.records)

  const quality: GovernanceQualityMetrics = {
    firstPassRate: taskMetrics.summary.total > 0 ? taskMetrics.summary.firstPassRate : 0,
    averageFixIterations: taskMetrics.summary.averageFixIterations,
    gatePassRate: frictionMetrics.totalGateChecks > 0
      ? (frictionMetrics.totalGateChecks - frictionMetrics.gateBlocks) / frictionMetrics.totalGateChecks
      : 0,
    evidenceCompletenessRate: taskMetrics.summary.artifactCompletenessRate,
    securityFindingsCount: 0,
    resolvedSecurityFindings: 0,
  }

  // Check security audit results
  const securityPath = join(scaleRoot, 'security-audit.json')
  if (existsSync(securityPath)) {
    try {
      const audit = JSON.parse(readFileSync(securityPath, 'utf-8'))
      quality.securityFindingsCount = audit.findings?.length ?? 0
      quality.resolvedSecurityFindings = audit.findings?.filter((f: { resolved?: boolean }) => f.resolved).length ?? 0
    } catch { /* ignore */ }
  }

  const tokenEfficiency = costMetrics.totalTokensUsed > 0
    ? quality.firstPassRate / (costMetrics.totalTokensUsed / 10000)
    : 0

  const gateEfficiency = frictionMetrics.gateBlocks > 0
    ? quality.gatePassRate / (frictionMetrics.gateBlocks / Math.max(1, frictionMetrics.totalGateChecks))
    : quality.gatePassRate

  const overallScore = round(Math.min(100,
    quality.firstPassRate * 30 +
    quality.gatePassRate * 20 +
    quality.evidenceCompletenessRate * 20 +
    (1 - Math.min(1, frictionMetrics.gateBlocks / Math.max(1, frictionMetrics.totalGateChecks))) * 15 +
    (costMetrics.contextCompilerSavings > 0 ? 10 : 0) +
    (quality.averageFixIterations < 2 ? 5 : 0),
  ))

  const recommendations = buildRecommendations(quality, frictionMetrics, costMetrics)

  return {
    cost: costMetrics,
    quality,
    friction: frictionMetrics,
    roi: {
      tokenEfficiency: round(tokenEfficiency),
      gateEfficiency: round(gateEfficiency),
      overallScore,
    },
    recommendations,
  }
}

export function summarizeGovernanceRoi(summary: GovernanceRoiSummary): string {
  const lines: string[] = [
    '## Governance ROI Report',
    '',
    `**Overall Score:** ${summary.roi.overallScore}/100`,
    '',
    '### Cost',
    `- Total Tokens: ${summary.cost.totalTokensUsed.toLocaleString()}`,
    `- Context Compiler Savings: ${summary.cost.contextCompilerSavings.toLocaleString()}`,
    `- Cache Hit Savings: ${summary.cost.cacheHitSavings.toLocaleString()}`,
  ]

  if (summary.cost.estimatedCostUsd !== undefined) {
    lines.push(`- Estimated Cost: $${summary.cost.estimatedCostUsd.toFixed(4)}`)
  }

  lines.push(
    '',
    '### Quality',
    `- First Pass Rate: ${(summary.quality.firstPassRate * 100).toFixed(0)}%`,
    `- Average Fix Iterations: ${summary.quality.averageFixIterations.toFixed(1)}`,
    `- Gate Pass Rate: ${(summary.quality.gatePassRate * 100).toFixed(0)}%`,
    `- Evidence Completeness: ${(summary.quality.evidenceCompletenessRate * 100).toFixed(0)}%`,
    `- Security Findings: ${summary.quality.securityFindingsCount} (${summary.quality.resolvedSecurityFindings} resolved)`,
    '',
    '### Friction',
    `- Gate Checks: ${summary.friction.totalGateChecks}`,
    `- Gate Blocks: ${summary.friction.gateBlocks}`,
    `- Skipped Phases: ${summary.friction.skippedPhases}`,
    `- Manual Overrides: ${summary.friction.manualOverrides}`,
    '',
    '### ROI',
    `- Token Efficiency: ${summary.roi.tokenEfficiency}`,
    `- Gate Efficiency: ${summary.roi.gateEfficiency}`,
  )

  if (summary.recommendations.length > 0) {
    lines.push('', '### Recommendations')
    for (const r of summary.recommendations) lines.push(`- ${r}`)
  }

  return lines.join('\n')
}

export function compareRoiReports(baseline: GovernanceRoiSummary, current: GovernanceRoiSummary): RoiDelta {
  const costDelta: Partial<GovernanceCostMetrics> = {
    totalTokensUsed: current.cost.totalTokensUsed - baseline.cost.totalTokensUsed,
    contextCompilerSavings: current.cost.contextCompilerSavings - baseline.cost.contextCompilerSavings,
    cacheHitSavings: current.cost.cacheHitSavings - baseline.cost.cacheHitSavings,
  }

  const qualityDelta: Partial<GovernanceQualityMetrics> = {
    firstPassRate: round(current.quality.firstPassRate - baseline.quality.firstPassRate),
    averageFixIterations: round(current.quality.averageFixIterations - baseline.quality.averageFixIterations),
    gatePassRate: round(current.quality.gatePassRate - baseline.quality.gatePassRate),
  }

  const frictionDelta: Partial<GovernanceFrictionMetrics> = {
    totalGateChecks: current.friction.totalGateChecks - baseline.friction.totalGateChecks,
    gateBlocks: current.friction.gateBlocks - baseline.friction.gateBlocks,
    skippedPhases: current.friction.skippedPhases - baseline.friction.skippedPhases,
  }

  const roiDelta = {
    tokenEfficiencyChange: round(current.roi.tokenEfficiency - baseline.roi.tokenEfficiency),
    gateEfficiencyChange: round(current.roi.gateEfficiency - baseline.roi.gateEfficiency),
    overallScoreChange: current.roi.overallScore - baseline.roi.overallScore,
  }

  const improving = roiDelta.overallScoreChange > 0
  const summary = improving
    ? `Governance ROI improved by ${roiDelta.overallScoreChange} points.`
    : roiDelta.overallScoreChange < 0
      ? `Governance ROI decreased by ${Math.abs(roiDelta.overallScoreChange)} points.`
      : 'Governance ROI unchanged.'

  return { costDelta, qualityDelta, frictionDelta, roiDelta, summary }
}

function collectTaskMetrics(scaleDir: string): { records: TaskMetricRecord[]; summary: ReturnType<TaskMetricsStore['summarize']> } {
  try {
    const store = new TaskMetricsStore(scaleDir)
    const records = store.list()
    return { records, summary: store.summarize() }
  } catch {
    return {
      records: [],
      summary: {
        total: 0,
        firstPassRate: 0,
        averageFixIterations: 0,
        artifactCompletenessRate: 0,
        residualRiskClarityRate: 0,
      },
    }
  }
}

function collectCostMetrics(scaleDir: string): GovernanceCostMetrics {
  try {
    const ledger = new ModelUsageLedger(scaleDir)
    const summary = ledger.summarize()
    return {
      totalTokensUsed: summary.totalTokens,
      tokensByPhase: {},
      estimatedCostUsd: summary.estimatedCostUsd,
      contextCompilerSavings: 0,
      cacheHitSavings: summary.cacheSavingsTokens,
    }
  } catch {
    return {
      totalTokensUsed: 0,
      tokensByPhase: {},
      contextCompilerSavings: 0,
      cacheHitSavings: 0,
    }
  }
}

function collectFrictionMetrics(scaleDir: string, _records: TaskMetricRecord[]): GovernanceFrictionMetrics {
  try {
    const evidenceStore = new EvidenceStore(scaleDir)
    const gates = evidenceStore.listGateResults(1000)
    const totalGateChecks = gates.length
    const gateBlocks = gates.filter(g => g.status === 'FAILED').length
    return {
      totalGateChecks,
      gateBlocks,
      averageGateLatencyMs: 0,
      skippedPhases: 0,
      manualOverrides: 0,
    }
  } catch {
    return {
      totalGateChecks: 0,
      gateBlocks: 0,
      averageGateLatencyMs: 0,
      skippedPhases: 0,
      manualOverrides: 0,
    }
  }
}

function buildRecommendations(
  quality: GovernanceQualityMetrics,
  friction: GovernanceFrictionMetrics,
  cost: GovernanceCostMetrics,
): string[] {
  const recs: string[] = []

  if (quality.firstPassRate < 0.6) {
    recs.push('First pass rate is below 60%. Improve test coverage and pre-verification checks.')
  }
  if (quality.averageFixIterations > 3) {
    recs.push('Average fix iterations is high. Consider adding more specific error guidance.')
  }
  if (quality.gatePassRate < 0.8 && friction.totalGateChecks > 0) {
    recs.push('Gate pass rate is below 80%. Review gate configurations for false positives.')
  }
  if (friction.gateBlocks > friction.totalGateChecks * 0.3 && friction.totalGateChecks > 0) {
    recs.push('High gate block rate. Consider adjusting thresholds or adding advisory gates.')
  }
  if (cost.totalTokensUsed > 0 && cost.contextCompilerSavings === 0) {
    recs.push('No context compiler savings recorded. Enable context budgeting to reduce token usage.')
  }
  if (quality.securityFindingsCount > quality.resolvedSecurityFindings) {
    recs.push(`${quality.securityFindingsCount - quality.resolvedSecurityFindings} unresolved security finding(s).`)
  }
  if (recs.length === 0) {
    recs.push('Governance metrics look healthy. Continue monitoring.')
  }

  return recs
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
