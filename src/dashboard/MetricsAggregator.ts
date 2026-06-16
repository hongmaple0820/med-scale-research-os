import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { ModelUsageLedger, type ModelUsageSummary } from '../runtime/ModelUsageLedger.js'
import { TaskMetricsStore, type TaskMetricSummary } from '../workflow/TaskMetricsStore.js'
import { EvidenceStore, type GateEvidenceRecord } from '../workflow/EvidenceStore.js'
import type { CommandRunEvidence } from '../tools/CommandRunLedger.js'

export interface MetricsAggregatorOptions {
  projectDir?: string
  scaleDir?: string
  sinceDays?: number
  now?: () => Date
}

export interface AggregatedGovernanceMetrics {
  sinceDays: number
  taskMetrics: TaskMetricSummary & {
    recentTasks: number
    recentFirstPassRate: number
  }
  gateFailures: {
    total: number
    failed: number
    byGate: Record<string, number>
  }
  commandRuns: {
    total: number
    passed: number
    failed: number
    rawEstimatedTokens: number
    compressedEstimatedTokens: number
    savedEstimatedTokens: number
  }
  modelUsage: ModelUsageSummary
}

export class MetricsAggregator {
  private projectDir: string
  private scaleRoot: string
  private sinceDays: number
  private now: () => Date

  constructor(options: MetricsAggregatorOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = resolveScaleRoot(this.projectDir, options.scaleDir)
    this.sinceDays = options.sinceDays ?? 7
    this.now = options.now ?? (() => new Date())
  }

  aggregate(): AggregatedGovernanceMetrics {
    const taskStore = new TaskMetricsStore(this.scaleRoot)
    const taskRecords = taskStore.list()
    const recentCutoff = this.now().getTime() - this.sinceDays * 24 * 60 * 60 * 1000
    const recentTasks = taskRecords.filter(record => Date.parse(record.date) >= recentCutoff)
    const recentPassed = recentTasks.filter(record => record.firstVerificationPass).length
    const gateResults = new EvidenceStore(this.scaleRoot).listGateResults(Number.MAX_SAFE_INTEGER)
    const commandRuns = listCommandRuns(this.scaleRoot)
    const modelUsage = new ModelUsageLedger(this.scaleRoot).summarize()

    return {
      sinceDays: this.sinceDays,
      taskMetrics: {
        ...taskStore.summarize(),
        recentTasks: recentTasks.length,
        recentFirstPassRate: ratio(recentPassed, recentTasks.length),
      },
      gateFailures: summarizeGateFailures(gateResults),
      commandRuns: summarizeCommandRuns(commandRuns),
      modelUsage,
    }
  }
}

export function aggregateGovernanceMetrics(options: MetricsAggregatorOptions = {}): AggregatedGovernanceMetrics {
  return new MetricsAggregator(options).aggregate()
}

function summarizeGateFailures(records: GateEvidenceRecord[]): AggregatedGovernanceMetrics['gateFailures'] {
  const failed = records.filter(record => !record.passed)
  const byGate: Record<string, number> = {}
  for (const record of failed) byGate[record.gate] = (byGate[record.gate] ?? 0) + 1
  return {
    total: records.length,
    failed: failed.length,
    byGate,
  }
}

function summarizeCommandRuns(records: CommandRunEvidence[]): AggregatedGovernanceMetrics['commandRuns'] {
  return {
    total: records.length,
    passed: records.filter(record => record.status === 'passed').length,
    failed: records.filter(record => record.status === 'failed').length,
    rawEstimatedTokens: records.reduce((sum, record) => sum + record.rawEstimatedTokens, 0),
    compressedEstimatedTokens: records.reduce((sum, record) => sum + record.compressedEstimatedTokens, 0),
    savedEstimatedTokens: records.reduce((sum, record) => sum + record.savedEstimatedTokens, 0),
  }
}

function listCommandRuns(scaleRoot: string): CommandRunEvidence[] {
  const root = join(scaleRoot, 'evidence', 'command-runs')
  if (!existsSync(root)) return []
  const files: string[] = []
  walkJson(root, files)
  return files
    .map(file => readJson<CommandRunEvidence>(file))
    .filter((record): record is CommandRunEvidence => Boolean(record))
}

function walkJson(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkJson(absolute, files)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    if (statSync(absolute).size > 1_000_000) continue
    files.push(absolute)
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  if (scaleDir && isAbsolute(scaleDir)) return scaleDir
  return join(projectDir, scaleDir ?? '.scale')
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

