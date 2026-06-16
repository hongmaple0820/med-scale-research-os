// SCALE Engine — Worklog Manager
// 工作日志读写管理，支持 markdown 格式的 pending/done 列表
// 设计参考：z.ai 自主开发循环模式 + Baton System 持久化

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from '../../core/logger.js'

// ============================================================================
// Types
// ============================================================================

export type TaskType = 'bug' | 'feature' | 'refactor' | 'test' | 'fix'
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked'
export type TaskPriority = 'P0' | 'P1' | 'P2'

export interface WorklogEntry {
  id: string
  type: TaskType
  description: string
  status: TaskStatus
  priority: TaskPriority
  files?: string[]
  notes?: string
}

export interface WorklogState {
  entries: WorklogEntry[]
  lastUpdated: string
  totalDone: number
  totalPending: number
}

// ============================================================================
// Worklog Manager
// ============================================================================

export class WorklogManager {
  private worklogPath: string

  constructor(worklogPath: string) {
    this.worklogPath = worklogPath
  }

  // ─────────────────────────────────────────────────────────────
  // Read
  // ─────────────────────────────────────────────────────────────

  /** Read and parse the worklog file */
  read(): WorklogState {
    if (!existsSync(this.worklogPath)) {
      return this.createEmptyState()
    }

    const content = readFileSync(this.worklogPath, 'utf-8')
    return this.parse(content)
  }

  /** Parse markdown content into WorklogState */
  parse(content: string): WorklogState {
    const entries: WorklogEntry[] = []
    let currentSection: 'pending' | 'done' = 'pending'
    let entryIndex = 0

    for (const line of content.split('\n')) {
      const trimmed = line.trim()

      // Detect section headers
      if (/^##\s+Pending/i.test(trimmed)) {
        currentSection = 'pending'
        continue
      }
      if (/^##\s+Done/i.test(trimmed)) {
        currentSection = 'done'
        continue
      }
      if (/^##\s+Blocked/i.test(trimmed)) {
        currentSection = 'pending' // blocked entries are in pending flow
        continue
      }

      // Parse pending entries: "- [P0] fix: description" or "- [P1] feat: description"
      const pendingMatch = trimmed.match(/^-\s+\[(P[0-2])\]\s+(\w+):\s+(.+)$/)
      if (pendingMatch && currentSection === 'pending') {
        entryIndex++
        const [, priority, typeRaw, description] = pendingMatch
        entries.push({
          id: `WL-${String(entryIndex).padStart(3, '0')}`,
          type: this.normalizeType(typeRaw),
          description: description.trim(),
          status: 'pending',
          priority: priority as TaskPriority,
        })
        continue
      }

      // Parse done entries: "- [x] description" or "- [x] type: description"
      const doneMatch = trimmed.match(/^-\s+\[x\]\s+(.+)$/)
      if (doneMatch && currentSection === 'done') {
        entryIndex++
        const raw = doneMatch[1]
        const typeMatch = raw.match(/^(\w+):\s+(.+)$/)
        entries.push({
          id: `WL-${String(entryIndex).padStart(3, '0')}`,
          type: typeMatch ? this.normalizeType(typeMatch[1]) : 'feature',
          description: typeMatch ? typeMatch[2].trim() : raw.trim(),
          status: 'done',
          priority: 'P2', // done items default to lowest priority
        })
        continue
      }

      // Parse in_progress entries: "- [~] description"
      const inProgressMatch = trimmed.match(/^-\s+\[~\]\s+(.+)$/)
      if (inProgressMatch) {
        entryIndex++
        const raw = inProgressMatch[1]
        const typeMatch = raw.match(/^\[(P[0-2])\]\s+(\w+):\s+(.+)$/)
        entries.push({
          id: `WL-${String(entryIndex).padStart(3, '0')}`,
          type: typeMatch ? this.normalizeType(typeMatch[2]) : 'feature',
          description: typeMatch ? typeMatch[3].trim() : raw.trim(),
          status: 'in_progress',
          priority: typeMatch ? (typeMatch[1] as TaskPriority) : 'P1',
        })
        continue
      }
    }

    const totalDone = entries.filter(e => e.status === 'done').length
    const totalPending = entries.filter(e => e.status === 'pending' || e.status === 'in_progress').length

    return {
      entries,
      lastUpdated: new Date().toISOString(),
      totalDone,
      totalPending,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Query
  // ─────────────────────────────────────────────────────────────

  /** Get next pending task by priority */
  getNextTask(state: WorklogState): WorklogEntry | undefined {
    const pending = state.entries
      .filter(e => e.status === 'pending')
      .sort((a, b) => this.priorityWeight(a.priority) - this.priorityWeight(b.priority))

    return pending[0]
  }

  /** Get all entries with a specific status */
  getByStatus(state: WorklogState, status: TaskStatus): WorklogEntry[] {
    return state.entries.filter(e => e.status === status)
  }

  /** Get entries by type */
  getByType(state: WorklogState, type: TaskType): WorklogEntry[] {
    return state.entries.filter(e => e.type === type)
  }

  // ─────────────────────────────────────────────────────────────
  // Update
  // ─────────────────────────────────────────────────────────────

  /** Update entry status */
  updateEntryStatus(
    state: WorklogState,
    entryId: string,
    newStatus: TaskStatus,
    notes?: string
  ): WorklogState {
    const updated = state.entries.map(e => {
      if (e.id === entryId) {
        return {
          ...e,
          status: newStatus,
          notes: notes ?? e.notes,
        }
      }
      return e
    })

    return this.recomputeState(updated)
  }

  /** Mark entry as in_progress */
  markInProgress(state: WorklogState, entryId: string): WorklogState {
    // First, reset any currently in_progress items back to pending
    const reset = state.entries.map(e =>
      e.status === 'in_progress' ? { ...e, status: 'pending' as TaskStatus } : e
    )
    // Then mark the target as in_progress
    const updated = reset.map(e =>
      e.id === entryId ? { ...e, status: 'in_progress' as TaskStatus } : e
    )
    return this.recomputeState(updated)
  }

  /** Mark entry as done */
  markDone(state: WorklogState, entryId: string, notes?: string): WorklogState {
    return this.updateEntryStatus(state, entryId, 'done', notes)
  }

  /** Mark entry as blocked */
  markBlocked(state: WorklogState, entryId: string, reason: string): WorklogState {
    return this.updateEntryStatus(state, entryId, 'blocked', reason)
  }

  /** Add a new entry */
  addEntry(
    state: WorklogState,
    entry: Omit<WorklogEntry, 'id'>
  ): WorklogState {
    const nextNum = state.entries.length + 1
    const newEntry: WorklogEntry = {
      ...entry,
      id: `WL-${String(nextNum).padStart(3, '0')}`,
    }
    const updated = [...state.entries, newEntry]
    return this.recomputeState(updated)
  }

  // ─────────────────────────────────────────────────────────────
  // Write
  // ─────────────────────────────────────────────────────────────

  /** Write worklog state back to markdown file */
  write(state: WorklogState): void {
    const dir = dirname(this.worklogPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const content = this.toMarkdown(state)
    writeFileSync(this.worklogPath, content, 'utf-8')
    logger.info(
      { path: this.worklogPath, total: state.entries.length },
      'Worklog written'
    )
  }

  /** Convert state to markdown format */
  toMarkdown(state: WorklogState): string {
    const inProgress = state.entries.filter(e => e.status === 'in_progress')
    const pending = state.entries.filter(e => e.status === 'pending')
    const done = state.entries.filter(e => e.status === 'done')
    const blocked = state.entries.filter(e => e.status === 'blocked')

    let md = `# Worklog\n\n`
    md += `> Updated: ${state.lastUpdated}\n\n`

    // In Progress
    if (inProgress.length > 0) {
      md += `## In Progress\n\n`
      for (const e of inProgress) {
        md += `- [~] [${e.priority}] ${e.type}: ${e.description}\n`
        if (e.notes) md += `  > ${e.notes}\n`
      }
      md += '\n'
    }

    // Pending
    md += `## Pending\n\n`
    if (pending.length === 0) {
      md += `_No pending tasks._\n\n`
    } else {
      for (const e of pending) {
        md += `- [${e.priority}] ${e.type}: ${e.description}\n`
        if (e.notes) md += `  > ${e.notes}\n`
      }
      md += '\n'
    }

    // Blocked
    if (blocked.length > 0) {
      md += `## Blocked\n\n`
      for (const e of blocked) {
        md += `- [${e.priority}] ${e.type}: ${e.description}\n`
        if (e.notes) md += `  > BLOCKED: ${e.notes}\n`
      }
      md += '\n'
    }

    // Done
    md += `## Done\n\n`
    if (done.length === 0) {
      md += `_No completed tasks yet._\n`
    } else {
      for (const e of done) {
        md += `- [x] ${e.type}: ${e.description}\n`
        if (e.notes) md += `  > ${e.notes}\n`
      }
    }

    return md
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private normalizeType(raw: string): TaskType {
    const map: Record<string, TaskType> = {
      fix: 'fix',
      bug: 'bug',
      feat: 'feature',
      feature: 'feature',
      refactor: 'refactor',
      test: 'test',
      chore: 'refactor',
    }
    return map[raw.toLowerCase()] ?? 'feature'
  }

  private priorityWeight(p: TaskPriority): number {
    const weights: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2 }
    return weights[p] ?? 99
  }

  private recomputeState(entries: WorklogEntry[]): WorklogState {
    return {
      entries,
      lastUpdated: new Date().toISOString(),
      totalDone: entries.filter(e => e.status === 'done').length,
      totalPending: entries.filter(e => e.status === 'pending' || e.status === 'in_progress').length,
    }
  }

  private createEmptyState(): WorklogState {
    return {
      entries: [],
      lastUpdated: new Date().toISOString(),
      totalDone: 0,
      totalPending: 0,
    }
  }
}
