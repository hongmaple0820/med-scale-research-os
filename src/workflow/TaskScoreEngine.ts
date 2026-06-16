import { isAbsolute, resolve } from 'node:path'
import { inspectCodeIntelligence } from '../codegraph/CodeIntelligence.js'
import { inspectMemoryProviders } from '../memory/MemoryProviders.js'
import { collectGovernanceRoi, type GovernanceRoiSummary } from './GovernanceRoi.js'
import { doctorEngineeringStandards, type EngineeringStandardFinding } from './EngineeringStandards.js'
import { EvidenceStore, type GateEvidenceRecord } from './EvidenceStore.js'
import { createGateStatusReport, type GateStatusReport } from './GateCatalog.js'

export type TaskScoreGrade = 'excellent' | 'good' | 'needs-work' | 'blocked'

export interface TaskScoreDimension {
  id: string
  name: string
  score: number
  maxScore: number
  status: 'pass' | 'warn' | 'fail'
  evidence: string[]
  recommendations: string[]
}

export interface TaskScoreReport {
  projectDir: string
  scaleDir: string
  generatedAt: string
  taskId?: string
  level: 'S' | 'M' | 'L' | 'CRITICAL'
  totalScore: number
  maxScore: 100
  grade: TaskScoreGrade
  passed: boolean
  dimensions: TaskScoreDimension[]
  blockers: string[]
  recommendations: string[]
  inputs: {
    changedFiles: string[]
    recentGateEvidence: number
  }
  references: {
    governanceRoi: GovernanceRoiSummary
    gateStatus: Pick<GateStatusReport, 'summary' | 'verificationProfile' | 'policy' | 'extensions' | 'warnings'>
  }
}

export interface CreateTaskScoreOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  level?: 'S' | 'M' | 'L' | 'CRITICAL'
  changedFiles?: string[]
}

export function createTaskScoreReport(options: CreateTaskScoreOptions = {}): TaskScoreReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = resolveScaleRoot(projectDir, options.scaleDir)
  const level = options.level ?? 'M'
  const changedFiles = uniquePaths(options.changedFiles ?? [])
  const gateEvidence = new EvidenceStore(scaleDir).listGateResults(50)
  const standards = doctorEngineeringStandards({
    projectDir,
    scaleDir,
    changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
  })
  const governanceRoi = collectGovernanceRoi({ projectDir, scaleDir })
  const codeIntelligence = inspectCodeIntelligence({ projectDir, scaleDir })
  const memory = inspectMemoryProviders({ projectDir, scaleDir })
  const gateStatus = createGateStatusReport({ projectDir, scaleDir })
  const dimensions = [
    verificationDimension(gateEvidence),
    architectureDimension(standards.ok, standards.findings),
    evidenceDimension(gateEvidence),
    contextDimension(codeIntelligence.availableProviderCount, codeIntelligence.projectIndexExists, memory.availableProviderCount),
    efficiencyDimension(governanceRoi),
    riskDimension(level, standards.findings, gateStatus.summary.blockingExtensions),
  ]
  const totalScore = clampScore(dimensions.reduce((sum, dimension) => sum + dimension.score, 0))
  const blockers = dimensions
    .filter(dimension => dimension.status === 'fail')
    .flatMap(dimension => dimension.evidence.map(item => `${dimension.name}: ${item}`))
  const recommendations = uniqueStrings(dimensions.flatMap(dimension => dimension.recommendations))
  const grade = gradeForScore(totalScore, blockers.length > 0)

  return {
    projectDir,
    scaleDir,
    generatedAt: new Date().toISOString(),
    taskId: options.taskId,
    level,
    totalScore,
    maxScore: 100,
    grade,
    passed: blockers.length === 0 && totalScore >= thresholdForLevel(level),
    dimensions,
    blockers,
    recommendations,
    inputs: {
      changedFiles,
      recentGateEvidence: gateEvidence.length,
    },
    references: {
      governanceRoi,
      gateStatus: {
        summary: gateStatus.summary,
        verificationProfile: gateStatus.verificationProfile,
        policy: gateStatus.policy,
        extensions: gateStatus.extensions,
        warnings: gateStatus.warnings,
      },
    },
  }
}

function verificationDimension(records: GateEvidenceRecord[]): TaskScoreDimension {
  if (records.length === 0) {
    return dimension('verification', 'Verification', 0, 30, 'fail', ['No persisted gate evidence was found.'], ['Run the required preflight or task verification gates before scoring.'])
  }
  const passed = records.filter(record => record.passed).length
  const passRate = passed / records.length
  const score = Math.round(passRate * 30)
  return dimension(
    'verification',
    'Verification',
    score,
    30,
    passRate >= 0.9 ? 'pass' : passRate >= 0.7 ? 'warn' : 'fail',
    [`${passed}/${records.length} recent gate records passed.`],
    passRate < 0.9 ? ['Fix failed gates and rerun verification before release.'] : [],
  )
}

function architectureDimension(ok: boolean, findings: EngineeringStandardFinding[]): TaskScoreDimension {
  const blocking = findings.filter(finding => finding.severity === 'fail')
  const warnings = findings.filter(finding => finding.severity === 'warn')
  if (blocking.length > 0) {
    return dimension('architecture', 'Architecture standards', 0, 20, 'fail', [`${blocking.length} blocking standards finding(s).`], ['Fix blocking architecture or engineering standards findings.'])
  }
  const score = ok && warnings.length === 0 ? 20 : Math.max(10, 20 - Math.min(10, warnings.length))
  return dimension(
    'architecture',
    'Architecture standards',
    score,
    20,
    warnings.length === 0 ? 'pass' : 'warn',
    warnings.length === 0 ? ['Standards doctor passed.'] : [`${warnings.length} advisory standards finding(s).`],
    warnings.length > 0 ? ['Review advisory standards findings before hardening the gate.'] : [],
  )
}

function evidenceDimension(records: GateEvidenceRecord[]): TaskScoreDimension {
  const withEvidence = records.filter(record => record.evidenceItems.length > 0 || record.evidence.trim().length > 0).length
  const ratio = records.length > 0 ? withEvidence / records.length : 0
  const score = Math.round(ratio * 15)
  return dimension(
    'evidence',
    'Evidence completeness',
    score,
    15,
    ratio >= 0.9 ? 'pass' : ratio >= 0.5 ? 'warn' : 'fail',
    records.length > 0 ? [`${withEvidence}/${records.length} gate records include evidence.`] : ['No evidence records found.'],
    ratio < 0.9 ? ['Persist command and gate evidence instead of relying on narrative claims.'] : [],
  )
}

function contextDimension(codeProviders: number, codeIndexExists: boolean, memoryProviders: number): TaskScoreDimension {
  let score = 0
  const evidence: string[] = []
  if (codeProviders > 0) {
    score += 4
    evidence.push(`${codeProviders} code intelligence provider(s) available.`)
  } else {
    evidence.push('No code intelligence provider is available.')
  }
  if (codeIndexExists) {
    score += 3
    evidence.push('Project code index exists.')
  } else {
    evidence.push('Project code index is missing.')
  }
  if (memoryProviders > 0) {
    score += 3
    evidence.push(`${memoryProviders} memory provider(s) available.`)
  } else {
    evidence.push('No memory provider is available.')
  }
  return dimension(
    'context',
    'Context and memory use',
    score,
    10,
    score >= 8 ? 'pass' : score >= 3 ? 'warn' : 'fail',
    evidence,
    score < 8 ? ['Initialize CodeGraph and memory providers so deterministic recall can reduce model context.'] : [],
  )
}

function efficiencyDimension(roi: GovernanceRoiSummary): TaskScoreDimension {
  const savings = roi.cost.contextCompilerSavings + roi.cost.cacheHitSavings
  const hasSavings = savings > 0
  const hasUsage = roi.cost.totalTokensUsed > 0
  const score = hasSavings ? 10 : hasUsage ? 5 : 4
  return dimension(
    'efficiency',
    'Cost efficiency',
    score,
    10,
    hasSavings ? 'pass' : 'warn',
    [
      `Governance ROI score is ${roi.roi.overallScore}/100.`,
      `Recorded context/cache savings: ${savings}.`,
    ],
    hasSavings ? [] : ['Record model usage and cache savings to prove token reduction instead of estimating it.'],
  )
}

function riskDimension(level: TaskScoreReport['level'], findings: EngineeringStandardFinding[], blockingExtensions: number): TaskScoreDimension {
  const blockingFindings = findings.filter(finding => finding.severity === 'fail').length
  const highRiskLevel = level === 'L' || level === 'CRITICAL'
  const score = blockingFindings > 0
    ? 0
    : highRiskLevel && blockingExtensions === 0
      ? 5
      : 15
  return dimension(
    'risk',
    'Risk control',
    score,
    15,
    score >= 12 ? 'pass' : score >= 5 ? 'warn' : 'fail',
    [
      `Task level: ${level}.`,
      `${blockingExtensions} blocking extension gate(s) configured.`,
      `${blockingFindings} blocking standards finding(s).`,
    ],
    score < 12 ? ['Use stricter gate profiles for L/CRITICAL work and resolve blocking standards findings.'] : [],
  )
}

function dimension(
  id: string,
  name: string,
  score: number,
  maxScore: number,
  status: TaskScoreDimension['status'],
  evidence: string[],
  recommendations: string[],
): TaskScoreDimension {
  return {
    id,
    name,
    score: Math.max(0, Math.min(maxScore, score)),
    maxScore,
    status,
    evidence,
    recommendations,
  }
}

function thresholdForLevel(level: TaskScoreReport['level']): number {
  if (level === 'CRITICAL') return 90
  if (level === 'L') return 85
  if (level === 'M') return 75
  return 65
}

function gradeForScore(score: number, blocked: boolean): TaskScoreGrade {
  if (blocked) return 'blocked'
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  return 'needs-work'
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function resolveScaleRoot(projectDir: string, scaleDir = '.scale'): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function uniquePaths(paths: string[]): string[] {
  return uniqueStrings(paths.map(path => path.replace(/\\/g, '/').trim()).filter(Boolean))
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}
