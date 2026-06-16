import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { IGate } from './GateSystem.js'
import type { GateEvidence, GateResult, GateStage } from '../types.js'

export type VisualFindingSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface VisualGateConfig {
  enabled?: boolean
  baseUrl?: string
  specPath?: string
  routes?: string[]
  reportPath?: string
  blockingSeverities?: VisualFindingSeverity[]
}

export interface VisualGateFinding {
  severity: VisualFindingSeverity
  route?: string
  message: string
  evidence?: string
}

export interface VisualGateReport {
  screenshots?: Array<{
    route: string
    path: string
  }>
  findings?: VisualGateFinding[]
}

export interface VisualGateOptions {
  projectDir?: string
  config?: VisualGateConfig
}

const DEFAULT_BLOCKING_SEVERITIES: VisualFindingSeverity[] = ['critical', 'high']

export class VisualGate implements IGate {
  stage: GateStage = 'G9'
  name = 'Visual Gate'
  description = 'Validates structured visual review evidence against UI spec routes.'
  requiredLevel: 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL' = 'M'

  private projectDir: string
  private config?: VisualGateConfig

  constructor(options: VisualGateOptions = {}) {
    this.projectDir = options.projectDir ?? process.cwd()
    this.config = options.config
  }

  async execute(): Promise<GateResult> {
    const start = Date.now()

    if (!this.config?.enabled) {
      return this.result({
        passed: true,
        status: 'PASSED',
        evidenceItems: [
          createEvidence({
            kind: 'manual',
            label: 'Visual gate skipped',
            passed: true,
            detail: 'Visual checks are not enabled for this task.',
          }),
        ],
        blockers: [],
        start,
      })
    }

    const validation = this.validateConfig(this.config)
    if (validation.blockers.length > 0) {
      return this.result({
        passed: false,
        status: 'FAILED',
        evidenceItems: [
          createEvidence({
            kind: 'manual',
            label: 'Visual gate configuration',
            passed: false,
            detail: validation.blockers.join('; '),
          }),
        ],
        blockers: validation.blockers,
        start,
      })
    }

    const reportPath = this.resolvePath(this.config.reportPath!)
    let report: VisualGateReport
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf-8')) as VisualGateReport
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return this.result({
        passed: false,
        status: 'FAILED',
        evidenceItems: [
          createEvidence({
            kind: 'file',
            label: 'Visual report parse',
            passed: false,
            path: reportPath,
            detail,
          }),
        ],
        blockers: [`visual report could not be parsed: ${detail}`],
        start,
      })
    }

    const findings = normalizeFindings(report.findings ?? [])
    const blockingSeverities = this.config.blockingSeverities ?? DEFAULT_BLOCKING_SEVERITIES
    const blockers = findings
      .filter(finding => blockingSeverities.includes(finding.severity))
      .map(finding => `${finding.severity} visual finding${finding.route ? ` on ${finding.route}` : ''}: ${finding.message}`)

    const evidenceItems = [
      createEvidence({
        kind: 'file',
        label: 'Visual report',
        passed: blockers.length === 0,
        path: reportPath,
        detail: renderFindingSummary(findings, report.screenshots?.length ?? 0),
      }),
    ]

    return this.result({
      passed: blockers.length === 0,
      status: blockers.length === 0 ? 'PASSED' : 'FAILED',
      evidenceItems,
      blockers,
      start,
    })
  }

  private validateConfig(config: VisualGateConfig): { blockers: string[] } {
    const blockers: string[] = []

    if (!config.baseUrl) {
      blockers.push('visual.baseUrl is required')
    } else {
      try {
        const url = new URL(config.baseUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          blockers.push('visual.baseUrl must use http or https')
        }
      } catch {
        blockers.push('visual.baseUrl must be a valid URL')
      }
    }

    if (!config.specPath) {
      blockers.push('visual.specPath is required')
    } else if (!existsSync(this.resolvePath(config.specPath))) {
      blockers.push(`visual spec does not exist: ${config.specPath}`)
    }

    if (!config.routes || config.routes.length === 0) {
      blockers.push('visual.routes must contain at least one route')
    }

    if (!config.reportPath) {
      blockers.push('visual report path is required')
    } else if (!existsSync(this.resolvePath(config.reportPath))) {
      blockers.push(`visual report does not exist: ${config.reportPath}`)
    }

    return { blockers }
  }

  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : join(this.projectDir, ...path.split('/'))
  }

  private result(input: {
    passed: boolean
    status: GateResult['status']
    evidenceItems: GateEvidence[]
    blockers: string[]
    start: number
  }): GateResult {
    return {
      gate: this.stage,
      status: input.status,
      passed: input.passed,
      evidence: textEvidence(input.evidenceItems),
      evidenceItems: input.evidenceItems,
      blockers: input.blockers,
      durationMs: Date.now() - input.start,
    }
  }
}

function normalizeFindings(findings: VisualGateFinding[]): VisualGateFinding[] {
  return findings.map(finding => ({
    ...finding,
    severity: normalizeSeverity(finding.severity),
  }))
}

function normalizeSeverity(severity: string): VisualFindingSeverity {
  const normalized = severity.toLowerCase()
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  return 'medium'
}

function renderFindingSummary(findings: VisualGateFinding[], screenshotCount: number): string {
  if (findings.length === 0) {
    return `No visual findings. screenshots=${screenshotCount}`
  }

  const lines = findings.map(finding => {
    const route = finding.route ? ` route=${finding.route}` : ''
    const evidence = finding.evidence ? ` evidence=${finding.evidence}` : ''
    return `[${finding.severity}]${route} ${finding.message}${evidence}`
  })

  return `screenshots=${screenshotCount}; findings=${findings.length}\n${lines.join('\n')}`
}

function createEvidence(input: Omit<GateEvidence, 'id'>): GateEvidence {
  return {
    id: `EVID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

function textEvidence(items: GateEvidence[]): string {
  return items.map(item => `${item.label}: ${item.detail}`).join('\n')
}
