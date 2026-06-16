// SCALE Orchestrator — Policy Loader
// 对齐 Symphony: YAML frontmatter + Markdown body in SCALE_POLICY.md
// 动态重载: 文件变更自动重载，无效配置保留上一次良好配置

import { existsSync, readFileSync, statSync, watchFile } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

// ---------------------------------------------------------------------------
// SCALE_POLICY.md schema (aligns with Symphony 6-key: tracker, polling, workspace, hooks, agent, codex)
// ---------------------------------------------------------------------------

export interface OrchestratorPolicy {
  tracker: TrackerSection
  polling: PollingSection
  workspace: WorkspaceSection
  hooks: HooksSection
  agent: AgentSection
  codex: CodexSection
  // Policy metadata
  version: number
  rawBody: string
  filePath: string
  lastModified: number
  hash: string
}

export interface TrackerSection {
  type: 'github' | 'linear' | 'jira'
  owner?: string
  repo?: string
  projectKey?: string
  baseUrl?: string
  activeStates: string[]
  terminalStates: string[]
}

export interface PollingSection {
  intervalMs: number       // How often to poll the tracker
  maxParallelWorkspaces: number
  maxRetryBackoffMs: number
  maxAttempts: number
  priorityLabels: Record<string, number>
}

export interface WorkspaceSection {
  root: string            // Where git worktrees live
  allowedChars: string     // Regex char class for workspace names
  maxWorkspaceAgeHours: number // Auto-cleanup threshold
}

export interface HooksSection {
  afterCreate?: string    // Shell command
  beforeRun?: string
  afterRun?: string
  beforeRemove?: string
}

export interface AgentSection {
  model: string
  maxTurns: number
  timeoutMinutes: number
  instructions?: string
}

export interface CodexSection {
  enabled: boolean
  promptTemplate?: string
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

export const DEFAULT_POLICY: OrchestratorPolicy = {
  tracker: {
    type: 'github',
    activeStates: ['open', 'in_progress'],
    terminalStates: ['resolved', 'closed', 'cancelled'],
  },
  polling: {
    intervalMs: 30000,
    maxParallelWorkspaces: 3,
    maxRetryBackoffMs: 300000,
    maxAttempts: 3,
    priorityLabels: { 'priority:critical': 0, 'priority:high': 1, 'priority:medium': 2, 'priority:low': 3 },
  },
  workspace: {
    root: '.scale/worktrees',
    allowedChars: '[A-Za-z0-9._-]',
    maxWorkspaceAgeHours: 24,
  },
  hooks: {},
  agent: {
    model: 'claude-sonnet-4-6',
    maxTurns: 50,
    timeoutMinutes: 30,
  },
  codex: {
    enabled: true,
  },
  version: 1,
  rawBody: '',
  filePath: '',
  lastModified: 0,
  hash: '',
}

// ---------------------------------------------------------------------------
// PolicyLoader
// ---------------------------------------------------------------------------

export class PolicyLoader {
  private currentPolicy: OrchestratorPolicy = { ...DEFAULT_POLICY }
  private lastGoodPolicy: OrchestratorPolicy = { ...DEFAULT_POLICY }
  private watcherActive = false

  /**
   * Load SCALE_POLICY.md from project root.
   * Falls back to good policy if the loaded one is invalid.
   */
  load(projectDir: string): OrchestratorPolicy {
    const policyPath = join(projectDir, 'SCALE_POLICY.md')
    if (!existsSync(policyPath)) {
      logger.warn('No SCALE_POLICY.md found, using defaults')
      this.currentPolicy = { ...DEFAULT_POLICY, filePath: policyPath, lastModified: Date.now(), hash: 'default' }
      return this.currentPolicy
    }

    const raw = readFileSync(policyPath, 'utf-8')
    const stat = statSync(policyPath)

    try {
      const parsed = this.parsePolicyMarkdown(raw, policyPath, stat.mtimeMs)
      this.lastGoodPolicy = parsed
      this.currentPolicy = parsed
      logger.info({ path: policyPath, version: parsed.version }, 'SCALE_POLICY.md loaded')
      return parsed
    } catch (err) {
      logger.error({ err, path: policyPath }, 'Failed to parse SCALE_POLICY.md — using last-good config')
      this.currentPolicy = { ...this.lastGoodPolicy, filePath: policyPath, lastModified: stat.mtimeMs }
      return this.currentPolicy
    }
  }

  /**
   * Enable dynamic reload via file watcher.
   * On file change: reload, retain last-good on parse failure.
   */
  watch(projectDir: string): void {
    if (this.watcherActive) return
    const policyPath = join(projectDir, 'SCALE_POLICY.md')

    watchFile(policyPath, { interval: 5000 }, () => {
      logger.info('SCALE_POLICY.md changed — reloading')
      this.load(projectDir)
    })

    this.watcherActive = true
  }

  /**
   * Get the current loaded policy (already validated/reloaded).
   */
  get(): OrchestratorPolicy {
    return this.currentPolicy
  }

  /**
   * Parse YAML frontmatter from Markdown.
   * Format: ---\n<YAML>\n---\n<MARKDOWN BODY>
   */
  parsePolicyMarkdown(raw: string, filePath: string, lastModified: number): OrchestratorPolicy {
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
      throw new Error('SCALE_POLICY.md missing YAML frontmatter (---...---)')
    }

    const yamlStr = frontmatterMatch[1]
    const bodyStart = (frontmatterMatch.index ?? 0) + frontmatterMatch[0].length
    const rawBody = raw.slice(bodyStart).trim()

    const frontmatter = this.minimalYamlParse(yamlStr) as Record<string, any>

    // Merge with defaults so partial configs work
    const merged: OrchestratorPolicy = {
      tracker: { ...DEFAULT_POLICY.tracker, ...(frontmatter.tracker ?? {}) },
      polling: { ...DEFAULT_POLICY.polling, ...(frontmatter.polling ?? {}) },
      workspace: { ...DEFAULT_POLICY.workspace, ...(frontmatter.workspace ?? {}) },
      hooks: { ...DEFAULT_POLICY.hooks, ...(frontmatter.hooks ?? {}) },
      agent: { ...DEFAULT_POLICY.agent, ...(frontmatter.agent ?? {}) },
      codex: { ...DEFAULT_POLICY.codex, ...(frontmatter.codex ?? {}) },
      version: frontmatter.version ?? 1,
      rawBody,
      filePath,
      lastModified,
      hash: '',
    }

    const crypto = __non_webpack_require__('node:crypto') ?? require('crypto')
    merged.hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)

    return merged
  }

  /**
   * Minimal YAML parser for the SCALE_POLICY.md frontmatter subset.
   * Handles nested objects and arrays needed by the 6-key schema.
   */
  private minimalYamlParse(yamlStr: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    // Split into lines and parse top-level key: value pairs
    const lines = yamlStr.split('\n')
    let currentSection: string | null = null
    let currentObj: Record<string, unknown> = {}
    let inArray: string | null = null
    let arrayValues: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // Section headers
      if (trimmed.match(/^[a-zA-Z_]+:/) && !trimmed.includes(': ') && !trimmed.endsWith(':')) {
        // Simple key: value at top level
        const [key, ...rest] = trimmed.split(':')
        const val = rest.join(':').trim()
        if (val && currentSection === null) {
          result[key.trim()] = isNaN(Number(val)) ? val : Number(val)
          continue
        }
      }

      // Start of a section object
      if (trimmed.endsWith(':') && !trimmed.match(/^\s*-/)) {
        const sectionName = trimmed.slice(0, -1).trim()
        currentSection = sectionName
        currentObj = {}
        result[sectionName] = currentObj
        inArray = null
        continue
      }

      // Key: value within a section
      if (currentSection && trimmed.includes(':') && !trimmed.startsWith('-')) {
        const [key, ...rest] = trimmed.split(':')
        const val = rest.join(':').trim()
        if (val) {
          // Numeric values
          if (/^\d+$/.test(val)) currentObj[key.trim()] = parseInt(val, 10)
          // Boolean values
          else if (val === 'true') currentObj[key.trim()] = true
          else if (val === 'false') currentObj[key.trim()] = false
          // Strings
          else currentObj[key.trim()] = val
        }
        inArray = null
        continue
      }

      // Array item — start
      if (currentSection && trimmed === '-') { inArray = null; continue }

      // Array items — list
      if (currentSection && trimmed.startsWith('- ') && !trimmed.includes(':')) {
        const val = trimmed.slice(2).trim()
        if (inArray) {
          arrayValues.push(val)
        } else {
          // Check if an array key was just defined
          const lastKey = Object.keys(currentObj).pop()
          if (lastKey && Array.isArray(currentObj[lastKey])) {
            ;(currentObj[lastKey] as string[]).push(val)
          }
        }
        continue
      }

      // Key: (empty) — start of an array
      if (currentSection && trimmed.includes(':') && trimmed.slice(-1) === ':') {
        const key = trimmed.slice(0, -1).trim()
        const valAfterColon = trimmed.split(':').slice(1).join(':').trim()
        if (!valAfterColon) {
          inArray = key
          arrayValues = []
          currentObj[key] = arrayValues
        }
        continue
      }
    }

    return result
  }
}

// Avoid bundler issues with dynamic require
function __non_webpack_require__(mod: string): unknown {
  try { return require(mod) } catch { return null }
}
