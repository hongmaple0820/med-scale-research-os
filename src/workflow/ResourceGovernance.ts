import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type ResourceAssetType =
  | 'canonical-doc'
  | 'task-artifact'
  | 'evidence-report'
  | 'temporary'
  | 'reusable-script'
  | 'generated-media'
  | 'contract'
  | 'decision-record'
  | 'unknown'

export type ResourceLifecycle =
  | 'maintained'
  | 'immutable'
  | 'task-scoped'
  | 'temporary'
  | 'generated'
  | 'review-required'

export type ResourceGitPolicy =
  | 'commit'
  | 'ignore'
  | 'lfs'
  | 'external'
  | 'review'

export type ResourceFindingSeverity = 'info' | 'warn' | 'fail'

export interface ResourceAsset {
  path: string
  type: ResourceAssetType
  lifecycle: ResourceLifecycle
  gitPolicy: ResourceGitPolicy
  reason: string
  sizeBytes: number
  modifiedAt: string
  tracked: boolean
  retentionDays?: number
  expiresAt?: string
  owner?: string
  module?: string
  sourceOfTruth?: boolean
}

export interface ResourceManifestAsset {
  path: string
  type?: ResourceAssetType
  lifecycle?: ResourceLifecycle
  gitPolicy?: ResourceGitPolicy
  owner?: string
  module?: string
  sourceOfTruth?: boolean
  retentionDays?: number
  lastReviewedAt?: string
  reviewIntervalDays?: number
}

export interface ResourceManifestFile {
  version?: number
  assets?: ResourceManifestAsset[]
}

export interface ResourcePolicyFile {
  version?: number
  maxGitFileSizeBytes?: number
  ignoredDirectories?: string[]
  retainedRuntimeDirectories?: string[]
  owners?: Record<string, string>
  modules?: Record<string, { path: string; owner?: string }>
}

export interface ResolvedResourcePolicy {
  version: number
  maxGitFileSizeBytes: number
  ignoredDirectories: string[]
  retainedRuntimeDirectories: string[]
  owners: Record<string, string>
  modules: Record<string, { path: string; owner?: string }>
  warnings: string[]
}

export interface ResolvedResourceManifest {
  version: number
  assets: ResourceManifestAsset[]
  warnings: string[]
}

export interface ResourceScanOptions {
  projectDir?: string
  scaleDir?: string
  includeIgnored?: boolean
  trackedPaths?: string[]
  now?: Date
}

export interface ResourceScanSummary {
  total: number
  byType: Record<ResourceAssetType, number>
  byGitPolicy: Record<ResourceGitPolicy, number>
  trackedForbidden: number
  expired: number
  largeTracked: number
}

export interface ResourceScanReport {
  projectDir: string
  policyPath: string
  manifestPath: string
  policy: ResolvedResourcePolicy
  manifest: ResolvedResourceManifest
  assets: ResourceAsset[]
  summary: ResourceScanSummary
  warnings: string[]
}

export interface ResourceFinding {
  severity: ResourceFindingSeverity
  code: string
  path?: string
  message: string
  fix?: string
}

export interface ResourceDoctorReport {
  ok: boolean
  projectDir: string
  findings: ResourceFinding[]
  scan: ResourceScanReport
}

export interface ResourceSettleOptions extends ResourceScanOptions {
  taskId?: string
  artifactsDir?: string
}

export interface ResourceSettleReport {
  ok: boolean
  taskId?: string
  resourceImpactPath?: string
  doctor: ResourceDoctorReport
}

interface Classification {
  type: ResourceAssetType
  lifecycle: ResourceLifecycle
  gitPolicy: ResourceGitPolicy
  reason: string
  retentionDays?: number
  sourceOfTruth?: boolean
}

const DEFAULT_IGNORED_DIRECTORIES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.next',
  '.turbo',
]

const DEFAULT_RUNTIME_DIRECTORIES = [
  '.scale/tmp',
  '.scale/evidence',
  '.scale/reports',
  '.scale/resource-reports',
  'tmp',
  'temp',
  'test-results',
  'playwright-report',
  'coverage',
]

const DEFAULT_OWNERS: Record<string, string> = {
  docs: 'engineering',
  'docs/standards': 'engineering',
  'docs/workflow': 'engineering',
  'docs/decisions': 'architecture',
  'docs/modules': 'module-owner',
  '.planning': 'engineering',
  '.scale': 'engineering',
}

const MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.wav',
  '.m4a',
])

const SCRIPT_EXTENSIONS = new Set(['.sh', '.ps1', '.cmd', '.bat', '.js', '.mjs', '.cjs', '.ts', '.py'])
const CONTRACT_EXTENSIONS = new Set(['.openapi.yaml', '.openapi.yml', '.proto'])
const RESOURCE_ASSET_TYPES: ResourceAssetType[] = [
  'canonical-doc',
  'task-artifact',
  'evidence-report',
  'temporary',
  'reusable-script',
  'generated-media',
  'contract',
  'decision-record',
  'unknown',
]
const RESOURCE_LIFECYCLES: ResourceLifecycle[] = [
  'maintained',
  'immutable',
  'task-scoped',
  'temporary',
  'generated',
  'review-required',
]
const RESOURCE_GIT_POLICIES: ResourceGitPolicy[] = ['commit', 'ignore', 'lfs', 'external', 'review']

export function resourcePolicyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'resource-policy.json')
}

export function resourceManifestPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'assets.json')
}

export function resourcePolicyTemplate(): string {
  return JSON.stringify({
    version: 1,
    maxGitFileSizeBytes: 5 * 1024 * 1024,
    ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES,
    retainedRuntimeDirectories: DEFAULT_RUNTIME_DIRECTORIES,
    owners: DEFAULT_OWNERS,
    modules: {
      example: {
        path: 'src/example',
        owner: 'team-or-owner',
      },
    },
  }, null, 2) + '\n'
}

export function resourceManifestTemplate(): string {
  return JSON.stringify({
    version: 1,
    assets: [],
  }, null, 2) + '\n'
}

export function loadResourcePolicy(projectDir = process.cwd(), scaleDir = '.scale'): ResolvedResourcePolicy {
  const path = resourcePolicyPath(projectDir, scaleDir)
  const warnings: string[] = []
  let parsed: ResourcePolicyFile = {}
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8')) as ResourcePolicyFile
    } catch (error) {
      warnings.push(`Failed to read ${path}: ${(error as Error).message}; using built-in defaults.`)
    }
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    maxGitFileSizeBytes: parsed.maxGitFileSizeBytes ?? 5 * 1024 * 1024,
    ignoredDirectories: parsed.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES,
    retainedRuntimeDirectories: parsed.retainedRuntimeDirectories ?? DEFAULT_RUNTIME_DIRECTORIES,
    owners: { ...DEFAULT_OWNERS, ...(parsed.owners ?? {}) },
    modules: parsed.modules ?? {},
    warnings,
  }
}

export function loadResourceManifest(projectDir = process.cwd(), scaleDir = '.scale'): ResolvedResourceManifest {
  const path = resourceManifestPath(projectDir, scaleDir)
  const warnings: string[] = []
  let parsed: ResourceManifestFile = {}
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8')) as ResourceManifestFile
    } catch (error) {
      warnings.push(`Failed to read ${path}: ${(error as Error).message}; using empty asset manifest.`)
    }
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    assets: Array.isArray(parsed.assets)
      ? parsed.assets
        .filter(item => item && typeof item === 'object' && typeof item.path === 'string' && item.path.length > 0)
        .map(item => ({
          path: normalizePath(item.path),
          type: isResourceAssetType(item.type) ? item.type : undefined,
          lifecycle: isResourceLifecycle(item.lifecycle) ? item.lifecycle : undefined,
          gitPolicy: isResourceGitPolicy(item.gitPolicy) ? item.gitPolicy : undefined,
          owner: typeof item.owner === 'string' ? item.owner : undefined,
          module: typeof item.module === 'string' ? item.module : undefined,
          sourceOfTruth: typeof item.sourceOfTruth === 'boolean' ? item.sourceOfTruth : undefined,
          retentionDays: typeof item.retentionDays === 'number' ? item.retentionDays : undefined,
          lastReviewedAt: typeof item.lastReviewedAt === 'string' ? item.lastReviewedAt : undefined,
          reviewIntervalDays: typeof item.reviewIntervalDays === 'number' ? item.reviewIntervalDays : undefined,
        }))
      : [],
    warnings,
  }
}

export function scanResourceAssets(options: ResourceScanOptions = {}): ResourceScanReport {
  const projectDir = options.projectDir ?? process.cwd()
  const scaleDir = options.scaleDir ?? '.scale'
  const policy = loadResourcePolicy(projectDir, scaleDir)
  const manifest = loadResourceManifest(projectDir, scaleDir)
  const manifestAssets = new Map(manifest.assets.map(asset => [normalizePath(asset.path), asset]))
  const tracked = new Set(options.trackedPaths ?? readTrackedPaths(projectDir))
  const files = walkFiles(projectDir, policy.ignoredDirectories)
  const now = options.now ?? new Date()
  const assets = files
    .map(file => classifyFile(projectDir, file, policy, manifestAssets, tracked, now))
    .filter((asset): asset is ResourceAsset => Boolean(asset))
  return {
    projectDir,
    policyPath: resourcePolicyPath(projectDir, scaleDir),
    manifestPath: resourceManifestPath(projectDir, scaleDir),
    policy,
    manifest,
    assets,
    summary: summarizeAssets(assets, policy, now),
    warnings: [...policy.warnings, ...manifest.warnings],
  }
}

export function doctorResourceAssets(options: ResourceScanOptions = {}): ResourceDoctorReport {
  const scan = scanResourceAssets(options)
  const now = options.now ?? new Date()
  const findings: ResourceFinding[] = []
  for (const warning of scan.policy.warnings) {
    findings.push({ severity: 'warn', code: 'policy-read-warning', message: warning })
  }
  for (const warning of scan.manifest.warnings) {
    findings.push({ severity: 'warn', code: 'manifest-read-warning', message: warning })
  }
  for (const asset of scan.manifest.assets) {
    const exists = existsSync(join(scan.projectDir, ...normalizePath(asset.path).split('/')))
    if (!exists && asset.sourceOfTruth) {
      findings.push({
        severity: 'fail',
        code: 'missing-source-of-truth',
        path: asset.path,
        message: 'Declared source-of-truth asset is missing from the workspace.',
        fix: 'Restore the maintained asset, update .scale/assets.json, or promote the replacement source of truth.',
      })
    } else if (!exists) {
      findings.push({
        severity: 'warn',
        code: 'missing-declared-resource',
        path: asset.path,
        message: 'Declared resource is missing from the workspace.',
        fix: 'Restore the file, update .scale/assets.json, or remove the stale catalog entry.',
      })
    }
    if (
      exists &&
      (asset.sourceOfTruth || asset.lifecycle === 'maintained') &&
      asset.lastReviewedAt &&
      asset.reviewIntervalDays &&
      isStaleReview(asset.lastReviewedAt, asset.reviewIntervalDays, now)
    ) {
      findings.push({
        severity: 'warn',
        code: 'stale-maintained-resource',
        path: asset.path,
        message: `Maintained resource was last reviewed at ${asset.lastReviewedAt}; review interval is ${asset.reviewIntervalDays} days.`,
        fix: 'Review the asset against current code and requirements, then update lastReviewedAt.',
      })
    }
  }
  for (const asset of scan.assets) {
    if (asset.tracked && (asset.gitPolicy === 'ignore' || asset.gitPolicy === 'external')) {
      findings.push({
        severity: 'fail',
        code: 'forbidden-tracked-resource',
        path: asset.path,
        message: `${asset.type} should not be tracked in Git (${asset.gitPolicy}).`,
        fix: 'Move it to runtime artifact storage, delete it from Git, or promote it to a maintained asset with an explicit policy.',
      })
    }
    if (asset.tracked && asset.sizeBytes > scan.policy.maxGitFileSizeBytes && asset.gitPolicy !== 'lfs') {
      findings.push({
        severity: 'warn',
        code: 'large-tracked-resource',
        path: asset.path,
        message: `Tracked file is ${asset.sizeBytes} bytes, above ${scan.policy.maxGitFileSizeBytes}.`,
        fix: 'Use Git LFS, external artifact storage, or keep only a lightweight source representation.',
      })
    }
    if (asset.expiresAt && new Date(asset.expiresAt).getTime() < now.getTime()) {
      findings.push({
        severity: 'warn',
        code: 'expired-resource',
        path: asset.path,
        message: `${asset.type} expired at ${asset.expiresAt}.`,
        fix: 'Delete it, archive it outside Git, or promote the final result into canonical documentation.',
      })
    }
    if (asset.type === 'canonical-doc' && !asset.owner) {
      findings.push({
        severity: 'warn',
        code: 'missing-owner',
        path: asset.path,
        message: 'Canonical documentation has no owner in resource policy.',
        fix: 'Add an owner under .scale/resource-policy.json owners or modules.',
      })
    }
  }
  return {
    ok: !findings.some(finding => finding.severity === 'fail'),
    projectDir: scan.projectDir,
    findings,
    scan,
  }
}

export function settleResourceAssets(options: ResourceSettleOptions = {}): ResourceSettleReport {
  const doctor = doctorResourceAssets(options)
  const resourceImpactPath = options.artifactsDir
    ? appendResourceImpact({
      projectDir: options.projectDir ?? process.cwd(),
      artifactsDir: options.artifactsDir,
      taskId: options.taskId,
      doctor,
    })
    : undefined
  return {
    ok: doctor.ok,
    taskId: options.taskId,
    resourceImpactPath,
    doctor,
  }
}

function classifyFile(
  projectDir: string,
  absolutePath: string,
  policy: ResolvedResourcePolicy,
  manifestAssets: Map<string, ResourceManifestAsset>,
  tracked: Set<string>,
  now: Date,
): ResourceAsset | null {
  const path = normalizePath(relative(projectDir, absolutePath))
  if (!path || path.startsWith('..')) return null
  const stat = statSync(absolutePath)
  const classification = classifyPath(path, policy)
  if (!classification) return null
  const selected = classification
  const manifestAsset = manifestAssets.get(path)
  const retentionDays = manifestAsset?.retentionDays ?? selected.retentionDays
  const expiresAt = retentionDays
    ? new Date(stat.mtime.getTime() + retentionDays! * 24 * 60 * 60 * 1000).toISOString()
    : undefined
  return {
    path,
    type: manifestAsset?.type ?? selected.type,
    lifecycle: manifestAsset?.lifecycle ?? selected.lifecycle,
    gitPolicy: manifestAsset?.gitPolicy ?? selected.gitPolicy,
    reason: selected.reason,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    tracked: tracked.has(path),
    retentionDays,
    expiresAt,
    owner: manifestAsset?.owner ?? ownerForPath(path, policy),
    module: manifestAsset?.module ?? moduleForPath(path, policy),
    sourceOfTruth: manifestAsset?.sourceOfTruth ?? selected.sourceOfTruth,
  }
}

function appendResourceImpact(options: {
  projectDir: string
  artifactsDir: string
  taskId?: string
  doctor: ResourceDoctorReport
}): string {
  const dir = isAbsolute(options.artifactsDir)
    ? options.artifactsDir
    : resolve(options.projectDir, options.artifactsDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, 'resource-impact.md')
  if (!existsSync(path)) {
    writeFileSync(path, '# Resource Impact\n\n', 'utf-8')
  }
  appendFileSync(path, resourceSettlementMarkdown(options), 'utf-8')
  return path
}

function resourceSettlementMarkdown(options: {
  taskId?: string
  doctor: ResourceDoctorReport
}): string {
  const findings = options.doctor.findings.length
    ? options.doctor.findings.map(finding => `| ${finding.severity.toUpperCase()} | ${finding.code} | ${escapeCell(finding.path ?? '')} | ${escapeCell(finding.message)} |`).join('\n')
    : '| OK | no-findings |  | No resource lifecycle findings. |'
  const summary = options.doctor.scan.summary
  return `
## SCALE Resource Settlement - ${new Date().toISOString()}

Task: ${options.taskId ?? 'unspecified'}
Status: ${options.doctor.ok ? 'passed' : 'blocked'}

| Metric | Value |
| --- | ---: |
| Total resources | ${summary.total} |
| Tracked forbidden | ${summary.trackedForbidden} |
| Large tracked | ${summary.largeTracked} |
| Expired | ${summary.expired} |

| Severity | Code | Path | Message |
| --- | --- | --- | --- |
${findings}
`
}

function classifyPath(path: string, policy: ResolvedResourcePolicy): Classification | null {
  if (path === resourcePolicyPath('', '').replace(/^[\\/]/, '') || path === '.scale/resource-policy.json' || path === '.scale/assets.json') {
    return { type: 'canonical-doc', lifecycle: 'maintained', gitPolicy: 'commit', reason: 'resource governance source of truth', sourceOfTruth: true }
  }
  if (path.startsWith('docs/decisions/') || /(^|\/)ADR-\d+/i.test(path)) {
    return { type: 'decision-record', lifecycle: 'immutable', gitPolicy: 'commit', reason: 'architecture decision record', sourceOfTruth: true }
  }
  if (
    path.startsWith('.planning/tasks/') &&
    (path.endsWith('.md') || path.endsWith('.html') || path.endsWith('/artifact-manifest.json'))
  ) {
    return { type: 'task-artifact', lifecycle: 'task-scoped', gitPolicy: 'review', reason: 'task planning or evidence artifact', retentionDays: 180 }
  }
  if (
    path.startsWith('.planning/archive/') &&
    (path.endsWith('.md') || path.endsWith('.html') || path.endsWith('/artifact-manifest.json'))
  ) {
    return { type: 'task-artifact', lifecycle: 'task-scoped', gitPolicy: 'review', reason: 'archived legacy task artifact', retentionDays: 365 }
  }
  if (
    path.startsWith('docs/worklog/tasks/') &&
    (path.endsWith('.md') || path.endsWith('.html') || path.endsWith('/artifact-manifest.json'))
  ) {
    return { type: 'task-artifact', lifecycle: 'task-scoped', gitPolicy: 'review', reason: 'legacy task evidence artifact; prefer .planning/tasks for new work', retentionDays: 180 }
  }
  if (path.startsWith('docs/modules/') || path.startsWith('docs/standards/') || path.startsWith('docs/architecture/') || path.startsWith('docs/workflow/') || /^docs\/[^/]+\.md$/i.test(path) || path === 'README.md' || path === 'CHANGELOG.md') {
    return { type: 'canonical-doc', lifecycle: 'maintained', gitPolicy: 'commit', reason: 'maintained project documentation', sourceOfTruth: true }
  }
  if (path.startsWith('scripts/tmp/') || path.startsWith('tmp/') || path.startsWith('temp/') || path.startsWith('.scale/tmp/')) {
    return { type: 'temporary', lifecycle: 'temporary', gitPolicy: 'ignore', reason: 'temporary workspace output', retentionDays: 7 }
  }
  if (isPythonBytecodeCache(path)) {
    return { type: 'temporary', lifecycle: 'temporary', gitPolicy: 'ignore', reason: 'Python bytecode cache generated by local tooling', retentionDays: 7 }
  }
  if (isRuntimePath(path, policy)) {
    const media = MEDIA_EXTENSIONS.has(extname(path).toLowerCase())
    return { type: media ? 'generated-media' : 'evidence-report', lifecycle: 'generated', gitPolicy: 'ignore', reason: 'runtime evidence or generated report', retentionDays: 30 }
  }
  if (path.startsWith('scripts/') && SCRIPT_EXTENSIONS.has(extname(path).toLowerCase())) {
    return { type: 'reusable-script', lifecycle: 'maintained', gitPolicy: 'commit', reason: 'reusable automation script', sourceOfTruth: true }
  }
  if (isContractPath(path)) {
    return { type: 'contract', lifecycle: 'maintained', gitPolicy: 'commit', reason: 'machine-readable interface contract', sourceOfTruth: true }
  }
  if (MEDIA_EXTENSIONS.has(extname(path).toLowerCase())) {
    const largeMedia = /\.(mp4|webm|mov|mp3|wav|m4a)$/i.test(path)
    return {
      type: 'generated-media',
      lifecycle: largeMedia ? 'review-required' : 'generated',
      gitPolicy: largeMedia ? 'external' : 'review',
      reason: largeMedia ? 'large media should live outside normal Git history' : 'media requires explicit documentation purpose',
      retentionDays: largeMedia ? 30 : undefined,
    }
  }
  return null
}

function isPythonBytecodeCache(path: string): boolean {
  return path.includes('/__pycache__/') || path.endsWith('.pyc') || path.endsWith('.pyo')
}

function summarizeAssets(assets: ResourceAsset[], policy: ResolvedResourcePolicy, now: Date): ResourceScanSummary {
  const byType = emptyTypeSummary()
  const byGitPolicy = emptyGitPolicySummary()
  for (const asset of assets) {
    byType[asset.type] += 1
    byGitPolicy[asset.gitPolicy] += 1
  }
  return {
    total: assets.length,
    byType,
    byGitPolicy,
    trackedForbidden: assets.filter(asset => asset.tracked && (asset.gitPolicy === 'ignore' || asset.gitPolicy === 'external')).length,
    expired: assets.filter(asset => asset.expiresAt && new Date(asset.expiresAt).getTime() < now.getTime()).length,
    largeTracked: assets.filter(asset => asset.tracked && asset.sizeBytes > policy.maxGitFileSizeBytes && asset.gitPolicy !== 'lfs').length,
  }
}

function walkFiles(projectDir: string, ignoredDirectories: string[]): string[] {
  if (!existsSync(projectDir)) return []
  const ignored = new Set(ignoredDirectories.map(normalizePath))
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      const rel = normalizePath(relative(projectDir, fullPath))
      if (entry.isDirectory()) {
        if (ignored.has(rel) || ignored.has(entry.name)) continue
        visit(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }
  visit(projectDir)
  return files
}

function readTrackedPaths(projectDir: string): string[] {
  try {
    return execFileSync('git', ['ls-files'], { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map(line => normalizePath(line.trim()))
      .filter(Boolean)
  } catch {
    return []
  }
}

function ownerForPath(path: string, policy: ResolvedResourcePolicy): string | undefined {
  if (path === '.scale/resource-policy.json' || path === '.scale/assets.json') return 'engineering'
  if (path === 'README.md' || path === 'CHANGELOG.md') return 'engineering'
  const ownerMatch = Object.entries(policy.owners)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => path === prefix || path.startsWith(`${normalizePath(prefix)}/`))
  if (ownerMatch) return ownerMatch[1]
  const moduleName = moduleForPath(path, policy)
  return moduleName ? policy.modules[moduleName]?.owner : undefined
}

function moduleForPath(path: string, policy: ResolvedResourcePolicy): string | undefined {
  for (const [name, module] of Object.entries(policy.modules)) {
    const modulePath = normalizePath(module.path)
    if (path === modulePath || path.startsWith(`${modulePath}/`)) return name
    if (path.startsWith(`docs/modules/${name}/`)) return name
  }
  const match = path.match(/^docs\/modules\/([^/]+)\//)
  return match?.[1]
}

function isRuntimePath(path: string, policy: ResolvedResourcePolicy): boolean {
  return policy.retainedRuntimeDirectories
    .map(normalizePath)
    .some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function isContractPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.startsWith('openapi/') || lower.startsWith('contracts/') || lower.startsWith('proto/')) return true
  if (lower.endsWith('.proto')) return true
  return [...CONTRACT_EXTENSIONS].some(suffix => lower.endsWith(suffix))
}

function isStaleReview(lastReviewedAt: string, reviewIntervalDays: number, now: Date): boolean {
  const reviewedAt = new Date(`${lastReviewedAt}T00:00:00Z`)
  if (Number.isNaN(reviewedAt.getTime()) || reviewIntervalDays <= 0) return false
  return now.getTime() - reviewedAt.getTime() > reviewIntervalDays * 24 * 60 * 60 * 1000
}

function isResourceAssetType(value: unknown): value is ResourceAssetType {
  return typeof value === 'string' && RESOURCE_ASSET_TYPES.includes(value as ResourceAssetType)
}

function isResourceLifecycle(value: unknown): value is ResourceLifecycle {
  return typeof value === 'string' && RESOURCE_LIFECYCLES.includes(value as ResourceLifecycle)
}

function isResourceGitPolicy(value: unknown): value is ResourceGitPolicy {
  return typeof value === 'string' && RESOURCE_GIT_POLICIES.includes(value as ResourceGitPolicy)
}

function emptyTypeSummary(): Record<ResourceAssetType, number> {
  return {
    'canonical-doc': 0,
    'task-artifact': 0,
    'evidence-report': 0,
    temporary: 0,
    'reusable-script': 0,
    'generated-media': 0,
    contract: 0,
    'decision-record': 0,
    unknown: 0,
  }
}

function emptyGitPolicySummary(): Record<ResourceGitPolicy, number> {
  return {
    commit: 0,
    ignore: 0,
    lfs: 0,
    external: 0,
    review: 0,
  }
}

function normalizePath(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//, '')
}

function resolveScaleRoot(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}
