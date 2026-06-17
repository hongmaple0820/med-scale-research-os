// MedSCALE Target Research CLI
// 医学研究者 + Agent 的原生交付入口

import { defineCommand } from 'citty'
import { spawn, spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonBridge } from '../bridge/PythonBridge.js'
import { STAGE_LABELS, type AnalysisStage } from '../bridge/types.js'
import { readMedicalWorkflowDashboard } from '../dashboard/MedicalWorkflowData.js'
import { normalizeLanguage, type ScaleLanguage } from '../i18n/Language.js'
import {
  importMemoryProviderKnowledge,
  MemoryBrain,
  renderMemoryLearningCandidateMarkdown,
  reviewMemoryLearningCandidate,
  type MemoryLearningCandidate,
  type MemoryNodeScope,
  type MemoryProviderImportReport,
  type MemoryReviewAction,
} from '../memory/index.js'
import {
  buildModelUsageInput,
  ModelUsageLedger,
  type ModelUsageInput,
  type ModelUsageRecord,
  type ModelUsageReport,
} from '../runtime/ModelUsageLedger.js'

const PROJECT_DIR = process.env.MEDSCALE_PROJECT_DIR ?? process.env.SCALE_PROJECT_DIR ?? process.cwd()
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface ResolvedTargetPlatform {
  projectDir: string
  platformDir: string
  mainPy: string
}

export interface TargetMemorySeedPlan {
  ok: boolean
  projectDir: string
  workflowRoot: string
  outputDir: string
  manuscriptsDir: string
  target: string
  disease: string
  slug: string | null
  manifestPath: string | null
  sourceFiles: string[]
  missingRoles: string[]
  warnings: string[]
}

export interface TargetMemorySeedReport {
  ok: boolean
  target: string
  disease: string
  provider: string
  manifestPath: string | null
  summaryPath: string | null
  recordPath: string | null
  sourceFiles: string[]
  missingRoles: string[]
  importReport: MemoryProviderImportReport | null
  warnings: string[]
}

export interface TargetDeliveryLearningReport {
  ok: boolean
  target: string
  disease: string
  candidateId: string | null
  candidatePath: string | null
  candidateMarkdownPath: string | null
  mirrorRecordPath: string | null
  mirrorSummaryPath: string | null
  recommendedAction: string | null
  promotable: boolean
  brainNodeId: string | null
  brainIngestOk: boolean | null
  sourceFiles: string[]
  warnings: string[]
}

export interface TargetRuntimeReadinessCard {
  id: string
  title: string
  state: 'pass' | 'warning' | 'fail' | 'pending'
  statusLabel: string
  summary: string
  details: string[]
  nextAction: string
  required: boolean
}

export interface TargetRuntimeReadiness {
  schema: 'medscale.runtime_readiness.v1'
  status: 'ready' | 'degraded' | 'blocked'
  score: number
  workspaceRoot: string
  requiredMissing: string[]
  warningCount: number
  failCount: number
  cards: TargetRuntimeReadinessCard[]
  recommendations: string[]
}

export interface TargetTokenCostLane {
  key: string
  label: string
  records: number
  totalTokens: number
  cacheSavingsTokens: number
  estimatedCostUsd?: number
}

export interface TargetTokenCostReport {
  schema: 'medscale.token_cost.v1'
  status: 'ready' | 'pending'
  generatedAt: string
  workspaceRoot: string
  usagePath: string
  window: {
    day?: string
    since?: string
    until?: string
    sinceDays?: number
  }
  summary: ModelUsageReport['summary']
  byProvider: ModelUsageReport['byProvider']
  byModel: ModelUsageReport['byModel']
  byTask: ModelUsageReport['byTask']
  byDay: ModelUsageReport['byDay']
  byMedicalLane: TargetTokenCostLane[]
  records: ModelUsageReport['records']
  recommendations: string[]
}

export interface TargetTokenUsageIngestSource {
  file: string
  pointer: string
  status: 'recorded' | 'duplicate' | 'skipped'
  medicalLane: string
  provider: string | null
  model?: string
  totalTokens: number
  recordId?: string
  warning?: string
}

export interface TargetTokenUsageIngestReport {
  schema: 'medscale.token_ingest.v1'
  status: 'ready' | 'pending' | 'warning'
  ok: boolean
  generatedAt: string
  workspaceRoot: string
  usagePath: string
  scannedFiles: string[]
  recorded: number
  duplicates: number
  skipped: number
  warnings: string[]
  sources: TargetTokenUsageIngestSource[]
  records: ModelUsageRecord[]
  tokenCost: TargetTokenCostReport
}

const DELIVERY_MEMORY_IMPORT_ROLES = [
  'manuscript_markdown',
  'manuscript_zhongliu',
  'manuscript_meta',
  'manuscript_quality',
  'manuscript_fact_check',
  'literature_evidence_pack',
  'agent_review_tasks',
  'agent_reviews',
  'delivery_manifest',
] as const

/** 解析 target-research-platform 目录（支持从仓库根或子目录运行） */
export function resolveTargetPlatform(projectDir: string = PROJECT_DIR): ResolvedTargetPlatform | null {
  const candidates = [
    resolve(projectDir, 'target-research-platform'),
    resolve(projectDir, '..', 'target-research-platform'),
    resolve(projectDir, '../..', 'target-research-platform'),
  ]

  for (const platformDir of candidates) {
    const mainPy = join(platformDir, 'main.py')
    if (existsSync(mainPy)) {
      return {
        projectDir: resolve(projectDir),
        platformDir,
        mainPy,
      }
    }
  }

  return null
}

function parseCancerList(raw: string | undefined): string[] {
  if (!raw?.trim()) return ['BRCA']
  return raw.split(/[,\s]+/).map(item => item.trim()).filter(Boolean)
}

function normalizeTargetToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function resolveTargetOutputDir(platform: ResolvedTargetPlatform, output: string | undefined): string {
  return resolve(platform.platformDir, String(output ?? './output'))
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function readWorkspaceJson(root: string, relativePath: string): Record<string, unknown> | null {
  return readJsonFile(join(root, ...relativePath.split('/')))
}

function resolveTargetWorkspaceRoot(projectDir: string): string {
  const candidates = [
    resolve(projectDir),
    resolve(projectDir, '..'),
    resolve(projectDir, '../..'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, '.scale'))) return candidate
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json')) && existsSync(join(candidate, 'target-research-platform'))) {
      return candidate
    }
  }
  return resolve(projectDir)
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const value = env.PATH ?? env.Path ?? ''
  return value.split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
}

function commandExtensions(command: string, env: NodeJS.ProcessEnv): string[] {
  if (command.includes('.')) return ['']
  if (process.platform !== 'win32') return ['']
  const pathext = String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
  return ['', ...new Set([...pathext, '.PS1'].map(item => item.startsWith('.') ? item : `.${item}`))]
}

function findCommandPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const binary = command.split(/\s+/)[0]
  for (const dir of pathEntries(env)) {
    for (const ext of commandExtensions(binary, env)) {
      const candidate = join(dir, `${binary}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function runtimeCard(
  id: string,
  title: string,
  state: TargetRuntimeReadinessCard['state'],
  statusLabel: string,
  summary: string,
  details: string[],
  nextAction: string,
  required: boolean,
): TargetRuntimeReadinessCard {
  return { id, title, state, statusLabel, summary, details, nextAction, required }
}

function targetScaleDir(root: string): string {
  return join(root, '.scale')
}

function targetUsagePath(root: string): string {
  return join(targetScaleDir(root), 'model-usage', 'usage.jsonl')
}

function normalizeSinceDaysValue(value: unknown, fallback = 30): number | undefined {
  if (value === undefined || value === null || value === '') return fallback
  const raw = String(value).trim().toLowerCase()
  if (raw === 'all' || raw === 'none' || raw === '0') return undefined
  const parsed = Number(raw.replace(/d$/, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function medicalUsageLane(record: ModelUsageReport['records'][number]): string {
  const metadata = record.metadata ?? {}
  const explicit = typeof metadata.medical_lane === 'string'
    ? metadata.medical_lane
    : typeof metadata.phase === 'string'
      ? metadata.phase
      : typeof metadata.gate === 'string'
        ? metadata.gate
        : ''
  const haystack = [
    explicit,
    record.taskId ?? '',
    record.sessionId ?? '',
    record.model ?? '',
  ].join(' ').toLowerCase()
  if (/literature|pubmed|openalex|文献|检索/.test(haystack)) return 'literature'
  if (/fact|claim|事实|核查/.test(haystack)) return 'fact_check'
  if (/package|audit|delivery|zip|交付|审计/.test(haystack)) return 'package_audit'
  if (/memory|gbrain|learning|candidate|记忆|沉淀/.test(haystack)) return 'memory'
  if (/agent|review|handoff|peer|评审|协作/.test(haystack)) return 'agent_review'
  return 'workflow'
}

function medicalLaneLabel(lane: string): string {
  const labels: Record<string, string> = {
    literature: 'Literature review',
    fact_check: 'Medical fact check',
    package_audit: 'Package audit',
    memory: 'Memory settlement',
    agent_review: 'Agent review',
    workflow: 'Workflow',
  }
  return labels[lane] ?? lane
}

function buildMedicalUsageLanes(records: ModelUsageReport['records']): TargetTokenCostLane[] {
  const lanes = new Map<string, TargetTokenCostLane>()
  for (const record of records) {
    const key = medicalUsageLane(record)
    const lane = lanes.get(key) ?? {
      key,
      label: medicalLaneLabel(key),
      records: 0,
      totalTokens: 0,
      cacheSavingsTokens: 0,
    }
    lane.records += 1
    lane.totalTokens += record.totalTokens
    lane.cacheSavingsTokens += record.cacheSavingsTokens
    if (record.estimatedCostUsd !== undefined) {
      lane.estimatedCostUsd = Math.round(((lane.estimatedCostUsd ?? 0) + record.estimatedCostUsd) * 1_000_000) / 1_000_000
    }
    lanes.set(key, lane)
  }
  return [...lanes.values()].sort((left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key))
}

export function buildTargetTokenCostReport(options: {
  projectDir?: string
  day?: string
  since?: string
  until?: string
  sinceDays?: number
  provider?: string
  model?: string
  taskId?: string
  sessionId?: string
  limit?: number
} = {}): TargetTokenCostReport {
  const root = resolveTargetWorkspaceRoot(options.projectDir ?? PROJECT_DIR)
  const sinceDays = options.day || options.since || options.until
    ? undefined
    : normalizeSinceDaysValue(options.sinceDays, 30)
  const since = options.since
    ?? (sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString() : undefined)
  const report = new ModelUsageLedger(targetScaleDir(root)).report({
    day: options.day,
    since,
    until: options.until,
    provider: options.provider,
    model: options.model,
    taskId: options.taskId,
    sessionId: options.sessionId,
    limit: options.limit,
  })
  const status: TargetTokenCostReport['status'] = report.summary.totalRecords > 0 ? 'ready' : 'pending'
  return {
    schema: 'medscale.token_cost.v1',
    status,
    generatedAt: report.generatedAt,
    workspaceRoot: root,
    usagePath: targetUsagePath(root),
    window: {
      day: options.day,
      since,
      until: options.until,
      sinceDays,
    },
    summary: report.summary,
    byProvider: report.byProvider,
    byModel: report.byModel,
    byTask: report.byTask,
    byDay: report.byDay,
    byMedicalLane: buildMedicalUsageLanes(report.records),
    records: report.records,
    recommendations: status === 'ready'
      ? ['Review high-token medical lanes before expert handoff and package delivery.']
      : [
          'Record model usage for literature review, fact check, package audit, agent review, and memory settlement.',
          'Use `medscale token record --provider <name> --usage-json <json>` after model calls.',
    ],
  }
}

interface TargetTokenUsageIngestOptions {
  projectDir?: string
  output?: string
  target?: string
  disease?: string
  files?: string[]
  provider?: string
  limit?: number
}

interface TargetTokenUsageCandidate {
  filePath: string
  pointer: string
  payload: Record<string, unknown>
}

const TOKEN_USAGE_FIELD_PATHS = [
  ['input_tokens'],
  ['prompt_tokens'],
  ['output_tokens'],
  ['completion_tokens'],
  ['cache_creation_input_tokens'],
  ['cache_read_input_tokens'],
  ['cached_tokens'],
  ['inputTokens'],
  ['promptTokens'],
  ['outputTokens'],
  ['completionTokens'],
  ['cacheCreationInputTokens'],
  ['cacheReadInputTokens'],
  ['cachedTokens'],
  ['prompt_tokens_details', 'cached_tokens'],
  ['input_tokens_details', 'cached_tokens'],
  ['promptTokensDetails', 'cachedTokens'],
  ['inputTokensDetails', 'cachedTokens'],
]

export function ingestTargetTokenUsage(options: TargetTokenUsageIngestOptions = {}): TargetTokenUsageIngestReport {
  const root = resolveTargetWorkspaceRoot(options.projectDir ?? PROJECT_DIR)
  const resolved = resolveTargetTokenIngestFiles(root, options)
  const ledger = new ModelUsageLedger(targetScaleDir(root))
  const seen = new Set(
    ledger
      .list({ limit: Number.MAX_SAFE_INTEGER })
      .map(record => typeof record.metadata?.ingest_key === 'string' ? record.metadata.ingest_key : '')
      .filter(Boolean),
  )
  const defaultProvider = stringValue(options.provider)
  const sources: TargetTokenUsageIngestSource[] = []
  const records: ModelUsageRecord[] = []
  const warnings = [...resolved.warnings]
  let duplicates = 0
  let skipped = 0

  for (const filePath of resolved.files) {
    const payload = readJsonFile(filePath)
    if (!payload) {
      skipped += 1
      warnings.push(`Cannot read JSON token usage artifact: ${filePath}`)
      continue
    }

    const candidates = collectTargetTokenUsageCandidates(filePath, payload)
    if (candidates.length === 0) {
      continue
    }

    for (const candidate of candidates) {
      const provider = firstString(candidate.payload, ['provider', 'model_provider', 'llm_provider', 'provider_id', 'vendor']) ?? defaultProvider
      const model = firstString(candidate.payload, ['model', 'model_id', 'model_name', 'llm_model', 'deployment'])
      const usageId = firstString(candidate.payload, ['usage_id', 'usageId'])
      const medicalLane = inferTokenUsageLane(filePath, candidate.pointer, candidate.payload)
      const relativePath = normalizedRelativePath(root, filePath)
      const sourceRole = inferTokenUsageSourceRole(filePath, candidate.payload)

      if (!provider) {
        skipped += 1
        const warning = `Token usage candidate skipped because provider is missing: ${relativePath}${candidate.pointer || '/'}`
        warnings.push(warning)
        sources.push({
          file: filePath,
          pointer: candidate.pointer || '/',
          status: 'skipped',
          medicalLane,
          provider: null,
          model,
          totalTokens: 0,
          warning,
        })
        continue
      }

      const baseInput = buildModelUsageInput({
        provider,
        model,
        taskId: firstString(candidate.payload, ['task_id', 'taskId', 'task', 'phase', 'role']) ?? `medscale-token-ingest-${medicalLane}`,
        sessionId: firstString(candidate.payload, ['session_id', 'sessionId', 'session']),
        estimatedCostUsd: firstNumber(candidate.payload, [
          'estimatedCostUsd',
          'estimated_cost_usd',
          'model_cost_usd',
          'llm_cost_usd',
          'cost_usd',
        ]),
        timestamp: firstString(candidate.payload, ['timestamp', 'created_at', 'createdAt', 'generated_at', 'generatedAt']),
        usagePayload: candidate.payload,
      })
      const usageMagnitude = (baseInput.inputTokens ?? 0)
        + (baseInput.outputTokens ?? 0)
        + (baseInput.cacheCreationInputTokens ?? 0)
        + (baseInput.cacheReadInputTokens ?? 0)
        + (baseInput.cachedTokens ?? 0)
      if (usageMagnitude <= 0) {
        skipped += 1
        const warning = `Token usage candidate did not contain positive token counts: ${relativePath}${candidate.pointer || '/'}`
        warnings.push(warning)
        sources.push({
          file: filePath,
          pointer: candidate.pointer || '/',
          status: 'skipped',
          medicalLane,
          provider,
          model,
          totalTokens: 0,
          warning,
        })
        continue
      }

      const ingestKey = usageId
        ? `usage_id:${usageId}`
        : [
            relativePath,
            candidate.pointer || '/',
            provider,
            model ?? '',
            baseInput.inputTokens ?? 0,
            baseInput.outputTokens ?? 0,
            baseInput.cacheCreationInputTokens ?? 0,
            baseInput.cacheReadInputTokens ?? 0,
            baseInput.cachedTokens ?? 0,
            baseInput.estimatedCostUsd ?? '',
          ].join('|')
      if (seen.has(ingestKey)) {
        duplicates += 1
        sources.push({
          file: filePath,
          pointer: candidate.pointer || '/',
          status: 'duplicate',
          medicalLane,
          provider,
          model,
          totalTokens: (baseInput.inputTokens ?? 0) + (baseInput.outputTokens ?? 0),
        })
        continue
      }

      const metadata: Record<string, string | number | boolean> = {
        source_path: relativePath,
        source_pointer: candidate.pointer || '/',
        source_role: sourceRole,
        medical_lane: medicalLane,
        ingest_key: ingestKey,
      }
      if (options.target) metadata.target = String(options.target)
      if (options.disease) metadata.disease = String(options.disease)
      if (usageId) metadata.usage_id = usageId
      const phase = firstString(candidate.payload, ['phase', 'gate', 'role'])
      if (phase) metadata.phase = phase

      const record = ledger.record({
        ...baseInput,
        metadata,
      })
      seen.add(ingestKey)
      records.push(record)
      sources.push({
        file: filePath,
        pointer: candidate.pointer || '/',
        status: 'recorded',
        medicalLane,
        provider,
        model,
        totalTokens: record.totalTokens,
        recordId: record.id,
      })
    }
  }

  const tokenCost = buildTargetTokenCostReport({
    projectDir: root,
    sinceDays: undefined,
    limit: options.limit ?? 20,
  })
  const recorded = records.length
  const status: TargetTokenUsageIngestReport['status'] = recorded > 0 || duplicates > 0
    ? 'ready'
    : warnings.length > 0
      ? 'warning'
      : 'pending'
  return {
    schema: 'medscale.token_ingest.v1',
    status,
    ok: recorded > 0 || duplicates > 0,
    generatedAt: new Date().toISOString(),
    workspaceRoot: root,
    usagePath: targetUsagePath(root),
    scannedFiles: resolved.files,
    recorded,
    duplicates,
    skipped,
    warnings: uniqueStrings(warnings),
    sources,
    records,
    tokenCost,
  }
}

function resolveTargetTokenIngestFiles(
  root: string,
  options: TargetTokenUsageIngestOptions,
): { files: string[]; warnings: string[] } {
  const warnings: string[] = []
  const explicitFiles = splitTokenIngestFiles(options.files ?? [])
  if (explicitFiles.length > 0) {
    const files = explicitFiles.map(file => resolveTokenIngestFilePath(root, file))
    return {
      files: uniqueStrings(files.filter(file => {
        if (existsSync(file)) return true
        warnings.push(`Token usage artifact does not exist: ${file}`)
        return false
      })),
      warnings,
    }
  }

  const target = stringValue(options.target)
  const disease = stringValue(options.disease)
  if (target && disease) {
    const plan = resolveTargetMemorySeedPlan({
      projectDir: root,
      output: options.output,
      target,
      disease,
    })
    return {
      files: uniqueStrings([plan.manifestPath, ...plan.sourceFiles].filter((file): file is string => Boolean(file))),
      warnings: [...plan.warnings],
    }
  }

  const platform = resolveTargetPlatform(root)
  if (!platform) {
    return {
      files: [],
      warnings: ['target-research-platform not found; pass --file or run from a MedSCALE workspace.'],
    }
  }
  const manuscriptsDir = join(resolveTargetOutputDir(platform, options.output), 'manuscripts')
  if (!existsSync(manuscriptsDir)) {
    return {
      files: [],
      warnings: ['Manuscripts output directory does not exist yet; pass --file or run a medical workflow first.'],
    }
  }
  return {
    files: readdirSync(manuscriptsDir)
      .filter(name => name.endsWith('.json'))
      .map(name => join(manuscriptsDir, name)),
    warnings,
  }
}

function splitTokenIngestFiles(values: string[]): string[] {
  return values
    .flatMap(value => String(value).split(/[;,]/g))
    .map(value => value.trim())
    .filter(Boolean)
}

function resolveTokenIngestFilePath(root: string, file: string): string {
  const cwdPath = resolve(file)
  return existsSync(cwdPath) ? cwdPath : resolve(root, file)
}

function collectTargetTokenUsageCandidates(filePath: string, payload: Record<string, unknown>): TargetTokenUsageCandidate[] {
  const candidates: TargetTokenUsageCandidate[] = []
  const visit = (value: unknown, pointer: string): void => {
    const record = asRecord(value)
    if (record) {
      if (hasKnownTokenUsagePayload(record)) {
        candidates.push({ filePath, pointer, payload: record })
        return
      }
      for (const [key, item] of Object.entries(record)) {
        visit(item, jsonPointerChild(pointer, key))
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, jsonPointerChild(pointer, String(index))))
    }
  }
  visit(payload, '')
  return candidates
}

function hasKnownTokenUsagePayload(value: Record<string, unknown>): boolean {
  const response = asRecord(value.response)
  const result = asRecord(value.result)
  const data = asRecord(value.data)
  const candidates = [
    value,
    asRecord(value.usage),
    response ? asRecord(response.usage) : null,
    result ? asRecord(result.usage) : null,
    data ? asRecord(data.usage) : null,
  ].filter((item): item is Record<string, unknown> => Boolean(item))
  return candidates.some(candidate => TOKEN_USAGE_FIELD_PATHS.some(path => numberAtPath(candidate, path) !== null))
}

function numberAtPath(record: Record<string, unknown>, path: string[]): number | null {
  let current: unknown = record
  for (const key of path) {
    const currentRecord = asRecord(current)
    if (!currentRecord || !(key in currentRecord)) return null
    current = currentRecord[key]
  }
  return toNumber(current)
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toNumber(record[key])
    if (value !== null && value >= 0) return value
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function jsonPointerChild(pointer: string, key: string): string {
  const encoded = key.replace(/~/g, '~0').replace(/\//g, '~1')
  return pointer ? `${pointer}/${encoded}` : `/${encoded}`
}

function normalizedRelativePath(root: string, filePath: string): string {
  return relative(root, filePath).replace(/\\/g, '/')
}

function inferTokenUsageLane(filePath: string, pointer: string, payload: Record<string, unknown>): string {
  const haystack = [
    filePath,
    pointer,
    firstString(payload, ['medical_lane', 'medicalLane', 'lane', 'source_role', 'sourceRole', 'phase', 'gate', 'role', 'task_id', 'taskId']) ?? '',
  ].join(' ').toLowerCase()
  if (/literature|pubmed|openalex|evidence/.test(haystack)) return 'literature'
  if (/fact|claim|check|verification/.test(haystack)) return 'fact_check'
  if (/package|audit|delivery|manifest|zip/.test(haystack)) return 'package_audit'
  if (/memory|gbrain|learning|candidate/.test(haystack)) return 'memory'
  if (/agent|review|handoff|peer/.test(haystack)) return 'agent_review'
  return 'workflow'
}

function inferTokenUsageSourceRole(filePath: string, payload: Record<string, unknown>): string {
  const explicit = firstString(payload, ['source_role', 'sourceRole', 'role', 'phase', 'gate'])
  if (explicit) return explicit
  const name = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (name.includes('fact')) return 'manuscript_fact_check'
  if (name.includes('quality')) return 'manuscript_quality'
  if (name.includes('agent_reviews')) return 'agent_reviews'
  if (name.includes('review_tasks')) return 'agent_review_tasks'
  if (name.includes('memory_seed')) return 'memory_seed'
  if (name.includes('learning_candidate')) return 'learning_candidate'
  if (name.includes('delivery_manifest')) return 'delivery_manifest'
  return 'token_usage_artifact'
}

function enabledProvider(config: Record<string, unknown> | null, id: string): Record<string, unknown> {
  const providers = Array.isArray(config?.providers) ? config.providers : []
  const found = providers.find(provider => {
    return provider && typeof provider === 'object' && !Array.isArray(provider) && (provider as Record<string, unknown>).id === id
  })
  return found && typeof found === 'object' && !Array.isArray(found) ? found as Record<string, unknown> : {}
}

function buildRuntimeMemoryCard(root: string, env: NodeJS.ProcessEnv): TargetRuntimeReadinessCard {
  const config = readWorkspaceJson(root, '.scale/memory-providers.json')
  const routing = config?.routing && typeof config.routing === 'object' && !Array.isArray(config.routing)
    ? config.routing as Record<string, unknown>
    : {}
  const defaultOrder = Array.isArray(routing.defaultOrder) ? routing.defaultOrder.map(String) : []
  const gbrain = enabledProvider(config, 'gbrain')
  const scaleLocal = enabledProvider(config, 'scale-local')
  const agentmemory = enabledProvider(config, 'agentmemory')
  const gbrainPath = findCommandPath('gbrain', env)
  const details = [
    `routing=${String(routing.mode ?? 'missing')}; order=${defaultOrder.length ? defaultOrder.join(',') : 'missing'}`,
    `gbrain=${gbrain.enabled ? 'enabled' : 'disabled'}; command=${gbrainPath ? 'found' : 'missing'}; write=${String(gbrain.writeMode ?? 'unknown')}`,
    `scale-local=${scaleLocal.enabled ? 'enabled' : 'disabled'}; write=${String(scaleLocal.writeMode ?? 'unknown')}`,
    `agentmemory=${agentmemory.enabled ? 'enabled' : 'disabled'}`,
  ]
  if (!config) {
    return runtimeCard(
      'third_party_memory',
      'Third-party memory',
      'warning',
      'CONFIG MISSING',
      'External memory routing is not configured; the native medical workflow can still run.',
      details,
      'Add a medical memory provider config when recall and memory review are needed.',
      false,
    )
  }
  if (!gbrain.enabled || !gbrainPath) {
    return runtimeCard(
      'third_party_memory',
      'Third-party memory',
      'warning',
      'GBRAIN OPTIONAL',
      'gbrain is unavailable, so recall and memory review will stay local or pending.',
      details,
      'Install or enable gbrain only if this study needs cross-session memory recall.',
      false,
    )
  }
  return runtimeCard(
    'third_party_memory',
    'Third-party memory',
    'pass',
    'GBRAIN READY',
    'External-first memory routing is available for governed research recall.',
    details,
    'Next: expose provider recall and Memory Brain review transitions.',
    false,
  )
}

function buildRuntimeCodeIntelligenceCard(root: string, env: NodeJS.ProcessEnv): TargetRuntimeReadinessCard {
  const config = readWorkspaceJson(root, '.scale/code-intelligence.json')
  const codegraphPath = findCommandPath('codegraph', env)
  const graphifyPath = findCommandPath('graphify', env)
  const codegraphDb = join(root, '.codegraph', 'codegraph.db')
  const graphifyManifest = join(root, 'graphify-out', 'manifest.json')
  const details = [
    `codegraph_command=${codegraphPath ? 'found' : 'missing'}`,
    `codegraph_db=${existsSync(codegraphDb) ? 'present' : 'missing'}`,
    `graphify_command=${graphifyPath ? 'found' : 'missing'}`,
    `graphify_manifest=${existsSync(graphifyManifest) ? 'present' : 'missing'}`,
    `config=${config ? 'present' : 'missing'}`,
  ]
  if (!codegraphPath) {
    return runtimeCard(
      'code_intelligence',
      'Code and knowledge graph',
      'warning',
      'CODEGRAPH OPTIONAL',
      'CodeGraph is not available; MedSCALE will use manifest and file-based evidence instead.',
      details,
      'Install CodeGraph only if graph-backed research inspection is needed.',
      false,
    )
  }
  if (!graphifyPath || !existsSync(graphifyManifest)) {
    return runtimeCard(
      'code_intelligence',
      'Code and knowledge graph',
      'warning',
      'GRAPH DEGRADED',
    'Code intelligence is partially available, but Graphify is not fully initialized.',
    details,
    'Run graphify install/status and regenerate the artifact graph.',
    false,
  )
  }
  return runtimeCard(
    'code_intelligence',
    'Code and knowledge graph',
    'pass',
    'GRAPH READY',
    'CodeGraph and Graphify signals are available for research workflow inspection.',
    details,
    'Next: render evidence graph status in the MedSCALE dashboard.',
    false,
  )
}

function buildRuntimeCliCard(env: NodeJS.ProcessEnv): TargetRuntimeReadinessCard {
  const probes = {
    python: findCommandPath('python', env),
    uv: findCommandPath('uv', env),
    node: findCommandPath('node', env),
  }
  const details = Object.entries(probes).map(([name, path]) => `${name}=${path ? 'found' : 'missing'}`)
  if (!probes.python) {
    return runtimeCard(
      'cli_runtime',
      'Native medical runtime',
      'fail',
      'RUNTIME MISSING',
      'Python is required to run the standalone medical research workflow.',
      details,
      'Restore Python 3.10+ PATH availability before running the medical platform.',
      true,
    )
  }
  if (!probes.uv) {
    return runtimeCard(
      'cli_runtime',
      'Native medical runtime',
      'warning',
      'PYTHON READY',
      'Python is available; uv is optional but recommended for reproducible medical dependencies.',
      details,
      'Use pip or install uv for faster isolated dependency setup.',
      true,
    )
  }
  return runtimeCard(
    'cli_runtime',
    'Native medical runtime',
    'pass',
    'PYTHON READY',
    'Native medical workflow runtime is available without an external governance CLI.',
    details,
    'Next: expose med-research os-plan, mcp doctor, and token report commands.',
    true,
  )
}

function buildRuntimeSkillsCard(root: string): TargetRuntimeReadinessCard {
  const config = readWorkspaceJson(root, '.scale/skills.json')
  const policy = config?.policy && typeof config.policy === 'object' && !Array.isArray(config.policy)
    ? config.policy as Record<string, unknown>
    : {}
  const domains = config?.domains && typeof config.domains === 'object' && !Array.isArray(config.domains)
    ? config.domains as Record<string, unknown>
    : {}
  const requiredMedicalDomains = [
    'medicalLiteratureReview',
    'medicalFactCheck',
    'medicalEvidenceGrading',
    'medicalStatisticalReview',
    'medicalPackageAudit',
    'medicalMemoryCurator',
  ]
  const missingDomains = requiredMedicalDomains.filter(domain => !(domain in domains))
  const details = [
    `policy=${String(policy.mode ?? 'missing')}`,
    `domain_count=${Object.keys(domains).length}`,
    `missing_medical_domains=${missingDomains.length ? missingDomains.join(',') : 'none'}`,
  ]
  if (!config) {
    return runtimeCard(
      'medical_skills',
      'Medical skills',
      'warning',
      'SKILLS MISSING',
      'Skill governance is not configured for this workspace.',
      details,
      'Add medical skill domains for literature review, fact check, evidence grading, statistics, package audit, and memory curation.',
      false,
    )
  }
  if (missingDomains.length > 0) {
    return runtimeCard(
      'medical_skills',
      'Medical skills',
      'warning',
      'MEDICAL DOMAINS MISSING',
      'Generic skill governance exists, but medical research roles are not first-class skill domains.',
      details,
      'Add the six MedSCALE medical skill domains and required evidence artifacts.',
      false,
    )
  }
  return runtimeCard(
    'medical_skills',
    'Medical skills',
    'pass',
    'SKILLS READY',
    'Medical research skill domains are configured.',
    details,
    'Next: bind each delivery gate to required skill evidence.',
    false,
  )
}

function buildRuntimeMcpCard(root: string): TargetRuntimeReadinessCard {
  const configDir = join(root, 'mcp-configs')
  const entries = existsSync(configDir)
    ? readdirSync(configDir).filter(name => !name.startsWith('_'))
    : []
  const serverYaml = join(root, '.scale', 'mcp-servers.yaml')
  const serverYamlText = readTextIfPresent(serverYaml)
  const requiredMedicalRoutes = [
    'medical-literature',
    'medical-fact-check',
    'medical-memory-review',
    'medical-package-audit',
    'medical-evidence-manifest',
  ]
  const missingMedicalRoutes = requiredMedicalRoutes.filter(route => !serverYamlText.includes(route))
  const details = [
    `mcp_config_count=${entries.length}`,
    `mcp_servers_yaml=${existsSync(serverYaml) ? 'present' : 'missing'}`,
    `missing_medical_routes=${missingMedicalRoutes.length ? missingMedicalRoutes.join(',') : 'none'}`,
    `memory_config=${existsSync(join(configDir, 'memory')) || existsSync(join(configDir, 'memory.json')) ? 'present' : 'missing'}`,
    `playwright_config=${existsSync(join(configDir, 'playwright')) || existsSync(join(configDir, 'playwright.json')) ? 'present' : 'missing'}`,
  ]
  if (entries.length === 0) {
    return runtimeCard(
      'mcp_surface',
      'MCP surface',
      'warning',
      'MCP MISSING',
      'No MCP configuration files were found for this workspace.',
      details,
      'Add MCP configs for memory, evidence manifests, browser checks, and medical retrieval.',
      false,
    )
  }
  if (!existsSync(serverYaml)) {
    return runtimeCard(
      'mcp_surface',
      'MCP surface',
      'warning',
      'MCP PARTIAL',
      'MCP configs exist, but the workspace has no MedSCALE server map contract.',
      details,
      'Add a native MedSCALE MCP server map and expose status in the medical doctor.',
      false,
    )
  }
  if (missingMedicalRoutes.length > 0) {
    return runtimeCard(
      'mcp_surface',
      'MCP surface',
      'warning',
      'MCP MEDICAL ROUTES MISSING',
      'MCP server map exists, but it does not yet declare the required MedSCALE medical routes.',
      details,
      'Add literature, fact-check, memory-review, package-audit, and evidence-manifest routes to the MedSCALE MCP server map.',
      false,
    )
  }
  return runtimeCard(
    'mcp_surface',
    'MCP surface',
    'pass',
    'MCP READY',
    'MCP configs and the MedSCALE medical server map are present.',
    details,
    'Next: wire these routes to live MCP tool health checks.',
    false,
  )
}

function buildRuntimeTokenCostCard(root: string): TargetRuntimeReadinessCard {
  const report = buildTargetTokenCostReport({ projectDir: root, sinceDays: undefined, limit: 5 })
  const cost = report.summary.estimatedCostUsd
  const details = [
    `usage_path=${report.usagePath}`,
    `records=${report.summary.totalRecords}`,
    `total_tokens=${report.summary.totalTokens}`,
    `cache_savings_tokens=${report.summary.cacheSavingsTokens}`,
    `estimated_cost_usd=${cost ?? 'unknown'}`,
    `medical_lanes=${report.byMedicalLane.length ? report.byMedicalLane.map(lane => lane.key).join(',') : 'none'}`,
  ]
  if (report.summary.totalRecords === 0) {
    return runtimeCard(
      'token_cost',
      'Token and cost ledger',
      'warning',
      'COST PENDING',
      'MedSCALE token/cost reporting is wired, but no medical model usage has been recorded yet.',
      details,
      'Record usage with medscale token record after literature review, fact check, package audit, agent review, and memory settlement.',
      false,
    )
  }
  return runtimeCard(
    'token_cost',
    'Token and cost ledger',
    'pass',
    'COST TRACKED',
    'MedSCALE has recorded model usage for cost and token review.',
    details,
    'Review medscale token report before package delivery and expert handoff.',
    false,
  )
}

function buildRuntimeMedicalRetrievalCard(root: string, platform: ResolvedTargetPlatform | null): TargetRuntimeReadinessCard {
  const platformDir = platform?.platformDir ?? join(root, 'target-research-platform')
  const pubmedClient = join(platformDir, 'src', 'api_clients', 'pubmed_client.py')
  const openalexClient = join(platformDir, 'src', 'api_clients', 'openalex_client.py')
  const literatureTests = join(platformDir, 'tests', 'test_literature_enrichment.py')
  const apiClientTests = join(platformDir, 'tests', 'test_api_clients.py')
  const details = [
    `pubmed_client=${existsSync(pubmedClient) ? 'present' : 'missing'}`,
    `openalex_client=${existsSync(openalexClient) ? 'present' : 'missing'}`,
    `literature_tests=${existsSync(literatureTests) ? 'present' : 'missing'}`,
    `api_client_tests=${existsSync(apiClientTests) ? 'present' : 'missing'}`,
  ]
  if (existsSync(pubmedClient) && existsSync(openalexClient) && (existsSync(literatureTests) || existsSync(apiClientTests))) {
    return runtimeCard(
      'medical_retrieval',
      'PubMed / OpenAlex retrieval',
      'pass',
      'RETRIEVAL READY',
      'PubMed and OpenAlex clients are present with test coverage for literature enrichment.',
      details,
      'Next: add live availability and rate-limit checks when credentials/network policy allow it.',
      false,
    )
  }
  return runtimeCard(
    'medical_retrieval',
    'PubMed / OpenAlex retrieval',
    'warning',
    'RETRIEVAL PARTIAL',
    'Medical retrieval clients or enrichment tests are missing from the native workflow.',
    details,
    'Add PubMed/OpenAlex clients and literature enrichment tests before external evidence review.',
    false,
  )
}

function buildRuntimePackageAuditCard(root: string, platform: ResolvedTargetPlatform | null): TargetRuntimeReadinessCard {
  const platformDir = platform?.platformDir ?? join(root, 'target-research-platform')
  const deliveryPackager = join(platformDir, 'src', 'output', 'delivery_packager.py')
  const deliveryManifestTests = join(platformDir, 'tests', 'test_delivery_manifest.py')
  const source = readTextIfPresent(deliveryPackager)
  const hasAudit = /audit_delivery_package/.test(source) && /hash_mismatches|broken_markdown_refs/.test(source)
  const details = [
    `delivery_packager=${existsSync(deliveryPackager) ? 'present' : 'missing'}`,
    `audit_delivery_package=${hasAudit ? 'present' : 'missing'}`,
    `delivery_manifest_tests=${existsSync(deliveryManifestTests) ? 'present' : 'missing'}`,
  ]
  if (hasAudit && existsSync(deliveryManifestTests)) {
    return runtimeCard(
      'package_audit',
      'Package audit',
      'pass',
      'AUDIT READY',
      'Delivery ZIP audit checks archive inventory, hashes, sizes, and markdown references.',
      details,
      'Run medscale package after manuscript generation to refresh audit evidence.',
      false,
    )
  }
  return runtimeCard(
    'package_audit',
    'Package audit',
    'warning',
    'AUDIT PARTIAL',
    'Delivery package audit is not yet a fully test-backed native doctor signal.',
    details,
    'Add package audit tests covering manifest inventory, hashes, and archive references.',
    false,
  )
}

function buildRuntimeFigureRefsCard(root: string, platform: ResolvedTargetPlatform | null): TargetRuntimeReadinessCard {
  const platformDir = platform?.platformDir ?? join(root, 'target-research-platform')
  const deliveryPackager = join(platformDir, 'src', 'output', 'delivery_packager.py')
  const qualityGate = join(platformDir, 'src', 'output', 'manuscript_quality.py')
  const packagerSource = readTextIfPresent(deliveryPackager)
  const qualitySource = readTextIfPresent(qualityGate)
  const archiveRefs = /broken_image_refs|image_refs_checked/.test(packagerSource)
  const bodyRefs = /figures\.referenced_in_text/.test(qualitySource)
  const details = [
    `archive_image_refs=${archiveRefs ? 'present' : 'missing'}`,
    `body_figure_refs=${bodyRefs ? 'present' : 'missing'}`,
    `quality_gate=${existsSync(qualityGate) ? 'present' : 'missing'}`,
  ]
  if (archiveRefs && bodyRefs) {
    return runtimeCard(
      'figure_refs',
      'Figure reference checks',
      'pass',
      'FIGURES READY',
      'Figure file presence, archive references, and in-text reference checks are native gates.',
      details,
      'Keep figure checks in package audit and manuscript quality tests before handoff.',
      false,
    )
  }
  return runtimeCard(
    'figure_refs',
    'Figure reference checks',
    'warning',
    'FIGURES PARTIAL',
    'Figure reference checks exist only partially across package audit and quality gates.',
    details,
    'Add explicit figure reference coverage for manuscript body and delivery archive paths.',
    false,
  )
}

function buildRuntimeMedicalWorkflowCard(root: string, platform: ResolvedTargetPlatform | null): TargetRuntimeReadinessCard {
  const platformDir = platform?.platformDir ?? join(root, 'target-research-platform')
  const details = [
    `platform=${existsSync(platformDir) ? 'present' : 'missing'}`,
    `main_py=${existsSync(join(platformDir, 'main.py')) ? 'present' : 'missing'}`,
    `requirements=${existsSync(join(platformDir, 'requirements.txt')) ? 'present' : 'missing'}`,
    `tests=${existsSync(join(platformDir, 'tests')) ? 'present' : 'missing'}`,
    `dashboard_os=${existsSync(join(platformDir, 'src', 'dashboard', 'app.py')) ? 'present' : 'missing'}`,
  ]
  if (!existsSync(platformDir) || !existsSync(join(platformDir, 'main.py'))) {
    return runtimeCard(
      'medical_workflow',
      'Medical workflow',
      'fail',
      'PLATFORM MISSING',
      'target-research-platform is required for MedSCALE Research OS.',
      details,
      'Restore target-research-platform before running the medical workflow.',
      true,
    )
  }
  if (!existsSync(join(platformDir, 'requirements.txt')) || !existsSync(join(platformDir, 'tests'))) {
    return runtimeCard(
      'medical_workflow',
      'Medical workflow',
      'warning',
      'WORKFLOW PARTIAL',
      'The medical platform exists, but dependency or test evidence is incomplete.',
      details,
      'Add medical pytest coverage to the default verification profile.',
      true,
    )
  }
  return runtimeCard(
    'medical_workflow',
    'Medical workflow',
    'pass',
    'WORKFLOW READY',
    'Medical platform files, dependencies, and tests are discoverable.',
    details,
    'Next: include target-research-platform pytest in native medical verification.',
    true,
  )
}

function runtimeReadinessScore(cards: TargetRuntimeReadinessCard[]): number {
  if (cards.length === 0) return 0
  const weights: Record<TargetRuntimeReadinessCard['state'], number> = {
    pass: 100,
    warning: 55,
    pending: 25,
    fail: 0,
  }
  return Math.round(cards.reduce((sum, card) => sum + weights[card.state], 0) / cards.length)
}

export function buildTargetRuntimeReadiness(
  projectDir: string = PROJECT_DIR,
  env: NodeJS.ProcessEnv = process.env,
): TargetRuntimeReadiness {
  const root = resolveTargetWorkspaceRoot(projectDir)
  const platform = resolveTargetPlatform(root)
  const cards = [
    buildRuntimeMemoryCard(root, env),
    buildRuntimeCodeIntelligenceCard(root, env),
    buildRuntimeCliCard(env),
    buildRuntimeSkillsCard(root),
    buildRuntimeMcpCard(root),
    buildRuntimeTokenCostCard(root),
    buildRuntimeMedicalRetrievalCard(root, platform),
    buildRuntimePackageAuditCard(root, platform),
    buildRuntimeFigureRefsCard(root, platform),
    buildRuntimeMedicalWorkflowCard(root, platform),
  ]
  const requiredMissing = cards
    .filter(card => card.required && card.state === 'fail')
    .flatMap(card => card.details)
  const warningCount = cards.filter(card => card.state === 'warning').length
  const failCount = cards.filter(card => card.state === 'fail').length
  const status: TargetRuntimeReadiness['status'] = requiredMissing.length > 0
    ? 'blocked'
    : (warningCount > 0 || failCount > 0 ? 'degraded' : 'ready')
  const recommendations = cards
    .filter(card => (card.state === 'fail' || card.state === 'warning') && card.nextAction)
    .map(card => card.nextAction)
  return {
    schema: 'medscale.runtime_readiness.v1',
    status,
    score: runtimeReadinessScore(cards),
    workspaceRoot: root,
    requiredMissing,
    warningCount,
    failCount,
    cards,
    recommendations: recommendations.length ? recommendations.slice(0, 6) : ['Run the native MedSCALE doctor before external expert review.'],
  }
}

export type TargetSetupPlatform = 'windows' | 'macos' | 'linux'
export type TargetSetupCapabilityStatus = 'ready' | 'partial' | 'missing' | 'planned'
export type TargetSetupCapabilityCategory =
  | 'runtime'
  | 'memory'
  | 'skills'
  | 'mcp'
  | 'code-map'
  | 'knowledge'
  | 'medical-evidence'
  | 'audit'
  | 'economics'

export interface TargetSetupCommandMatrix {
  windows: string | null
  unix: string | null
  selected: string | null
}

export interface TargetSetupCapability {
  id: string
  title: string
  category: TargetSetupCapabilityCategory
  status: TargetSetupCapabilityStatus
  required: boolean
  summary: string
  evidence: string[]
  install: TargetSetupCommandMatrix
  verify: TargetSetupCommandMatrix
  nextAction: string
}

export interface TargetSetupPlan {
  schema: 'medscale.setup_plan.v1'
  product: 'MedSCALE Research OS'
  lang: ScaleLanguage
  platform: TargetSetupPlatform
  status: 'ready' | 'degraded' | 'blocked'
  mode: 'plan-only'
  workspaceRoot: string
  runtimeReadiness: TargetRuntimeReadiness
  commands: {
    local: string
    localJson: string
    npx: string
    npxJson: string
    visual: string
  }
  summary: {
    ready: number
    partial: number
    missing: number
    planned: number
    requiredMissing: string[]
  }
  capabilities: TargetSetupCapability[]
  nextSteps: string[]
  notes: string[]
}

export interface TargetSetupApplyEntry {
  id: string
  source: string
  destination: string
  status: 'copied' | 'skipped' | 'missing'
}

export interface TargetSetupApplyReport {
  schema: 'medscale.setup_apply.v1'
  ok: boolean
  product: 'MedSCALE Research OS'
  workspaceRoot: string
  packageRoot: string
  copied: number
  skipped: number
  missing: number
  entries: TargetSetupApplyEntry[]
  nextCommands: string[]
  warnings: string[]
}

function detectSetupPlatform(value?: unknown): TargetSetupPlatform {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'windows' || raw === 'win' || raw === 'win32') return 'windows'
  if (raw === 'macos' || raw === 'darwin' || raw === 'mac') return 'macos'
  if (raw === 'linux') return 'linux'
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

function selectedCommand(platform: TargetSetupPlatform, windows: string | null, unix: string | null): TargetSetupCommandMatrix {
  const selected = platform === 'windows' ? windows : unix
  return { windows, unix, selected }
}

function targetText<T>(lang: ScaleLanguage, zh: T, en: T): T {
  return lang === 'zh' ? zh : en
}

function runtimeCardById(readiness: TargetRuntimeReadiness, id: string): TargetRuntimeReadinessCard | null {
  return readiness.cards.find(card => card.id === id) ?? null
}

function runtimeDetailValue(card: TargetRuntimeReadinessCard | null, key: string): string | null {
  const prefix = `${key}=`
  const found = card?.details.find(item => item.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function setupStatusFromRuntimeState(card: TargetRuntimeReadinessCard | null): TargetSetupCapabilityStatus {
  if (!card) return 'missing'
  if (card.state === 'pass') return 'ready'
  if (card.state === 'warning' || card.state === 'pending') return 'partial'
  return card.required ? 'missing' : 'partial'
}

function readTextIfPresent(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : ''
  } catch {
    return ''
  }
}

function shouldCopyMedscaleTemplate(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, '/')
  const excluded = [
    '/target-research-platform/output',
    '/target-research-platform/output/',
    '/target-research-platform/cache',
    '/target-research-platform/cache/',
    '/target-research-platform/.pytest_cache',
    '/target-research-platform/.pytest_cache/',
    '/target-research-platform/.tmp-pytest',
    '/target-research-platform/.tmp-pytest/',
    '/target-research-platform/provenance_logs',
    '/target-research-platform/provenance_logs/',
    '/__pycache__/',
    '/.git/',
  ]
  if (excluded.some(part => normalized.includes(part))) return false
  return !/\.py[cod]$/i.test(normalized)
}

function copySetupEntry(options: {
  id: string
  source: string
  destination: string
}): TargetSetupApplyEntry {
  const source = resolve(options.source)
  const destination = resolve(options.destination)
  if (!existsSync(source)) {
    return { id: options.id, source, destination, status: 'missing' }
  }
  if (existsSync(destination)) {
    return { id: options.id, source, destination, status: 'skipped' }
  }
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: shouldCopyMedscaleTemplate,
  })
  return { id: options.id, source, destination, status: 'copied' }
}

export function applyTargetSetup(options: {
  projectDir: string
  packageRoot?: string
  lang?: unknown
}): TargetSetupApplyReport {
  const workspaceRoot = resolve(options.projectDir)
  const packageRoot = resolve(options.packageRoot ?? PACKAGE_ROOT)
  const lang = normalizeLanguage(options.lang)
  mkdirSync(workspaceRoot, { recursive: true })

  const entries = [
    copySetupEntry({
      id: 'target-research-platform',
      source: join(packageRoot, 'target-research-platform'),
      destination: join(workspaceRoot, 'target-research-platform'),
    }),
    copySetupEntry({
      id: 'scale-skills',
      source: join(packageRoot, '.scale', 'skills.json'),
      destination: join(workspaceRoot, '.scale', 'skills.json'),
    }),
    copySetupEntry({
      id: 'scale-mcp-servers',
      source: join(packageRoot, '.scale', 'mcp-servers.yaml'),
      destination: join(workspaceRoot, '.scale', 'mcp-servers.yaml'),
    }),
    copySetupEntry({
      id: 'scale-verification',
      source: join(packageRoot, '.scale', 'verification.json'),
      destination: join(workspaceRoot, '.scale', 'verification.json'),
    }),
    copySetupEntry({
      id: 'mcp-configs',
      source: join(packageRoot, 'mcp-configs'),
      destination: join(workspaceRoot, 'mcp-configs'),
    }),
    copySetupEntry({
      id: 'medscale-docs',
      source: join(packageRoot, 'docs'),
      destination: join(workspaceRoot, 'docs'),
    }),
  ]
  const copied = entries.filter(entry => entry.status === 'copied').length
  const skipped = entries.filter(entry => entry.status === 'skipped').length
  const missing = entries.filter(entry => entry.status === 'missing').length
  const warnings = entries
    .filter(entry => entry.status === 'missing')
    .map(entry => targetText(lang, `初始化源缺失: ${entry.id}`, `Missing setup source: ${entry.id}`))

  return {
    schema: 'medscale.setup_apply.v1',
    ok: missing === 0,
    product: 'MedSCALE Research OS',
    workspaceRoot,
    packageRoot,
    copied,
    skipped,
    missing,
    entries,
    nextCommands: [
      `medscale doctor --dir "${workspaceRoot}" --json`,
      `medscale setup --dir "${workspaceRoot}" --visual --lang ${lang}`,
      `cd "${join(workspaceRoot, 'target-research-platform')}" && python -m pip install -r requirements.txt`,
    ],
    warnings,
  }
}

function setupCapability(options: {
  id: string
  title: string
  category: TargetSetupCapabilityCategory
  status: TargetSetupCapabilityStatus
  required?: boolean
  summary: string
  evidence: string[]
  installWindows?: string | null
  installUnix?: string | null
  verifyWindows?: string | null
  verifyUnix?: string | null
  nextAction: string
  platform: TargetSetupPlatform
}): TargetSetupCapability {
  return {
    id: options.id,
    title: options.title,
    category: options.category,
    status: options.status,
    required: Boolean(options.required),
    summary: options.summary,
    evidence: options.evidence,
    install: selectedCommand(options.platform, options.installWindows ?? null, options.installUnix ?? null),
    verify: selectedCommand(options.platform, options.verifyWindows ?? null, options.verifyUnix ?? null),
    nextAction: options.nextAction,
  }
}

function buildSetupCommands(lang: ScaleLanguage): TargetSetupPlan['commands'] {
  const packageName = '@hongmaple0820/med-scale-research-os'
  return {
    local: `npm run medscale -- setup --lang ${lang}`,
    localJson: `npm run medscale -- setup --lang ${lang} --json`,
    npx: `npx -y ${packageName} setup --lang ${lang}`,
    npxJson: `npx -y ${packageName} setup --lang ${lang} --json`,
    visual: `npx -y ${packageName} setup --visual --lang ${lang}`,
  }
}

function buildTargetSetupCapabilities(options: {
  root: string
  platform: TargetSetupPlatform
  lang: ScaleLanguage
  env: NodeJS.ProcessEnv
  readiness: TargetRuntimeReadiness
}): TargetSetupCapability[] {
  const { root, platform, lang, env, readiness } = options
  const memoryCard = runtimeCardById(readiness, 'third_party_memory')
  const codeCard = runtimeCardById(readiness, 'code_intelligence')
  const cliCard = runtimeCardById(readiness, 'cli_runtime')
  const skillsCard = runtimeCardById(readiness, 'medical_skills')
  const mcpCard = runtimeCardById(readiness, 'mcp_surface')
  const workflowCard = runtimeCardById(readiness, 'medical_workflow')
  const retrievalCard = runtimeCardById(readiness, 'medical_retrieval')
  const packageAuditCard = runtimeCardById(readiness, 'package_audit')
  const figureRefsCard = runtimeCardById(readiness, 'figure_refs')
  const codegraphCommand = runtimeDetailValue(codeCard, 'codegraph_command')
  const codegraphDb = runtimeDetailValue(codeCard, 'codegraph_db')
  const graphifyCommand = runtimeDetailValue(codeCard, 'graphify_command')
  const graphifyManifest = runtimeDetailValue(codeCard, 'graphify_manifest')
  const mcpConfigCount = Number(runtimeDetailValue(mcpCard, 'mcp_config_count') ?? 0)
  const mcpServerYaml = runtimeDetailValue(mcpCard, 'mcp_servers_yaml')
  const agentmemory = runtimeDetailValue(memoryCard, 'agentmemory')
  const gbrainCommand = runtimeDetailValue(memoryCard, 'gbrain')?.includes('command=found')
  const platformDir = resolveTargetPlatform(root)?.platformDir ?? join(root, 'target-research-platform')
  const pubmedClient = join(platformDir, 'src', 'api_clients', 'pubmed_client.py')
  const openalexClient = join(platformDir, 'src', 'api_clients', 'openalex_client.py')
  const deliveryPackager = join(platformDir, 'src', 'output', 'delivery_packager.py')
  const rtkPath = findCommandPath('rtk', env)
  const packageJson = readJsonFile(join(root, 'package.json'))
  const packageName = typeof packageJson?.name === 'string' ? packageJson.name : 'missing'
  const medscaleBinReady = existsSync(join(root, 'package.json')) && readTextIfPresent(join(root, 'package.json')).includes('"medscale"')
  const medscalePackageReady = packageName === '@hongmaple0820/med-scale-research-os' && medscaleBinReady
  const tokenCostReport = buildTargetTokenCostReport({ projectDir: root, sinceDays: undefined, limit: 5 })

  return [
    setupCapability({
      id: 'native-cli',
      title: targetText(lang, 'MedSCALE 原生 CLI', 'MedSCALE native CLI'),
      category: 'runtime',
      status: cliCard?.state === 'fail' ? 'missing' : (medscaleBinReady ? 'ready' : 'partial'),
      required: true,
      summary: targetText(
        lang,
        '医学工作流已经有 medscale 入口；基础运行只要求 Python 和医学平台目录。',
        'The medical workflow has a medscale entrypoint; the base runtime only requires Python and the medical platform.',
      ),
      evidence: [
        `cli_runtime=${cliCard?.statusLabel ?? 'missing'}`,
        `medscale_bin=${medscaleBinReady ? 'present' : 'missing'}`,
      ],
      installWindows: 'npm install && npm run build',
      installUnix: 'npm install && npm run build',
      verifyWindows: 'npm run medscale -- doctor --json',
      verifyUnix: 'npm run medscale -- doctor --json',
      nextAction: targetText(lang, '继续用 medscale doctor / setup / os-plan 作为医学工作流入口。', 'Use medscale doctor / setup / os-plan as the medical workflow entrypoints.'),
      platform,
    }),
    setupCapability({
      id: 'npx-visual-installer',
      title: targetText(lang, 'npx 可视化安装入口', 'npx visual installer'),
      category: 'runtime',
      status: medscalePackageReady ? 'partial' : 'planned',
      required: true,
      summary: targetText(
        lang,
        '本地可视化 setup 入口已经可用；公开 npx 体验仍需要首次发布。',
        'The local visual setup entrypoint is available; the public npx experience still needs the first publish.',
      ),
      evidence: [`package_name=${packageName}`, `medscale_bin=${medscaleBinReady ? 'present' : 'missing'}`, 'visual_command=present', 'public_npx_publish=pending'],
      installWindows: 'npm run medscale -- setup --visual --lang zh',
      installUnix: 'npm run medscale -- setup --visual --lang zh',
      verifyWindows: 'npm run medscale -- setup --json',
      verifyUnix: 'npm run medscale -- setup --json',
      nextAction: targetText(lang, '首次发布 npm 包后，用 npx -y 验证跨平台 setup --visual 体验。', 'After the first npm publish, verify the cross-platform setup --visual flow with npx -y.'),
      platform,
    }),
    setupCapability({
      id: 'gbrain',
      title: 'gbrain',
      category: 'memory',
      status: gbrainCommand && memoryCard?.state === 'pass' ? 'ready' : setupStatusFromRuntimeState(memoryCard),
      required: true,
      summary: targetText(
        lang,
        '默认外部记忆供应商，用于跨会话医学证据召回；缺失时不阻断本地医学工作流。',
        'Default external memory provider for cross-session medical evidence recall; missing gbrain does not block the local medical workflow.',
      ),
      evidence: memoryCard?.details ?? ['third_party_memory=missing'],
      installWindows: 'gbrain init --pglite',
      installUnix: 'gbrain init --pglite',
      verifyWindows: 'gbrain doctor --json',
      verifyUnix: 'gbrain doctor --json',
      nextAction: targetText(lang, '先保持只读召回和候选写入，后续接 approve/reject/stale/restore 审核流。', 'Keep recall read-only and writes candidate-only, then wire approve/reject/stale/restore review states.'),
      platform,
    }),
    setupCapability({
      id: 'agentmemory',
      title: 'agentmemory',
      category: 'memory',
      status: agentmemory?.includes('enabled') ? 'partial' : 'missing',
      required: true,
      summary: targetText(
        lang,
        '第二记忆供应商槽位已在规划内，但当前工作区没有启用为医学记忆路由。',
        'A secondary memory provider slot is planned, but this workspace has not enabled it for medical memory routing.',
      ),
      evidence: [`agentmemory=${agentmemory ?? 'missing'}`],
      installWindows: 'npx -y @agentmemory/agentmemory --help',
      installUnix: 'npx -y @agentmemory/agentmemory --help',
      verifyWindows: 'npm run medscale -- setup --json',
      verifyUnix: 'npm run medscale -- setup --json',
      nextAction: targetText(lang, '先以 gbrain 为主，agentmemory 作为团队共享记忆的必需后备。', 'Keep gbrain primary and use agentmemory as a required shared-memory fallback.'),
      platform,
    }),
    setupCapability({
      id: 'memory-brain-review',
      title: targetText(lang, 'Memory Brain 审核流', 'Memory Brain review flow'),
      category: 'memory',
      status: 'ready',
      required: true,
      summary: targetText(
        lang,
        'memory seed、learning candidate、approve/reject/stale/restore 已有原生审核状态和审计记录。',
        'Memory seed, learning candidates, and approve/reject/stale/restore now have native review states and audit records.',
      ),
      evidence: ['remember_command=present', 'learn_command=present', 'memory_review_command=present', 'review_transitions=approve,reject,stale,restore'],
      installWindows: 'npm run medscale -- learn --help',
      installUnix: 'npm run medscale -- learn --help',
      verifyWindows: 'npm run medscale -- memory-review --help',
      verifyUnix: 'npm run medscale -- memory-review --help',
      nextAction: targetText(lang, '下一阶段把审核状态映射到 18766 医学研究者视图。', 'Next, map review status into the 18766 researcher view.'),
      platform,
    }),
    setupCapability({
      id: 'rtk',
      title: 'RTK',
      category: 'runtime',
      status: rtkPath ? 'ready' : 'missing',
      required: true,
      summary: targetText(
        lang,
        'RTK 可作为命令包装、压缩和外部工具治理层，但不再是 MedSCALE 医学工作流的必需运行时。',
        'RTK can serve as a command wrapper, compression, and external tool governance layer, but it is no longer required for MedSCALE runtime.',
      ),
      evidence: [`rtk=${rtkPath ? 'found' : 'missing'}`],
      installWindows: 'cargo install --git https://github.com/rtk-ai/rtk',
      installUnix: 'cargo install --git https://github.com/rtk-ai/rtk',
      verifyWindows: 'rtk --version',
      verifyUnix: 'rtk --version',
      nextAction: targetText(lang, '需要命令证据压缩时再启用；不要把它放回必需依赖。', 'Enable it only for command evidence compression; do not move it back into required dependencies.'),
      platform,
    }),
    setupCapability({
      id: 'codegraph',
      title: 'CodeGraph',
      category: 'code-map',
      status: codegraphCommand === 'found' && codegraphDb === 'present' ? 'ready' : (codegraphCommand === 'found' || codegraphDb === 'present' ? 'partial' : 'missing'),
      required: true,
      summary: targetText(
        lang,
        '代码地图能力用于医生/研究者视角的实现追踪；缺失时可退回 manifest 和文件证据。',
        'Code-map capability supports researcher-facing implementation traceability; missing CodeGraph falls back to manifests and file evidence.',
      ),
      evidence: [`codegraph_command=${codegraphCommand ?? 'missing'}`, `codegraph_db=${codegraphDb ?? 'missing'}`],
      installWindows: 'npm install -g @colbymchenry/codegraph && codegraph init -i',
      installUnix: 'npm install -g @colbymchenry/codegraph && codegraph init -i',
      verifyWindows: 'codegraph --help',
      verifyUnix: 'codegraph --help',
      nextAction: targetText(lang, '把 CodeGraph 状态纳入 native doctor 深度检查和知识库视图。', 'Fold CodeGraph status into native doctor deep checks and the knowledge-base view.'),
      platform,
    }),
    setupCapability({
      id: 'graphify',
      title: 'Graphify',
      category: 'knowledge',
      status: graphifyCommand === 'found' && graphifyManifest === 'present' ? 'ready' : (graphifyCommand === 'found' || graphifyManifest === 'present' ? 'partial' : 'missing'),
      required: true,
      summary: targetText(
        lang,
        '知识图谱能力可增强医学证据、代码和交付物之间的关系追踪。',
        'Knowledge graph support can connect medical evidence, code, and delivery artifacts.',
      ),
      evidence: [`graphify_command=${graphifyCommand ?? 'missing'}`, `graphify_manifest=${graphifyManifest ?? 'missing'}`],
      installWindows: 'pipx install graphify && graphify install --platform codex',
      installUnix: 'pipx install graphify && graphify install --platform codex',
      verifyWindows: 'graphify hook status',
      verifyUnix: 'graphify hook status',
      nextAction: targetText(lang, '初始化 graphify-out/manifest.json 后在首页显示知识图谱状态。', 'Initialize graphify-out/manifest.json and surface graph status on the homepage.'),
      platform,
    }),
    setupCapability({
      id: 'medical-skills',
      title: targetText(lang, '医学专用 skills', 'Medical skills'),
      category: 'skills',
      status: setupStatusFromRuntimeState(skillsCard),
      required: true,
      summary: targetText(
        lang,
        skillsCard?.state === 'pass'
          ? '文献评审、事实核查、循证分级、统计审查、package audit、memory curator 已配置为医学 skill 域。'
          : '文献评审、事实核查、循证分级、统计审查、package audit、memory curator 还没有完整固化为一等 skill 域。',
        skillsCard?.state === 'pass'
          ? 'Literature review, fact check, evidence grading, statistical review, package audit, and memory curator are configured as medical skill domains.'
          : 'Literature review, fact check, evidence grading, statistical review, package audit, and memory curator are not yet fully first-class skill domains.',
      ),
      evidence: skillsCard?.details ?? ['medical_skills=missing'],
      installWindows: 'npm run medscale -- setup --json',
      installUnix: 'npm run medscale -- setup --json',
      verifyWindows: 'npm run medscale -- doctor --json',
      verifyUnix: 'npm run medscale -- doctor --json',
      nextAction: targetText(
        lang,
        skillsCard?.state === 'pass'
          ? '把医学 skill 域绑定到质量、事实核查、循证分级、统计审查、包审计、记忆审核门禁。'
          : '补齐医学 skill contract，并把每个交付门禁绑定到证据产物。',
        skillsCard?.state === 'pass'
          ? 'Bind medical skill domains to quality, fact-check, evidence-grading, statistical-review, package-audit, and memory-review gates.'
          : 'Add medical skill contracts and bind each delivery gate to evidence artifacts.',
      ),
      platform,
    }),
    setupCapability({
      id: 'mcp-server-map',
      title: targetText(lang, 'MedSCALE MCP server map', 'MedSCALE MCP server map'),
      category: 'mcp',
      status: setupStatusFromRuntimeState(mcpCard),
      required: true,
      summary: targetText(
        lang,
        mcpCard?.state === 'pass'
          ? '医学检索、事实核查、记忆审核、package audit、证据 manifest 已纳入 MedSCALE MCP server map。'
          : 'MCP 配置目前是 partial；还缺医学检索、事实核查、记忆审核、package audit 的原生 server map。',
        mcpCard?.state === 'pass'
          ? 'Literature retrieval, fact checks, memory review, package audit, and evidence manifests are declared in the MedSCALE MCP server map.'
          : 'MCP is currently partial; native server maps for literature retrieval, fact checks, memory review, and package audit are still missing.',
      ),
      evidence: mcpCard?.details ?? ['mcp_surface=missing'],
      installWindows: 'npm run medscale -- setup --json',
      installUnix: 'npm run medscale -- setup --json',
      verifyWindows: 'npm run medscale -- doctor --json',
      verifyUnix: 'npm run medscale -- doctor --json',
      nextAction: targetText(
        lang,
        mcpCard?.state === 'pass'
          ? '把 MCP route 接入 live health、权限边界和 18766 医学研究者视图。'
          : '新增 MedSCALE 原生 MCP map，并在 doctor 中做深度检查。',
        mcpCard?.state === 'pass'
          ? 'Wire MCP routes into live health checks, permission boundaries, and the 18766 researcher view.'
          : 'Add the native MedSCALE MCP map and deep-check it from doctor.',
      ),
      platform,
    }),
    setupCapability({
      id: 'pubmed-openalex',
      title: 'PubMed / OpenAlex',
      category: 'medical-evidence',
      status: setupStatusFromRuntimeState(retrievalCard),
      required: true,
      summary: targetText(
        lang,
        '医学检索客户端已经存在，但尚未进入 native doctor 深度检查和首页能力图。',
        'Medical retrieval clients exist, but they are not yet part of native doctor deep checks or the homepage capability map.',
      ),
      evidence: retrievalCard?.details ?? [
        `pubmed_client=${existsSync(pubmedClient) ? 'present' : 'missing'}`,
        `openalex_client=${existsSync(openalexClient) ? 'present' : 'missing'}`,
      ],
      installWindows: 'cd target-research-platform && python -m pip install -r requirements.txt',
      installUnix: 'cd target-research-platform && python -m pip install -r requirements.txt',
      verifyWindows: 'cd target-research-platform && python -m pytest tests/test_literature* tests/test_*openalex*',
      verifyUnix: 'cd target-research-platform && python -m pytest tests/test_literature* tests/test_*openalex*',
      nextAction: targetText(lang, '把 PubMed/OpenAlex 可用性、速率限制和缓存状态纳入 doctor。', 'Add PubMed/OpenAlex availability, rate-limit, and cache status to doctor.'),
      platform,
    }),
    setupCapability({
      id: 'package-audit',
      title: 'Package audit',
      category: 'audit',
      status: setupStatusFromRuntimeState(packageAuditCard),
      required: true,
      summary: targetText(
        lang,
        '交付包审计已有打包器基础；还需要在 native doctor 和首页中显示更细的审计结果。',
        'Delivery package audit has a packager foundation; native doctor and homepage need more granular audit status.',
      ),
      evidence: packageAuditCard?.details ?? [`delivery_packager=${existsSync(deliveryPackager) ? 'present' : 'missing'}`],
      installWindows: 'cd target-research-platform && python -m pip install -r requirements.txt',
      installUnix: 'cd target-research-platform && python -m pip install -r requirements.txt',
      verifyWindows: 'cd target-research-platform && python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py',
      verifyUnix: 'cd target-research-platform && python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py',
      nextAction: targetText(lang, '把 package audit 从交付物状态升级成 doctor 深度检查项。', 'Promote package audit from delivery status into a doctor deep-check item.'),
      platform,
    }),
    setupCapability({
      id: 'figure-refs',
      title: targetText(lang, '图表引用检查', 'Figure reference checks'),
      category: 'audit',
      status: setupStatusFromRuntimeState(figureRefsCard),
      required: true,
      summary: targetText(
        lang,
        '交付包能收集 figures，但图表编号、正文引用、期刊格式检查还没有成为独立门禁。',
        'The delivery package can collect figures, but numbering, in-text references, and journal-format checks are not yet an independent gate.',
      ),
      evidence: figureRefsCard?.details ?? [`delivery_packager=${existsSync(deliveryPackager) ? 'present' : 'missing'}`],
      installWindows: 'npm run medscale -- package --help',
      installUnix: 'npm run medscale -- package --help',
      verifyWindows: 'cd target-research-platform && python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py',
      verifyUnix: 'cd target-research-platform && python -m pytest tests/test_deliverables.py tests/test_delivery_manifest.py',
      nextAction: targetText(lang, '新增 figure refs 审查器，检查正文引用、文件存在性和 submission 清单。', 'Add a figure refs reviewer for in-text references, file presence, and submission manifests.'),
      platform,
    }),
    setupCapability({
      id: 'token-cost',
      title: targetText(lang, 'Token / cost 面板', 'Token / cost panel'),
      category: 'economics',
      status: tokenCostReport.summary.totalRecords > 0 ? 'ready' : 'partial',
      required: true,
      summary: targetText(
        lang,
        tokenCostReport.summary.totalRecords > 0
          ? 'MedSCALE 已写入模型 usage 记录，可用于医学任务 token/cost 复盘。'
          : 'MedSCALE token/cost 本地账本已接入，等待文献评审、事实核查、包审计、memory settlement 的 usage 记录。',
        tokenCostReport.summary.totalRecords > 0
          ? 'MedSCALE has model usage records available for medical task token/cost review.'
          : 'The MedSCALE token/cost ledger is wired and waiting for usage records from literature review, fact check, package audit, and memory settlement.',
      ),
      evidence: [
        'medscale_token_cli=present',
        `usage_path=${tokenCostReport.usagePath}`,
        `records=${tokenCostReport.summary.totalRecords}`,
        `total_tokens=${tokenCostReport.summary.totalTokens}`,
        `medical_lanes=${tokenCostReport.byMedicalLane.length ? tokenCostReport.byMedicalLane.map(lane => lane.key).join(',') : 'none'}`,
      ],
      installWindows: 'npm run medscale -- token record --help',
      installUnix: 'npm run medscale -- token record --help',
      verifyWindows: 'npm run medscale -- token report --json',
      verifyUnix: 'npm run medscale -- token report --json',
      nextAction: targetText(lang, '在文献检索、Agent review、fact check、memory settlement 后调用 medscale token record。', 'Call medscale token record after literature review, agent review, fact check, and memory settlement.'),
      platform,
    }),
    setupCapability({
      id: 'medical-workflow',
      title: targetText(lang, '医学研究工作流', 'Medical research workflow'),
      category: 'medical-evidence',
      status: setupStatusFromRuntimeState(workflowCard),
      required: true,
      summary: targetText(
        lang,
        'target-research-platform 是 MedSCALE Research OS 的医学执行内核。',
        'target-research-platform is the medical execution kernel of MedSCALE Research OS.',
      ),
      evidence: workflowCard?.details ?? ['medical_workflow=missing'],
      installWindows: 'cd target-research-platform && python -m pip install -r requirements.txt',
      installUnix: 'cd target-research-platform && python -m pip install -r requirements.txt',
      verifyWindows: 'cd target-research-platform && python -m pytest',
      verifyUnix: 'cd target-research-platform && python -m pytest',
      nextAction: targetText(lang, '保持 core 运行时，外部能力走增强层必须一起安装。', 'Keep core runtime and ensure external capabilities in the enhancement layer are also installed.'),
      platform,
    }),
  ]
}

export function buildTargetSetupPlan(options: {
  projectDir?: string
  lang?: unknown
  platform?: unknown
  env?: NodeJS.ProcessEnv
} = {}): TargetSetupPlan {
  const projectDir = String(options.projectDir ?? PROJECT_DIR)
  const env = options.env ?? process.env
  const root = resolveTargetWorkspaceRoot(projectDir)
  const lang = normalizeLanguage(options.lang ?? env.MEDSCALE_LANG ?? env.SCALE_LANG ?? 'zh')
  const platform = detectSetupPlatform(options.platform)
  const runtimeReadiness = buildTargetRuntimeReadiness(root, env)
  const capabilities = buildTargetSetupCapabilities({ root, platform, lang, env, readiness: runtimeReadiness })
  const capabilityById = Object.fromEntries(capabilities.map(capability => [capability.id, capability]))
  const summary = {
    ready: capabilities.filter(capability => capability.status === 'ready').length,
    partial: capabilities.filter(capability => capability.status === 'partial').length,
    missing: capabilities.filter(capability => capability.status === 'missing').length,
    planned: capabilities.filter(capability => capability.status === 'planned').length,
    requiredMissing: capabilities
      .filter(capability => capability.required && capability.status === 'missing')
      .map(capability => capability.id),
  }
  const status: TargetSetupPlan['status'] = summary.requiredMissing.length > 0
    ? 'blocked'
    : (summary.partial > 0 || summary.missing > 0 || summary.planned > 0 ? 'degraded' : 'ready')
  const nextSteps = [
    targetText(lang, '先运行 medscale doctor --json 确认必需运行时。', 'Run medscale doctor --json to confirm required runtime health.'),
    capabilityById['medical-skills']?.status === 'ready' && capabilityById['mcp-server-map']?.status === 'ready'
      ? targetText(
          lang,
          '将医学 skills 和 MCP route 绑定到质量、事实核查、包审计、记忆审核门禁。',
          'Bind medical skills and MCP routes to quality, fact-check, package-audit, and memory-review gates.',
        )
      : targetText(
          lang,
          '补医学 skills、MCP server map、Memory Brain 审核流。',
          'Add medical skills, MCP server maps, and Memory Brain review transitions.',
        ),
    targetText(
      lang,
      '把 PubMed/OpenAlex、package audit、figure refs、token/cost 纳入 native doctor 深度检查。',
      'Fold PubMed/OpenAlex, package audit, figure refs, and token/cost into native doctor deep checks.',
    ),
    targetText(lang, '整理 npm 包名和 README 后发布 npx 可视化安装入口。', 'Package the npm name and README, then publish the npx visual installer.'),
  ]
  const notes = targetText(lang,
    [
      'setup 当前是 plan-only，不会自动安装或修改系统环境。',
      'RTK、CodeGraph、Graphify、gbrain、agentmemory 都是增强能力，不阻断基础医学工作流。',
      'MedSCALE Research OS 运行入口使用 medscale，不再要求 scale CLI。',
    ],
    [
      'setup is currently plan-only and does not install or modify the system environment.',
      'RTK, CodeGraph, Graphify, gbrain, and agentmemory are enhanced capabilities, not blockers for the base medical workflow.',
      'MedSCALE Research OS uses medscale as the runtime entrypoint and does not require the scale CLI.',
    ],
  )
  return {
    schema: 'medscale.setup_plan.v1',
    product: 'MedSCALE Research OS',
    lang,
    platform,
    status,
    mode: 'plan-only',
    workspaceRoot: root,
    runtimeReadiness,
    commands: buildSetupCommands(lang),
    summary,
    capabilities,
    nextSteps,
    notes,
  }
}

function renderTargetSetupPlan(plan: TargetSetupPlan): string {
  const label = (status: TargetSetupCapabilityStatus): string => {
    if (status === 'ready') return 'PASS'
    if (status === 'partial') return 'WARN'
    if (status === 'missing') return 'TODO'
    return 'PLAN'
  }
  const title = targetText(plan.lang, 'MedSCALE Research OS 安装与能力计划', 'MedSCALE Research OS Setup and Capability Plan')
  const lines = [
    '',
    title,
    '='.repeat(50),
    `Product: ${plan.product}`,
    `Platform: ${plan.platform}`,
    `Status: ${plan.status} (${plan.runtimeReadiness.score})`,
    `Mode: ${plan.mode}`,
    `Workspace: ${plan.workspaceRoot}`,
    '',
    targetText(plan.lang, '入口命令:', 'Entry commands:'),
    `  Local: ${plan.commands.local}`,
    `  Local JSON: ${plan.commands.localJson}`,
    `  npx: ${plan.commands.npx}`,
    `  Visual: ${plan.commands.visual}`,
    '',
    targetText(plan.lang, '能力矩阵:', 'Capability matrix:'),
    ...plan.capabilities.map(capability => {
      const command = capability.verify.selected ?? capability.install.selected ?? 'n/a'
      return `  [${label(capability.status)}] ${capability.title} (${capability.category}) - ${capability.summary}\n      verify: ${command}\n      next: ${capability.nextAction}`
    }),
    '',
    targetText(plan.lang, '下一步:', 'Next steps:'),
    ...plan.nextSteps.map(item => `  - ${item}`),
    '',
    targetText(plan.lang, '说明:', 'Notes:'),
    ...plan.notes.map(item => `  - ${item}`),
  ]
  return lines.join('\n')
}

export function renderTargetSetupVisualPlan(plan: TargetSetupPlan): string {
  const statusLabel = (status: TargetSetupCapabilityStatus): string => {
    if (status === 'ready') return 'PASS'
    if (status === 'partial') return 'WARN'
    if (status === 'missing') return 'TODO'
    return 'PLAN'
  }
  const categoryLabel = (category: TargetSetupCapabilityCategory): string => {
    const labels: Record<TargetSetupCapabilityCategory, string> = {
      runtime: targetText(plan.lang, '运行时', 'Runtime'),
      memory: targetText(plan.lang, '记忆', 'Memory'),
      knowledge: targetText(plan.lang, '知识图谱', 'Knowledge'),
      mcp: 'MCP',
      skills: 'Skills',
      'code-map': targetText(plan.lang, '代码地图', 'Code map'),
      'medical-evidence': targetText(plan.lang, '医学证据', 'Medical evidence'),
      audit: targetText(plan.lang, '审计', 'Audit'),
      economics: targetText(plan.lang, '成本', 'Economics'),
    }
    return labels[category]
  }
  const grouped = plan.capabilities.reduce((acc, capability) => {
    const list = acc.get(capability.category) ?? []
    list.push(capability)
    acc.set(capability.category, list)
    return acc
  }, new Map<TargetSetupCapabilityCategory, TargetSetupCapability[]>())
  const categories: TargetSetupCapabilityCategory[] = [
    'runtime',
    'medical-evidence',
    'memory',
    'skills',
    'mcp',
    'knowledge',
    'code-map',
    'audit',
    'economics',
  ]
  const commandRows = [
    ['local', plan.commands.local],
    ['local-json', plan.commands.localJson],
    ['visual', plan.commands.visual],
    ['npx-json', plan.commands.npxJson],
  ]
  const installQueue = plan.capabilities
    .filter(capability => capability.status !== 'ready')
    .map(capability => ({ capability, command: capability.install.selected }))
    .filter(item => item.command)
  const verifyQueue = plan.capabilities
    .filter(capability => capability.verify.selected)
    .map(capability => ({ capability, command: capability.verify.selected as string }))

  const lines = [
    '',
    targetText(plan.lang, 'MedSCALE Research OS 可视化安装向导', 'MedSCALE Research OS Visual Setup Guide'),
    '='.repeat(56),
    `${targetText(plan.lang, '工作区', 'Workspace')}: ${plan.workspaceRoot}`,
    `${targetText(plan.lang, '平台', 'Platform')}: ${plan.platform}`,
    `${targetText(plan.lang, '状态', 'Status')}: ${plan.status} | ready=${plan.summary.ready} partial=${plan.summary.partial} missing=${plan.summary.missing} planned=${plan.summary.planned}`,
    '',
    targetText(plan.lang, '复制命令', 'Copy commands'),
    '-'.repeat(56),
    ...commandRows.map(([name, command]) => `  ${name.padEnd(10)} ${command}`),
    '',
    targetText(plan.lang, '能力分组', 'Capability lanes'),
    '-'.repeat(56),
  ]

  for (const category of categories) {
    const capabilities = grouped.get(category)
    if (!capabilities?.length) continue
    lines.push(`  ${categoryLabel(category)}`)
    for (const capability of capabilities) {
      const marker = capability.required ? 'required' : 'optional'
      lines.push(`    [${statusLabel(capability.status)}] ${capability.title} (${marker})`)
      lines.push(`      ${capability.summary}`)
      lines.push(`      next: ${capability.nextAction}`)
    }
  }

  lines.push('', targetText(plan.lang, '安装队列', 'Install queue'), '-'.repeat(56))
  if (installQueue.length) {
    for (const item of installQueue) lines.push(`  [${statusLabel(item.capability.status)}] ${item.capability.id}: ${item.command}`)
  } else {
    lines.push(targetText(plan.lang, '  没有待安装能力。', '  No install actions needed.'))
  }

  lines.push('', targetText(plan.lang, '验证队列', 'Verify queue'), '-'.repeat(56))
  for (const item of verifyQueue) lines.push(`  [${statusLabel(item.capability.status)}] ${item.capability.id}: ${item.command}`)

  lines.push('', targetText(plan.lang, '安全边界', 'Safety boundary'), '-'.repeat(56))
  lines.push(...plan.notes.map(item => `  - ${item}`))
  lines.push('')
  lines.push(targetText(
    plan.lang,
    '提示：setup --visual 只展示和分组命令，不会自动安装第三方工具。',
    'Tip: setup --visual only displays grouped commands; it does not auto-install third-party tools.',
  ))
  return lines.join('\n')
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function quoteMaybe(value: string | null | undefined): string {
  return value && value.trim() ? value : 'N/A'
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean) as string[])]
}

function deriveMemorySlugFromManifest(manifestPath: string): string {
  return manifestPath.replace(/\\/g, '/').split('/').pop()?.replace(/_delivery_manifest\.json$/i, '') ?? 'medical_delivery'
}

function buildTargetMemorySummaryMarkdown(plan: TargetMemorySeedPlan): string {
  const manifest = plan.manifestPath ? readJsonFile(plan.manifestPath) : null
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  const qualityPath = filePathForRole(files, 'manuscript_quality')
  const factPath = filePathForRole(files, 'manuscript_fact_check')
  const metaPath = filePathForRole(files, 'manuscript_meta')
  const quality = qualityPath ? readJsonFile(qualityPath) : null
  const fact = factPath ? readJsonFile(factPath) : null
  const meta = metaPath ? readJsonFile(metaPath) : null
  const manifestQuality = asRecord(manifest?.quality_gate)
  const manifestFact = asRecord(manifest?.fact_check)
  const literature = asRecord(manifest?.literature)
  const enrichment = asRecord(literature?.enrichment)
  const sourceCounts = asRecord(literature?.source_counts)
  const dataSources = toStringList(manifest?.data_sources)
  const reviewTodo = toStringList(manifest?.human_review_todo)
  const hints = uniqueStrings([
    plan.target,
    plan.disease,
    `${plan.target} ${plan.disease}`,
    `${plan.target} manuscript`,
    `${plan.target} zhongliu`,
    `${plan.target} quality gate`,
    `${plan.target} fact check`,
    `${plan.target} delivery manifest`,
    `${plan.target} literature evidence`,
    'medical research delivery',
    'manuscript quality gate',
    'manuscript fact check',
  ])

  const figureNames = Array.isArray(manifest?.figures)
    ? manifest.figures
      .map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null
        return String((item as Record<string, unknown>).relative ?? (item as Record<string, unknown>).path ?? '').trim() || null
      })
      .filter(Boolean) as string[]
    : []

  return [
    `# Medical Delivery Summary`,
    '',
    `Target: ${quoteMaybe(plan.target)}`,
    `Disease: ${quoteMaybe(plan.disease)}`,
    `Slug: ${quoteMaybe(plan.slug)}`,
    `Manifest path: ${quoteMaybe(plan.manifestPath)}`,
    '',
    `Search hints: ${hints.join(' | ')}`,
    '',
    '## Quality Gate',
    `Passed: ${String(quality?.passed ?? manifestQuality?.passed ?? 'unknown')}`,
    `Grade: ${quoteMaybe(String(quality?.grade ?? manifestQuality?.grade ?? ''))}`,
    `Score: ${quoteMaybe(String(quality?.score ?? manifestQuality?.score ?? ''))}`,
    `Errors: ${quoteMaybe(String(quality?.errors ?? manifestQuality?.errors ?? ''))}`,
    `Warnings: ${quoteMaybe(String(quality?.warnings ?? manifestQuality?.warnings ?? ''))}`,
    '',
    '## Fact Check',
    `Passed: ${String(fact?.passed ?? manifestFact?.passed ?? 'unknown')}`,
    `Score: ${quoteMaybe(String(fact?.score ?? manifestFact?.score ?? ''))}`,
    `Claims checked: ${quoteMaybe(String(fact?.claims_checked ?? manifestFact?.claims_checked ?? ''))}`,
    `Unverified claims: ${Array.isArray(fact?.unverified_claims) ? fact?.unverified_claims.length : quoteMaybe(String(fact?.unverified_claims ?? '0'))}`,
    '',
    '## Literature Evidence',
    `Review count: ${quoteMaybe(String(literature?.count ?? ''))}`,
    `Agent cache reviews: ${quoteMaybe(String(literature?.agent_cache_count ?? sourceCounts?.agent_cache ?? '0'))}`,
    `LLM reviews: ${quoteMaybe(String(literature?.llm_count ?? '0'))}`,
    `Rule-based reviews: ${quoteMaybe(String(literature?.rule_based_count ?? '0'))}`,
    `Enrichment sources: ${toStringList(enrichment?.sources).join(', ') || 'none'}`,
    `MeSH count: ${quoteMaybe(String(enrichment?.mesh_count ?? ''))}`,
    `Citation count available: ${quoteMaybe(String(enrichment?.citation_count_available ?? ''))}`,
    '',
    '## Data Sources',
    ...(dataSources.length > 0 ? dataSources.map(item => `- ${item}`) : ['- none']),
    '',
    '## Figures',
    ...(figureNames.length > 0 ? figureNames.map(item => `- ${item}`) : ['- none']),
    '',
    '## Human Review Todo',
    ...(reviewTodo.length > 0 ? reviewTodo.map(item => `- ${item}`) : ['- none']),
    '',
    '## Importable Medical Artifacts',
    ...plan.sourceFiles.map(item => `- ${item}`),
    '',
    '## Delivery Boundary',
    String(manifest?.disclaimer ?? 'This is a generated medical research delivery draft and requires human review before submission or clinical interpretation.'),
    '',
    ...(meta ? [
      '## Metadata Keys',
      ...Object.keys(meta).slice(0, 16).map(key => `- ${key}`),
      '',
    ] : []),
  ].join('\n')
}

function buildTargetMemorySummaryArtifact(plan: TargetMemorySeedPlan): { summaryPath: string; content: string } {
  const summaryPath = join(plan.manuscriptsDir, `${plan.slug ?? 'medical_delivery'}_memory_summary.md`)
  const content = buildTargetMemorySummaryMarkdown(plan)
  mkdirSync(plan.manuscriptsDir, { recursive: true })
  writeFileSync(summaryPath, content, 'utf-8')
  return { summaryPath, content }
}

function writeTargetMemorySeedRecord(
  plan: TargetMemorySeedPlan,
  provider: string,
  summaryPath: string | null,
  importReport: MemoryProviderImportReport | null,
): string {
  const recordPath = join(plan.manuscriptsDir, `${plan.slug ?? 'medical_delivery'}_memory_seed.json`)
  const payload = {
    generated_at: new Date().toISOString(),
    target: plan.target,
    disease: plan.disease,
    slug: plan.slug,
    provider,
    manifest_path: plan.manifestPath,
    summary_path: summaryPath,
    source_files: summaryPath ? [summaryPath, ...plan.sourceFiles] : [...plan.sourceFiles],
    missing_roles: plan.missingRoles,
    import_ok: importReport?.ok ?? false,
    import_exit_code: importReport?.exitCode ?? null,
    staged_files: importReport?.stagedFiles ?? [],
    warnings: uniqueStrings([...(plan.warnings ?? []), ...(importReport?.warnings ?? [])]),
  }
  writeFileSync(recordPath, JSON.stringify(payload, null, 2), 'utf-8')
  return recordPath
}

function filePathForRole(files: unknown[], role: string): string | null {
  const entry = files.find(item => item && typeof item === 'object' && !Array.isArray(item) && String((item as Record<string, unknown>).role ?? '') === role) as Record<string, unknown> | undefined
  const path = entry?.path
  return typeof path === 'string' && path.trim() ? path : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function resolveTargetMemorySeedPlan(options: {
  projectDir?: string
  output?: string
  target: string
  disease: string
}): TargetMemorySeedPlan {
  const projectDir = resolve(String(options.projectDir ?? PROJECT_DIR))
  const platform = resolveTargetPlatform(projectDir)
  if (!platform) {
    return {
      ok: false,
      projectDir,
      workflowRoot: resolve(projectDir, 'target-research-platform'),
      outputDir: resolve(projectDir, 'target-research-platform', String(options.output ?? './output')),
      manuscriptsDir: resolve(projectDir, 'target-research-platform', String(options.output ?? './output'), 'manuscripts'),
      target: options.target,
      disease: options.disease,
      slug: null,
      manifestPath: null,
      sourceFiles: [],
      missingRoles: [...DELIVERY_MEMORY_IMPORT_ROLES],
      warnings: ['target-research-platform not found; cannot resolve medical delivery artifacts for memory seeding.'],
    }
  }

  const outputDir = resolveTargetOutputDir(platform, options.output)
  const manuscriptsDir = join(outputDir, 'manuscripts')
  if (!existsSync(manuscriptsDir)) {
    return {
      ok: false,
      projectDir,
      workflowRoot: platform.platformDir,
      outputDir,
      manuscriptsDir,
      target: options.target,
      disease: options.disease,
      slug: null,
      manifestPath: null,
      sourceFiles: [],
      missingRoles: [...DELIVERY_MEMORY_IMPORT_ROLES],
      warnings: ['Manuscripts output directory does not exist yet. Run the native manuscript/package command from target-research-platform first.'],
    }
  }

  const targetKey = normalizeTargetToken(options.target)
  const diseaseKey = normalizeTargetToken(options.disease)
  const manifestFiles = readdirSync(manuscriptsDir)
    .filter(name => name.endsWith('_delivery_manifest.json'))
    .map(name => join(manuscriptsDir, name))
  const matchedManifest = manifestFiles.find(filePath => {
    const payload = readJsonFile(filePath)
    return normalizeTargetToken(String(payload?.target ?? '')) === targetKey
      && normalizeTargetToken(String(payload?.disease ?? '')) === diseaseKey
  }) ?? null

  if (!matchedManifest) {
    return {
      ok: false,
      projectDir,
      workflowRoot: platform.platformDir,
      outputDir,
      manuscriptsDir,
      target: options.target,
      disease: options.disease,
      slug: null,
      manifestPath: null,
      sourceFiles: [],
      missingRoles: [...DELIVERY_MEMORY_IMPORT_ROLES],
      warnings: ['Delivery manifest for the requested target/disease was not found. Run the native package command for this study first.'],
    }
  }

  const manifest = readJsonFile(matchedManifest)
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  const selectedFiles: string[] = []
  const missingRoles: string[] = []
  const warnings: string[] = []

  for (const role of DELIVERY_MEMORY_IMPORT_ROLES) {
    const item = files.find(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      return String((entry as Record<string, unknown>).role ?? '') === role
    }) as Record<string, unknown> | undefined
    const filePath = item?.path ? String(item.path) : null
    if (!filePath || !existsSync(filePath)) {
      missingRoles.push(role)
      continue
    }
    selectedFiles.push(filePath)
  }

  if (selectedFiles.length === 0) {
    warnings.push('The delivery manifest exists, but none of the memory-importable medical artifacts were found on disk.')
  }

  return {
    ok: selectedFiles.length > 0,
    projectDir,
    workflowRoot: platform.platformDir,
    outputDir,
    manuscriptsDir,
    target: options.target,
    disease: options.disease,
    slug: deriveMemorySlugFromManifest(matchedManifest),
    manifestPath: matchedManifest,
    sourceFiles: selectedFiles,
    missingRoles,
    warnings,
  }
}

export function seedTargetDeliveryMemory(options: {
  projectDir?: string
  output?: string
  target: string
  disease: string
  provider?: string
}): TargetMemorySeedReport {
  const plan = resolveTargetMemorySeedPlan(options)
  if (!plan.ok) {
    return {
      ok: false,
      target: options.target,
      disease: options.disease,
      provider: String(options.provider ?? 'gbrain'),
      manifestPath: plan.manifestPath,
      summaryPath: null,
      recordPath: null,
      sourceFiles: plan.sourceFiles,
      missingRoles: plan.missingRoles,
      importReport: null,
      warnings: plan.warnings,
    }
  }

  const summary = buildTargetMemorySummaryArtifact(plan)
  const importReport = importMemoryProviderKnowledge({
    projectDir: plan.projectDir,
    provider: String(options.provider ?? 'gbrain'),
    files: [summary.summaryPath, ...plan.sourceFiles],
    noEmbed: true,
  })
  const recordPath = writeTargetMemorySeedRecord(
    plan,
    String(options.provider ?? 'gbrain'),
    summary.summaryPath,
    importReport,
  )

  return {
    ok: importReport.ok,
    target: options.target,
    disease: options.disease,
    provider: String(options.provider ?? 'gbrain'),
    manifestPath: plan.manifestPath,
    summaryPath: summary.summaryPath,
    recordPath,
    sourceFiles: [summary.summaryPath, ...plan.sourceFiles],
    missingRoles: plan.missingRoles,
    importReport,
    warnings: [...plan.warnings, ...importReport.warnings],
  }
}

function safeTargetLearningSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'medical-delivery'
}

function toProjectPath(projectDir: string, filePath: string): string {
  const normalized = relative(projectDir, filePath).replace(/\\/g, '/')
  return normalized && !normalized.startsWith('..') ? normalized : filePath.replace(/\\/g, '/')
}

function buildTargetDeliveryLearningSummary(options: {
  taskLabel: string
  qualityPassed: boolean | null
  qualityGrade: string | null
  qualityScore: number | null
  factPassed: boolean | null
  factScore: number | null
  claimsChecked: number | null
  reviewCount: number | null
  agentCount: number
  llmCount: number
  ruleBasedCount: number
  seedProvider: string | null
  seedOk: boolean | null
}): string {
  const parts = [
    `Medical delivery "${options.taskLabel}"`,
    options.qualityPassed === true
      ? `passed the manuscript quality gate${options.qualityGrade ? ` (${options.qualityGrade})` : ''}${options.qualityScore != null ? ` with score ${options.qualityScore}` : ''}`
      : options.qualityPassed === false
        ? 'did not pass the manuscript quality gate'
        : 'is still missing a definitive manuscript quality result',
    options.factPassed === true
      ? `${options.claimsChecked ?? 'multiple'} claims passed fact check${options.factScore != null ? ` (score ${options.factScore})` : ''}`
      : options.factPassed === false
        ? 'still has unresolved fact-check issues'
        : 'still needs more fact-check evidence',
    `literature review coverage=${options.reviewCount ?? 0} (agent=${options.agentCount}, llm=${options.llmCount}, rule=${options.ruleBasedCount})`,
    options.seedProvider
      ? `memory seed ${options.seedProvider}=${options.seedOk === true ? 'ready' : options.seedOk === false ? 'failed' : 'pending'}`
      : 'memory seed not requested',
  ]
  return `${parts.join('; ')}. Review this candidate before promoting it into durable project memory or knowledge-base rules.`
}

export function settleTargetDeliveryLearning(options: {
  projectDir?: string
  output?: string
  target: string
  disease: string
  memorySeed?: TargetMemorySeedReport | null
  ingestToBrain?: boolean
}): TargetDeliveryLearningReport {
  const plan = resolveTargetMemorySeedPlan(options)
  if (!plan.ok || !plan.manifestPath) {
    return {
      ok: false,
      target: options.target,
      disease: options.disease,
      candidateId: null,
      candidatePath: null,
      candidateMarkdownPath: null,
      mirrorRecordPath: null,
      mirrorSummaryPath: null,
      recommendedAction: null,
      promotable: false,
      brainNodeId: null,
      brainIngestOk: null,
      sourceFiles: plan.sourceFiles,
      warnings: plan.warnings,
    }
  }

  const manifest = readJsonFile(plan.manifestPath)
  if (!manifest) {
    return {
      ok: false,
      target: options.target,
      disease: options.disease,
      candidateId: null,
      candidatePath: null,
      candidateMarkdownPath: null,
      mirrorRecordPath: null,
      mirrorSummaryPath: null,
      recommendedAction: null,
      promotable: false,
      brainNodeId: null,
      brainIngestOk: null,
      sourceFiles: plan.sourceFiles,
      warnings: ['The delivery manifest exists but could not be parsed.'],
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : []
  const qualityPath = filePathForRole(files, 'manuscript_quality')
  const factPath = filePathForRole(files, 'manuscript_fact_check')
  const metaPath = filePathForRole(files, 'manuscript_meta')
  const packagePath = filePathForRole(files, 'delivery_package')
  const quality = qualityPath ? readJsonFile(qualityPath) : null
  const fact = factPath ? readJsonFile(factPath) : null
  const literature = asRecord(manifest.literature)
  const manifestQuality = asRecord(manifest.quality_gate)
  const manifestFact = asRecord(manifest.fact_check)
  const reviewTodo = toStringList(manifest.human_review_todo)
  const qualityPassed = typeof quality?.passed === 'boolean'
    ? quality.passed
    : typeof manifestQuality?.passed === 'boolean'
      ? manifestQuality.passed
      : null
  const factPassed = typeof fact?.passed === 'boolean'
    ? fact.passed
    : typeof manifestFact?.passed === 'boolean'
      ? manifestFact.passed
      : null
  const qualityGrade = String(quality?.grade ?? manifestQuality?.grade ?? '').trim() || null
  const qualityScore = toNumber(quality?.score ?? manifestQuality?.score)
  const factScore = toNumber(fact?.score ?? manifestFact?.score)
  const claimsChecked = toNumber(fact?.claims_checked ?? manifestFact?.claims_checked)
  const reviewCount = toNumber(literature?.count)
  const agentCount = toNumber(literature?.agent_cache_count) ?? 0
  const llmCount = toNumber(literature?.llm_count) ?? 0
  const ruleBasedCount = toNumber(literature?.rule_based_count) ?? 0
  const slug = plan.slug ?? safeTargetLearningSegment(`${plan.target}-${plan.disease}`)

  const recommendedAction = qualityPassed === false || factPassed === false
    ? 'resolve-failures-first'
    : qualityPassed === true && factPassed === true
      ? 'review-for-knowledge-base'
      : 'record-more-evidence'
  const promotable = recommendedAction === 'review-for-knowledge-base'

  const warnings = uniqueStrings([
    ...plan.warnings,
    ...(plan.missingRoles.length > 0
      ? [`Memory-seeding source roles are incomplete: ${plan.missingRoles.join(', ')}`]
      : []),
    ...(qualityPassed === false ? ['Manuscript quality gate did not pass for this delivery.'] : []),
    ...(factPassed === false ? ['Manuscript fact check did not pass for this delivery.'] : []),
    ...(qualityPassed !== true ? ['Quality evidence is incomplete; keep this learning candidate under review.'] : []),
    ...(factPassed !== true ? ['Fact-check evidence is incomplete; keep this learning candidate under review.'] : []),
    ...(ruleBasedCount > 0 && agentCount + llmCount === 0
      ? ['Literature interpretation still depends on rule-based fallback; upgrade Agent/LLM review before promotion.']
      : []),
    ...reviewTodo.map(item => `Human review todo: ${item}`),
    ...(options.memorySeed && !options.memorySeed.ok
      ? [`Memory seed via ${options.memorySeed.provider} is incomplete; cross-session recall may miss this delivery.`]
      : []),
  ])

  const scaleRoot = resolve(plan.projectDir, '.scale')
  const learningDir = join(scaleRoot, 'memory', 'learning-candidates')
  const candidateId = `MLC-medical-${safeTargetLearningSegment(slug)}`
  const candidatePath = join(learningDir, `${candidateId}.json`)
  const candidateMarkdownPath = join(learningDir, `${candidateId}.md`)
  const mirrorRecordPath = join(plan.manuscriptsDir, `${slug}_memory_learning_candidate.json`)
  const mirrorSummaryPath = join(plan.manuscriptsDir, `${slug}_memory_learning_candidate.md`)

  const artifactPaths = uniqueStrings([
    plan.manifestPath,
    qualityPath,
    factPath,
    metaPath,
    packagePath,
    options.memorySeed?.recordPath,
    options.memorySeed?.summaryPath,
    ...plan.sourceFiles,
  ])

  const candidate: MemoryLearningCandidate = {
    version: '1.0',
    id: candidateId,
    status: 'candidate',
    generatedAt: new Date().toISOString(),
    title: `Medical learning candidate: ${plan.target} / ${plan.disease}`,
    task: `Review medical delivery for ${plan.target} in ${plan.disease}`,
    taskId: `medical-delivery-${safeTargetLearningSegment(slug)}`,
    sessionId: options.memorySeed?.provider ? `medical-memory-${safeTargetLearningSegment(options.memorySeed.provider)}` : undefined,
    level: 'M',
    summary: buildTargetDeliveryLearningSummary({
      taskLabel: `${plan.target} / ${plan.disease}`,
      qualityPassed,
      qualityGrade,
      qualityScore,
      factPassed,
      factScore,
      claimsChecked,
      reviewCount,
      agentCount,
      llmCount,
      ruleBasedCount,
      seedProvider: options.memorySeed?.provider ?? null,
      seedOk: options.memorySeed?.ok ?? null,
    }),
    recommendedAction,
    promotable,
    tags: uniqueStrings([
      'medical-delivery',
      'medical-learning',
      `target-${safeTargetLearningSegment(plan.target)}`,
      `disease-${safeTargetLearningSegment(plan.disease)}`,
      promotable ? 'verified-evidence' : 'review-required',
      qualityPassed === false || factPassed === false ? 'failed-evidence' : null,
    ]),
    evidenceIds: [],
    sessionEventIds: [],
    knowledgeIds: [],
    graphRefs: [],
    artifactPaths: artifactPaths.map(filePath => toProjectPath(plan.projectDir, filePath)),
    evidenceSummaries: [
      {
        id: 'delivery-manifest',
        status: 'passed',
        title: 'Delivery manifest',
        summary: `Resolved at ${toProjectPath(plan.projectDir, plan.manifestPath)} with ${artifactPaths.length} linked artifact(s).`,
      },
      {
        id: 'quality-gate',
        status: qualityPassed === true ? 'passed' : qualityPassed === false ? 'failed' : 'pending',
        title: 'Manuscript quality gate',
        summary: `grade=${qualityGrade ?? 'n/a'}; score=${qualityScore ?? 'n/a'}; passed=${qualityPassed == null ? 'unknown' : String(qualityPassed)}`,
      },
      {
        id: 'fact-check',
        status: factPassed === true ? 'passed' : factPassed === false ? 'failed' : 'pending',
        title: 'Manuscript fact check',
        summary: `score=${factScore ?? 'n/a'}; claims_checked=${claimsChecked ?? 'n/a'}; passed=${factPassed == null ? 'unknown' : String(factPassed)}`,
      },
      {
        id: 'literature-evidence',
        status: ruleBasedCount > 0 && agentCount + llmCount === 0 ? 'warning' : 'passed',
        title: 'Literature evidence mix',
        summary: `reviews=${reviewCount ?? 0}; agent=${agentCount}; llm=${llmCount}; rule=${ruleBasedCount}`,
      },
      ...(options.memorySeed ? [{
        id: 'memory-seed',
        status: options.memorySeed.ok ? 'passed' : 'failed',
        title: `Memory seed (${options.memorySeed.provider})`,
        summary: `summary=${options.memorySeed.summaryPath ? 'ready' : 'missing'}; record=${options.memorySeed.recordPath ? 'ready' : 'missing'}`,
      }] : []),
    ],
    sessionSummaries: [
      {
        id: 'medical-delivery',
        eventType: 'medical.delivery.ready',
        phase: 'package',
        message: `Delivery package available for ${plan.target} / ${plan.disease}.`,
      },
      ...(options.memorySeed ? [{
        id: 'medical-memory-seed',
        eventType: 'medical.memory.seed',
        phase: 'remember',
        message: `Seeded to ${options.memorySeed.provider}: ${options.memorySeed.ok ? 'ok' : 'failed'}.`,
      }] : []),
    ],
    warnings,
    contextBudget: {
      used: artifactPaths.length,
      limit: artifactPaths.length,
      remaining: 0,
      overBudget: false,
    },
    contentRef: toProjectPath(plan.projectDir, candidateMarkdownPath),
  }

  mkdirSync(learningDir, { recursive: true })
  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), 'utf-8')
  writeFileSync(candidateMarkdownPath, renderMemoryLearningCandidateMarkdown(candidate), 'utf-8')

  let brainNodeId: string | null = null
  let brainIngestOk: boolean | null = null
  let brainWarnings: string[] = []

  if (options.ingestToBrain) {
    const brain = new MemoryBrain({ projectDir: plan.projectDir })
    try {
      const ingest = brain.ingest({ from: 'candidate', candidateId, type: 'decision' })
      brainIngestOk = ingest.ok
      brainNodeId = ingest.nodes[0]?.id ?? null
      brainWarnings = ingest.warnings
    } finally {
      brain.close()
    }
  }

  const finalWarnings = uniqueStrings([...warnings, ...brainWarnings])
  const finalCandidate: MemoryLearningCandidate = {
    ...candidate,
    warnings: finalWarnings,
  }
  const summaryMarkdown = renderMemoryLearningCandidateMarkdown(finalCandidate)

  writeFileSync(candidatePath, JSON.stringify(finalCandidate, null, 2), 'utf-8')
  writeFileSync(candidateMarkdownPath, summaryMarkdown, 'utf-8')

  writeFileSync(mirrorSummaryPath, summaryMarkdown, 'utf-8')
  writeFileSync(mirrorRecordPath, JSON.stringify({
    generated_at: finalCandidate.generatedAt,
    target: plan.target,
    disease: plan.disease,
    slug,
    candidate_id: candidateId,
    candidate_path: candidatePath,
    candidate_markdown_path: candidateMarkdownPath,
    summary_path: mirrorSummaryPath,
    recommended_action: recommendedAction,
    promotable,
    brain_ingest_ok: brainIngestOk,
    brain_node_id: brainNodeId,
    source_files: artifactPaths,
    warnings: finalWarnings,
    candidate: finalCandidate,
  }, null, 2), 'utf-8')

  return {
    ok: !options.ingestToBrain || brainIngestOk !== false,
    target: plan.target,
    disease: plan.disease,
    candidateId,
    candidatePath,
    candidateMarkdownPath,
    mirrorRecordPath,
    mirrorSummaryPath,
    recommendedAction,
    promotable,
    brainNodeId,
    brainIngestOk,
    sourceFiles: artifactPaths,
    warnings: finalWarnings,
  }
}

function normalizeMemoryReviewAction(value: unknown): MemoryReviewAction {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'approve' || normalized === 'reject' || normalized === 'stale' || normalized === 'restore') {
    return normalized
  }
  throw new Error('memory-review action must be approve, reject, stale, or restore.')
}

function normalizeTargetMemoryScope(value: unknown): MemoryNodeScope | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'project' || normalized === 'workspace' || normalized === 'global-candidate') return normalized
  throw new Error('--scope must be project, workspace, or global-candidate.')
}

function extractLastJson(stdout: string): unknown | null {
  const trimmed = stdout.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return null

  const firstBrace = trimmed.indexOf('{')
  if (firstBrace >= 0) {
    try {
      return JSON.parse(trimmed.slice(firstBrace))
    } catch {
      // fall through
    }
  }

  const lines = trimmed.split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    try {
      return JSON.parse(line)
    } catch {
      // continue scanning
    }
  }

  return null
}

function runPythonCommand(
  platform: ResolvedTargetPlatform,
  args: string[],
  options?: { json?: boolean; inherit?: boolean },
): { code: number; stdout: string; stderr: string; parsed: Record<string, unknown> | null } {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd: platform.platformDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    encoding: 'utf-8',
  }

  const commandArgs = [platform.mainPy, ...args]
  const useInherit = options?.inherit ?? !options?.json

  if (useInherit) {
    const result = spawnSync('python', commandArgs, {
      ...spawnOptions,
      stdio: 'inherit',
    })
    return {
      code: result.status ?? 1,
      stdout: '',
      stderr: '',
      parsed: null,
    }
  }

  const result = spawnSync('python', commandArgs, {
    ...spawnOptions,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  const parsedRaw = extractLastJson(stdout)
  const parsed = parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
    ? parsedRaw as Record<string, unknown>
    : null

  return {
    code: result.status ?? 1,
    stdout,
    stderr,
    parsed,
  }
}

function readMedicalResearchOsPlan(
  platform: ResolvedTargetPlatform,
): { code: number; stdout: string; stderr: string; parsed: Record<string, unknown> | null } {
  const script = [
    'import json',
    'from pathlib import Path',
    'from src.dashboard.app import DashboardState',
    'payload = DashboardState(Path.cwd()).build_medical_research_os_plan()',
    'print(json.dumps(payload, ensure_ascii=False))',
  ].join('; ')
  const result = spawnSync('python', ['-c', script], {
    cwd: platform.platformDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  const parsedRaw = extractLastJson(stdout)
  const parsed = parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
    ? parsedRaw as Record<string, unknown>
    : null
  return {
    code: result.status ?? 1,
    stdout,
    stderr,
    parsed,
  }
}

function buildTargetPackageCommandArgs(args: Record<string, unknown>, jsonMode: boolean): string[] {
  const commandArgs = [
    'package',
    '--target',
    String(args.target),
    '--disease',
    String(args.disease),
    '--output',
    String(args.output ?? './output'),
  ]
  if (jsonMode) commandArgs.push('--json')
  return commandArgs
}

export const targetAnalyzeCommand = defineCommand({
  meta: {
    name: 'analyze',
    description: 'Run full 4-stage target research pipeline (expression → screening → deep research → business)',
  },
  args: {
    target: { type: 'positional', required: true, description: 'Target gene symbol, e.g. CDK4' },
    disease: { type: 'string', required: true, description: 'Disease name, e.g. "breast cancer"' },
    cancers: { type: 'string', default: 'BRCA', description: 'Comma-separated cancer codes, e.g. BRCA,LUAD' },
    ensg: { type: 'string', description: 'Optional Ensembl gene ID' },
    modality: {
      type: 'string',
      default: 'small_molecule',
      description: 'Drug modality: small_molecule | antibody | cell_therapy | gene_therapy',
    },
    'risk-level': { type: 'string', default: 'medium', description: 'Risk level: low | medium | high' },
    output: { type: 'string', default: './output', description: 'Output directory under target-research-platform' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const platform = resolveTargetPlatform(String(args.dir ?? PROJECT_DIR))
    if (!platform) {
      console.error('未找到 target-research-platform/main.py，请在 yixue-scale-engine 仓库根目录运行。')
      process.exit(1)
    }

    const cancers = parseCancerList(String(args.cancers ?? 'BRCA'))
    const cmdArgs = [
      'full',
      '--target', String(args.target),
      '--disease', String(args.disease),
      '--cancers', ...cancers,
      '--modality', String(args.modality ?? 'small_molecule'),
      '--risk-level', String(args['risk-level'] ?? 'medium'),
      '--output', String(args.output ?? './output'),
      '--cache', './cache',
    ]

    if (args.ensg) cmdArgs.push('--ensg', String(args.ensg))
    if (args.json) cmdArgs.push('--json')

    if (!args.json) {
      console.log(`\n开始分析: ${args.target} / ${args.disease} (${cancers.join(', ')})`)
      console.log('预计耗时 5-15 分钟，请保持网络畅通。\n')
    }

    const result = runPythonCommand(platform, cmdArgs, { json: Boolean(args.json), inherit: !args.json })

    if (args.json) {
      if (result.parsed) {
        console.log(JSON.stringify(result.parsed, null, 2))
      } else {
        console.log(JSON.stringify({
          success: false,
          error: 'Pipeline finished without JSON output',
          stderr: result.stderr.slice(-1000),
        }, null, 2))
      }
      process.exit(result.code)
    }

    if (result.code !== 0) {
      console.error('\n分析失败，请运行 target-research-platform 的原生 doctor/测试检查环境。')
      process.exit(result.code)
    }

    console.log('\n  下一步:')
    console.log('    medscale status        # 查看运行状态与报告链接')
    console.log('    medscale dashboard     # 打开医学研究工作台 http://127.0.0.1:18766')
  },
})

function printDeliveryReadiness(snapshot: ReturnType<typeof readMedicalWorkflowDashboard>): void {
  const delivery = snapshot.deliveryPackage
  if (!delivery) return
  const packageAudit = delivery.packageAudit

  const findings = delivery.qualityFindings ?? []
  const evidence = delivery.literatureEvidence
  const todo = delivery.humanReviewTodo ?? []

  if (!packageAudit && !findings.length && !evidence && !todo.length) return

  console.log('\n  Delivery readiness:')

  if (packageAudit) {
    const verdict = packageAudit.passed === true ? 'PASS' : packageAudit.passed === false ? 'FAIL' : 'UNKNOWN'
    console.log(`    ZIP audit: ${verdict}; entries=${packageAudit.entryCount ?? '-'}; files=${packageAudit.filesChecked ?? '-'}`)
    console.log(`    Archive refs: images=${packageAudit.imageRefsChecked ?? '-'}; links=${packageAudit.markdownRefsChecked ?? '-'}; README=${packageAudit.readmePresent === true ? 'ready' : packageAudit.readmePresent === false ? 'missing' : 'unknown'}`)
    if ((packageAudit.brokenImageRefs ?? 0) > 0 || (packageAudit.brokenMarkdownRefs ?? 0) > 0) {
      console.log(`    Broken refs: images=${packageAudit.brokenImageRefs ?? 0}; links=${packageAudit.brokenMarkdownRefs ?? 0}`)
    }
  }

  if (findings.length > 0) {
    console.log('    Quality findings:')
    for (const finding of findings.slice(0, 5)) {
      const severity = finding.severity ?? 'unknown'
      const id = finding.id ?? 'quality'
      const message = finding.message ?? ''
      console.log(`      - [${severity}] ${id}: ${message}`)
    }
  }

  if (evidence) {
    const sources = evidence.sources.length > 0 ? evidence.sources.join(', ') : 'none'
    console.log(`    Literature reviews: ${evidence.count ?? '-'} papers; Agent=${evidence.agentCacheCount ?? 0}; LLM=${evidence.llmCount ?? 0}; rule=${evidence.ruleBasedCount ?? 0}`)
    console.log(`    Enrichment: sources=${sources}; MeSH=${evidence.meshCount ?? 0}; citations=${evidence.citationCountAvailable ?? 0}; cache=${evidence.cacheUsed ? 'used' : 'not used'}`)
  }

  if (todo.length > 0) {
    console.log('    Human review todo:')
    for (const item of todo.slice(0, 8)) {
      console.log(`      - ${item}`)
    }
  }
}

function printMemorySeedSummary(snapshot: ReturnType<typeof readMedicalWorkflowDashboard>): void {
  const seed = snapshot.memorySeed
  if (!seed) return

  const status = seed.importOk === true
    ? 'ready'
    : seed.importOk === false
      ? 'failed'
      : (seed.recordReady || seed.summaryReady ? 'partial' : 'pending')

  console.log('\n  Memory seed:')
  console.log(`    Status: ${status}`)
  console.log(`    Provider: ${seed.provider ?? 'unknown'}`)
  if (seed.generatedAt) console.log(`    Generated: ${seed.generatedAt}`)
  console.log(`    Record: ${seed.recordReady ? 'ready' : 'missing'}`)
  console.log(`    Summary: ${seed.summaryReady ? 'ready' : 'missing'}`)
  if (seed.sourceFileCount != null || seed.stagedFileCount != null) {
    console.log(`    Files: source=${seed.sourceFileCount ?? 0}; staged=${seed.stagedFileCount ?? 0}`)
  }
  if (seed.recordPath) console.log(`    Record path: ${seed.recordPath}`)
  if (seed.summaryPath) console.log(`    Summary path: ${seed.summaryPath}`)
  if (seed.missingRoles.length > 0) {
    console.log(`    Missing roles: ${seed.missingRoles.join(', ')}`)
  }
  if (seed.warnings.length > 0) {
    console.log('    Warnings:')
    for (const warning of seed.warnings.slice(0, 5)) {
      console.log(`      - ${warning}`)
    }
  }
}

function printLearningCandidateSummary(snapshot: ReturnType<typeof readMedicalWorkflowDashboard>): void {
  const learning = snapshot.learningCandidate
  if (!learning) return

  const status = learning.brainIngestOk === false
    ? 'brain-ingest-failed'
    : learning.promotable
      ? 'ready-for-review'
      : learning.recommendedAction === 'resolve-failures-first'
        ? 'blocked'
        : 'collect-more-evidence'

  console.log('\n  Learning candidate:')
  console.log(`    Status: ${status}`)
  console.log(`    Candidate ID: ${learning.candidateId ?? 'unknown'}`)
  console.log(`    Recommended action: ${learning.recommendedAction ?? 'unknown'}`)
  console.log(`    Promotable: ${learning.promotable ? 'yes' : 'no'}`)
  if (learning.generatedAt) console.log(`    Generated: ${learning.generatedAt}`)
  console.log(`    Record: ${learning.recordReady ? 'ready' : 'missing'}`)
  console.log(`    Summary: ${learning.summaryReady ? 'ready' : 'missing'}`)
  if (learning.brainNodeId) console.log(`    Brain node: ${learning.brainNodeId}`)
  if (learning.recordPath) console.log(`    Record path: ${learning.recordPath}`)
  if (learning.summaryPath) console.log(`    Summary path: ${learning.summaryPath}`)
  if (learning.warnings.length > 0) {
    console.log('    Warnings:')
    for (const warning of learning.warnings.slice(0, 5)) {
      console.log(`      - ${warning}`)
    }
  }
}

export const targetStatusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show latest target research pipeline status and artifact links',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const snapshot = readMedicalWorkflowDashboard(projectDir)

    if (args.json) {
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }

    console.log('\n靶点研究管线状态')
    console.log('='.repeat(50))

    if (!snapshot.available || !snapshot.liveStatus) {
      console.log('  状态: 暂无运行记录')
      for (const error of snapshot.errors) console.log(`  提示: ${error}`)
      console.log('\n  请先运行: medscale analyze <GENE> --disease "<disease>"')
      return
    }

    const live = snapshot.liveStatus
    console.log(`  运行 ID: ${live.run_id ?? '—'}`)
    console.log(`  状态: ${live.status}`)
    console.log(`  靶点: ${live.target}`)
    console.log(`  疾病: ${live.disease}`)
    console.log(`  进度: ${live.progress_percent}%`)
    console.log(`  当前阶段: ${live.current_stage_label ?? live.current_stage ?? '—'}`)

    if (snapshot.manuscriptQuality) {
      const quality = snapshot.manuscriptQuality
      const verdict = quality.passed === true ? 'PASS' : quality.passed === false ? 'FAIL' : 'UNKNOWN'
      const score = quality.score == null ? '—' : quality.score
      console.log('\n  论文质量门禁:')
      console.log(`    结果: ${verdict}`)
      if (quality.grade) console.log(`    等级: ${quality.grade}`)
      console.log(`    分数: ${score}`)
      if (quality.errors != null || quality.warnings != null) {
        console.log(`    问题: ${quality.errors ?? 0} errors / ${quality.warnings ?? 0} warnings`)
      }
    }

    if (snapshot.manuscriptFactCheck) {
      const fact = snapshot.manuscriptFactCheck
      const verdict = fact.passed === true ? 'PASS' : fact.passed === false ? 'FAIL' : 'UNKNOWN'
      console.log('\n  医学事实核查:')
      console.log(`    结果: ${verdict}`)
      console.log(`    分数: ${fact.score ?? '—'}`)
      console.log(`    核查项: ${fact.claimsChecked ?? '—'}`)
      console.log(`    问题: ${fact.errors ?? 0} errors / ${fact.warnings ?? 0} warnings`)
    }

    if (snapshot.deliveryPackage) {
      console.log('\n  Delivery package:')
      console.log(`    ZIP: ${snapshot.deliveryPackage.exists ? 'ready' : 'missing'}`)
      if (snapshot.deliveryPackage.packagePath) {
        console.log(`    Path: ${snapshot.deliveryPackage.packagePath}`)
      }
      if (snapshot.deliveryPackage.size != null) {
        console.log(`    Size: ${Math.round(snapshot.deliveryPackage.size / 1024)} KB`)
      }
      if (snapshot.deliveryPackage.packageAudit) {
        const audit = snapshot.deliveryPackage.packageAudit
        const verdict = audit.passed === true ? 'PASS' : audit.passed === false ? 'FAIL' : 'UNKNOWN'
        console.log(`    Package audit: ${verdict}`)
        console.log(`    Entries: ${audit.entryCount ?? '-'}; checked files: ${audit.filesChecked ?? '-'}; image refs: ${audit.imageRefsChecked ?? '-'}`)
        if (audit.errors != null || audit.warnings != null) {
          console.log(`    Issues: ${audit.errors ?? 0} errors / ${audit.warnings ?? 0} warnings`)
        }
      }
    }

    printMemorySeedSummary(snapshot)
    printLearningCandidateSummary(snapshot)
    printDeliveryReadiness(snapshot)

    if (snapshot.business) {
      console.log('\n  商业规划摘要:')
      if (snapshot.business.totalDurationMonths != null) {
        console.log(`    周期: ${snapshot.business.totalDurationMonths} 个月`)
      }
      if (snapshot.business.totalCostEstimate != null) {
        console.log(`    成本估算: $${snapshot.business.totalCostEstimate}M`)
      }
    }

    if (snapshot.reports.length > 0) {
      console.log('\n  可下载报告:')
      for (const report of snapshot.reports.slice(0, 8)) {
        const mark = report.exists ? '✓' : '✗'
        console.log(`    [${mark}] ${report.label}: ${report.relativePath}`)
      }
    }
  },
})

export const targetDoctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check Python runtime and target-research-platform health',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const platform = resolveTargetPlatform(projectDir)
    const bridge = new PythonBridge({
      platformDir: platform?.platformDir ?? './target-research-platform',
    })
    const health = await bridge.healthCheck()
    const requirementsExists = platform
      ? existsSync(join(platform.platformDir, 'requirements.txt'))
      : false
    const runtimeReadiness = buildTargetRuntimeReadiness(projectDir)
    const platformOk = Boolean(platform && health.pythonAvailable && health.platformExists)

    const report = {
      ok: platformOk && runtimeReadiness.status !== 'blocked',
      platformFound: Boolean(platform),
      platformDir: platform?.platformDir ?? null,
      pythonAvailable: health.pythonAvailable,
      pythonVersion: health.pythonVersion ?? null,
      platformExists: health.platformExists,
      requirementsExists,
      runtimeReadiness,
      recommendations: [] as string[],
    }

    if (!platform) {
      report.recommendations.push('在 yixue-scale-engine 仓库根目录运行，或设置 --dir 指向仓库根。')
    }
    if (!health.pythonAvailable) {
      report.recommendations.push('安装 Python 3.10+ 并确保 python 在 PATH 中。')
    }
    if (platform && !requirementsExists) {
      report.recommendations.push('缺少 requirements.txt，请检查 target-research-platform 目录完整性。')
    }
    if (platform && health.pythonAvailable) {
      report.recommendations.push(`安装依赖: cd target-research-platform && pip install -r requirements.txt`)
    }
    report.recommendations.push(...runtimeReadiness.recommendations)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      process.exit(report.ok ? 0 : 1)
    }

    console.log('\n靶点研究环境诊断')
    console.log('='.repeat(50))
    console.log(`  平台目录: ${report.platformDir ?? '未找到'}`)
    console.log(`  Python: ${report.pythonAvailable ? report.pythonVersion : '不可用'}`)
    console.log(`  main.py: ${report.platformExists ? '存在' : '缺失'}`)
    console.log(`  requirements.txt: ${report.requirementsExists ? '存在' : '缺失'}`)
    console.log(`  MedSCALE runtime: ${runtimeReadiness.status} (${runtimeReadiness.score})`)

    console.log('\n  Runtime Doctor:')
    for (const card of runtimeReadiness.cards) {
      const mark = card.state === 'pass' ? 'PASS' : card.state === 'warning' ? 'WARN' : card.state === 'fail' ? 'FAIL' : 'PENDING'
      console.log(`    [${mark}] ${card.title}: ${card.statusLabel}`)
      console.log(`      ${card.summary}`)
    }

    if (report.recommendations.length > 0) {
      console.log('\n  建议:')
      for (const item of report.recommendations) console.log(`    - ${item}`)
    }

    console.log(`\n  总体: ${report.ok ? '可运行' : '需要修复'}`)
    process.exit(report.ok ? 0 : 1)
  },
})

export const targetOsPlanCommand = defineCommand({
  meta: {
    name: 'os-plan',
    description: 'Export the MedSCALE Research OS collaboration plan as read-only JSON',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const platform = resolveTargetPlatform(String(args.dir ?? PROJECT_DIR))
    if (!platform) {
      const payload = {
        success: false,
        error: 'target-research-platform not found; cannot build MedSCALE Research OS plan.',
      }
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2))
      } else {
        console.error(payload.error)
      }
      process.exit(1)
    }

    const result = readMedicalResearchOsPlan(platform)
    if (args.json) {
      console.log(JSON.stringify(result.parsed ?? {
        success: false,
        error: 'MedSCALE Research OS plan did not return JSON.',
        stderr: result.stderr.slice(-1000),
      }, null, 2))
      process.exit(result.code === 0 && result.parsed ? 0 : 1)
    }

    if (result.code !== 0 || !result.parsed) {
      console.error('MedSCALE Research OS plan generation failed.')
      if (result.stderr.trim()) console.error(result.stderr.trim())
      process.exit(1)
    }

    const plan = result.parsed
    const product = plan.product && typeof plan.product === 'object' && !Array.isArray(plan.product)
      ? plan.product as Record<string, unknown>
      : {}
    const loop = plan.agent_loop_readiness && typeof plan.agent_loop_readiness === 'object' && !Array.isArray(plan.agent_loop_readiness)
      ? plan.agent_loop_readiness as Record<string, unknown>
      : {}
    const runtime = plan.runtime_readiness && typeof plan.runtime_readiness === 'object' && !Array.isArray(plan.runtime_readiness)
      ? plan.runtime_readiness as Record<string, unknown>
      : {}
    const promptStudio = plan.prompt_studio && typeof plan.prompt_studio === 'object' && !Array.isArray(plan.prompt_studio)
      ? plan.prompt_studio as Record<string, unknown>
      : {}
    const templates = Array.isArray(promptStudio.templates) ? promptStudio.templates : []

    console.log('\nMedSCALE Research OS Plan')
    console.log('='.repeat(50))
    console.log(`  Product: ${String(product.name ?? 'MedSCALE Research OS')}`)
    console.log(`  Status: ${String(loop.status ?? 'unknown')} (${String(loop.score ?? '-')})`)
    console.log(`  Runtime: ${String(runtime.status ?? 'unknown')} (${String(runtime.score ?? '-')})`)
    console.log(`  Prompt templates: ${templates.length}`)
    console.log('\n  JSON:')
    console.log('    medscale os-plan --json')
  },
})

function parseTargetJsonArg(value: unknown, name: string): unknown {
  try {
    return JSON.parse(String(value ?? 'null').replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new Error(`${name} must be valid JSON.`)
  }
}

function parseTargetMetadata(value: unknown): Record<string, string | number | boolean> {
  const parsed = parseTargetJsonArg(value ?? '{}', '--metadata-json')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--metadata-json must be a JSON object.')
  }
  const metadata: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') metadata[key] = item
  }
  return metadata
}

function parseTargetNonNegative(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`)
  return parsed
}

function parseTargetPositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`)
  return parsed
}

function targetUsagePayload(args: Record<string, unknown>, root: string): unknown {
  if (args['usage-file']) return parseTargetJsonArg(readFileSync(resolve(root, String(args['usage-file'])), 'utf-8'), '--usage-file')
  if (args['usage-json']) return parseTargetJsonArg(args['usage-json'], '--usage-json')
  return undefined
}

function buildTargetModelUsageInput(args: Record<string, unknown>, root: string): ModelUsageInput {
  const provider = String(args.provider ?? '').trim()
  if (!provider) throw new Error('MedSCALE token record requires --provider.')
  const metadata = parseTargetMetadata(args['metadata-json'])
  for (const key of ['medical-lane', 'phase', 'gate', 'target', 'disease']) {
    if (args[key] !== undefined && args[key] !== '') metadata[key.replace('-', '_')] = String(args[key])
  }
  return buildModelUsageInput({
    provider,
    model: args.model ? String(args.model) : undefined,
    taskId: args['task-id'] ? String(args['task-id']) : undefined,
    sessionId: args['session-id'] ? String(args['session-id']) : undefined,
    inputTokens: parseTargetNonNegative(args['input-tokens'], '--input-tokens'),
    outputTokens: parseTargetNonNegative(args['output-tokens'], '--output-tokens'),
    cacheEligibleTokens: parseTargetNonNegative(args['cache-eligible-tokens'], '--cache-eligible-tokens'),
    cacheCreationInputTokens: parseTargetNonNegative(args['cache-creation-input-tokens'], '--cache-creation-input-tokens'),
    cacheReadInputTokens: parseTargetNonNegative(args['cache-read-input-tokens'], '--cache-read-input-tokens'),
    cachedTokens: parseTargetNonNegative(args['cached-tokens'], '--cached-tokens'),
    estimatedCostUsd: parseTargetNonNegative(args['estimated-cost-usd'], '--estimated-cost-usd'),
    metadata,
    timestamp: args.timestamp ? String(args.timestamp) : undefined,
    usagePayload: targetUsagePayload(args, root),
  })
}

export const targetTokenCommand = defineCommand({
  meta: {
    name: 'token',
    description: 'Record and report MedSCALE medical workflow token/cost usage',
  },
  subCommands: {
    record: defineCommand({
      meta: { name: 'record', description: 'Record real model usage for a medical research task' },
      args: {
        dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
        provider: { type: 'string', required: true, description: 'Model provider: anthropic, openai, codex, etc.' },
        model: { type: 'string', description: 'Optional model id' },
        'task-id': { type: 'string', description: 'Task id linked to this model usage' },
        'session-id': { type: 'string', description: 'Session id linked to this model usage' },
        'medical-lane': { type: 'string', description: 'Medical lane: literature, fact_check, package_audit, memory, agent_review, workflow' },
        phase: { type: 'string', description: 'Medical workflow phase' },
        gate: { type: 'string', description: 'Review gate linked to this usage' },
        target: { type: 'string', description: 'Target gene/symbol linked to this usage' },
        disease: { type: 'string', description: 'Disease context linked to this usage' },
        'usage-json': { type: 'string', description: 'Raw provider response or usage JSON' },
        'usage-file': { type: 'string', description: 'Path to a JSON file containing provider usage' },
        'input-tokens': { type: 'string', description: 'Explicit input token count; overrides usage JSON' },
        'output-tokens': { type: 'string', description: 'Explicit output token count; overrides usage JSON' },
        'cache-eligible-tokens': { type: 'string', description: 'Explicit cache-eligible token count' },
        'cache-creation-input-tokens': { type: 'string', description: 'Explicit Anthropic cache creation token count' },
        'cache-read-input-tokens': { type: 'string', description: 'Explicit Anthropic cache read token count' },
        'cached-tokens': { type: 'string', description: 'Explicit OpenAI cached token count' },
        'estimated-cost-usd': { type: 'string', description: 'Optional estimated cost in USD' },
        timestamp: { type: 'string', description: 'Optional ISO timestamp' },
        'metadata-json': { type: 'string', default: '{}', description: 'Additional JSON metadata' },
        json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
      },
      run({ args }) {
        const root = resolveTargetWorkspaceRoot(String(args.dir ?? PROJECT_DIR))
        const record = new ModelUsageLedger(targetScaleDir(root)).record(buildTargetModelUsageInput(args, root))
        if (args.json) {
          console.log(JSON.stringify(record, null, 2))
          return
        }
        console.log(`MedSCALE token usage recorded: ${record.id}`)
        console.log(`  Provider: ${record.provider}`)
        console.log(`  Model: ${record.model ?? 'unknown'}`)
        console.log(`  Tokens: input ${record.inputTokens}, output ${record.outputTokens}, total ${record.totalTokens}`)
        if (record.cacheSavingsTokens > 0) console.log(`  Cache savings: ${record.cacheSavingsTokens} tokens`)
        if (record.estimatedCostUsd !== undefined) console.log(`  Estimated cost: $${record.estimatedCostUsd.toFixed(6)}`)
      },
    }),
    ingest: defineCommand({
      meta: { name: 'ingest', description: 'Scan medical workflow JSON artifacts and ingest real model usage fields' },
      args: {
        dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
        target: { type: 'string', description: 'Target gene/symbol used to resolve delivery artifacts' },
        disease: { type: 'string', description: 'Disease context used to resolve delivery artifacts' },
        output: { type: 'string', default: './output', description: 'Output root under target-research-platform' },
        file: { type: 'string', description: 'JSON artifact path(s); comma or semicolon separated' },
        provider: { type: 'string', description: 'Default provider when artifact usage omits provider' },
        limit: { type: 'string', description: 'Maximum recent records to include in the embedded report' },
        json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
      },
      run({ args }) {
        const files = args.file ? [String(args.file)] : []
        const report = ingestTargetTokenUsage({
          projectDir: String(args.dir ?? PROJECT_DIR),
          output: args.output ? String(args.output) : undefined,
          target: args.target ? String(args.target) : undefined,
          disease: args.disease ? String(args.disease) : undefined,
          files,
          provider: args.provider ? String(args.provider) : undefined,
          limit: parseTargetPositiveInt(args.limit, '--limit'),
        })
        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        console.log('MedSCALE Token Usage Ingest')
        console.log(`  Status: ${report.status}`)
        console.log(`  Files scanned: ${report.scannedFiles.length}`)
        console.log(`  Recorded: ${report.recorded}`)
        console.log(`  Duplicates: ${report.duplicates}`)
        console.log(`  Skipped: ${report.skipped}`)
        console.log(`  Ledger records: ${report.tokenCost.summary.totalRecords}`)
        for (const source of report.sources.slice(0, 8)) {
          const provider = source.provider ?? 'provider-missing'
          console.log(`  ${source.status}: ${source.medicalLane} ${provider} ${source.totalTokens} tokens (${source.pointer})`)
        }
        for (const warning of report.warnings.slice(0, 8)) console.log(`  [WARN] ${warning}`)
      },
    }),
    report: defineCommand({
      meta: { name: 'report', description: 'Summarize MedSCALE token/cost usage by provider, task, day, and medical lane' },
      args: {
        dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
        day: { type: 'string', description: 'Exact UTC day in YYYY-MM-DD format' },
        since: { type: 'string', description: 'ISO timestamp lower bound' },
        until: { type: 'string', description: 'ISO timestamp upper bound' },
        'since-days': { type: 'string', default: '30', description: 'Relative time window when day/since/until are omitted; use all to disable' },
        provider: { type: 'string', description: 'Filter by provider' },
        model: { type: 'string', description: 'Filter by model id' },
        'task-id': { type: 'string', description: 'Filter by task id' },
        'session-id': { type: 'string', description: 'Filter by session id' },
        limit: { type: 'string', description: 'Maximum recent records to include; defaults to 20' },
        json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
      },
      run({ args }) {
        const report = buildTargetTokenCostReport({
          projectDir: String(args.dir ?? PROJECT_DIR),
          day: args.day ? String(args.day) : undefined,
          since: args.since ? String(args.since) : undefined,
          until: args.until ? String(args.until) : undefined,
          sinceDays: normalizeSinceDaysValue(args['since-days'], 30),
          provider: args.provider ? String(args.provider) : undefined,
          model: args.model ? String(args.model) : undefined,
          taskId: args['task-id'] ? String(args['task-id']) : undefined,
          sessionId: args['session-id'] ? String(args['session-id']) : undefined,
          limit: parseTargetPositiveInt(args.limit, '--limit'),
        })
        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        console.log('MedSCALE Token/Cost Report')
        console.log(`  Status: ${report.status}`)
        console.log(`  Records: ${report.summary.totalRecords}`)
        console.log(`  Tokens: input ${report.summary.totalInputTokens}, output ${report.summary.totalOutputTokens}, total ${report.summary.totalTokens}`)
        console.log(`  Cache savings: ${report.summary.cacheSavingsTokens} tokens`)
        if (report.summary.estimatedCostUsd !== undefined) console.log(`  Estimated cost: $${report.summary.estimatedCostUsd.toFixed(6)}`)
        for (const lane of report.byMedicalLane.slice(0, 6)) {
          const cost = lane.estimatedCostUsd !== undefined ? `, $${lane.estimatedCostUsd.toFixed(6)}` : ''
          console.log(`  ${lane.label}: ${lane.records} record(s), ${lane.totalTokens} tokens${cost}`)
        }
        for (const item of report.recommendations) console.log(`  Next: ${item}`)
      },
    }),
  },
})

export const targetSetupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Plan or initialize MedSCALE Research OS third-party capabilities and medical platform checks',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    lang: { type: 'string', default: undefined, description: 'Output language: zh or en' },
    platform: { type: 'string', default: undefined, description: 'Target platform: windows, macos, or linux' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
    visual: { type: 'boolean', default: false, description: 'Show the researcher-facing visual setup plan' },
    apply: { type: 'boolean', default: false, description: 'Initialize bundled MedSCALE medical platform files without overwriting existing files' },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? PROJECT_DIR)
    const applyReport = args.apply ? applyTargetSetup({ projectDir, lang: args.lang }) : null
    const plan = buildTargetSetupPlan({
      projectDir,
      lang: args.lang,
      platform: args.platform,
    })
    const payload = {
      ...plan,
      requestedApply: Boolean(args.apply),
      requestedVisual: Boolean(args.visual),
      applyAvailable: false,
      applyMessage: plan.lang === 'zh'
        ? 'setup 当前是 plan-only；请按 install/verify 命令逐项执行。'
        : 'setup is currently plan-only; run each install/verify command explicitly.',
    }

    ;(payload as Record<string, unknown>).applyAvailable = true
    ;(payload as Record<string, unknown>).applyReport = applyReport
    ;(payload as Record<string, unknown>).applyMessage = args.apply
      ? (applyReport?.ok
        ? targetText(plan.lang, 'MedSCALE Research OS 初始化完成；下一步运行 doctor 和医学研究命令。', 'MedSCALE Research OS initialization completed; run doctor and medical research commands next.')
        : targetText(plan.lang, 'MedSCALE Research OS 初始化未完全完成；请查看 applyReport.warnings。', 'MedSCALE Research OS initialization did not fully complete; inspect applyReport.warnings.'))
      : targetText(
        plan.lang,
        'setup 默认只展示计划；需要初始化当前工作区时运行 medscale setup --apply --lang zh。',
        'setup shows the plan by default; run medscale setup --apply --lang en to initialize this workspace.',
      )

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      process.exit(plan.status === 'blocked' || applyReport?.ok === false ? 1 : 0)
    }

    console.log(args.visual ? renderTargetSetupVisualPlan(plan) : renderTargetSetupPlan(plan))
    if (args.apply) {
      console.log('')
      console.log(payload.applyMessage)
      if (applyReport) {
        console.log(`  copied=${applyReport.copied} skipped=${applyReport.skipped} missing=${applyReport.missing}`)
        for (const command of applyReport.nextCommands) console.log(`  next: ${command}`)
      }
    }
    process.exit(plan.status === 'blocked' || applyReport?.ok === false ? 1 : 0)
  },
})

export const targetDashboardCommand = defineCommand({
  meta: {
    name: 'dashboard',
    description: 'Start local web dashboard for target research results',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    host: { type: 'string', default: '127.0.0.1', description: 'Bind host' },
    port: { type: 'string', default: '18766', description: 'Bind port' },
  },
  async run({ args }) {
    const platform = resolveTargetPlatform(String(args.dir ?? PROJECT_DIR))
    if (!platform) {
      console.error('未找到 target-research-platform，无法启动 Dashboard。')
      process.exit(1)
    }

    const dashboardModule = join(platform.platformDir, 'src', 'dashboard', 'app.py')
    if (!existsSync(dashboardModule)) {
      console.error(`Dashboard 模块不存在: ${dashboardModule}`)
      process.exit(1)
    }

    console.log(`启动医学研究工作台: http://${args.host}:${args.port}`)
    console.log('按 Ctrl+C 停止服务\n')

    const child = spawn(
      'python',
      ['-m', 'src.dashboard.app', '--host', String(args.host), '--port', String(args.port)],
      { cwd: platform.platformDir, stdio: 'inherit', env: process.env },
    )

    child.on('exit', (code) => process.exit(code ?? 0))
  },
})

export const targetManuscriptCommand = defineCommand({
  meta: {
    name: 'manuscript',
    description: 'Generate a journal manuscript draft from existing target research outputs',
  },
  args: {
    target: { type: 'string', required: true, description: 'Target gene symbol, e.g. CDK4' },
    disease: { type: 'string', required: true, description: 'Disease name, e.g. "breast cancer"' },
    output: { type: 'string', default: './output', description: 'Output root under target-research-platform' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    'fail-on-quality': { type: 'boolean', default: false, description: 'Exit non-zero when manuscript quality gate fails' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const platform = resolveTargetPlatform(String(args.dir ?? PROJECT_DIR))
    if (!platform) {
      console.error('target-research-platform not found; cannot generate manuscript.')
      process.exit(1)
    }

    const commandArgs = [
      'manuscript',
      '--target',
      String(args.target),
      '--disease',
      String(args.disease),
      '--output',
      String(args.output ?? './output'),
    ]
    if (args['fail-on-quality']) commandArgs.push('--fail-on-quality')
    if (args.json) commandArgs.push('--json')

    if (!args.json) {
      console.log(`\nGenerating manuscript draft: ${args.target} / ${args.disease}`)
    }

    const result = runPythonCommand(platform, commandArgs, {
      json: Boolean(args.json),
      inherit: !args.json,
    })

    if (args.json) {
      if (result.parsed) {
        console.log(JSON.stringify(result.parsed, null, 2))
      } else {
        console.log(JSON.stringify({
          success: false,
          error: 'Manuscript command finished without JSON output',
          stderr: result.stderr.slice(-1000),
        }, null, 2))
      }
    }

    process.exit(result.code)
  },
})

export const targetRememberCommand = defineCommand({
  meta: {
    name: 'remember',
    description: 'Seed the latest medical delivery artifacts into the configured memory provider',
  },
  args: {
    target: { type: 'string', required: true, description: 'Target gene symbol, e.g. CDK4' },
    disease: { type: 'string', required: true, description: 'Disease name, e.g. "breast cancer"' },
    output: { type: 'string', default: './output', description: 'Output root under target-research-platform' },
    provider: { type: 'string', default: 'gbrain', description: 'Memory provider id, default gbrain' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const report = seedTargetDeliveryMemory({
      projectDir: String(args.dir ?? PROJECT_DIR),
      output: String(args.output ?? './output'),
      target: String(args.target),
      disease: String(args.disease),
      provider: String(args.provider ?? 'gbrain'),
    })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      process.exit(report.ok ? 0 : 1)
    }

    console.log(`\nSeeding medical delivery memory: ${args.target} / ${args.disease}`)
    console.log(`  Provider: ${report.provider}`)
    if (report.manifestPath) console.log(`  Manifest: ${report.manifestPath}`)
    if (report.summaryPath) console.log(`  Summary: ${report.summaryPath}`)
    if (report.recordPath) console.log(`  Record: ${report.recordPath}`)
    console.log(`  Files: ${report.sourceFiles.length}`)
    if (report.missingRoles.length > 0) {
      console.log(`  Missing roles: ${report.missingRoles.join(', ')}`)
    }
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    process.exit(report.ok ? 0 : 1)
  },
})

export const targetLearnCommand = defineCommand({
  meta: {
    name: 'learn',
    description: 'Settle the latest medical delivery into a reviewable learning candidate for Memory Brain',
  },
  args: {
    target: { type: 'string', required: true, description: 'Target gene symbol, e.g. CDK4' },
    disease: { type: 'string', required: true, description: 'Disease name, e.g. "breast cancer"' },
    output: { type: 'string', default: './output', description: 'Output root under target-research-platform' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    'seed-memory': { type: 'boolean', default: false, description: 'Seed delivery memory before settling the learning candidate' },
    provider: { type: 'string', default: 'gbrain', description: 'Memory provider id used with --seed-memory' },
    'ingest-memory-brain': { type: 'boolean', default: false, description: 'Also ingest the learning candidate into Memory Brain as a candidate node' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const memorySeed = args['seed-memory']
      ? seedTargetDeliveryMemory({
          projectDir: String(args.dir ?? PROJECT_DIR),
          output: String(args.output ?? './output'),
          target: String(args.target),
          disease: String(args.disease),
          provider: String(args.provider ?? 'gbrain'),
        })
      : null

    const report = settleTargetDeliveryLearning({
      projectDir: String(args.dir ?? PROJECT_DIR),
      output: String(args.output ?? './output'),
      target: String(args.target),
      disease: String(args.disease),
      memorySeed,
      ingestToBrain: Boolean(args['ingest-memory-brain']),
    })

    if (args.json) {
      console.log(JSON.stringify({
        ...report,
        ...(memorySeed ? { memory_seed: memorySeed } : {}),
      }, null, 2))
      process.exit(report.ok ? 0 : 1)
    }

    console.log(`\nSettling medical learning candidate: ${args.target} / ${args.disease}`)
    console.log(`  Candidate: ${report.candidateId ?? 'n/a'}`)
    console.log(`  Recommended action: ${report.recommendedAction ?? 'n/a'}`)
    console.log(`  Promotable: ${report.promotable ? 'yes' : 'no'}`)
    if (report.candidatePath) console.log(`  Candidate path: ${report.candidatePath}`)
    if (report.candidateMarkdownPath) console.log(`  Candidate markdown: ${report.candidateMarkdownPath}`)
    if (report.mirrorRecordPath) console.log(`  Delivery record: ${report.mirrorRecordPath}`)
    if (report.mirrorSummaryPath) console.log(`  Delivery summary: ${report.mirrorSummaryPath}`)
    if (report.brainNodeId) console.log(`  Brain node: ${report.brainNodeId}`)
    for (const warning of report.warnings.slice(0, 8)) console.log(`  [WARN] ${warning}`)
    process.exit(report.ok ? 0 : 1)
  },
})

export const targetMemoryReviewCommand = defineCommand({
  meta: {
    name: 'memory-review',
    description: 'Review a Memory Brain learning candidate: approve, reject, stale, or restore',
  },
  args: {
    action: { type: 'positional', required: true, description: 'Review action: approve, reject, stale, or restore' },
    'candidate-id': { type: 'string', description: 'Learning candidate id; defaults to the latest candidate' },
    reviewer: { type: 'string', default: 'medscale', description: 'Reviewer id/name for the audit record' },
    reason: { type: 'string', description: 'Short review reason' },
    scope: { type: 'string', description: 'Memory scope: project, workspace, or global-candidate' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  run({ args }) {
    let action: MemoryReviewAction
    let scope: MemoryNodeScope | undefined
    try {
      action = normalizeMemoryReviewAction(args.action)
      scope = normalizeTargetMemoryScope(args.scope)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
      return
    }

    const report = reviewMemoryLearningCandidate({
      projectDir: String(args.dir ?? PROJECT_DIR),
      candidateId: args['candidate-id'] ? String(args['candidate-id']) : undefined,
      action,
      reviewer: String(args.reviewer ?? 'medscale'),
      reason: args.reason ? String(args.reason) : undefined,
      scope,
    })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      process.exit(report.ok ? 0 : 1)
    }

    console.log(`\nMemory Brain review: ${action}`)
    console.log(`  Candidate: ${report.candidateId ?? 'n/a'}`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Node: ${report.nodeId ?? 'n/a'} (${report.nodeStatus ?? 'n/a'})`)
    if (report.reviewPath) console.log(`  Review record: ${report.reviewPath}`)
    if (report.reviewMarkdownPath) console.log(`  Review markdown: ${report.reviewMarkdownPath}`)
    for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    process.exit(report.ok ? 0 : 1)
  },
})

export const targetPackageCommand = defineCommand({
  meta: {
    name: 'package',
    description: 'Create a researcher-facing ZIP delivery package from generated manuscript artifacts',
  },
  args: {
    target: { type: 'string', required: true, description: 'Target gene symbol, e.g. CDK4' },
    disease: { type: 'string', required: true, description: 'Disease name, e.g. "breast cancer"' },
    output: { type: 'string', default: './output', description: 'Output root under target-research-platform' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project root directory' },
    'seed-memory': { type: 'boolean', default: false, description: 'After packaging, seed the resulting delivery artifacts into the memory provider' },
    'memory-provider': { type: 'string', default: 'gbrain', description: 'Memory provider id used with --seed-memory' },
    'settle-learning': { type: 'boolean', default: false, description: 'After packaging, settle the delivery into a reviewable learning candidate' },
    'ingest-memory-brain': { type: 'boolean', default: false, description: 'When settling learning, also ingest the candidate into Memory Brain' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable JSON' },
  },
  async run({ args }) {
    const platform = resolveTargetPlatform(String(args.dir ?? PROJECT_DIR))
    if (!platform) {
      console.error('target-research-platform not found; cannot package manuscript delivery.')
      process.exit(1)
    }

    const commandArgs = buildTargetPackageCommandArgs(args as Record<string, unknown>, Boolean(args.json))

    if (!args.json) {
      console.log(`\nPackaging manuscript delivery: ${args.target} / ${args.disease}`)
    }

    let packageResult = runPythonCommand(platform, commandArgs, {
      json: Boolean(args.json),
      inherit: !args.json,
    })

    let memorySeed: TargetMemorySeedReport | null = null
    if (packageResult.code === 0 && args['seed-memory']) {
      memorySeed = seedTargetDeliveryMemory({
        projectDir: String(args.dir ?? PROJECT_DIR),
        output: String(args.output ?? './output'),
        target: String(args.target),
        disease: String(args.disease),
        provider: String(args['memory-provider'] ?? 'gbrain'),
      })
    }

    let learningCandidate: TargetDeliveryLearningReport | null = null
    if (packageResult.code === 0 && args['settle-learning']) {
      learningCandidate = settleTargetDeliveryLearning({
        projectDir: String(args.dir ?? PROJECT_DIR),
        output: String(args.output ?? './output'),
        target: String(args.target),
        disease: String(args.disease),
        memorySeed,
        ingestToBrain: Boolean(args['ingest-memory-brain']),
      })
    }

    let refreshPackageError: string | null = null
    if (
      packageResult.code === 0
      && (memorySeed || learningCandidate)
    ) {
      const refreshed = runPythonCommand(
        platform,
        buildTargetPackageCommandArgs(args as Record<string, unknown>, true),
        { json: true, inherit: false },
      )
      if (refreshed.code === 0 && refreshed.parsed) {
        packageResult = refreshed
      } else {
        refreshPackageError = refreshed.stderr.trim() || refreshed.stdout.trim() || 'Package refresh finished without JSON output'
      }
    }

    const tokenUsageIngest = packageResult.code === 0
      ? ingestTargetTokenUsage({
          projectDir: String(args.dir ?? PROJECT_DIR),
          output: String(args.output ?? './output'),
          target: String(args.target),
          disease: String(args.disease),
        })
      : null

    if (args.json) {
      if (packageResult.parsed) {
        console.log(JSON.stringify({
          ...packageResult.parsed,
          ...(memorySeed ? { memory_seed: memorySeed } : {}),
          ...(learningCandidate ? { learning_candidate: learningCandidate } : {}),
          ...(tokenUsageIngest ? { token_usage_ingest: tokenUsageIngest } : {}),
          ...(refreshPackageError ? { refresh_package_error: refreshPackageError } : {}),
        }, null, 2))
      } else {
        console.log(JSON.stringify({
          success: false,
          error: 'Package command finished without JSON output',
          stderr: packageResult.stderr.slice(-1000),
          ...(memorySeed ? { memory_seed: memorySeed } : {}),
          ...(learningCandidate ? { learning_candidate: learningCandidate } : {}),
          ...(tokenUsageIngest ? { token_usage_ingest: tokenUsageIngest } : {}),
          ...(refreshPackageError ? { refresh_package_error: refreshPackageError } : {}),
        }, null, 2))
      }
    } else {
      if (memorySeed) {
        console.log(`  Memory seed: ${memorySeed.ok ? 'completed' : 'failed'} (${memorySeed.provider})`)
        if (memorySeed.summaryPath) console.log(`  Memory summary: ${memorySeed.summaryPath}`)
        if (memorySeed.recordPath) console.log(`  Memory record: ${memorySeed.recordPath}`)
        console.log(`  Seeded files: ${memorySeed.sourceFiles.length}`)
        if (memorySeed.missingRoles.length > 0) {
          console.log(`  Missing roles: ${memorySeed.missingRoles.join(', ')}`)
        }
        for (const warning of memorySeed.warnings.slice(0, 8)) console.log(`  [WARN] ${warning}`)
      }
      if (learningCandidate) {
        console.log(`  Learning candidate: ${learningCandidate.promotable ? 'ready-for-review' : learningCandidate.recommendedAction}`)
        if (learningCandidate.mirrorRecordPath) console.log(`  Learning record: ${learningCandidate.mirrorRecordPath}`)
        if (learningCandidate.mirrorSummaryPath) console.log(`  Learning summary: ${learningCandidate.mirrorSummaryPath}`)
        if (learningCandidate.brainNodeId) console.log(`  Brain node: ${learningCandidate.brainNodeId}`)
        for (const warning of learningCandidate.warnings.slice(0, 8)) console.log(`  [WARN] ${warning}`)
      }
      if (memorySeed || learningCandidate) {
        if (refreshPackageError) {
          console.log(`  [WARN] Delivery ZIP refresh failed: ${refreshPackageError}`)
        } else {
          console.log('  Delivery ZIP refreshed with memory-seed and learning-candidate artifacts.')
        }
      }
      if (tokenUsageIngest) {
        console.log(`  Token usage ingest: ${tokenUsageIngest.recorded} recorded, ${tokenUsageIngest.duplicates} duplicate, ${tokenUsageIngest.skipped} skipped`)
        for (const warning of tokenUsageIngest.warnings.slice(0, 4)) console.log(`  [WARN] ${warning}`)
      }
    }

    const exitCode = packageResult.code !== 0
      ? packageResult.code
      : (
        Boolean(refreshPackageError)
        || 
        (args['seed-memory'] && memorySeed && !memorySeed.ok)
        || (args['settle-learning'] && learningCandidate && !learningCandidate.ok)
      )
        ? 1
        : 0
    process.exit(exitCode)
  },
})

export const targetCommand = defineCommand({
  meta: {
    name: 'target',
    description: 'Medical target research pipeline - analyze, manuscript, package, status, dashboard, doctor',
  },
  subCommands: {
    analyze: targetAnalyzeCommand,
    manuscript: targetManuscriptCommand,
    remember: targetRememberCommand,
    learn: targetLearnCommand,
    'memory-review': targetMemoryReviewCommand,
    token: targetTokenCommand,
    package: targetPackageCommand,
    status: targetStatusCommand,
    doctor: targetDoctorCommand,
    'os-plan': targetOsPlanCommand,
    setup: targetSetupCommand,
    dashboard: targetDashboardCommand,
  },
})

/** 阶段标签映射（供测试和文档引用） */
export function formatStageLabel(stage: AnalysisStage): string {
  return STAGE_LABELS[stage]
}
