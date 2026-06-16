import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { WorkflowEvalStore, type WorkflowEvalRun } from '../eval/WorkflowEval.js'
import { MemoryBrain } from '../memory/MemoryBrain.js'
import { RuntimeEvidenceLedger } from '../runtime/RuntimeEvidenceLedger.js'
import { doctorResourceAssets } from '../workflow/ResourceGovernance.js'
import { HTMLDocumentRenderer, type DocLang, type ThemeMode } from './HTMLDocumentRenderer.js'
import { listExistingHtmlArtifacts } from './HTMLArtifactLayer.js'
import { aggregateGovernanceMetrics, type AggregatedGovernanceMetrics } from '../dashboard/MetricsAggregator.js'

export interface GovernanceDashboardOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  output?: string
  theme?: ThemeMode
  lang?: DocLang
  now?: () => Date
}

export interface GovernanceDashboardSummary {
  runtime: {
    total: number
    passed: number
    failed: number
    skipped: number
    ok: boolean
  }
  eval: {
    runs: number
    failures: number
    openFailures: number
    latestRunId?: string
    latestPassAt1Rate?: number
  }
  memory: {
    total: number
    active: number
    candidate: number
    contradictions: number
    ok: boolean
  }
  resources: {
    total: number
    findings: number
    failedFindings: number
    ok: boolean
  }
  htmlArtifacts: {
    count: number
  }
  governanceMetrics: AggregatedGovernanceMetrics
}

export interface GovernanceDashboardResult {
  ok: boolean
  projectDir: string
  scaleRoot: string
  outputPath: string
  manifestPath: string
  generatedAt: string
  summary: GovernanceDashboardSummary
  findings: Array<{ severity: 'info' | 'warn' | 'fail'; code: string; message: string }>
}

export function renderGovernanceDashboard(options: GovernanceDashboardOptions = {}): GovernanceDashboardResult {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleRoot = resolveScaleRoot(projectDir, options.scaleDir)
  const generatedAt = (options.now ?? (() => new Date()))().toISOString()
  const outputPath = resolveOutputPath(projectDir, scaleRoot, options.output)
  const manifestPath = join(dirname(outputPath), 'governance-dashboard-manifest.json')

  const runtime = new RuntimeEvidenceLedger({
    projectDir,
    scaleDir: scaleRoot,
    createDirs: false,
  }).summary({ taskId: options.taskId, limit: Number.MAX_SAFE_INTEGER })

  const evalStore = new WorkflowEvalStore({ projectDir, scaleDir: scaleRoot })
  const evalRuns = listEvalRuns(evalStore.runsDir)
  const evalFailures = evalStore.listFailures({ taskId: options.taskId, sinceDays: 30 })
  const latestRun = evalRuns[0]

  const brain = new MemoryBrain({ projectDir, scaleDir: scaleRoot })
  const memoryDream = brain.dream()
  const resourceDoctor = doctorResourceAssets({ projectDir, scaleDir: scaleRoot })
  const htmlArtifacts = listExistingHtmlArtifacts({ projectDir, scaleDir: scaleRoot, taskId: options.taskId })
  const governanceMetrics = aggregateGovernanceMetrics({ projectDir, scaleDir: scaleRoot })

  const summary: GovernanceDashboardSummary = {
    runtime: {
      total: runtime.total,
      passed: runtime.passed,
      failed: runtime.failed,
      skipped: runtime.skipped,
      ok: runtime.ok,
    },
    eval: {
      runs: evalRuns.length,
      failures: evalFailures.length,
      openFailures: evalFailures.filter(failure => failure.status === 'open').length,
      latestRunId: latestRun?.id,
      latestPassAt1Rate: latestRun?.metrics.passAt1Rate,
    },
    memory: {
      total: memoryDream.summary.total,
      active: memoryDream.summary.active,
      candidate: memoryDream.summary.candidate,
      contradictions: memoryDream.summary.contradictions,
      ok: memoryDream.ok && memoryDream.summary.contradictions === 0,
    },
    resources: {
      total: resourceDoctor.scan.summary.total,
      findings: resourceDoctor.findings.length,
      failedFindings: resourceDoctor.findings.filter(finding => finding.severity === 'fail').length,
      ok: resourceDoctor.ok,
    },
    htmlArtifacts: {
      count: htmlArtifacts.length,
    },
    governanceMetrics,
  }

  const findings = dashboardFindings(summary)
  const ok = !findings.some(finding => finding.severity === 'fail')
  const renderer = new HTMLDocumentRenderer({
    title: 'SCALE Governance Dashboard',
    theme: options.theme ?? 'auto',
    lang: options.lang ?? 'zh',
    interactive: true,
    printFriendly: true,
  })
  const html = renderer.renderReport({
    type: 'governance-dashboard',
    title: 'SCALE Governance Dashboard',
    timestamp: generatedAt,
    metrics: {
      status: ok ? 'OK' : 'ATTENTION',
      runtimePassed: summary.runtime.passed,
      evalFailures: summary.eval.failures,
      activeMemory: summary.memory.active,
      resourceFindings: summary.resources.findings,
      htmlArtifacts: summary.htmlArtifacts.count,
      commandTokenSavings: summary.governanceMetrics.commandRuns.savedEstimatedTokens,
      modelCacheSavings: summary.governanceMetrics.modelUsage.cacheSavingsTokens,
    },
    sections: [
      { heading: 'Runtime Evidence', content: runtimeSection(summary) },
      { heading: 'Governance Metrics', content: governanceMetricsSection(summary.governanceMetrics) },
      { heading: 'Workflow Eval', content: evalSection(evalRuns, evalFailures) },
      { heading: 'Memory Brain', content: memorySection(memoryDream) },
      { heading: 'Resource Governance', content: resourceSection(resourceDoctor) },
      { heading: 'HTML Artifacts', content: htmlArtifactSection(htmlArtifacts) },
      { heading: 'Next Actions', content: nextActionsSection(findings) },
    ],
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
  writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    generatedAt,
    outputPath: normalizeProjectPath(projectDir, outputPath),
    gitPolicy: 'ignore',
    lifecycle: 'generated-report',
    source: 'scale-governance-dashboard',
    taskId: options.taskId,
    summary,
    findings,
  }, null, 2) + '\n', 'utf-8')

  return {
    ok,
    projectDir,
    scaleRoot,
    outputPath,
    manifestPath,
    generatedAt,
    summary,
    findings,
  }
}

function dashboardFindings(summary: GovernanceDashboardSummary): GovernanceDashboardResult['findings'] {
  const findings: GovernanceDashboardResult['findings'] = []
  if (!summary.runtime.ok) {
    findings.push({ severity: 'fail', code: 'runtime-failures', message: `${summary.runtime.failed} runtime evidence record(s) failed.` })
  }
  if (summary.eval.openFailures > 0) {
    findings.push({ severity: 'warn', code: 'open-eval-failures', message: `${summary.eval.openFailures} eval failure replay record(s) are still open.` })
  }
  if (!summary.memory.ok) {
    findings.push({ severity: 'fail', code: 'memory-contradictions', message: `${summary.memory.contradictions} memory contradiction(s) require review.` })
  }
  if (!summary.resources.ok) {
    findings.push({ severity: 'fail', code: 'resource-governance-failed', message: `${summary.resources.failedFindings} resource governance finding(s) failed.` })
  }
  if (summary.htmlArtifacts.count === 0) {
    findings.push({ severity: 'info', code: 'no-html-artifacts', message: 'No task HTML artifacts were found for this scope.' })
  }
  return findings
}

function runtimeSection(summary: GovernanceDashboardSummary): string {
  return `<table>
    <thead><tr><th>Status</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th></tr></thead>
    <tbody><tr><td>${summary.runtime.ok ? 'OK' : 'FAILED'}</td><td>${summary.runtime.total}</td><td>${summary.runtime.passed}</td><td>${summary.runtime.failed}</td><td>${summary.runtime.skipped}</td></tr></tbody>
  </table>`
}

function governanceMetricsSection(metrics: AggregatedGovernanceMetrics): string {
  const gateRows = Object.entries(metrics.gateFailures.byGate)
    .sort(([, a], [, b]) => b - a)
    .map(([gate, count]) => `<tr><td><code>${escapeHtml(gate)}</code></td><td>${count}</td></tr>`)
    .join('')
  const providerRows = Object.entries(metrics.modelUsage.byProvider)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, summary]) => `<tr><td>${escapeHtml(provider)}</td><td>${summary.records}</td><td>${summary.totalTokens}</td><td>${summary.cacheSavingsTokens}</td></tr>`)
    .join('')
  return `
    <h3>Task Metrics</h3>
    <table><thead><tr><th>Window</th><th>Total Tasks</th><th>Recent Tasks</th><th>First Pass</th><th>Recent First Pass</th><th>Avg Fix Iterations</th></tr></thead>
    <tbody><tr><td>${metrics.sinceDays} days</td><td>${metrics.taskMetrics.total}</td><td>${metrics.taskMetrics.recentTasks}</td><td>${(metrics.taskMetrics.firstPassRate * 100).toFixed(1)}%</td><td>${(metrics.taskMetrics.recentFirstPassRate * 100).toFixed(1)}%</td><td>${metrics.taskMetrics.averageFixIterations.toFixed(2)}</td></tr></tbody></table>
    <h3>Gate Failures</h3>
    <table><thead><tr><th>Total Gate Evidence</th><th>Failed</th></tr></thead><tbody><tr><td>${metrics.gateFailures.total}</td><td>${metrics.gateFailures.failed}</td></tr></tbody></table>
    <table><thead><tr><th>Gate</th><th>Failures</th></tr></thead><tbody>${gateRows || '<tr><td colspan="2">No gate failures found.</td></tr>'}</tbody></table>
    <h3>Command Output Compression</h3>
    <table><thead><tr><th>Total Runs</th><th>Passed</th><th>Failed</th><th>Raw Tokens</th><th>Compressed Tokens</th><th>Saved Tokens</th></tr></thead>
    <tbody><tr><td>${metrics.commandRuns.total}</td><td>${metrics.commandRuns.passed}</td><td>${metrics.commandRuns.failed}</td><td>${metrics.commandRuns.rawEstimatedTokens}</td><td>${metrics.commandRuns.compressedEstimatedTokens}</td><td>${metrics.commandRuns.savedEstimatedTokens}</td></tr></tbody></table>
    <h3>Model Usage</h3>
    <table><thead><tr><th>Records</th><th>Total Tokens</th><th>Cache Eligible</th><th>Cache Creation</th><th>Cache Read</th><th>Cached</th><th>Saved</th></tr></thead>
    <tbody><tr><td>${metrics.modelUsage.totalRecords}</td><td>${metrics.modelUsage.totalTokens}</td><td>${metrics.modelUsage.cacheEligibleTokens}</td><td>${metrics.modelUsage.cacheCreationInputTokens}</td><td>${metrics.modelUsage.cacheReadInputTokens}</td><td>${metrics.modelUsage.cachedTokens}</td><td>${metrics.modelUsage.cacheSavingsTokens}</td></tr></tbody></table>
    <table><thead><tr><th>Provider</th><th>Records</th><th>Total Tokens</th><th>Saved Tokens</th></tr></thead><tbody>${providerRows || '<tr><td colspan="4">No model usage records found.</td></tr>'}</tbody></table>
  `
}

function evalSection(runs: WorkflowEvalRun[], failures: ReturnType<WorkflowEvalStore['listFailures']>): string {
  const latestRows = runs.slice(0, 5).map(run => `<tr>
    <td><code>${escapeHtml(run.id)}</code></td>
    <td>${escapeHtml(run.suiteId)}</td>
    <td>${run.ok ? 'pass' : 'fail'}</td>
    <td>${(run.metrics.passAt1Rate * 100).toFixed(1)}%</td>
    <td>${run.metrics.failureReplayCount}</td>
  </tr>`).join('')
  const failureRows = failures.slice(0, 8).map(failure => `<tr>
    <td><code>${escapeHtml(failure.id)}</code></td>
    <td>${escapeHtml(failure.category)}</td>
    <td>${escapeHtml(failure.status)}</td>
    <td>${escapeHtml(failure.phase)}</td>
  </tr>`).join('')
  return `
    <h3>Latest Runs</h3>
    <table><thead><tr><th>Run</th><th>Suite</th><th>Status</th><th>Pass@1</th><th>Failures</th></tr></thead><tbody>${latestRows || '<tr><td colspan="5">No eval runs found.</td></tr>'}</tbody></table>
    <h3>Recent Failures</h3>
    <table><thead><tr><th>Failure</th><th>Category</th><th>Status</th><th>Phase</th></tr></thead><tbody>${failureRows || '<tr><td colspan="4">No recent failure replays found.</td></tr>'}</tbody></table>
  `
}

function memorySection(memoryDream: ReturnType<MemoryBrain['dream']>): string {
  const contradictionRows = memoryDream.contradictions.slice(0, 8).map(item => `<tr>
    <td><code>${escapeHtml(item.id)}</code></td>
    <td>${escapeHtml(item.title)}</td>
    <td>${item.nodeIds.map(id => `<code>${escapeHtml(id)}</code>`).join(', ')}</td>
  </tr>`).join('')
  const promoteRows = memoryDream.promotionCandidates.slice(0, 8).map(item => `<tr>
    <td><code>${escapeHtml(item.id)}</code></td>
    <td>${escapeHtml(item.title)}</td>
    <td>${item.confidence.toFixed(2)}</td>
  </tr>`).join('')
  return `
    <table><thead><tr><th>Total</th><th>Active</th><th>Candidate</th><th>Stale</th><th>Contradictions</th></tr></thead>
    <tbody><tr><td>${memoryDream.summary.total}</td><td>${memoryDream.summary.active}</td><td>${memoryDream.summary.candidate}</td><td>${memoryDream.summary.stale}</td><td>${memoryDream.summary.contradictions}</td></tr></tbody></table>
    <h3>Contradictions</h3>
    <table><thead><tr><th>ID</th><th>Title</th><th>Nodes</th></tr></thead><tbody>${contradictionRows || '<tr><td colspan="3">No contradictions found.</td></tr>'}</tbody></table>
    <h3>Promotion Candidates</h3>
    <table><thead><tr><th>ID</th><th>Title</th><th>Confidence</th></tr></thead><tbody>${promoteRows || '<tr><td colspan="3">No promotion candidates found.</td></tr>'}</tbody></table>
  `
}

function resourceSection(resourceDoctor: ReturnType<typeof doctorResourceAssets>): string {
  const findingRows = resourceDoctor.findings.slice(0, 12).map(finding => `<tr>
    <td>${escapeHtml(finding.severity)}</td>
    <td>${escapeHtml(finding.code)}</td>
    <td>${escapeHtml(finding.path ?? '')}</td>
    <td>${escapeHtml(finding.message)}</td>
  </tr>`).join('')
  const summary = resourceDoctor.scan.summary
  return `
    <table><thead><tr><th>Status</th><th>Total Assets</th><th>Tracked Forbidden</th><th>Expired</th><th>Large Tracked</th></tr></thead>
    <tbody><tr><td>${resourceDoctor.ok ? 'OK' : 'FAILED'}</td><td>${summary.total}</td><td>${summary.trackedForbidden}</td><td>${summary.expired}</td><td>${summary.largeTracked}</td></tr></tbody></table>
    <h3>Findings</h3>
    <table><thead><tr><th>Severity</th><th>Code</th><th>Path</th><th>Message</th></tr></thead><tbody>${findingRows || '<tr><td colspan="4">No resource findings.</td></tr>'}</tbody></table>
  `
}

function htmlArtifactSection(paths: string[]): string {
  const rows = paths.slice(0, 20).map(path => `<tr><td><code>${escapeHtml(path)}</code></td></tr>`).join('')
  return `<table><thead><tr><th>Artifact</th></tr></thead><tbody>${rows || '<tr><td>No task HTML artifacts found.</td></tr>'}</tbody></table>`
}

function nextActionsSection(findings: GovernanceDashboardResult['findings']): string {
  if (findings.length === 0) return '<p>No blocking governance actions detected.</p>'
  return `<ul>${findings.map(finding => `<li><strong>${escapeHtml(finding.code)}</strong>: ${escapeHtml(finding.message)}</li>`).join('')}</ul>`
}

function listEvalRuns(runsDir: string): WorkflowEvalRun[] {
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJson<WorkflowEvalRun>(join(runsDir, file)))
    .filter((run): run is WorkflowEvalRun => Boolean(run))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
}

function resolveOutputPath(projectDir: string, scaleRoot: string, output?: string): string {
  if (output?.trim()) return isAbsolute(output) ? output : resolve(projectDir, output)
  return join(scaleRoot, 'reports', 'governance-dashboard.html')
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  if (scaleDir && isAbsolute(scaleDir)) return scaleDir
  return join(projectDir, scaleDir ?? '.scale')
}

function normalizeProjectPath(projectDir: string, path: string): string {
  const relativePath = relative(projectDir, path)
  if (!relativePath.startsWith('..') && !isAbsolute(relativePath)) return normalizePath(relativePath)
  return path
}

function normalizePath(path: string): string {
  return path.split(/[/\\]+/).filter(Boolean).join('/')
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
