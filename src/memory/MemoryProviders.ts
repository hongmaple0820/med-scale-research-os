import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { MemoryBrain, type MemoryNode } from './MemoryBrain.js'
import { externalCommandExists } from '../core/ExternalCommand.js'
import { runGbrainCommandSync } from '../core/GbrainRuntime.js'

export type MemoryProviderKind = 'scale-local' | 'agentmemory' | 'gbrain' | 'generic-http'
export type MemoryProviderCapability = 'keyword-recall' | 'semantic-recall' | 'graph-recall' | 'session-memory' | 'mcp' | 'write-memory'
export type MemoryProviderSafetyLevel = 'trusted-local' | 'review-required' | 'blocked'
export type MemoryProviderWriteMode = 'disabled' | 'candidate-only' | 'enabled'

export interface MemoryProviderConfig {
  id: string
  kind: MemoryProviderKind
  enabled: boolean
  priority: number
  endpoint?: string
  statusPath?: string
  searchPath?: string
  apiKeyEnv?: string
  capabilities: MemoryProviderCapability[]
  safetyLevel: MemoryProviderSafetyLevel
  writeMode: MemoryProviderWriteMode
  attribution?: {
    license: string
    sourceUrl: string
    notice: string
  }
}

export interface MemoryProviderRoutingConfig {
  mode: 'auto' | 'local-only' | 'external-first'
  defaultOrder: string[]
  allowExternalWrite: boolean
  requireEvidence: boolean
  maxResultsPerProvider: number
}

export interface MemoryProvidersConfig {
  version: '1.0'
  routing: MemoryProviderRoutingConfig
  providers: MemoryProviderConfig[]
}

export interface MemoryProviderStatus {
  id: string
  kind: MemoryProviderKind
  enabled: boolean
  available: boolean
  selectedByDefault: boolean
  priority: number
  capabilities: MemoryProviderCapability[]
  safetyLevel: MemoryProviderSafetyLevel
  writeMode: MemoryProviderWriteMode
  reason: string
}

export interface MemoryProviderStatusReport {
  projectDir: string
  scaleDir: string
  configPath: string
  configExists: boolean
  routing: MemoryProviderRoutingConfig
  providers: MemoryProviderStatus[]
  availableProviderCount: number
  warnings: string[]
}

export interface MemoryProviderRecallInput {
  query: string
  task?: string
  files?: string[]
  limit?: number
  provider?: string
  includeCandidates?: boolean
}

export interface MemoryProviderRecallItem {
  provider: string
  id: string
  title: string
  summary: string
  confidence: number
  score: number
  evidencePaths: string[]
  sourceUrl?: string
  metadata?: Record<string, unknown>
}

export interface MemoryProviderRecallReport {
  ok: boolean
  projectDir: string
  generatedAt: string
  query: string
  providerOrder: string[]
  selectedProviders: string[]
  fallbackUsed: boolean
  items: MemoryProviderRecallItem[]
  providerStatuses: MemoryProviderStatus[]
  warnings: string[]
}

export interface MemoryProviderUseReport {
  ok: boolean
  projectDir: string
  scaleDir: string
  path: string
  existed: boolean
  provider: string
  mode: MemoryProviderRoutingConfig['mode']
  previousOrder: string[]
  nextOrder: string[]
  providerStatus?: MemoryProviderStatus
  warnings: string[]
}

export interface MemoryProviderImportReport {
  ok: boolean
  provider: string
  projectDir: string
  scaleDir: string
  sourceMode: 'defaults' | 'files'
  stagingDir?: string
  sourceFiles: string[]
  stagedFiles: string[]
  command?: string
  fileCount: number
  exitCode?: number
  stdout?: string
  stderr?: string
  providerStatus?: MemoryProviderStatus
  warnings: string[]
}

export interface GbrainCliHealth {
  available: boolean
  degraded: boolean
  reason: string
  status?: string
  healthScore?: number
}

export function defaultMemoryProvidersConfig(): MemoryProvidersConfig {
  return {
    version: '1.0',
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain', 'scale-local'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [
      {
        id: 'agentmemory',
        kind: 'agentmemory',
        enabled: false,
        priority: 90,
        endpoint: process.env.AGENTMEMORY_ENDPOINT,
        statusPath: '/health',
        searchPath: '/search',
        apiKeyEnv: 'AGENTMEMORY_API_KEY',
        capabilities: ['semantic-recall', 'session-memory', 'mcp'],
        safetyLevel: 'review-required',
        writeMode: 'disabled',
        attribution: {
          license: 'Apache-2.0',
          sourceUrl: 'https://github.com/rohitg00/agentmemory',
          notice: 'Optional external memory provider. Do not enable writes until retention, privacy, and delete boundaries are reviewed.',
        },
      },
      {
        id: 'gbrain',
        kind: 'gbrain',
        enabled: true,
        priority: 95,
        endpoint: process.env.GBRAIN_ENDPOINT,
        statusPath: '/health',
        searchPath: '/search',
        apiKeyEnv: 'GBRAIN_API_KEY',
        capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
        safetyLevel: 'review-required',
        writeMode: 'disabled',
        attribution: {
          license: 'MIT',
          sourceUrl: 'https://github.com/garrytan/gbrain',
          notice: 'Optional graph memory provider. Treat returned knowledge as recall evidence, not final truth.',
        },
      },
      {
        id: 'scale-local',
        kind: 'scale-local',
        enabled: true,
        priority: 10,
        capabilities: ['keyword-recall'],
        safetyLevel: 'trusted-local',
        writeMode: 'candidate-only',
      },
    ],
  }
}

const GBRAIN_DEFAULT_IMPORT_FILES = [
  'README.md',
  'AGENTS.md',
  'docs/guides/GETTING_STARTED.md',
  'docs/guides/DEVELOPMENT_WORKFLOW.md',
  'docs/MEMORY_FABRIC.md',
  'docs/guides/MEDICAL_RESEARCH_DELIVERY.md',
  'docs/guides/MEDICAL_AGENT_OPERATING_GUIDE.md',
  'docs/architecture/MEDICAL_RESEARCH_PLATFORM_ARCHITECTURE.md',
  'target-research-platform/README.md',
] as const

const SUPPORTED_IMPORT_EXTENSIONS = new Set(['.md', '.markdown', '.json', '.txt'])

export function memoryProvidersConfigPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'memory-providers.json')
}

export function writeMemoryProvidersConfig(options: {
  projectDir?: string
  scaleDir?: string
  force?: boolean
} = {}): { path: string; written: boolean; config: MemoryProvidersConfig } {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const path = memoryProvidersConfigPath(projectDir, options.scaleDir)
  if (existsSync(path) && !options.force) {
    return { path, written: false, config: loadMemoryProvidersConfig(projectDir, options.scaleDir).config }
  }
  mkdirSync(dirname(path), { recursive: true })
  const config = defaultMemoryProvidersConfig()
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return { path, written: true, config }
}

function saveMemoryProvidersConfig(projectDir: string, scaleDir: string | undefined, config: MemoryProvidersConfig): string {
  const path = memoryProvidersConfigPath(projectDir, scaleDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return path
}

export function loadMemoryProvidersConfig(projectDir = process.cwd(), scaleDir = '.scale'): {
  config: MemoryProvidersConfig
  path: string
  exists: boolean
} {
  const path = memoryProvidersConfigPath(projectDir, scaleDir)
  if (!existsSync(path)) return { config: defaultMemoryProvidersConfig(), path, exists: false }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<MemoryProvidersConfig>
    const defaults = defaultMemoryProvidersConfig()
    return {
      path,
      exists: true,
      config: {
        version: '1.0',
        routing: {
          ...defaults.routing,
          ...(parsed.routing ?? {}),
          defaultOrder: Array.isArray(parsed.routing?.defaultOrder) ? parsed.routing.defaultOrder.map(String) : defaults.routing.defaultOrder,
          maxResultsPerProvider: positiveInt(parsed.routing?.maxResultsPerProvider, defaults.routing.maxResultsPerProvider),
        },
        providers: normalizeProviders(parsed.providers, defaults.providers),
      },
    }
  } catch {
    return { config: defaultMemoryProvidersConfig(), path, exists: true }
  }
}

export function inspectMemoryProviders(options: {
  projectDir?: string
  scaleDir?: string
} = {}): MemoryProviderStatusReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const statuses = loaded.config.providers
    .map(provider => providerStatus(provider, loaded.config.routing))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  return {
    projectDir,
    scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
    configPath: loaded.path,
    configExists: loaded.exists,
    routing: loaded.config.routing,
    providers: statuses,
    availableProviderCount: statuses.filter(status => status.available).length,
    warnings: providerWarnings(statuses, loaded.config),
  }
}

export function useMemoryProvider(options: {
  projectDir?: string
  scaleDir?: string
  provider: string
  mode?: MemoryProviderRoutingConfig['mode']
  endpoint?: string
  writeMode?: MemoryProviderWriteMode
  allowExternalWrite?: boolean
}): MemoryProviderUseReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const provider = String(options.provider).trim()
  const config: MemoryProvidersConfig = {
    ...loaded.config,
    routing: {
      ...loaded.config.routing,
    },
    providers: loaded.config.providers.map(item => ({ ...item })),
  }
  const target = config.providers.find(item => item.id === provider)
  if (!target) {
    return {
      ok: false,
      projectDir,
      scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
      path: loaded.path,
      existed: loaded.exists,
      provider,
      mode: config.routing.mode,
      previousOrder: [...loaded.config.routing.defaultOrder],
      nextOrder: [...loaded.config.routing.defaultOrder],
      warnings: [`Unknown memory provider: ${provider}`],
    }
  }

  const previousOrder = [...config.routing.defaultOrder]
  target.enabled = true
  if (options.endpoint) target.endpoint = options.endpoint
  if (options.writeMode) target.writeMode = options.writeMode

  const nextOrder = [provider, ...config.routing.defaultOrder.filter(item => item !== provider)]
  config.routing.defaultOrder = nextOrder
  if (typeof options.allowExternalWrite === 'boolean') config.routing.allowExternalWrite = options.allowExternalWrite
  if (options.mode) config.routing.mode = options.mode
  else if (target.kind === 'scale-local') config.routing.mode = 'local-only'
  else if (config.routing.mode === 'local-only') config.routing.mode = 'external-first'

  const path = saveMemoryProvidersConfig(projectDir, options.scaleDir, config)
  const status = inspectMemoryProviders({ projectDir, scaleDir: options.scaleDir })
  return {
    ok: true,
    projectDir,
    scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
    path,
    existed: loaded.exists,
    provider,
    mode: status.routing.mode,
    previousOrder,
    nextOrder: [...status.routing.defaultOrder],
    providerStatus: status.providers.find(item => item.id === provider),
    warnings: status.warnings,
  }
}

export function importMemoryProviderKnowledge(options: {
  projectDir?: string
  scaleDir?: string
  provider: string
  files?: string[]
  noEmbed?: boolean
}): MemoryProviderImportReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleRoot = resolveScaleRoot(projectDir, options.scaleDir)
  const statusReport = inspectMemoryProviders({ projectDir, scaleDir: options.scaleDir })
  const provider = statusReport.providers.find(item => item.id === options.provider)
  if (!provider) {
    return {
      ok: false,
      provider: options.provider,
      projectDir,
      scaleDir: scaleRoot,
      sourceMode: options.files?.length ? 'files' : 'defaults',
      sourceFiles: [],
      stagedFiles: [],
      fileCount: 0,
      warnings: [`Unknown memory provider: ${options.provider}`],
    }
  }
  if (provider.kind !== 'gbrain') {
    return {
      ok: false,
      provider: provider.id,
      projectDir,
      scaleDir: scaleRoot,
      sourceMode: options.files?.length ? 'files' : 'defaults',
      sourceFiles: [],
      stagedFiles: [],
      fileCount: 0,
      providerStatus: provider,
      warnings: [`${provider.id} does not support markdown import via SCALE yet; use gbrain for project knowledge seeding.`],
    }
  }
  if (!commandExists('gbrain')) {
    return {
      ok: false,
      provider: provider.id,
      projectDir,
      scaleDir: scaleRoot,
      sourceMode: options.files?.length ? 'files' : 'defaults',
      sourceFiles: [],
      stagedFiles: [],
      fileCount: 0,
      providerStatus: provider,
      warnings: ['gbrain CLI is unavailable; install and initialize it before importing project knowledge.'],
    }
  }

  const resolvedSources = resolveImportSourceFiles(projectDir, options.files)
  if (resolvedSources.files.length === 0) {
    return {
      ok: false,
      provider: provider.id,
      projectDir,
      scaleDir: scaleRoot,
      sourceMode: resolvedSources.mode,
      sourceFiles: [],
      stagedFiles: [],
      fileCount: 0,
      providerStatus: provider,
      warnings: resolvedSources.warnings.length > 0
        ? resolvedSources.warnings
        : ['No markdown files were found for gbrain import.'],
    }
  }

  const staged = stageGbrainImportFiles(projectDir, scaleRoot, resolvedSources.files)
  if (staged.stagedFiles.length === 0) {
    return {
      ok: false,
      provider: provider.id,
      projectDir,
      scaleDir: scaleRoot,
      sourceMode: resolvedSources.mode,
      stagingDir: staged.stagingDir,
      sourceFiles: resolvedSources.files,
      stagedFiles: [],
      fileCount: resolvedSources.files.length,
      providerStatus: provider,
      warnings: [...resolvedSources.warnings, ...staged.warnings, 'No files were successfully staged for gbrain import.'],
    }
  }
  const args = ['import', staged.stagingDir]
  if (options.noEmbed !== false) args.push('--no-embed')
  const result = runGbrainCommandSync(args, {
    cwd: projectDir,
    timeout: 120_000,
  })

  return {
    ok: result.exitCode === 0,
    provider: provider.id,
    projectDir,
    scaleDir: scaleRoot,
    sourceMode: resolvedSources.mode,
    stagingDir: staged.stagingDir,
    sourceFiles: resolvedSources.files,
    stagedFiles: staged.stagedFiles,
    command: `gbrain ${args.map(quoteArg).join(' ')}`,
    fileCount: resolvedSources.files.length,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    providerStatus: provider,
    warnings: [
      ...resolvedSources.warnings,
      ...staged.warnings,
      ...(result.exitCode === 0 ? [] : [firstLine(result.stderr || result.stdout || 'gbrain import failed')]),
    ],
  }
}

export async function recallMemoryProviders(options: {
  projectDir?: string
  scaleDir?: string
} & MemoryProviderRecallInput): Promise<MemoryProviderRecallReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadMemoryProvidersConfig(projectDir, options.scaleDir)
  const statuses = inspectMemoryProviders({ projectDir, scaleDir: options.scaleDir }).providers
  const limit = Math.max(1, Math.floor(options.limit ?? loaded.config.routing.maxResultsPerProvider))
  const providers = orderedProviders(loaded.config, options.provider)
  const warnings: string[] = []
  const items: MemoryProviderRecallItem[] = []
  const selectedProviders: string[] = []
  let fallbackUsed = false

  for (const provider of providers) {
    const status = statuses.find(item => item.id === provider.id)
    if (!status?.available) {
      warnings.push(`${provider.id} skipped: ${status?.reason ?? 'not available'}`)
      continue
    }
    try {
      const recalled = provider.kind === 'scale-local'
        ? recallLocal(projectDir, options.scaleDir, provider, options, limit)
        : await recallExternal(provider, options, limit)
      if (recalled.length > 0) {
        selectedProviders.push(provider.id)
        items.push(...recalled)
      }
      if (provider.kind === 'scale-local' && providers.some(item => item.kind !== 'scale-local')) fallbackUsed = true
    } catch (error) {
      warnings.push(`${provider.id} recall failed: ${(error as Error).message}`)
    }
    if (items.length >= limit && !options.provider) break
  }

  return {
    ok: items.length > 0,
    projectDir,
    generatedAt: new Date().toISOString(),
    query: options.query,
    providerOrder: providers.map(provider => provider.id),
    selectedProviders,
    fallbackUsed,
    items: items
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
      .slice(0, limit),
    providerStatuses: statuses,
    warnings,
  }
}

function orderedProviders(config: MemoryProvidersConfig, providerId?: string): MemoryProviderConfig[] {
  const candidates = config.routing.mode === 'local-only'
    ? config.providers.filter(provider => provider.kind === 'scale-local')
    : config.providers
  const selected = providerId
    ? candidates.filter(provider => provider.id === providerId)
    : candidates.filter(provider => config.routing.defaultOrder.includes(provider.id))
  const order = config.routing.mode === 'local-only'
    ? ['scale-local']
    : config.routing.defaultOrder
  const fallbackSelected = selected.length > 0 ? selected : candidates
  return fallbackSelected.sort((a, b) => {
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    const orderRank = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    return orderRank || b.priority - a.priority || a.id.localeCompare(b.id)
  })
}

function resolveImportSourceFiles(
  projectDir: string,
  inputs?: string[],
): { mode: 'defaults' | 'files'; files: string[]; warnings: string[] } {
  const mode = inputs && inputs.length > 0 ? 'files' : 'defaults'
  const queue = inputs && inputs.length > 0 ? inputs : [...GBRAIN_DEFAULT_IMPORT_FILES]
  const warnings: string[] = []
  const files = new Set<string>()

  for (const raw of queue) {
    const candidate = String(raw ?? '').trim()
    if (!candidate) continue
    const resolved = resolve(projectDir, candidate)
    if (!existsSync(resolved)) {
      warnings.push(`Import source missing: ${candidate}`)
      continue
    }
    for (const file of collectImportableFiles(resolved)) files.add(file)
  }

  return {
    mode,
    files: [...files].sort((a, b) => a.localeCompare(b)),
    warnings,
  }
}

function collectImportableFiles(entryPath: string): string[] {
  if (!existsSync(entryPath)) return []
  const stats = statSync(entryPath)
  if (stats.isDirectory()) {
    return readdirSync(entryPath, { withFileTypes: true })
      .flatMap(entry => collectImportableFiles(join(entryPath, entry.name)))
  }
  return isImportableFile(entryPath) ? [entryPath] : []
}

function isImportableFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return SUPPORTED_IMPORT_EXTENSIONS.has(extension)
}

function stageGbrainImportFiles(
  projectDir: string,
  scaleRoot: string,
  files: string[],
): { stagingDir: string; stagedFiles: string[]; warnings: string[] } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const stagingDir = join(scaleRoot, 'memory-provider-imports', `${timestamp}-gbrain`)
  mkdirSync(stagingDir, { recursive: true })
  const stagedFiles: string[] = []
  const warnings: string[] = []

  files.forEach((filePath, index) => {
    const relativePath = normalizeDisplayPath(projectDir, filePath)
    const stagedName = `${String(index + 1).padStart(2, '0')}-${slugifyImportPath(relativePath)}.md`
    const stagedPath = join(stagingDir, stagedName)
    try {
      const wrapped = buildStagedImportDocument(relativePath, filePath)
      writeFileSync(stagedPath, wrapped, 'utf-8')
      stagedFiles.push(stagedPath)
    } catch (error) {
      warnings.push(`Failed to stage ${relativePath}: ${(error as Error).message}`)
    }
  })

  return { stagingDir, stagedFiles, warnings }
}

function buildStagedImportDocument(relativePath: string, filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  const original = readFileSync(filePath, 'utf-8')
  if (extension === '.json') {
    const normalized = tryPrettyPrintJson(original)
    const hints = buildStructuredArtifactHints(relativePath, original)
    return [
      '# Imported Structured Artifact',
      '',
      `Source path: ${relativePath}`,
      ...(hints.length > 0 ? [...hints, ''] : []),
      '',
      '```json',
      normalized,
      '```',
      '',
    ].join('\n')
  }
  if (extension === '.txt') {
    return [
      '# Imported Text Artifact',
      '',
      `Source path: ${relativePath}`,
      '',
      '```text',
      original,
      '```',
      '',
    ].join('\n')
  }
  return [
    '# Imported Repository Document',
    '',
    `Source path: ${relativePath}`,
    '',
    original,
    '',
  ].join('\n')
}

function tryPrettyPrintJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function buildStructuredArtifactHints(relativePath: string, raw: string): string[] {
  const hints: string[] = []
  const pathHint = relativePath
    .replace(/\.[^.]+$/u, '')
    .replace(/[\\/._-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (pathHint) hints.push(`Search hints: ${pathHint}`)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed as Record<string, unknown>).slice(0, 12)
      if (keys.length > 0) hints.push(`Top-level keys: ${keys.join(', ')}`)
    }
  } catch {
    // best effort only
  }

  return hints
}

function recallLocal(
  projectDir: string,
  scaleDir: string | undefined,
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
): MemoryProviderRecallItem[] {
  const brain = new MemoryBrain({ projectDir, scaleDir })
  try {
    const active = brain.query(input.query, { limit, status: 'active' }).nodes
    const nodes = active.length > 0 || !input.includeCandidates
      ? active
      : brain.query(input.query, { limit }).nodes
    return nodes.map(node => nodeToRecall(provider.id, node))
  } finally {
    brain.close()
  }
}

async function recallExternal(
  provider: MemoryProviderConfig,
  input: MemoryProviderRecallInput,
  limit: number,
): Promise<MemoryProviderRecallItem[]> {
  if (provider.kind === 'gbrain' && commandExists('gbrain')) {
    return recallGbrainCli(input, limit)
  }
  if (!provider.endpoint) return []
  const response = await fetch(new URL(provider.searchPath ?? '/search', provider.endpoint), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKeyEnv && process.env[provider.apiKeyEnv] ? { authorization: `Bearer ${process.env[provider.apiKeyEnv]}` } : {}),
    },
    body: JSON.stringify({
      query: input.query,
      task: input.task,
      files: input.files ?? [],
      limit,
    }),
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as unknown
  const raw = extractExternalResults(data)
  return raw.slice(0, limit).map((item, index) => externalToRecall(provider.id, item, index))
}

function extractExternalResults(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of ['results', 'items', 'memories', 'nodes', 'documents']) {
    const value = data[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

function externalToRecall(provider: string, item: Record<string, unknown>, index: number): MemoryProviderRecallItem {
  const title = firstString(item.title, item.name, item.summary, item.content, item.text) ?? `${provider} memory ${index + 1}`
  const summary = firstString(item.summary, item.content, item.text, item.body, item.markdown) ?? title
  const confidence = clampNumber(item.confidence ?? item.relevance ?? item.score, 0.5)
  const score = clampNumber(item.score ?? item.relevance ?? item.confidence, confidence)
  return {
    provider,
    id: firstString(item.id, item.key, item.memoryId) ?? `${provider}-${index + 1}`,
    title: truncate(title, 140),
    summary: truncate(summary, 500),
    confidence,
    score,
    evidencePaths: arrayOfStrings(item.evidencePaths ?? item.evidence_paths ?? item.sources),
    sourceUrl: firstString(item.url, item.sourceUrl, item.source_url),
    metadata: item,
  }
}

function nodeToRecall(provider: string, node: MemoryNode): MemoryProviderRecallItem {
  return {
    provider,
    id: node.id,
    title: node.title,
    summary: node.summary,
    confidence: node.confidence,
    score: node.confidence,
    evidencePaths: node.evidencePaths,
    metadata: {
      type: node.type,
      scope: node.scope,
      status: node.status,
      entities: node.entities,
    },
  }
}

function providerStatus(provider: MemoryProviderConfig, routing: MemoryProviderRoutingConfig): MemoryProviderStatus {
  if (!provider.enabled) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: 'disabled by memory provider policy',
    }
  }
  if (provider.kind === 'scale-local') {
    return {
      ...providerStatusBase(provider, routing),
      available: true,
      reason: 'local MemoryBrain fallback is available',
    }
  }
  if (provider.kind === 'gbrain' && commandExists('gbrain')) {
    const health = inspectGbrainCliHealth()
    if (health.available) {
      return {
        ...providerStatusBase(provider, routing),
        available: true,
        reason: health.reason,
      }
    }
    if (!provider.endpoint) {
      return {
        ...providerStatusBase(provider, routing),
        available: false,
        reason: health.reason,
      }
    }
  }
  if (!provider.endpoint) {
    return {
      ...providerStatusBase(provider, routing),
      available: false,
      reason: provider.kind === 'gbrain'
        ? `${provider.id} requires either a local gbrain CLI install or endpoint configuration before autonomous use`
        : `${provider.id} requires endpoint configuration before autonomous use`,
    }
  }
  return {
    ...providerStatusBase(provider, routing),
    available: true,
    reason: `${provider.id} endpoint configured; recall is read-only unless policy enables writes`,
  }
}

export function inspectGbrainCliHealth(): GbrainCliHealth {
  const result = runGbrainCommandSync(['doctor', '--json'], {
    timeout: 10_000,
  })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const parsed = parseGbrainDoctorReport(output)
  if (parsed && gbrainCoreRecallReady(parsed)) {
    return gbrainCoreReadyHealth(parsed)
  }
  if (result.exitCode === 0) {
    return { available: true, degraded: false, reason: 'gbrain doctor passed; graph-backed recall is available' }
  }
  return {
    available: false,
    degraded: false,
    reason: /no brain configured/i.test(output)
      ? 'gbrain CLI is installed but no brain is configured; run `gbrain init --pglite` before autonomous recall'
      : `gbrain CLI is installed but doctor failed: ${firstLine(output)}`,
  }
}

function gbrainCoreReadyHealth(report: GbrainDoctorReport): GbrainCliHealth {
  const status = typeof report.status === 'string' ? report.status : undefined
  const healthScore = typeof report.health_score === 'number' ? report.health_score : undefined
  const nonOkChecks = gbrainDoctorChecks(report)
    .filter(check => check.status !== 'ok')
    .map(check => check.name)
    .filter(Boolean)
  const optionalIssues = nonOkChecks.filter(check => !GBRAIN_CORE_RECALL_CHECKS.has(check))
  if (status === 'healthy' || optionalIssues.length === 0) {
    return {
      available: true,
      degraded: false,
      reason: 'gbrain doctor passed; graph-backed recall is available',
      status,
      healthScore,
    }
  }
  return {
    available: true,
    degraded: false,
    reason: `gbrain core recall is available; optional doctor warnings: ${optionalIssues.slice(0, 3).join(', ')}`,
    status,
    healthScore,
  }
}

interface GbrainDoctorReport {
  status?: unknown
  health_score?: unknown
  checks?: unknown
}

interface GbrainDoctorCheck {
  name: string
  status: string
  message?: string
}

function parseGbrainDoctorReport(output: string): GbrainDoctorReport | null {
  const json = extractFirstJsonObject(output)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return isRecord(parsed) ? parsed as GbrainDoctorReport : null
  } catch {
    return null
  }
}

function extractFirstJsonObject(output: string): string | null {
  const start = output.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < output.length; index += 1) {
    const char = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return output.slice(start, index + 1)
    }
  }
  return null
}

function gbrainCoreRecallReady(report: GbrainDoctorReport): boolean {
  const connection = gbrainDoctorCheckStatus(report, 'connection')
  const schema = gbrainDoctorCheckStatus(report, 'schema_version')
  const brainScore = gbrainDoctorCheckStatus(report, 'brain_score')
  return connection === 'ok' && (schema === 'ok' || brainScore === 'ok')
}

const GBRAIN_CORE_RECALL_CHECKS = new Set(['connection', 'schema_version', 'brain_score'])

function gbrainDoctorCheckStatus(report: GbrainDoctorReport, name: string): string | undefined {
  return gbrainDoctorChecks(report).find(check => check.name === name)?.status
}

function gbrainDoctorChecks(report: GbrainDoctorReport): GbrainDoctorCheck[] {
  if (!Array.isArray(report.checks)) return []
  return report.checks.filter(isRecord).map(check => ({
    name: String(check.name ?? ''),
    status: String(check.status ?? ''),
    message: typeof check.message === 'string' ? check.message : undefined,
  })).filter(check => check.name)
}

function providerStatusBase(provider: MemoryProviderConfig, routing: MemoryProviderRoutingConfig): Omit<MemoryProviderStatus, 'available' | 'reason'> {
  return {
    id: provider.id,
    kind: provider.kind,
    enabled: provider.enabled,
    selectedByDefault: routing.defaultOrder.includes(provider.id),
    priority: provider.priority,
    capabilities: provider.capabilities,
    safetyLevel: provider.safetyLevel,
    writeMode: provider.writeMode,
  }
}

function providerWarnings(statuses: MemoryProviderStatus[], config: MemoryProvidersConfig): string[] {
  const warnings: string[] = []
  if (!config.routing.allowExternalWrite && statuses.some(status => status.writeMode === 'enabled' && status.kind !== 'scale-local')) {
    warnings.push('External memory write is configured on a provider while routing.allowExternalWrite is false.')
  }
  if (!statuses.some(status => status.kind === 'scale-local' && status.available)) {
    warnings.push('scale-local fallback is unavailable; autonomous recall may fail closed.')
  }
  for (const status of statuses) {
    if (status.kind !== 'scale-local' && status.enabled && status.safetyLevel !== 'review-required') {
      warnings.push(`${status.id} should remain review-required until privacy and retention boundaries are recorded.`)
    }
  }
  return warnings
}

function recallGbrainCli(
  input: MemoryProviderRecallInput,
  limit: number,
): MemoryProviderRecallItem[] {
  const queryResult = runGbrainCli(['query', input.query], 8_000)
  const queryParsed = parseGbrainResults(queryResult.stdout)
  if (queryParsed.length > 0) {
    return queryParsed
      .slice(0, limit)
      .map((item, index) => externalToRecall('gbrain', item, index))
  }

  const searchResult = runGbrainCli(['search', input.query], 8_000)
  const searchParsed = parseGbrainResults(searchResult.stdout)
  if (searchParsed.length === 0 && queryResult.exitCode !== 0 && !queryResult.timedOut && searchResult.exitCode !== 0 && !searchResult.timedOut) {
    throw new Error(firstLine(queryResult.stderr || searchResult.stderr) || `gbrain query/search failed with exit code ${queryResult.exitCode}/${searchResult.exitCode}`)
  }
  return searchParsed
    .slice(0, limit)
    .map((item, index) => externalToRecall('gbrain', item, index))
}

function runGbrainCli(args: string[], timeout: number): { stdout: string; stderr: string; exitCode: number; timedOut: boolean } {
  const result = runGbrainCommandSync(args, {
    timeout,
    env: {
      ...process.env,
      GBRAIN_OUTPUT_MODE: process.env.GBRAIN_OUTPUT_MODE ?? 'json',
    },
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  }
}

function parseGbrainResults(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    return extractExternalResults(JSON.parse(trimmed))
  } catch {
    return parseGbrainTextResults(trimmed)
  }
}

function parseGbrainTextResults(stdout: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = []
  const lines = stdout.split(/\r?\n/)
  let current: Record<string, unknown> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const ranked = line.match(/^(\d+)\.\s+(.*)$/)
    if (ranked) {
      if (current) records.push(current)
      current = { title: ranked[2], summary: ranked[2] }
      continue
    }
    const scored = line.match(/^\[(\d+(?:\.\d+)?)\]\s+(.+?)(?:\s+--\s+(.*))?$/)
    if (scored) {
      if (current) records.push(current)
      current = {
        title: scored[2],
        summary: scored[3] ?? scored[2],
        score: Number(scored[1]),
        confidence: Number(scored[1]),
      }
      continue
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (current) current.summary = `${String(current.summary ?? '')} ${line.slice(2)}`.trim()
      continue
    }
    if (current) {
      current.summary = `${String(current.summary ?? '')} ${line}`.trim()
    }
  }
  if (current) records.push(current)
  return records
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? 'unknown error'
}

function commandExists(command: string): boolean {
  return externalCommandExists(command)
}

function normalizeProviders(input: unknown, defaults: MemoryProviderConfig[]): MemoryProviderConfig[] {
  if (!Array.isArray(input)) return defaults
  const byId = new Map(defaults.map(provider => [provider.id, provider]))
  const providers = input.filter(isRecord).map(item => {
    const id = String(item.id ?? '')
    const base = byId.get(id)
    return {
      ...(base ?? {}),
      ...item,
      id,
      kind: normalizeKind(item.kind, base?.kind),
      enabled: item.enabled !== false && Boolean(item.enabled ?? base?.enabled ?? false),
      priority: positiveInt(item.priority, base?.priority ?? 0),
      capabilities: arrayOfStrings(item.capabilities) as MemoryProviderCapability[],
      safetyLevel: normalizeSafety(item.safetyLevel, base?.safetyLevel),
      writeMode: normalizeWriteMode(item.writeMode, base?.writeMode),
    } as MemoryProviderConfig
  }).filter(provider => provider.id)
  for (const defaultProvider of defaults) {
    if (!providers.some(provider => provider.id === defaultProvider.id)) providers.push(defaultProvider)
  }
  return providers
}

function normalizeKind(value: unknown, fallback: MemoryProviderKind = 'generic-http'): MemoryProviderKind {
  return ['scale-local', 'agentmemory', 'gbrain', 'generic-http'].includes(String(value))
    ? value as MemoryProviderKind
    : fallback
}

function normalizeSafety(value: unknown, fallback: MemoryProviderSafetyLevel = 'review-required'): MemoryProviderSafetyLevel {
  return ['trusted-local', 'review-required', 'blocked'].includes(String(value))
    ? value as MemoryProviderSafetyLevel
    : fallback
}

function normalizeWriteMode(value: unknown, fallback: MemoryProviderWriteMode = 'disabled'): MemoryProviderWriteMode {
  return ['disabled', 'candidate-only', 'enabled'].includes(String(value))
    ? value as MemoryProviderWriteMode
    : fallback
}

function normalizeDisplayPath(projectDir: string, filePath: string): string {
  const relativePath = relative(projectDir, filePath)
  return relativePath && !relativePath.startsWith('..') ? relativePath.replace(/\\/g, '/') : filePath
}

function slugifyImportPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'document'
}

function quoteArg(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(value => typeof value === 'string' ? value.trim() : '').find(Boolean)
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function clampNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0.01, Math.min(1, Math.round(number * 100) / 100))
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value
}
