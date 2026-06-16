import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type WorkspaceTopologyKind = 'single' | 'monorepo' | 'polyrepo' | 'submodule-workspace' | 'moe'
export type WorkspaceRepositoryRole = 'root' | 'service' | 'package' | 'submodule' | 'nested-repo' | 'external'

export interface WorkspaceRepositoryConfig {
  name: string
  path: string
  role: WorkspaceRepositoryRole
  required?: boolean
  services?: string[]
  branchPattern?: string
  remote?: string
  dependsOn?: string[]
  pointerFile?: string
}

export interface WorkspaceBranchPolicy {
  mode?: 'gitlab-flow'
  integrationBranch?: string
  productionBranch?: string
  protectedBranches?: string[]
  featurePrefixes?: string[]
  releasePrefixes?: string[]
  hotfixPrefixes?: string[]
  requireAuthorScopeDate?: boolean
}

export interface WorkspaceFinishPolicy {
  requireCleanRepositories?: boolean
  requirePushedBranches?: boolean
  requireRootPointerUpdate?: boolean
  requireReviewArtifacts?: boolean
}

export interface WorkspaceTopologyConfig {
  version?: number
  topology: WorkspaceTopologyKind
  repositories: WorkspaceRepositoryConfig[]
  branchPolicy?: WorkspaceBranchPolicy
  finishPolicy?: WorkspaceFinishPolicy
}

export interface ResolvedWorkspaceTopology extends WorkspaceTopologyConfig {
  version: number
  configured: boolean
  configPath: string
  branchPolicy: Required<WorkspaceBranchPolicy>
  finishPolicy: Required<WorkspaceFinishPolicy>
  warnings: string[]
}

export interface WorkspaceTopologyOptions {
  projectDir?: string
  scaleDir?: string
}

export interface WorkspaceTopologyTemplateOptions {
  topology?: WorkspaceTopologyKind
  projectName?: string
}

export function loadWorkspaceTopology(
  projectDir = process.cwd(),
  scaleDir = '.scale',
): ResolvedWorkspaceTopology | null {
  const path = workspaceTopologyPath(projectDir, scaleDir)
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceTopologyConfig
  return normalizeWorkspaceTopology(raw, {
    configured: true,
    configPath: path,
  })
}

export function resolveWorkspaceTopology(
  options: WorkspaceTopologyOptions = {},
): ResolvedWorkspaceTopology {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const loaded = loadWorkspaceTopology(projectDir, scaleDir)
  if (loaded) return loaded

  return normalizeWorkspaceTopology({
    version: 1,
    topology: 'single',
    repositories: [
      { name: 'root', path: '.', role: 'root', required: true },
    ],
  }, {
    configured: false,
    configPath: workspaceTopologyPath(projectDir, scaleDir),
    warnings: [`No workspace topology found at ${workspaceTopologyPath(projectDir, scaleDir)}; using single-repository defaults.`],
  })
}

export function writeWorkspaceTopologyTemplate(
  projectDir = process.cwd(),
  options: WorkspaceTopologyTemplateOptions = {},
  scaleDir = '.scale',
): string {
  const path = workspaceTopologyPath(projectDir, scaleDir)
  const dir = path.split(/[\\/]/).slice(0, -1).join('/')
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, workspaceTopologyTemplate(options), 'utf-8')
  return path
}

export function workspaceTopologyTemplate(options: WorkspaceTopologyTemplateOptions = {}): string {
  const topology = options.topology ?? 'moe'
  const repositories: WorkspaceRepositoryConfig[] = [
    {
      name: 'root',
      path: '.',
      role: 'root',
      required: true,
    },
  ]

  if (topology === 'monorepo') {
    repositories.push({
      name: 'example-service',
      path: 'services/example',
      role: 'service',
      required: false,
      services: ['example'],
    })
  } else if (topology === 'moe' || topology === 'polyrepo') {
    repositories.push({
      name: 'example-service',
      path: '../example-service',
      role: 'external',
      required: false,
      services: ['example'],
      branchPattern: 'codex/*',
      remote: 'origin',
      dependsOn: [],
      pointerFile: 'repos/example-service.ref',
    })
  } else if (topology === 'submodule-workspace') {
    repositories.push({
      name: 'example-service',
      path: 'services/example',
      role: 'submodule',
      required: false,
      services: ['example'],
      remote: 'origin',
    })
  }

  const config: WorkspaceTopologyConfig = {
    version: 1,
    topology,
    repositories,
    branchPolicy: defaultBranchPolicy(),
    finishPolicy: defaultFinishPolicy(topology),
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

export function workspaceTopologyPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  const root = isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
  return join(root, 'workspace.json')
}

export function resolveRepositoryPath(projectDir: string, repo: WorkspaceRepositoryConfig): string {
  return isAbsolute(repo.path) ? repo.path : resolve(projectDir, repo.path)
}

function normalizeWorkspaceTopology(
  raw: WorkspaceTopologyConfig,
  meta: { configured: boolean; configPath: string; warnings?: string[] },
): ResolvedWorkspaceTopology {
  const topology = normalizeTopology(raw.topology)
  const repositories = normalizeRepositories(raw.repositories)

  const warnings = [
    ...(meta.warnings ?? []),
    ...topologyWarnings(topology, repositories),
  ]

  return {
    version: raw.version ?? 1,
    topology,
    repositories,
    branchPolicy: {
      ...defaultBranchPolicy(),
      ...(raw.branchPolicy ?? {}),
    },
    finishPolicy: {
      ...defaultFinishPolicy(topology),
      ...(raw.finishPolicy ?? {}),
    },
    configured: meta.configured,
    configPath: meta.configPath,
    warnings,
  }
}

function normalizeTopology(value: WorkspaceTopologyKind | string | undefined): WorkspaceTopologyKind {
  if (
    value === 'single'
    || value === 'monorepo'
    || value === 'polyrepo'
    || value === 'submodule-workspace'
    || value === 'moe'
  ) {
    return value
  }
  return 'single'
}

function normalizeRepositories(repositories: WorkspaceRepositoryConfig[] | undefined): WorkspaceRepositoryConfig[] {
  const normalized = (repositories ?? [])
    .filter(repo => Boolean(repo.name && repo.path))
    .map(repo => ({
      ...repo,
      path: normalizeRelative(repo.path),
      required: repo.required !== false,
    }))

  if (!normalized.some(repo => repo.role === 'root' || repo.path === '.')) {
    normalized.unshift({ name: 'root', path: '.', role: 'root', required: true })
  }

  return normalized.length > 0
    ? normalized
    : [{ name: 'root', path: '.', role: 'root', required: true }]
}

function defaultFinishPolicy(topology: WorkspaceTopologyKind): Required<WorkspaceFinishPolicy> {
  return {
    requireCleanRepositories: true,
    requirePushedBranches: true,
    requireRootPointerUpdate: topology === 'moe' || topology === 'submodule-workspace',
    requireReviewArtifacts: topology === 'moe',
  }
}

function defaultBranchPolicy(): Required<WorkspaceBranchPolicy> {
  return {
    mode: 'gitlab-flow',
    integrationBranch: 'dev',
    productionBranch: 'master',
    protectedBranches: ['dev', 'master', 'main'],
    featurePrefixes: ['feature/', 'feat/', 'fix/', 'chore/', 'docs/', 'codex/'],
    releasePrefixes: ['release/'],
    hotfixPrefixes: ['hotfix/'],
    requireAuthorScopeDate: true,
  }
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/')
}

function topologyWarnings(topology: WorkspaceTopologyKind, repositories: WorkspaceRepositoryConfig[]): string[] {
  if (topology !== 'moe' && topology !== 'polyrepo') return []
  return repositories
    .filter(repo => repo.path !== '.' && !isAbsolute(repo.path) && !repo.path.startsWith('../'))
    .map(repo => `${topology} repository "${repo.name}" uses path "${repo.path}" under the root checkout; prefer a sibling or absolute path to avoid nested git conflicts.`)
}
