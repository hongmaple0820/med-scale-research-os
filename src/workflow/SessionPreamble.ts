// SCALE Engine — Session Preamble (v0.31.0)
// Automatic environment context collection before workflow execution.
// Inspired by gstack's preamble pattern: collect branch, sessions, learnings, etc.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { SCALE_ENGINE_VERSION } from '../version.js'

const SILENT_GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore']

// ============================================================================
// Types
// ============================================================================

export interface SessionPreamble {
  sessionId: string
  timestamp: string
  gitBranch: string
  gitRoot: string
  projectSlug: string
  scaleVersion: string
  activeRunCount: number
  learningCount: number
  verificationProfile: string
  governanceMode: string
  warnings: string[]
}

export interface PreambleOptions {
  projectDir?: string
  scaleDir?: string
}

// ============================================================================
// Collector
// ============================================================================

export function collectSessionPreamble(opts?: PreambleOptions): SessionPreamble {
  const projectDir = opts?.projectDir ?? process.cwd()
  const scaleDir = opts?.scaleDir ?? '.scale'

  const warnings: string[] = []

  // Git branch
  let gitBranch = 'unknown'
  try {
    gitBranch = execSync('git branch --show-current', {
      cwd: projectDir, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
    }).trim()
  } catch {
    warnings.push('Not in a git repository or git not available')
  }

  // Git root
  let gitRoot = projectDir
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: projectDir, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
    }).trim()
  } catch {
    // Use projectDir as fallback
  }

  // Project slug
  const projectSlug = deriveProjectSlug(projectDir)

  // Active run count
  const activeRunCount = countActiveRuns(scaleDir)

  // Learning count
  const learningCount = countLearnings(scaleDir, projectSlug)

  // Verification profile
  const verificationProfile = resolveCurrentProfile(scaleDir, projectDir)

  // Governance mode (default)
  const governanceMode = 'standard'

  return {
    sessionId: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    gitBranch,
    gitRoot,
    projectSlug,
    scaleVersion: SCALE_ENGINE_VERSION,
    activeRunCount,
    learningCount,
    verificationProfile,
    governanceMode,
    warnings,
  }
}

// ============================================================================
// Formatter
// ============================================================================

export function formatPreambleForAgent(preamble: SessionPreamble): string {
  const lines: string[] = [
    `SESSION: ${preamble.sessionId}`,
    `BRANCH: ${preamble.gitBranch}`,
    `PROJECT: ${preamble.projectSlug}`,
    `SCALE_VERSION: ${preamble.scaleVersion}`,
    `ACTIVE_RUNS: ${preamble.activeRunCount}`,
    `LEARNINGS: ${preamble.learningCount}`,
    `VERIFICATION_PROFILE: ${preamble.verificationProfile}`,
    `GOVERNANCE_MODE: ${preamble.governanceMode}`,
  ]

  if (preamble.warnings.length > 0) {
    lines.push(`WARNINGS: ${preamble.warnings.join('; ')}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function deriveProjectSlug(projectDir: string): string {
  try {
    return basename(projectDir).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  } catch {
    return 'unknown'
  }
}

function countActiveRuns(scaleDir: string): number {
  const runsDir = join(scaleDir, 'ai-os', 'runs')
  if (!existsSync(runsDir)) return 0
  try {
    return readdirSync(runsDir).filter(f => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

function countLearnings(scaleDir: string, projectSlug: string): number {
  const learningsDir = join(scaleDir, 'learnings')
  if (!existsSync(learningsDir)) return 0
  try {
    const jsonlPath = join(learningsDir, `${projectSlug}.jsonl`)
    if (!existsSync(jsonlPath)) return 0
    const content = readFileSync(jsonlPath, 'utf-8')
    return content.split('\n').filter(line => line.trim()).length
  } catch {
    return 0
  }
}

function resolveCurrentProfile(scaleDir: string, projectDir: string): string {
  try {
    const matrixPath = join(projectDir, scaleDir, 'verification-matrix.json')
    if (existsSync(matrixPath)) {
      const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as { defaultProfile?: string }
      return matrix.defaultProfile ?? 'default'
    }
  } catch {
    // Ignore
  }
  return 'default'
}
