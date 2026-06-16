import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

export type DependencyAuditSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type DependencyAuditMode = 'compatibility' | 'strict' | 'offline'

export interface DependencyAuditPolicyFile {
  version?: number
  mode?: DependencyAuditMode
  maxPackages?: number
  maxPackageFiles?: number
  allowPackages?: string[]
  baselineFindings?: Array<{
    packageName: string
    version?: string
    ruleId: string
    reason?: string
  }>
}

export interface ResolvedDependencyAuditPolicy {
  version: number
  mode: DependencyAuditMode
  maxPackages: number
  maxPackageFiles: number
  allowPackages: string[]
  baselineFindings: Array<{
    packageName: string
    version?: string
    ruleId: string
    reason?: string
  }>
  warnings: string[]
}

export interface DependencyAuditFinding {
  packageName: string
  version?: string
  ruleId: string
  severity: DependencyAuditSeverity
  path?: string
  message: string
  evidence?: string
  fix?: string
}

export interface DependencyAuditSummary {
  packagesAudited: number
  totalFindings: number
  bySeverity: Record<DependencyAuditSeverity, number>
}

export interface DependencyAuditReport {
  ok: boolean
  projectDir: string
  lockfilePath?: string
  policyPath: string
  mode: DependencyAuditMode
  packagesAudited: string[]
  findings: DependencyAuditFinding[]
  blockers: string[]
  summary: DependencyAuditSummary
  warnings: string[]
}

export interface DependencyAuditOptions {
  projectDir?: string
  scaleDir?: string
  mode?: DependencyAuditMode
  changedPackages?: string[]
  maxPackages?: number
  maxPackageFiles?: number
}

interface PackageLockFile {
  packages?: Record<string, PackageLockPackage>
}

interface PackageLockPackage {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  hasInstallScript?: boolean
  bin?: string | Record<string, string>
  deprecated?: string
  resolved?: string
  integrity?: string
  main?: string
}

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs'])
const DEFAULT_MAX_PACKAGES = 50
const DEFAULT_MAX_PACKAGE_FILES = 25
const BUILT_IN_BLOCKED_PACKAGE_VERSIONS: Array<{
  packageName: string
  version: string
  severity: DependencyAuditSeverity
  message: string
}> = [
  {
    packageName: 'content-type',
    version: '2.0.0',
    severity: 'HIGH',
    message: 'Package version is flagged for ownership/provenance instability by external supply-chain analysis.',
  },
  {
    packageName: 'type-is',
    version: '2.1.0',
    severity: 'HIGH',
    message: 'Package version is flagged for ownership/provenance instability by external supply-chain analysis.',
  },
  {
    packageName: 'type-js',
    version: '2.1.0',
    severity: 'HIGH',
    message: 'Package version is flagged for ownership/provenance instability by external supply-chain analysis.',
  },
]

export function dependencyAuditPolicyTemplate(): string {
  return JSON.stringify({
    version: 1,
    mode: 'compatibility',
    maxPackages: DEFAULT_MAX_PACKAGES,
    maxPackageFiles: DEFAULT_MAX_PACKAGE_FILES,
    allowPackages: [],
    baselineFindings: [],
  }, null, 2) + '\n'
}

export function dependencyAuditPolicyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  const scaleRoot = scaleDir.includes(':') || scaleDir.startsWith('/') || scaleDir.startsWith('\\\\')
    ? scaleDir
    : join(projectDir, scaleDir)
  return join(scaleRoot, 'security', 'dependency-policy.json')
}

export function loadDependencyAuditPolicy(projectDir = process.cwd(), scaleDir = '.scale'): ResolvedDependencyAuditPolicy {
  const path = dependencyAuditPolicyPath(projectDir, scaleDir)
  const warnings: string[] = []
  let parsed: DependencyAuditPolicyFile = {}
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8')) as DependencyAuditPolicyFile
    } catch (error) {
      warnings.push(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}; using built-in defaults.`)
    }
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    mode: normalizeMode(parsed.mode) ?? 'compatibility',
    maxPackages: positiveNumber(parsed.maxPackages) ?? DEFAULT_MAX_PACKAGES,
    maxPackageFiles: positiveNumber(parsed.maxPackageFiles) ?? DEFAULT_MAX_PACKAGE_FILES,
    allowPackages: Array.isArray(parsed.allowPackages)
      ? parsed.allowPackages.filter(item => typeof item === 'string' && item.length > 0)
      : [],
    baselineFindings: Array.isArray(parsed.baselineFindings)
      ? parsed.baselineFindings.filter(item =>
        typeof item.packageName === 'string' &&
        typeof item.ruleId === 'string',
      )
      : [],
    warnings,
  }
}

export function auditDependencies(options: DependencyAuditOptions = {}): DependencyAuditReport {
  const projectDir = options.projectDir ?? process.cwd()
  const scaleDir = options.scaleDir ?? '.scale'
  const policy = loadDependencyAuditPolicy(projectDir, scaleDir)
  const mode = options.mode ?? policy.mode
  const lockfilePath = join(projectDir, 'package-lock.json')
  const warnings = [...policy.warnings]
  if (!existsSync(lockfilePath)) {
    warnings.push('No package-lock.json found; dependency audit skipped.')
    return createReport({
      projectDir,
      policyPath: dependencyAuditPolicyPath(projectDir, scaleDir),
      mode,
      packagesAudited: [],
      findings: [],
      warnings,
    })
  }

  let lockfile: PackageLockFile
  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf-8')) as PackageLockFile
  } catch (error) {
    warnings.push(`Failed to parse package-lock.json: ${error instanceof Error ? error.message : String(error)}`)
    return createReport({
      projectDir,
      lockfilePath,
      policyPath: dependencyAuditPolicyPath(projectDir, scaleDir),
      mode,
      packagesAudited: [],
      findings: [{
        packageName: 'package-lock.json',
        ruleId: 'dependency.lockfile-invalid',
        severity: mode === 'strict' ? 'HIGH' : 'LOW',
        path: 'package-lock.json',
        message: 'package-lock.json could not be parsed.',
      }],
      warnings,
    })
  }

  const packages = selectPackages(lockfile, {
    changedPackages: options.changedPackages,
    maxPackages: options.maxPackages ?? policy.maxPackages,
  }).filter(pkg => !policy.allowPackages.includes(pkg.name))

  const rawFindings = packages.flatMap(pkg => scanPackage(projectDir, pkg, options.maxPackageFiles ?? policy.maxPackageFiles))
  const findings = rawFindings.filter(finding => !isBaselineFinding(finding, policy))
  return createReport({
    projectDir,
    lockfilePath,
    policyPath: dependencyAuditPolicyPath(projectDir, scaleDir),
    mode,
    packagesAudited: packages.map(pkg => pkg.name),
    findings,
    warnings,
  })
}

function createReport(input: {
  projectDir: string
  lockfilePath?: string
  policyPath: string
  mode: DependencyAuditMode
  packagesAudited: string[]
  findings: DependencyAuditFinding[]
  warnings: string[]
}): DependencyAuditReport {
  const blockers = input.findings
    .filter(finding => shouldBlock(finding.severity, input.mode))
    .map(finding => `${finding.severity} ${finding.ruleId} in ${finding.packageName}${finding.version ? `@${finding.version}` : ''} - ${finding.message}`)
  return {
    ok: blockers.length === 0,
    projectDir: input.projectDir,
    lockfilePath: input.lockfilePath,
    policyPath: input.policyPath,
    mode: input.mode,
    packagesAudited: input.packagesAudited,
    findings: input.findings,
    blockers,
    summary: summarize(input.packagesAudited.length, input.findings),
    warnings: input.warnings,
  }
}

function selectPackages(lockfile: PackageLockFile, options: { changedPackages?: string[]; maxPackages: number }): Array<{ name: string; path: string; metadata: PackageLockPackage }> {
  const packages = lockfile.packages ?? {}
  const root = packages[''] ?? {}
  const direct = new Set([
    ...Object.keys(root.dependencies ?? {}),
    ...Object.keys(root.devDependencies ?? {}),
    ...Object.keys(root.optionalDependencies ?? {}),
  ])
  const requested = new Set(options.changedPackages?.length ? options.changedPackages : [...direct])
  return Object.entries(packages)
    .filter(([path]) => isTopLevelNodeModulePath(path))
    .map(([path, metadata]) => ({ name: packageNameFromLockPath(path), path, metadata }))
    .filter(pkg => requested.has(pkg.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(0, options.maxPackages))
}

function scanPackage(projectDir: string, pkg: { name: string; path: string; metadata: PackageLockPackage }, maxPackageFiles: number): DependencyAuditFinding[] {
  const findings: DependencyAuditFinding[] = []
  findings.push(...scanBuiltInBlockedVersions(pkg))
  if (pkg.metadata.hasInstallScript) {
    findings.push({
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.install-script',
      severity: 'HIGH',
      path: pkg.path,
      message: 'Dependency declares an install lifecycle script.',
      evidence: 'hasInstallScript=true',
      fix: 'Review package provenance, pin the version, or replace the dependency.',
    })
  }
  if (pkg.metadata.bin) {
    findings.push({
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.bin-script',
      severity: 'MEDIUM',
      path: pkg.path,
      message: 'Dependency exposes executable bin scripts.',
      evidence: typeof pkg.metadata.bin === 'string' ? pkg.metadata.bin : Object.keys(pkg.metadata.bin).join(', '),
      fix: 'Verify the command is intentionally used and comes from a trusted package.',
    })
  }
  if (pkg.metadata.deprecated) {
    findings.push({
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.deprecated',
      severity: 'HIGH',
      path: pkg.path,
      message: 'Dependency is marked deprecated.',
      evidence: pkg.metadata.deprecated,
      fix: 'Upgrade or replace the deprecated dependency.',
    })
  }
  findings.push(...scanPackageSource(projectDir, pkg, maxPackageFiles))
  return findings
}

function scanBuiltInBlockedVersions(pkg: { name: string; path: string; metadata: PackageLockPackage }): DependencyAuditFinding[] {
  const version = pkg.metadata.version
  if (!version) return []
  return BUILT_IN_BLOCKED_PACKAGE_VERSIONS
    .filter(entry => entry.packageName === pkg.name && entry.version === version)
    .map(entry => ({
      packageName: pkg.name,
      version,
      ruleId: 'dependency.ownership-unstable',
      severity: entry.severity,
      path: pkg.path,
      message: entry.message,
      evidence: `${pkg.name}@${version}`,
      fix: 'Pin to a reviewed stable version or replace the dependency until provenance is manually accepted.',
    }))
}

function scanPackageSource(projectDir: string, pkg: { name: string; path: string; metadata: PackageLockPackage }, maxPackageFiles: number): DependencyAuditFinding[] {
  const root = join(projectDir, ...pkg.path.split('/'))
  if (!existsSync(root)) return []
  const files: string[] = []
  walkPackage(root, files, maxPackageFiles)
  const findings: DependencyAuditFinding[] = []
  for (const file of files) {
    let content = ''
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue
    const relativePath = normalizePath(relative(projectDir, file))
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const finding = sourceFindingForLine(pkg, relativePath, index + 1, line)
      if (finding) findings.push(finding)
    }
  }
  return findings
}

// Packages that legitimately use eval/Function for browser automation, sandboxing, etc.
const KNOWN_EVAL_PACKAGES = new Set([
  'playwright',
  'playwright-core',
  'puppeteer-core',
  'puppeteer',
  'jsdom',
  'happy-dom',
])

function sourceFindingForLine(pkg: { name: string; metadata: PackageLockPackage }, path: string, lineNumber: number, line: string): DependencyAuditFinding | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return null
  if (/\beval\s*\(|new\s+Function\s*\(/.test(trimmed)) {
    return {
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.eval',
      severity: KNOWN_EVAL_PACKAGES.has(pkg.name) ? 'MEDIUM' : 'CRITICAL',
      path,
      message: 'Dependency source uses dynamic code execution.',
      evidence: `line ${lineNumber}: ${trimmed.slice(0, 180)}`,
      fix: 'Replace the dependency or pin and review a safe version.',
    }
  }
  if (/\bexecSync\s*\(|\bchild_process\.exec\s*\(|\bshell\s*:\s*true\b|\bspawn\s*\([^,\n]+,\s*[^,\n]+,\s*\{[^}]*shell\s*:\s*true/.test(trimmed)) {
    return {
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.shell-exec',
      severity: 'HIGH',
      path,
      message: 'Dependency source performs shell execution.',
      evidence: `line ${lineNumber}: ${trimmed.slice(0, 180)}`,
      fix: 'Review whether the dependency can execute user-controlled input.',
    }
  }
  if (/\b(?:fetch|axios|request|http\.request|https\.request)\s*\(/.test(trimmed)) {
    return {
      packageName: pkg.name,
      version: pkg.metadata.version,
      ruleId: 'dependency.network-access',
      severity: 'MEDIUM',
      path,
      message: 'Dependency source performs network access.',
      evidence: `line ${lineNumber}: ${trimmed.slice(0, 180)}`,
      fix: 'Confirm the network behavior is expected and documented.',
    }
  }
  return null
}

function walkPackage(dir: string, files: string[], maxFiles: number): void {
  if (files.length >= maxFiles) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'test', 'tests', '__tests__', 'coverage', 'dist', 'docs', 'example', 'examples', 'benchmark', 'benchmarks'].includes(entry.name)) continue
      walkPackage(fullPath, files, maxFiles)
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) {
      try {
        if (statSync(fullPath).size <= 300_000) files.push(fullPath)
      } catch {
        // Ignore files that disappear during scanning.
      }
    }
  }
}

function packageNameFromLockPath(path: string): string {
  const parts = path.split('/')
  if (parts[1]?.startsWith('@')) return `${parts[1]}/${parts[2] ?? ''}`
  return parts[1] ?? basename(path)
}

function isTopLevelNodeModulePath(path: string): boolean {
  const parts = path.split('/')
  if (parts[0] !== 'node_modules') return false
  if (parts[1]?.startsWith('@')) return parts.length === 3
  return parts.length === 2
}

function isBaselineFinding(finding: DependencyAuditFinding, policy: ResolvedDependencyAuditPolicy): boolean {
  return policy.baselineFindings.some(item =>
    item.packageName === finding.packageName &&
    item.ruleId === finding.ruleId &&
    (item.version === undefined || item.version === finding.version),
  )
}

function shouldBlock(severity: DependencyAuditSeverity, mode: DependencyAuditMode): boolean {
  if (severity === 'CRITICAL') return true
  return mode === 'strict' && severity === 'HIGH'
}

function summarize(packagesAudited: number, findings: DependencyAuditFinding[]): DependencyAuditSummary {
  const bySeverity: Record<DependencyAuditSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  }
  for (const finding of findings) bySeverity[finding.severity] += 1
  return {
    packagesAudited,
    totalFindings: findings.length,
    bySeverity,
  }
}

function normalizeMode(value: unknown): DependencyAuditMode | undefined {
  return value === 'compatibility' || value === 'strict' || value === 'offline' ? value : undefined
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index).toLowerCase() : ''
}

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}
