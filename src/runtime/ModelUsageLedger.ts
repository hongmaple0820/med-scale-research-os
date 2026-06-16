import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ModelUsageInput {
  provider: string
  model?: string
  taskId?: string
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  cacheEligibleTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  cachedTokens?: number
  estimatedCostUsd?: number
  metadata?: Record<string, string | number | boolean>
  timestamp?: string
}

export interface ModelUsageRecord extends Required<Omit<ModelUsageInput, 'model' | 'taskId' | 'sessionId' | 'estimatedCostUsd' | 'metadata'>> {
  id: string
  model?: string
  taskId?: string
  sessionId?: string
  estimatedCostUsd?: number
  metadata?: Record<string, string | number | boolean>
  totalTokens: number
  cacheSavingsTokens: number
}

export interface ModelUsageSummary {
  totalRecords: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  cacheEligibleTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cachedTokens: number
  cacheSavingsTokens: number
  estimatedCostUsd?: number
  byProvider: Record<string, {
    records: number
    totalTokens: number
    cacheSavingsTokens: number
  }>
}

export interface ModelUsageFilter {
  day?: string
  since?: string
  until?: string
  provider?: string
  model?: string
  taskId?: string
  sessionId?: string
  limit?: number
  sort?: 'asc' | 'desc'
}

export interface ModelUsageBreakdownRow {
  key: string
  records: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheSavingsTokens: number
  estimatedCostUsd?: number
}

export interface ModelUsageReport {
  generatedAt: string
  filters: {
    day?: string
    since?: string
    until?: string
    provider?: string
    model?: string
    taskId?: string
    sessionId?: string
    limit: number
  }
  summary: ModelUsageSummary
  byProvider: ModelUsageBreakdownRow[]
  byModel: ModelUsageBreakdownRow[]
  byTask: ModelUsageBreakdownRow[]
  byDay: ModelUsageBreakdownRow[]
  records: ModelUsageRecord[]
}

export interface ModelUsagePayloadInput extends Omit<ModelUsageInput, 'inputTokens' | 'outputTokens' | 'cacheEligibleTokens' | 'cacheCreationInputTokens' | 'cacheReadInputTokens' | 'cachedTokens'> {
  usagePayload?: unknown
  inputTokens?: number
  outputTokens?: number
  cacheEligibleTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  cachedTokens?: number
}

export class ModelUsageLedger {
  private usageDir: string
  private usagePath: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.usageDir = join(scaleDir, 'model-usage')
    this.usagePath = join(this.usageDir, 'usage.jsonl')
  }

  record(input: ModelUsageInput): ModelUsageRecord {
    if (!existsSync(this.usageDir)) mkdirSync(this.usageDir, { recursive: true })
    const record = normalizeRecord(input)
    appendFileSync(this.usagePath, JSON.stringify(record) + '\n', 'utf-8')
    return record
  }

  list(filter: ModelUsageFilter = {}): ModelUsageRecord[] {
    const records = this.readAll()
      .filter(record => matchesFilter(record, filter))
      .sort((left, right) => compareRecordTimestamp(left, right, filter.sort ?? 'desc'))
    return applyLimit(records, filter.limit)
  }

  summarize(filter: ModelUsageFilter = {}): ModelUsageSummary {
    return summarizeRecords(this.list({ ...filter, limit: undefined }))
  }

  report(filter: ModelUsageFilter = {}): ModelUsageReport {
    const limit = normalizeLimit(filter.limit)
    const records = this.list({ ...filter, limit: undefined })
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        day: filter.day,
        since: filter.since,
        until: filter.until,
        provider: filter.provider,
        model: filter.model,
        taskId: filter.taskId,
        sessionId: filter.sessionId,
        limit,
      },
      summary: summarizeRecords(records),
      byProvider: breakdownRows(records, record => record.provider),
      byModel: breakdownRows(records, record => record.model ?? '(unknown)'),
      byTask: breakdownRows(records, record => record.taskId ?? '(none)'),
      byDay: breakdownRows(records, record => normalizeDay(record.timestamp) ?? '(unknown)'),
      records: limit > 0 ? records.slice(0, limit) : records,
    }
  }

  private readAll(): ModelUsageRecord[] {
    if (!existsSync(this.usagePath)) return []
    return readFileSync(this.usagePath, 'utf-8')
      .split('\n')
      .map(line => parseRecordLine(line))
      .filter((record): record is ModelUsageRecord => Boolean(record))
  }
}

export function buildModelUsageInput(input: ModelUsagePayloadInput): ModelUsageInput {
  const usage = findUsagePayload(input.usagePayload)
  const cacheCreationInputTokens = preferredNumber(
    input.cacheCreationInputTokens,
    usage,
    [['cache_creation_input_tokens'], ['cacheCreationInputTokens']],
  )
  const cacheReadInputTokens = preferredNumber(
    input.cacheReadInputTokens,
    usage,
    [['cache_read_input_tokens'], ['cacheReadInputTokens']],
  )
  const cachedTokens = preferredNumber(
    input.cachedTokens,
    usage,
    [
      ['cached_tokens'],
      ['prompt_tokens_details', 'cached_tokens'],
      ['input_tokens_details', 'cached_tokens'],
      ['promptTokensDetails', 'cachedTokens'],
      ['inputTokensDetails', 'cachedTokens'],
    ],
  )
  return {
    provider: input.provider,
    model: input.model,
    taskId: input.taskId,
    sessionId: input.sessionId,
    inputTokens: preferredNumber(
      input.inputTokens,
      usage,
      [['input_tokens'], ['prompt_tokens'], ['inputTokens'], ['promptTokens']],
    ),
    outputTokens: preferredNumber(
      input.outputTokens,
      usage,
      [['output_tokens'], ['completion_tokens'], ['outputTokens'], ['completionTokens']],
    ),
    cacheEligibleTokens: preferredNumber(
      input.cacheEligibleTokens,
      usage,
      [['cache_eligible_tokens'], ['cacheEligibleTokens']],
      Math.max(cacheCreationInputTokens, cacheReadInputTokens, cachedTokens),
    ),
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cachedTokens,
    estimatedCostUsd: input.estimatedCostUsd,
    metadata: input.metadata,
    timestamp: input.timestamp,
  }
}

function summarizeRecords(records: ModelUsageRecord[]): ModelUsageSummary {
  const summary: ModelUsageSummary = {
    totalRecords: records.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    cacheEligibleTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedTokens: 0,
    cacheSavingsTokens: 0,
    byProvider: {},
  }

  let cost: number | undefined
  for (const record of records) {
    summary.totalInputTokens += record.inputTokens
    summary.totalOutputTokens += record.outputTokens
    summary.totalTokens += record.totalTokens
    summary.cacheEligibleTokens += record.cacheEligibleTokens
    summary.cacheCreationInputTokens += record.cacheCreationInputTokens
    summary.cacheReadInputTokens += record.cacheReadInputTokens
    summary.cachedTokens += record.cachedTokens
    summary.cacheSavingsTokens += record.cacheSavingsTokens
    if (record.estimatedCostUsd !== undefined) cost = (cost ?? 0) + record.estimatedCostUsd
    const provider = summary.byProvider[record.provider] ?? { records: 0, totalTokens: 0, cacheSavingsTokens: 0 }
    provider.records += 1
    provider.totalTokens += record.totalTokens
    provider.cacheSavingsTokens += record.cacheSavingsTokens
    summary.byProvider[record.provider] = provider
  }
  if (cost !== undefined) summary.estimatedCostUsd = roundCost(cost)
  return summary
}

function normalizeRecord(input: ModelUsageInput): ModelUsageRecord {
  const inputTokens = nonNegative(input.inputTokens)
  const outputTokens = nonNegative(input.outputTokens)
  const cacheCreationInputTokens = nonNegative(input.cacheCreationInputTokens)
  const cacheReadInputTokens = nonNegative(input.cacheReadInputTokens)
  const cachedTokens = nonNegative(input.cachedTokens)
  const cacheSavingsTokens = Math.max(cacheReadInputTokens, cachedTokens)
  return {
    id: `USAGE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    taskId: input.taskId,
    sessionId: input.sessionId,
    inputTokens,
    outputTokens,
    cacheEligibleTokens: nonNegative(input.cacheEligibleTokens),
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cachedTokens,
    estimatedCostUsd: input.estimatedCostUsd,
    metadata: input.metadata,
    totalTokens: inputTokens + outputTokens,
    cacheSavingsTokens,
  }
}

function breakdownRows(records: ModelUsageRecord[], groupBy: (record: ModelUsageRecord) => string): ModelUsageBreakdownRow[] {
  const summaryByKey = new Map<string, ModelUsageBreakdownRow>()
  for (const record of records) {
    const key = groupBy(record)
    const row = summaryByKey.get(key) ?? {
      key,
      records: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheSavingsTokens: 0,
    }
    row.records += 1
    row.inputTokens += record.inputTokens
    row.outputTokens += record.outputTokens
    row.totalTokens += record.totalTokens
    row.cacheSavingsTokens += record.cacheSavingsTokens
    if (record.estimatedCostUsd !== undefined) {
      row.estimatedCostUsd = roundCost((row.estimatedCostUsd ?? 0) + record.estimatedCostUsd)
    }
    summaryByKey.set(key, row)
  }
  return [...summaryByKey.values()]
    .sort((left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key))
}

function matchesFilter(record: ModelUsageRecord, filter: ModelUsageFilter): boolean {
  if (filter.day && normalizeDay(record.timestamp) !== filter.day) return false
  if (filter.provider && record.provider !== filter.provider) return false
  if (filter.model && record.model !== filter.model) return false
  if (filter.taskId && record.taskId !== filter.taskId) return false
  if (filter.sessionId && record.sessionId !== filter.sessionId) return false

  const timestamp = parseTimestamp(record.timestamp)
  if (filter.since) {
    const since = parseTimestamp(filter.since)
    if (timestamp !== undefined && since !== undefined && timestamp < since) return false
  }
  if (filter.until) {
    const until = parseTimestamp(filter.until)
    if (timestamp !== undefined && until !== undefined && timestamp > until) return false
  }
  return true
}

function compareRecordTimestamp(left: ModelUsageRecord, right: ModelUsageRecord, sort: 'asc' | 'desc'): number {
  const leftTime = parseTimestamp(left.timestamp) ?? 0
  const rightTime = parseTimestamp(right.timestamp) ?? 0
  if (leftTime === rightTime) return left.id.localeCompare(right.id)
  return sort === 'asc' ? leftTime - rightTime : rightTime - leftTime
}

function applyLimit(records: ModelUsageRecord[], limit: number | undefined): ModelUsageRecord[] {
  const normalized = normalizeLimit(limit)
  return normalized > 0 ? records.slice(0, normalized) : records
}

function normalizeLimit(limit: number | undefined): number {
  return Number.isFinite(limit) && (limit ?? 0) > 0 ? Number(limit) : 20
}

function parseRecordLine(line: string): ModelUsageRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as ModelUsageRecord
  } catch {
    return null
  }
}

function findUsagePayload(payload: unknown): Record<string, unknown> | undefined {
  const root = asRecord(payload)
  if (!root) return undefined
  const response = asRecord(root.response)
  const result = asRecord(root.result)
  const data = asRecord(root.data)
  const candidates = [
    root,
    asRecord(root.usage),
    response ? asRecord(response.usage) : undefined,
    result ? asRecord(result.usage) : undefined,
    data ? asRecord(data.usage) : undefined,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
  return candidates.find(candidate => hasKnownUsageField(candidate))
}

function hasKnownUsageField(value: Record<string, unknown>): boolean {
  return [
    ['input_tokens'],
    ['prompt_tokens'],
    ['output_tokens'],
    ['completion_tokens'],
    ['cache_creation_input_tokens'],
    ['cache_read_input_tokens'],
    ['cached_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
  ].some(path => getNumberAtPath(value, path) !== undefined)
}

function preferredNumber(
  explicit: number | undefined,
  usage: Record<string, unknown> | undefined,
  paths: string[][],
  fallback = 0,
): number {
  if (explicit !== undefined) return nonNegative(explicit)
  if (!usage) return nonNegative(fallback)
  for (const path of paths) {
    const value = getNumberAtPath(usage, path)
    if (value !== undefined) return nonNegative(value)
  }
  return nonNegative(fallback)
}

function getNumberAtPath(record: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = record
  for (const key of path) {
    const object = asRecord(current)
    if (!object || !(key in object)) return undefined
    current = object[key]
  }
  return typeof current === 'number'
    ? current
    : typeof current === 'string' && current.trim() !== '' && !Number.isNaN(Number(current))
      ? Number(current)
      : undefined
}

function normalizeDay(timestamp: string): string | undefined {
  const parsed = parseTimestamp(timestamp)
  return parsed === undefined ? undefined : new Date(parsed).toISOString().slice(0, 10)
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value) || value < 0) return 0
  return value
}
