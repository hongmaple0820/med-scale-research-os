import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type MetricTaskLevel = 'M' | 'L' | 'CRITICAL'

export interface TaskMetricRecord {
  date: string
  taskId: string
  taskName: string
  level: MetricTaskLevel
  services: string[]
  filesChanged: number
  firstVerificationPass: boolean
  fixIterations: number
  reworkNeeded: boolean
  artifactComplete: boolean
  residualRisk: string
  finalGateStatus: 'passed' | 'failed' | 'blocked'
}

export interface TaskMetricSummary {
  total: number
  firstPassRate: number
  averageFixIterations: number
  artifactCompletenessRate: number
  residualRiskClarityRate: number
}

export interface VerificationMetricInput {
  taskId: string
  taskName: string
  level: MetricTaskLevel
  services?: string[]
  filesChanged?: number
  passed: boolean
  artifactComplete?: boolean
  residualRisk?: string
  finalGateStatus?: TaskMetricRecord['finalGateStatus']
  date?: string
}

export class TaskMetricsStore {
  private metricsDir: string
  private recordsPath: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.metricsDir = join(scaleDir, 'metrics')
    this.recordsPath = join(this.metricsDir, 'tasks.jsonl')
  }

  append(record: TaskMetricRecord): void {
    if (!existsSync(this.metricsDir)) mkdirSync(this.metricsDir, { recursive: true })
    appendFileSync(this.recordsPath, JSON.stringify(record) + '\n', 'utf-8')
  }

  upsert(record: TaskMetricRecord): void {
    const records = this.list()
    const index = records.findIndex(candidate => candidate.taskId === record.taskId)
    if (index >= 0) records[index] = record
    else records.push(record)
    this.writeAll(records)
  }

  recordVerification(input: VerificationMetricInput): TaskMetricRecord {
    const previous = this.findByTaskId(input.taskId)
    const finalGateStatus: TaskMetricRecord['finalGateStatus'] = input.finalGateStatus ?? (input.passed ? 'passed' : 'failed')
    const additionalIteration = previous && !(previous.finalGateStatus === 'passed' && finalGateStatus === 'passed') ? 1 : 0
    const firstVerificationPass = previous?.firstVerificationPass ?? input.passed
    const fixIterations = (previous?.fixIterations ?? 0) + additionalIteration
    const record: TaskMetricRecord = {
      date: input.date ?? currentDate(),
      taskId: input.taskId,
      taskName: input.taskName,
      level: input.level,
      services: input.services ?? [],
      filesChanged: input.filesChanged ?? 0,
      firstVerificationPass,
      fixIterations,
      reworkNeeded: !firstVerificationPass || fixIterations > 0,
      artifactComplete: input.artifactComplete ?? false,
      residualRisk: input.residualRisk ?? '',
      finalGateStatus,
    }
    this.upsert(record)
    return record
  }

  list(): TaskMetricRecord[] {
    if (!existsSync(this.recordsPath)) return []
    return readFileSync(this.recordsPath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as TaskMetricRecord)
  }

  findByTaskId(taskId: string): TaskMetricRecord | undefined {
    const records = this.list()
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (records[i].taskId === taskId) return records[i]
    }
    return undefined
  }

  summarize(): TaskMetricSummary {
    const records = this.list()
    if (records.length === 0) {
      return {
        total: 0,
        firstPassRate: 0,
        averageFixIterations: 0,
        artifactCompletenessRate: 0,
        residualRiskClarityRate: 0,
      }
    }

    return {
      total: records.length,
      firstPassRate: ratio(records.filter(record => record.firstVerificationPass).length, records.length),
      averageFixIterations: records.reduce((sum, record) => sum + record.fixIterations, 0) / records.length,
      artifactCompletenessRate: ratio(records.filter(record => record.artifactComplete).length, records.length),
      residualRiskClarityRate: ratio(records.filter(record => record.residualRisk.trim().length > 0).length, records.length),
    }
  }

  toMarkdownRow(record: TaskMetricRecord): string {
    return [
      record.date,
      record.taskName,
      record.level,
      record.services.join(', '),
      String(record.filesChanged),
      record.firstVerificationPass ? 'yes' : 'no',
      String(record.fixIterations),
      record.reworkNeeded ? 'yes' : 'no',
      record.artifactComplete ? 'yes' : 'no',
      record.residualRisk || 'none stated',
      record.finalGateStatus,
    ].map(escapeCell).join(' | ')
  }

  writeMarkdownReport(projectDir = process.cwd()): string {
    const target = join(projectDir, 'docs', 'worklog', 'metrics.md')
    const dir = join(projectDir, 'docs', 'worklog')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const section = this.renderGeneratedMarkdownSection()
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '# Workflow Metrics\n\n'
    const next = replaceGeneratedSection(existing, section)
    writeFileSync(target, next, 'utf-8')
    return target
  }

  private renderGeneratedMarkdownSection(): string {
    const summary = this.summarize()
    const rows = this.list().map(record => `| ${this.toMarkdownRow(record)} |`)
    return [
      '<!-- SCALE_METRICS:START -->',
      `Total tasks: ${summary.total}`,
      `First-pass verification rate: ${(summary.firstPassRate * 100).toFixed(1)}%`,
      `Average fix iterations: ${summary.averageFixIterations.toFixed(2)}`,
      `Artifact completeness: ${(summary.artifactCompletenessRate * 100).toFixed(1)}%`,
      '',
      '| Date | Task | Level | Services | Files Changed | First Verification Pass | Fix Iterations | Rework Needed | Artifact Complete | Residual Risk | Final Gate |',
      '| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- |',
      ...(rows.length ? rows : ['|  |  |  |  |  |  |  |  |  |  |  |']),
      '<!-- SCALE_METRICS:END -->',
    ].join('\n')
  }

  private writeAll(records: TaskMetricRecord[]): void {
    if (!existsSync(this.metricsDir)) mkdirSync(this.metricsDir, { recursive: true })
    const body = records.map(record => JSON.stringify(record)).join('\n')
    writeFileSync(this.recordsPath, body ? `${body}\n` : '', 'utf-8')
  }
}

function replaceGeneratedSection(existing: string, generatedSection: string): string {
  const marker = /<!-- SCALE_METRICS:START -->[\s\S]*?<!-- SCALE_METRICS:END -->/
  if (marker.test(existing)) return existing.replace(marker, generatedSection)
  const titleMatch = existing.match(/^# .+\n/)
  if (titleMatch) {
    return existing.replace(titleMatch[0], `${titleMatch[0]}\n${generatedSection}\n`)
  }
  return `# Workflow Metrics\n\n${generatedSection}\n\n${existing}`
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
