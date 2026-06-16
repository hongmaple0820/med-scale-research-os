// SCALE Engine — Diff-Based Test Selector (v0.32.0)
// Select tests based on changed files to reduce test execution time.
// Inspired by gstack's touchfile-based test dependency tracking.

import { execSync } from 'node:child_process'

// ============================================================================
// Types
// ============================================================================

export type TestTier = 'gate' | 'periodic'

export interface TestDependency {
  testFile: string
  touchfiles: string[] // glob patterns
  tier: TestTier
}

export interface TestSelectionResult {
  selected: string[]
  skipped: string[]
  reason: Record<string, string[]> // testFile → changed files that triggered it
  globalChangeTriggeredAll: boolean
}

export interface SelectOptions {
  baseBranch?: string
  projectDir?: string
  tier?: TestTier
}

// ============================================================================
// Dependency Registry
// ============================================================================

const dependencyRegistry = new Map<string, TestDependency>()

export function registerTestDependency(dep: TestDependency): void {
  dependencyRegistry.set(dep.testFile, dep)
}

export function clearDependencies(): void {
  dependencyRegistry.clear()
}

export function getDependencies(): TestDependency[] {
  return Array.from(dependencyRegistry.values())
}

// ============================================================================
// Global Patterns
// ============================================================================

// Changes to these files trigger ALL tests
const GLOBAL_PATTERNS = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.*',
  '.github/**',
  'AGENTS.md',
  'CLAUDE.md',
]

// ============================================================================
// Core Selector
// ============================================================================

export function selectTestsByDiff(opts?: SelectOptions): TestSelectionResult {
  const baseBranch = opts?.baseBranch ?? 'master'
  const projectDir = opts?.projectDir ?? process.cwd()

  const changedFiles = getChangedFiles(baseBranch, projectDir)
  const deps = Array.from(dependencyRegistry.values())

  // Filter by tier if specified
  const filtered = opts?.tier ? deps.filter(d => d.tier === opts.tier) : deps

  // Check for global changes
  const globalChangeTriggeredAll = changedFiles.some(f =>
    GLOBAL_PATTERNS.some(pattern => matchGlob(f, pattern)),
  )

  const selected: string[] = []
  const skipped: string[] = []
  const reason: Record<string, string[]> = {}

  for (const dep of filtered) {
    if (globalChangeTriggeredAll) {
      selected.push(dep.testFile)
      reason[dep.testFile] = ['[global change]']
      continue
    }

    const matchedFiles = changedFiles.filter(cf =>
      dep.touchfiles.some(pattern => matchGlob(cf, pattern)),
    )

    if (matchedFiles.length > 0) {
      selected.push(dep.testFile)
      reason[dep.testFile] = matchedFiles
    } else {
      skipped.push(dep.testFile)
    }
  }

  return { selected, skipped, reason, globalChangeTriggeredAll }
}

// ============================================================================
// Formatter
// ============================================================================

export function formatTestSelection(result: TestSelectionResult): string {
  const lines: string[] = ['## Test Selection\n']

  if (result.globalChangeTriggeredAll) {
    lines.push('**Global config change detected — all tests selected.**\n')
  }

  lines.push(`**Selected:** ${result.selected.length}`)
  for (const test of result.selected) {
    const reasons = result.reason[test] ?? []
    lines.push(`  ✅ ${test}`)
    if (reasons.length > 0 && reasons[0] !== '[global change]') {
      lines.push(`     ↳ changed: ${reasons.join(', ')}`)
    }
  }

  if (result.skipped.length > 0) {
    lines.push(`\n**Skipped:** ${result.skipped.length}`)
    for (const test of result.skipped) {
      lines.push(`  ⏭️ ${test}`)
    }
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function getChangedFiles(baseBranch: string, projectDir: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only ${baseBranch}...HEAD`,
      { cwd: projectDir, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()

    if (!output) return []
    return output.split('\n').filter(Boolean)
  } catch {
    // Not in a git repo or no base branch — return empty
    return []
  }
}

// Simple glob matching (no external dependency)
function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]')

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(filePath)
}
