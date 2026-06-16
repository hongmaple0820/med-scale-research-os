import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { estimateTokens } from '../context/ContextBudget.js'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'
import { runSafeCommand } from '../tools/SafeCommandRunner.js'

export type WorkflowEvalCaseType = 'bugfix' | 'feature' | 'refactor' | 'security' | 'frontend' | 'release' | 'resource'
export type FailureReplayCategory =
  | 'wrong-exploration-path'
  | 'hallucinated-project-fact'
  | 'missing-codegraph-or-graph-fallback'
  | 'over-broad-context-load'
  | 'bad-skill-recommendation'
  | 'missing-verification-evidence'
  | 'failed-security-or-resource-gate'
  | 'human-correction-after-agent-confidence'
  | 'command-failure'
  | 'unknown'

export interface WorkflowEvalAttempt {
  id?: string
  command: string
  expectedExitCode?: number
  outputContains?: string
  timeoutMs?: number
}

export interface WorkflowEvalCase {
  id: string
  type: WorkflowEvalCaseType
  title: string
  task: string
  phase?: string
  successCriteria?: string[]
  attempts: WorkflowEvalAttempt[]
  expectedFailureCategory?: FailureReplayCategory
  humanCorrections?: number
  estimatedContextTokens?: number
}

export interface WorkflowEvalSuite {
  version: string
  id: string
  name: string
  cases: WorkflowEvalCase[]
}

export interface WorkflowEvalAttemptResult {
  id: string
  command: string
  expectedExitCode: number
  exitCode: number
  passed: boolean
  durationMs: number
  outputSummary: string
  redactionApplied: boolean
}

export interface WorkflowEvalCaseResult {
  id: string
  type: WorkflowEvalCaseType
  title: string
  task: string
  passed: boolean
  passAt1: boolean
  passAt3: boolean
  fixIterations: number
  humanCorrections: number
  estimatedTokens: number
  toolCalls: number
  attempts: WorkflowEvalAttemptResult[]
  failureReplayIds: string[]
}

export interface WorkflowEvalMetrics {
  total: number
  passed: number
  failed: number
  passAt1: number
  passAt3: number
  passAt1Rate: number
  passAt3Rate: number
  averageFixIterations: number
  totalToolCalls: number
  estimatedTokens: number
  humanCorrections: number
  failureReplayCount: number
}

export interface WorkflowEvalRun {
  id: string
  suiteId: string
  generatedAt: string
  projectDir: string
  ok: boolean
  cases: WorkflowEvalCaseResult[]
  metrics: WorkflowEvalMetrics
  failureReplayIds: string[]
}

export interface FailureReplayRecord {
  id: string
  taskId: string
  suiteId: string
  caseId: string
  generatedAt: string
  category: FailureReplayCategory
  phase: string
  task: string
  wrongTurn: string
  evidence: string
  correction: string
  prevention: string
  replayCommand?: string
  status: 'open' | 'promoted' | 'accepted-risk' | 'closed'
  redactionApplied: boolean
}

export interface FailureImprovementCandidate {
  id: string
  failureId: string
  createdAt: string
  category: FailureReplayCategory
  title: string
  recommendation: string
  evidencePath: string
  status: 'candidate'
}

export interface WorkflowEvalComparison {
  baseline: Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'>
  candidate: Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'>
  delta: {
    passAt1Rate: number
    passAt3Rate: number
    averageFixIterations: number
    totalToolCalls: number
    estimatedTokens: number
    humanCorrections: number
  }
  recommendation: 'improved' | 'regressed' | 'mixed' | 'same'
}

export interface WorkflowEvalStoreOptions {
  projectDir?: string
  scaleDir?: string
}

export function defaultWorkflowEvalSuite(): WorkflowEvalSuite {
  return {
    version: '1.0',
    id: 'workflow-baseline',
    name: 'SCALE workflow baseline',
    cases: [
      {
        id: 'governance-command-smoke',
        type: 'bugfix',
        title: 'Command evidence smoke',
        task: 'Verify that a local command can produce concrete eval evidence.',
        phase: 'verify',
        successCriteria: ['command exits 0', 'output contains scale-eval-ok'],
        attempts: [
          {
            id: 'attempt-1',
            command: 'node -e "console.log(\'scale-eval-ok\')"',
            expectedExitCode: 0,
            outputContains: 'scale-eval-ok',
          },
        ],
      },
    ],
  }
}

export class WorkflowEvalStore {
  readonly projectDir: string
  readonly scaleRoot: string
  readonly evalRoot: string
  readonly suitesDir: string
  readonly runsDir: string
  readonly failuresDir: string
  readonly improvementsDir: string

  constructor(options: WorkflowEvalStoreOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.evalRoot = join(this.scaleRoot, 'evals')
    this.suitesDir = join(this.evalRoot, 'suites')
    this.runsDir = join(this.evalRoot, 'runs')
    this.failuresDir = join(this.evalRoot, 'failures')
    this.improvementsDir = join(this.evalRoot, 'improvements')
  }

  initSuite(suiteId = 'workflow-baseline', force = false): { path: string; written: boolean; suite: WorkflowEvalSuite } {
    const suite = { ...defaultWorkflowEvalSuite(), id: suiteId }
    const path = this.suitePath(suiteId)
    if (existsSync(path) && !force) return { path, written: false, suite: this.loadSuite(suiteId) }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(suite, null, 2), 'utf-8')
    return { path, written: true, suite }
  }

  loadSuite(suiteIdOrPath = 'workflow-baseline'): WorkflowEvalSuite {
    const path = this.resolveSuitePath(suiteIdOrPath)
    if (!existsSync(path)) return defaultWorkflowEvalSuite()
    return JSON.parse(stripBom(readFileSync(path, 'utf-8'))) as WorkflowEvalSuite
  }

  saveRun(run: WorkflowEvalRun): string {
    mkdirSync(this.runsDir, { recursive: true })
    const path = join(this.runsDir, `${safeSegment(run.id)}.json`)
    writeFileSync(path, JSON.stringify(run, null, 2), 'utf-8')
    return path
  }

  saveFailure(record: FailureReplayRecord): string {
    mkdirSync(this.failuresDir, { recursive: true })
    const path = join(this.failuresDir, `${safeSegment(record.id)}.json`)
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
    return path
  }

  listFailures(query: { taskId?: string; sinceDays?: number } = {}): FailureReplayRecord[] {
    if (!existsSync(this.failuresDir)) return []
    const since = query.sinceDays ? Date.now() - query.sinceDays * 24 * 60 * 60 * 1000 : 0
    return readdirSync(this.failuresDir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<FailureReplayRecord>(join(this.failuresDir, file)))
      .filter((record): record is FailureReplayRecord => Boolean(record))
      .filter(record => !query.taskId || record.taskId === query.taskId)
      .filter(record => !since || Date.parse(record.generatedAt) >= since)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
  }

  getFailure(id: string): FailureReplayRecord | null {
    return readJson<FailureReplayRecord>(join(this.failuresDir, `${safeSegment(id)}.json`))
  }

  loadRun(idOrPath: string): WorkflowEvalRun {
    const path = this.resolveRunPath(idOrPath)
    const run = readJson<WorkflowEvalRun>(path)
    if (!run) throw new Error(`Eval run not found: ${idOrPath}`)
    return run
  }

  promoteFailure(id: string): FailureImprovementCandidate {
    const failure = this.getFailure(id)
    if (!failure) throw new Error(`Failure replay not found: ${id}`)
    mkdirSync(this.improvementsDir, { recursive: true })
    const candidate: FailureImprovementCandidate = {
      id: `IMPROVE-${Date.now()}-${randomUUID().slice(0, 8)}`,
      failureId: failure.id,
      createdAt: new Date().toISOString(),
      category: failure.category,
      title: `Prevent ${failure.category} in ${failure.caseId}`,
      recommendation: failure.prevention,
      evidencePath: join(this.failuresDir, `${safeSegment(failure.id)}.json`),
      status: 'candidate',
    }
    writeFileSync(join(this.improvementsDir, `${safeSegment(candidate.id)}.json`), JSON.stringify(candidate, null, 2), 'utf-8')
    this.saveFailure({ ...failure, status: 'promoted' })
    return candidate
  }

  suitePath(suiteId: string): string {
    return join(this.suitesDir, `${safeSegment(suiteId)}.json`)
  }

  private resolveSuitePath(suiteIdOrPath: string): string {
    if (suiteIdOrPath.endsWith('.json')) return isAbsolute(suiteIdOrPath) ? suiteIdOrPath : resolve(this.projectDir, suiteIdOrPath)
    return this.suitePath(suiteIdOrPath)
  }

  private resolveRunPath(idOrPath: string): string {
    if (idOrPath.endsWith('.json')) return isAbsolute(idOrPath) ? idOrPath : resolve(this.projectDir, idOrPath)
    return join(this.runsDir, `${safeSegment(idOrPath)}.json`)
  }
}

export async function runWorkflowEvalSuite(options: WorkflowEvalStoreOptions & {
  suite?: string
} = {}): Promise<{ run: WorkflowEvalRun; runPath: string; failurePaths: string[] }> {
  const store = new WorkflowEvalStore(options)
  const suite = store.loadSuite(options.suite ?? 'workflow-baseline')
  const caseResults: WorkflowEvalCaseResult[] = []
  const failurePaths: string[] = []
  const runId = `EVAL-${Date.now()}-${randomUUID().slice(0, 8)}`

  for (const item of suite.cases) {
    const result = await runEvalCase(store, suite.id, item)
    caseResults.push(result.caseResult)
    failurePaths.push(...result.failurePaths)
  }

  const failureReplayIds = caseResults.flatMap(result => result.failureReplayIds)
  const run: WorkflowEvalRun = {
    id: runId,
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    projectDir: store.projectDir,
    ok: caseResults.every(result => result.passed),
    cases: caseResults,
    metrics: summarizeEval(caseResults),
    failureReplayIds,
  }
  const runPath = store.saveRun(run)
  return { run, runPath, failurePaths }
}

export function compareWorkflowEvalRuns(options: WorkflowEvalStoreOptions & {
  baseline: string
  candidate: string
}): WorkflowEvalComparison {
  const store = new WorkflowEvalStore(options)
  const baseline = store.loadRun(options.baseline)
  const candidate = store.loadRun(options.candidate)
  const delta = {
    passAt1Rate: candidate.metrics.passAt1Rate - baseline.metrics.passAt1Rate,
    passAt3Rate: candidate.metrics.passAt3Rate - baseline.metrics.passAt3Rate,
    averageFixIterations: candidate.metrics.averageFixIterations - baseline.metrics.averageFixIterations,
    totalToolCalls: candidate.metrics.totalToolCalls - baseline.metrics.totalToolCalls,
    estimatedTokens: candidate.metrics.estimatedTokens - baseline.metrics.estimatedTokens,
    humanCorrections: candidate.metrics.humanCorrections - baseline.metrics.humanCorrections,
  }
  return {
    baseline: pickRun(baseline),
    candidate: pickRun(candidate),
    delta,
    recommendation: comparisonRecommendation(delta),
  }
}

export function renderWorkflowEvalReport(run: WorkflowEvalRun): string {
  const rows = run.cases.map(item => [
    item.id,
    item.type,
    item.passed ? 'pass' : 'fail',
    item.passAt1 ? 'yes' : 'no',
    item.passAt3 ? 'yes' : 'no',
    String(item.fixIterations),
    String(item.toolCalls),
    String(item.estimatedTokens),
    item.failureReplayIds.join(', ') || 'none',
  ])
  return [
    `# Workflow Eval Report: ${run.suiteId}`,
    '',
    `Run: ${run.id}`,
    `Generated: ${run.generatedAt}`,
    `Status: ${run.ok ? 'pass' : 'fail'}`,
    '',
    `Pass@1: ${(run.metrics.passAt1Rate * 100).toFixed(1)}%`,
    `Pass@3: ${(run.metrics.passAt3Rate * 100).toFixed(1)}%`,
    `Average fix iterations: ${run.metrics.averageFixIterations.toFixed(2)}`,
    `Tool calls: ${run.metrics.totalToolCalls}`,
    `Estimated tokens: ${run.metrics.estimatedTokens}`,
    `Failure replays: ${run.metrics.failureReplayCount}`,
    '',
    '| Case | Type | Status | Pass@1 | Pass@3 | Fix Iterations | Tool Calls | Estimated Tokens | Failure Replays |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n')
}

async function runEvalCase(store: WorkflowEvalStore, suiteId: string, item: WorkflowEvalCase): Promise<{
  caseResult: WorkflowEvalCaseResult
  failurePaths: string[]
}> {
  const attempts: WorkflowEvalAttemptResult[] = []
  const failureReplayIds: string[] = []
  const failurePaths: string[] = []
  let passedAt = -1

  for (let i = 0; i < item.attempts.length; i += 1) {
    const attempt = item.attempts[i]
    const result = await runAttempt(attempt, store.projectDir)
    attempts.push(result)
    if (!result.passed) {
      const replay = createFailureReplay(suiteId, item, result, i + 1)
      failureReplayIds.push(replay.id)
      failurePaths.push(store.saveFailure(replay))
    }
    if (result.passed && passedAt < 0) {
      passedAt = i + 1
      break
    }
  }

  const passed = passedAt > 0
  const estimatedTokens = item.estimatedContextTokens ?? estimateTokens([
    item.task,
    ...attempts.map(attempt => attempt.outputSummary),
  ].join('\n'))
  return {
    caseResult: {
      id: item.id,
      type: item.type,
      title: item.title,
      task: item.task,
      passed,
      passAt1: passedAt === 1,
      passAt3: passed && passedAt <= 3,
      fixIterations: passed ? Math.max(0, passedAt - 1) : attempts.length,
      humanCorrections: item.humanCorrections ?? 0,
      estimatedTokens,
      toolCalls: attempts.length,
      attempts,
      failureReplayIds,
    },
    failurePaths,
  }
}

async function runAttempt(attempt: WorkflowEvalAttempt, cwd: string): Promise<WorkflowEvalAttemptResult> {
  const started = Date.now()
  const expectedExitCode = attempt.expectedExitCode ?? 0
  const commandRedaction = redactEvidenceText(attempt.command)
  try {
    const result = await runSafeCommand(attempt.command, {
      cwd,
      timeout: attempt.timeoutMs ?? 30_000,
    })
    const output = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n')
    const outputRedaction = redactEvidenceText(output.slice(-2000))
    const outputContains = attempt.outputContains
      ? output.includes(attempt.outputContains)
      : true
    return {
      id: attempt.id ?? `attempt-${randomUUID().slice(0, 8)}`,
      command: commandRedaction.value,
      expectedExitCode,
      exitCode: result.exitCode,
      passed: result.exitCode === expectedExitCode && outputContains,
      durationMs: Date.now() - started,
      outputSummary: outputRedaction.value || '(no output)',
      redactionApplied: commandRedaction.redacted || outputRedaction.redacted,
    }
  } catch (error) {
    const outputRedaction = redactEvidenceText(error instanceof Error ? error.message : String(error))
    return {
      id: attempt.id ?? `attempt-${randomUUID().slice(0, 8)}`,
      command: commandRedaction.value,
      expectedExitCode,
      exitCode: 1,
      passed: false,
      durationMs: Date.now() - started,
      outputSummary: outputRedaction.value,
      redactionApplied: commandRedaction.redacted || outputRedaction.redacted,
    }
  }
}

function createFailureReplay(suiteId: string, item: WorkflowEvalCase, attempt: WorkflowEvalAttemptResult, attemptNumber: number): FailureReplayRecord {
  const evidence = redactEvidenceValue({
    command: attempt.command,
    exitCode: attempt.exitCode,
    expectedExitCode: attempt.expectedExitCode,
    outputSummary: attempt.outputSummary,
  })
  return {
    id: `FAIL-${Date.now()}-${randomUUID().slice(0, 8)}`,
    taskId: item.id,
    suiteId,
    caseId: item.id,
    generatedAt: new Date().toISOString(),
    category: item.expectedFailureCategory ?? 'command-failure',
    phase: item.phase ?? 'verify',
    task: item.task,
    wrongTurn: `Attempt ${attemptNumber} did not satisfy eval criteria.`,
    evidence: JSON.stringify(evidence.value),
    correction: 'Run the replay command, inspect failure evidence, then update workflow rules, tests, docs, or accepted risk.',
    prevention: preventionFor(item.expectedFailureCategory ?? 'command-failure'),
    replayCommand: attempt.command,
    status: 'open',
    redactionApplied: attempt.redactionApplied || evidence.redacted,
  }
}

function summarizeEval(cases: WorkflowEvalCaseResult[]): WorkflowEvalMetrics {
  const total = cases.length
  const passAt1 = cases.filter(item => item.passAt1).length
  const passAt3 = cases.filter(item => item.passAt3).length
  const failed = cases.filter(item => !item.passed).length
  return {
    total,
    passed: total - failed,
    failed,
    passAt1,
    passAt3,
    passAt1Rate: ratio(passAt1, total),
    passAt3Rate: ratio(passAt3, total),
    averageFixIterations: total === 0 ? 0 : cases.reduce((sum, item) => sum + item.fixIterations, 0) / total,
    totalToolCalls: cases.reduce((sum, item) => sum + item.toolCalls, 0),
    estimatedTokens: cases.reduce((sum, item) => sum + item.estimatedTokens, 0),
    humanCorrections: cases.reduce((sum, item) => sum + item.humanCorrections, 0),
    failureReplayCount: cases.reduce((sum, item) => sum + item.failureReplayIds.length, 0),
  }
}

function preventionFor(category: FailureReplayCategory): string {
  const map: Record<FailureReplayCategory, string> = {
    'wrong-exploration-path': 'Add code intelligence or scoped exploration evidence before implementation.',
    'hallucinated-project-fact': 'Require evidence paths before project facts become active memory.',
    'missing-codegraph-or-graph-fallback': 'Record graph provider status and explicit fallback reason.',
    'over-broad-context-load': 'Use context budget and lazy context pack before broad reads.',
    'bad-skill-recommendation': 'Lower capability confidence or require stronger tool evidence.',
    'missing-verification-evidence': 'Block final claims until runtime evidence exists.',
    'failed-security-or-resource-gate': 'Promote the finding into security or resource governance checks.',
    'human-correction-after-agent-confidence': 'Record human correction as an eval signal and lower confidence.',
    'command-failure': 'Capture command, exit code, output summary, and a replay command.',
    unknown: 'Classify the failure before promoting any workflow rule.',
  }
  return map[category]
}

function comparisonRecommendation(delta: WorkflowEvalComparison['delta']): WorkflowEvalComparison['recommendation'] {
  const better = delta.passAt1Rate > 0 || delta.passAt3Rate > 0 || delta.averageFixIterations < 0 || delta.humanCorrections < 0
  const worse = delta.passAt1Rate < 0 || delta.passAt3Rate < 0 || delta.averageFixIterations > 0 || delta.humanCorrections > 0
  if (better && !worse) return 'improved'
  if (worse && !better) return 'regressed'
  if (better || worse) return 'mixed'
  return 'same'
}

function pickRun(run: WorkflowEvalRun): Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'> {
  return { id: run.id, suiteId: run.suiteId, metrics: run.metrics }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(stripBom(readFileSync(path, 'utf-8'))) as T
  } catch {
    return null
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

function safeSegment(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, '-')
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
