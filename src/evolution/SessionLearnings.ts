// SCALE Engine — Session Learnings (v0.31.0)
// Cross-session knowledge persistence inspired by gstack's learnings.jsonl.
// Learnings survive across sessions and are loaded into future plans.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

// ============================================================================
// Types
// ============================================================================

export type LearningCategory = 'failure' | 'pattern' | 'preference' | 'environment'

export interface LearningEntry {
  id: string
  ts: string
  projectSlug: string
  category: LearningCategory
  title: string
  detail: string
  evidenceIds: string[]
  tags: string[]
  relevanceDecay?: number  // 0-1, higher = decays faster
}

export interface LearningSearchQuery {
  tags?: string[]
  category?: LearningCategory
  limit?: number
  projectSlug?: string
}

export interface LearningStore {
  append(entry: LearningEntry): void
  search(query: LearningSearchQuery): LearningEntry[]
  prune(opts: { olderThanDays?: number; minRelevance?: number }): number
  count(): number
  exportJsonl(): string
}

// ============================================================================
// Store Implementation
// ============================================================================

export function createLearningStore(opts: { storePath?: string }): LearningStore {
  const storePath = opts.storePath ?? '.scale/learnings'
  const dir = storePath

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  function getJsonlPath(projectSlug: string): string {
    return join(dir, `${projectSlug}.jsonl`)
  }

  function readEntries(projectSlug: string): LearningEntry[] {
    const path = getJsonlPath(projectSlug)
    if (!existsSync(path)) return []
    try {
      const content = readFileSync(path, 'utf-8')
      return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as LearningEntry)
    } catch {
      return []
    }
  }

  function writeEntries(projectSlug: string, entries: LearningEntry[]) {
    ensureDir()
    const path = getJsonlPath(projectSlug)
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    writeFileSync(path, content, 'utf-8')
  }

  return {
    append(entry: LearningEntry) {
      ensureDir()
      const path = getJsonlPath(entry.projectSlug)
      appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8')
    },

    search(query: LearningSearchQuery): LearningEntry[] {
      const slug = query.projectSlug
      const slugs = slug ? [slug] : listProjectSlugs(dir)
      const allEntries: LearningEntry[] = []

      for (const s of slugs) {
        const entries = readEntries(s)
        allEntries.push(...entries)
      }

      let filtered = allEntries

      if (query.category) {
        filtered = filtered.filter(e => e.category === query.category)
      }
      if (query.tags && query.tags.length > 0) {
        filtered = filtered.filter(e => query.tags!.some(t => e.tags.includes(t)))
      }

      // Sort by timestamp descending (newest first)
      filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

      if (query.limit) {
        filtered = filtered.slice(0, query.limit)
      }

      return filtered
    },

    prune(opts: { olderThanDays?: number; minRelevance?: number }): number {
      const slugs = listProjectSlugs(dir)
      let prunedCount = 0

      for (const slug of slugs) {
        const entries = readEntries(slug)
        const now = Date.now()
        const kept = entries.filter(e => {
          if (opts.olderThanDays) {
            const ageMs = now - new Date(e.ts).getTime()
            const ageDays = ageMs / (1000 * 60 * 60 * 24)
            if (ageDays > opts.olderThanDays) {
              prunedCount++
              return false
            }
          }
          if (opts.minRelevance && e.relevanceDecay) {
            const ageMs = now - new Date(e.ts).getTime()
            const ageDays = ageMs / (1000 * 60 * 60 * 24)
            const relevance = Math.max(0, 1 - (e.relevanceDecay * ageDays / 30))
            if (relevance < opts.minRelevance) {
              prunedCount++
              return false
            }
          }
          return true
        })

        if (kept.length !== entries.length) {
          writeEntries(slug, kept)
        }
      }

      return prunedCount
    },

    count(): number {
      const slugs = listProjectSlugs(dir)
      let total = 0
      for (const slug of slugs) {
        total += readEntries(slug).length
      }
      return total
    },

    exportJsonl(): string {
      const slugs = listProjectSlugs(dir)
      const lines: string[] = []
      for (const slug of slugs) {
        const entries = readEntries(slug)
        for (const entry of entries) {
          lines.push(JSON.stringify(entry))
        }
      }
      return lines.join('\n') + '\n'
    },
  }
}

// ============================================================================
// Auto-learn from Run Report
// ============================================================================

interface RunReportForLearning {
  status: string
  mode: string
  plan: {
    task: string
    level?: string
    governance?: {
      mode?: string
    }
  }
  failureLearning: {
    status: string
    candidates: Array<{
      id: string
      source: string
      title: string
      summary: string
      evidenceRefs: string[]
      promotable: boolean
    }>
  }
  verification: {
    allPassed: boolean
    commands: Array<{
      command: string
      status: string
      exitCode: number
    }>
  }
}

export function autoLearnFromRunReport(report: RunReportForLearning): LearningEntry[] {
  const entries: LearningEntry[] = []
  const projectSlug = deriveProjectSlug()
  const ts = new Date().toISOString()

  // Learn from blocked runs
  if (report.status === 'blocked') {
    entries.push({
      id: randomUUID(),
      ts,
      projectSlug,
      category: 'failure',
      title: `Run blocked: ${report.plan.task.slice(0, 80)}`,
      detail: `Task "${report.plan.task}" was blocked. Governance mode: ${report.plan.governance?.mode ?? 'unknown'}.`,
      evidenceIds: [],
      tags: ['blocked', report.mode],
      relevanceDecay: 0.3,
    })
  }

  // Learn from failure learning candidates
  for (const candidate of report.failureLearning.candidates) {
    entries.push({
      id: randomUUID(),
      ts,
      projectSlug,
      category: 'failure',
      title: candidate.title,
      detail: candidate.summary,
      evidenceIds: candidate.evidenceRefs,
      tags: ['failure-learning', candidate.source, candidate.promotable ? 'promotable' : 'non-promotable'],
      relevanceDecay: 0.2,
    })
  }

  // Learn from verification failures
  for (const cmd of report.verification.commands) {
    if (cmd.status === 'failed') {
      entries.push({
        id: randomUUID(),
        ts,
        projectSlug,
        category: 'failure',
        title: `Verification failed: ${cmd.command}`,
        detail: `Command "${cmd.command}" exited with code ${cmd.exitCode}.`,
        evidenceIds: [],
        tags: ['verification-failure', 'exit-code-' + cmd.exitCode],
        relevanceDecay: 0.4,
      })
    }
  }

  return entries
}

// ============================================================================
// Load Relevant Learnings
// ============================================================================

export function loadRelevantLearnings(opts: {
  projectDir?: string
  scaleDir?: string
  task?: string
  tags?: string[]
  limit?: number
}): LearningEntry[] {
  const scaleDir = opts.scaleDir ?? '.scale'
  const storePath = join(scaleDir, 'learnings')
  const store = createLearningStore({ storePath })

  const projectSlug = deriveProjectSlug(opts.projectDir)
  const query: LearningSearchQuery = {
    projectSlug,
    tags: opts.tags,
    limit: opts.limit ?? 10,
  }

  let results = store.search(query)

  // If task is provided, filter by relevance to task keywords
  if (opts.task) {
    const taskWords = opts.task.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    results = results.filter(e => {
      const entryText = `${e.title} ${e.detail}`.toLowerCase()
      return taskWords.some(w => entryText.includes(w))
    })
  }

  return results.slice(0, opts.limit ?? 10)
}

// ============================================================================
// Helpers
// ============================================================================

function deriveProjectSlug(projectDir?: string): string {
  try {
    const dir = projectDir ?? process.cwd()
    return basename(dir).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  } catch {
    return 'unknown'
  }
}

function listProjectSlugs(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''))
  } catch {
    return []
  }
}
