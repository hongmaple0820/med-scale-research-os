import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ReviewFinding } from '../ReviewStore.js'
import { analyzeReview, type DiffInput } from '../ReviewAnalyzer.js'
import {
  scanEngineeringStandards,
  type EngineeringStandardFinding,
  type EngineeringStandardSeverity,
} from '../EngineeringStandards.js'
import type { DiagnosticLoopInput } from '../DiagnosticLoop.js'

export type HuntFindingSource = 'engineering-standards' | 'review-analyzer'
export type HuntFindingStatus = 'open' | 'ignored'

export interface HuntFinding {
  id: string
  fingerprint: string
  source: HuntFindingSource
  status: HuntFindingStatus
  severity: EngineeringStandardSeverity
  category: string
  ruleId: string
  path?: string
  line?: number
  message: string
  evidence?: string
  fix?: string
  ignoreReason?: string
  diagnosticInput: DiagnosticLoopInput
}

export interface HuntSummary {
  total: number
  open: number
  ignored: number
  blocking: number
  bySeverity: Record<EngineeringStandardSeverity, number>
  bySource: Record<HuntFindingSource, number>
}

export interface HuntScanReport {
  projectDir: string
  generatedAt: string
  findings: HuntFinding[]
  summary: HuntSummary
  warnings: string[]
}

export interface BackgroundHunterOptions {
  projectDir?: string
  scaleDir?: string
  store?: HuntFindingStore
}

export interface BackgroundHunterScanOptions {
  now?: Date
  changedFiles?: string[]
  statusOutput?: string
  diffs?: DiffInput[]
}

export interface IgnoredHuntFinding {
  id: string
  fingerprint: string
  reason?: string
  ignoredAt: string
}

interface HuntFindingStoreFile {
  version?: number
  ignored?: IgnoredHuntFinding[]
}

export class BackgroundHunter {
  private readonly projectDir: string
  private readonly scaleDir: string
  private readonly store: HuntFindingStore

  constructor(options: BackgroundHunterOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleDir = options.scaleDir ?? '.scale'
    this.store = options.store ?? new HuntFindingStore({ projectDir: this.projectDir, scaleDir: this.scaleDir })
  }

  scan(options: BackgroundHunterScanOptions = {}): HuntScanReport {
    const now = options.now ?? new Date()
    const standardsReport = scanEngineeringStandards({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
      now,
      changedFiles: options.changedFiles,
    })
    const findings = [
      ...standardsReport.findings.map(finding => this.fromEngineeringStandard(finding)),
      ...this.reviewFindings(options),
    ].sort(compareHuntFindings)
    const ignored = this.store.listIgnored()
    const resolvedFindings = findings.map(finding => {
      const ignoredFinding = ignored.find(item => item.id === finding.id || item.fingerprint === finding.fingerprint)
      if (!ignoredFinding) return finding
      return {
        ...finding,
        status: 'ignored' as const,
        ignoreReason: ignoredFinding.reason,
      }
    })
    return {
      projectDir: this.projectDir,
      generatedAt: now.toISOString(),
      findings: resolvedFindings,
      summary: summarizeHuntFindings(resolvedFindings),
      warnings: standardsReport.warnings,
    }
  }

  createDiagnosticInput(finding: HuntFinding): DiagnosticLoopInput {
    return createDiagnosticInput(finding)
  }

  private fromEngineeringStandard(finding: EngineeringStandardFinding): HuntFinding {
    const fingerprint = stableFingerprint([
      'engineering-standards',
      finding.ruleId,
      normalizePath(finding.path),
      String(finding.line ?? ''),
      finding.message,
    ])
    const id = huntId(fingerprint)
    const path = normalizePath(finding.path)
    const result: HuntFinding = {
      id,
      fingerprint,
      source: 'engineering-standards',
      status: 'open',
      severity: finding.severity,
      category: finding.category,
      ruleId: finding.ruleId,
      path,
      line: finding.line,
      message: finding.message,
      evidence: finding.evidence,
      fix: finding.fix,
      diagnosticInput: createDiagnosticInput({
        id,
        source: 'engineering-standards',
        ruleId: finding.ruleId,
        path,
        message: finding.message,
        evidence: finding.evidence,
      }),
    }
    return result
  }

  private reviewFindings(options: BackgroundHunterScanOptions): HuntFinding[] {
    if (!options.statusOutput || !options.diffs?.length) return []
    return analyzeReview({
      statusOutput: options.statusOutput,
      diffs: options.diffs,
    }).findings.map(finding => this.fromReviewFinding(finding))
  }

  private fromReviewFinding(finding: ReviewFinding): HuntFinding {
    const path = finding.file ? normalizePath(finding.file) : undefined
    const fingerprint = stableFingerprint([
      'review-analyzer',
      finding.category,
      finding.severity,
      path ?? '',
      finding.description,
      finding.evidence ?? '',
    ])
    const id = huntId(fingerprint)
    const severity = reviewSeverityToStandardSeverity(finding.severity)
    return {
      id,
      fingerprint,
      source: 'review-analyzer',
      status: 'open',
      severity,
      category: finding.category,
      ruleId: `review-${finding.category}`,
      path,
      message: finding.description,
      evidence: finding.evidence,
      diagnosticInput: createDiagnosticInput({
        id,
        source: 'review-analyzer',
        ruleId: `review-${finding.category}`,
        path,
        message: finding.description,
        evidence: finding.evidence,
      }),
    }
  }
}

export class HuntFindingStore {
  private readonly path: string

  constructor(options: { projectDir?: string; scaleDir?: string } = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleDir = options.scaleDir ?? '.scale'
    const scaleRoot = isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
    this.path = join(scaleRoot, 'hunt', 'ignored-findings.json')
  }

  listIgnored(): IgnoredHuntFinding[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as HuntFindingStoreFile
      return Array.isArray(parsed.ignored)
        ? parsed.ignored.filter(item => typeof item.id === 'string' && typeof item.fingerprint === 'string')
        : []
    } catch {
      return []
    }
  }

  ignore(finding: IgnoredHuntFinding): IgnoredHuntFinding {
    const current = this.listIgnored()
    const next = [
      ...current.filter(item => item.id !== finding.id && item.fingerprint !== finding.fingerprint),
      finding,
    ].sort((a, b) => a.id.localeCompare(b.id))
    const dir = this.path.slice(0, this.path.lastIndexOf(sep))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.path, JSON.stringify({ version: 1, ignored: next }, null, 2) + '\n', 'utf-8')
    return finding
  }
}

export function createDiagnosticInput(finding: Pick<HuntFinding, 'id' | 'source' | 'ruleId' | 'path' | 'message' | 'evidence'>): DiagnosticLoopInput {
  const changedFiles = finding.path ? [finding.path] : []
  const verificationCommand = finding.path
    ? `scale standards doctor --changed-files ${finding.path}`
    : 'scale standards doctor'
  return {
    taskId: `HUNT-${finding.id.toUpperCase()}`,
    symptom: `${finding.source} ${finding.ruleId}: ${finding.message}`,
    reproductionCommand: verificationCommand,
    expectedFailure: finding.evidence ?? finding.message,
    changedFiles,
    verificationCommands: [verificationCommand],
  }
}

function summarizeHuntFindings(findings: HuntFinding[]): HuntSummary {
  const bySeverity: Record<EngineeringStandardSeverity, number> = { info: 0, warn: 0, fail: 0 }
  const bySource: Record<HuntFindingSource, number> = {
    'engineering-standards': 0,
    'review-analyzer': 0,
  }
  for (const finding of findings) {
    bySeverity[finding.severity] += 1
    bySource[finding.source] += 1
  }
  return {
    total: findings.length,
    open: findings.filter(finding => finding.status === 'open').length,
    ignored: findings.filter(finding => finding.status === 'ignored').length,
    blocking: findings.filter(finding => finding.status === 'open' && finding.severity === 'fail').length,
    bySeverity,
    bySource,
  }
}

function compareHuntFindings(a: HuntFinding, b: HuntFinding): number {
  return severityRank(b.severity) - severityRank(a.severity) ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.id.localeCompare(b.id)
}

function severityRank(severity: EngineeringStandardSeverity): number {
  if (severity === 'fail') return 3
  if (severity === 'warn') return 2
  return 1
}

function reviewSeverityToStandardSeverity(severity: ReviewFinding['severity']): EngineeringStandardSeverity {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'fail'
  if (severity === 'MEDIUM') return 'warn'
  return 'info'
}

function stableFingerprint(parts: string[]): string {
  return parts.map(part => part.trim()).join('\0')
}

function huntId(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 12)
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsolute(path)) return normalized.replace(/^\.\//, '')
  return relative(process.cwd(), path).replace(/\\/g, '/')
}
