// SCALE Engine — Session Coordinator
// Multi-session parallel task coordination: file overlap detection, task dependency graph, conflict resolution

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

// ============================================================================
// Types
// ============================================================================

export type SessionTaskStatus = 'planned' | 'active' | 'blocked' | 'done' | 'cancelled'
export type DependencyType = 'blocks' | 'soft-dep' | 'data-flow'
export type OverlapRisk = 'low' | 'medium' | 'high'
export type EnforcementLevel = 'advisory' | 'warn' | 'block'
export type ConflictResolution = 'accept' | 'defer' | 'split-files' | 'manual'

export interface SessionTask {
  sessionId: string
  taskId: string
  files: string[]
  dependencies: string[]
  status: SessionTaskStatus
  startedAt: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export interface FileOverlap {
  file: string
  sessions: Array<{ sessionId: string; taskId: string }>
  risk: OverlapRisk
  suggestion: string
}

export interface TaskDependencyEdge {
  from: string
  to: string
  type: DependencyType
  reason: string
}

export interface ConflictRecord {
  id: string
  file: string
  sessions: string[]
  resolution: ConflictResolution
  resolvedBy?: string
  resolvedAt: string
  notes?: string
}

export interface SessionCoordinatorConfig {
  enforcement: EnforcementLevel
  maxConcurrentSessions: number
  trackFileOverlaps: boolean
  autoBlockOnHighRisk: boolean
}

export interface SessionCoordinatorInput {
  projectDir?: string
  scaleDir?: string
  config?: Partial<SessionCoordinatorConfig>
}

export interface CoordinationStatus {
  activeSessions: number
  activeTasks: SessionTask[]
  fileOverlaps: FileOverlap[]
  blockedTasks: Array<{ taskId: string; blockedBy: string[] }>
  conflicts: ConflictRecord[]
  recommendations: string[]
}

export interface TopologicalOrder {
  order: string[]
  cycles: string[][]
  blocked: string[]
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: SessionCoordinatorConfig = {
  enforcement: 'warn',
  maxConcurrentSessions: 10,
  trackFileOverlaps: true,
  autoBlockOnHighRisk: false,
}

// ============================================================================
// SessionCoordinator
// ============================================================================

export class SessionCoordinator {
  private tasks: Map<string, SessionTask>
  private dependencies: TaskDependencyEdge[]
  private conflicts: ConflictRecord[]
  private config: SessionCoordinatorConfig
  private statePath: string
  private stateDir: string

  constructor(input: SessionCoordinatorInput = {}) {
    const projectDir = resolve(input.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(input.scaleDir ?? '')
      ? input.scaleDir as string
      : join(projectDir, input.scaleDir ?? '.scale')

    this.stateDir = join(scaleRoot, 'coordinator')
    this.statePath = join(this.stateDir, 'state.json')
    this.config = { ...DEFAULT_CONFIG, ...input.config }
    this.tasks = new Map()
    this.dependencies = []
    this.conflicts = []

    this.loadState()
  }

  // --------------------------------------------------------------------------
  // Session Registration
  // --------------------------------------------------------------------------

  registerSession(task: Omit<SessionTask, 'status' | 'startedAt'>): SessionTask {
    const existing = this.tasks.get(task.taskId)
    if (existing && existing.status !== 'cancelled' && existing.status !== 'done') {
      return existing
    }

    const fullTask: SessionTask = {
      ...task,
      status: 'planned',
      startedAt: new Date().toISOString(),
      files: task.files.map(normalizePath),
    }

    this.tasks.set(fullTask.taskId, fullTask)

    // Register dependencies as edges
    for (const depId of fullTask.dependencies) {
      this.dependencies.push({
        from: depId,
        to: fullTask.taskId,
        type: 'blocks',
        reason: `${fullTask.taskId} declares dependency on ${depId}`,
      })
    }

    this.saveState()
    return fullTask
  }

  activateTask(taskId: string): { allowed: boolean; blockers: string[] } {
    const task = this.tasks.get(taskId)
    if (!task) return { allowed: false, blockers: [`Task ${taskId} not found.`] }

    const blockers = this.getTaskBlockers(taskId)
    if (blockers.length > 0 && this.config.enforcement === 'block') {
      return { allowed: false, blockers }
    }

    task.status = 'active'
    this.saveState()
    return { allowed: true, blockers }
  }

  completeTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'done'
    task.completedAt = new Date().toISOString()
    this.saveState()
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'cancelled'
    task.completedAt = new Date().toISOString()
    this.saveState()
  }

  blockTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'blocked'
    this.saveState()
  }

  // --------------------------------------------------------------------------
  // File Overlap Detection
  // --------------------------------------------------------------------------

  detectOverlaps(): FileOverlap[] {
    const activeTasks = this.getActiveTasks()
    const fileMap = new Map<string, Array<{ sessionId: string; taskId: string }>>()

    for (const task of activeTasks) {
      for (const file of task.files) {
        const normalized = normalizePath(file)
        const group = fileMap.get(normalized) ?? []
        group.push({ sessionId: task.sessionId, taskId: task.taskId })
        fileMap.set(normalized, group)
      }
    }

    const overlaps: FileOverlap[] = []
    for (const [file, sessions] of fileMap) {
      if (sessions.length < 2) continue

      const risk = this.assessOverlapRisk(file, sessions.map(s => s.taskId))
      overlaps.push({
        file,
        sessions,
        risk,
        suggestion: this.suggestOverlapResolution(file, risk, sessions.length),
      })
    }

    return overlaps
  }

  // --------------------------------------------------------------------------
  // Task Dependency Graph
  // --------------------------------------------------------------------------

  addDependency(edge: TaskDependencyEdge): void {
    this.dependencies.push(edge)
    this.saveState()
  }

  getTopologicalOrder(): TopologicalOrder {
    const taskIds = new Set<string>()
    for (const task of this.tasks.values()) {
      if (task.status !== 'cancelled' && task.status !== 'done') {
        taskIds.add(task.taskId)
      }
    }

    const adjacency = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    for (const id of taskIds) {
      adjacency.set(id, [])
      inDegree.set(id, 0)
    }

    for (const edge of this.dependencies) {
      if (taskIds.has(edge.from) && taskIds.has(edge.to)) {
        adjacency.get(edge.from)!.push(edge.to)
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
      }
    }

    // Kahn's algorithm with cycle detection
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const order: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      order.push(current)
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1
        inDegree.set(neighbor, newDeg)
        if (newDeg === 0) queue.push(neighbor)
      }
    }

    // Nodes not in order are in cycles
    const inOrder = new Set(order)
    const blocked = [...taskIds].filter(id => !inOrder.has(id))

    // Find actual cycles
    const cycles = this.findCycles(blocked, adjacency)

    return { order, cycles, blocked }
  }

  getDependencies(taskId: string): { upstream: string[]; downstream: string[] } {
    const upstream: string[] = []
    const downstream: string[] = []

    for (const edge of this.dependencies) {
      if (edge.to === taskId && !upstream.includes(edge.from)) upstream.push(edge.from)
      if (edge.from === taskId && !downstream.includes(edge.to)) downstream.push(edge.to)
    }

    return { upstream, downstream }
  }

  // --------------------------------------------------------------------------
  // Conflict Resolution
  // --------------------------------------------------------------------------

  recordConflict(conflict: Omit<ConflictRecord, 'id' | 'resolvedAt'>): ConflictRecord {
    const record: ConflictRecord = {
      ...conflict,
      id: `CONFLICT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      resolvedAt: new Date().toISOString(),
    }
    this.conflicts.push(record)
    this.saveState()
    return record
  }

  // --------------------------------------------------------------------------
  // Status & Recommendations
  // --------------------------------------------------------------------------

  getCoordinationStatus(): CoordinationStatus {
    const activeTasks = this.getActiveTasks()
    const overlaps = this.config.trackFileOverlaps ? this.detectOverlaps() : []
    const topo = this.getTopologicalOrder()

    const blockedTasks = topo.blocked.map(taskId => ({
      taskId,
      blockedBy: this.getDependencies(taskId).upstream.filter(
        depId => this.tasks.get(depId)?.status !== 'done',
      ),
    }))

    const recommendations = this.buildRecommendations(activeTasks, overlaps, blockedTasks)

    return {
      activeSessions: new Set(activeTasks.map(t => t.sessionId)).size,
      activeTasks,
      fileOverlaps: overlaps,
      blockedTasks,
      conflicts: this.conflicts,
      recommendations,
    }
  }

  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------

  private loadState(): void {
    if (!existsSync(this.statePath)) return
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf-8'))
      if (raw.tasks) {
        for (const [id, task] of Object.entries(raw.tasks as Record<string, SessionTask>)) {
          this.tasks.set(id, task)
        }
      }
      if (raw.dependencies) this.dependencies = raw.dependencies
      if (raw.conflicts) this.conflicts = raw.conflicts
    } catch { /* ignore corrupt state */ }
  }

  private saveState(): void {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true })
    const tasks: Record<string, SessionTask> = {}
    for (const [id, task] of this.tasks) tasks[id] = task
    writeFileSync(this.statePath, JSON.stringify({
      tasks,
      dependencies: this.dependencies,
      conflicts: this.conflicts,
    }, null, 2), 'utf-8')
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private getActiveTasks(): SessionTask[] {
    return [...this.tasks.values()].filter(
      t => t.status === 'active' || t.status === 'planned',
    )
  }

  getTask(taskId: string): SessionTask | undefined {
    return this.tasks.get(taskId)
  }

  listTasks(): SessionTask[] {
    return [...this.tasks.values()]
  }

  private getTaskBlockers(taskId: string): string[] {
    const blockers: string[] = []
    const { upstream } = this.getDependencies(taskId)

    for (const depId of upstream) {
      const dep = this.tasks.get(depId)
      if (dep && dep.status !== 'done') {
        blockers.push(`Task ${taskId} blocked by ${depId} (status: ${dep.status})`)
      }
    }

    // Check file overlaps with high risk
    if (this.config.autoBlockOnHighRisk) {
      const task = this.tasks.get(taskId)
      if (task) {
        const overlaps = this.detectOverlaps()
        for (const overlap of overlaps) {
          if (overlap.risk === 'high' && overlap.sessions.some(s => s.taskId === taskId)) {
            blockers.push(`High-risk file overlap on ${overlap.file}`)
          }
        }
      }
    }

    return blockers
  }

  private assessOverlapRisk(file: string, taskIds: string[]): OverlapRisk {
    // Shared config/infra files are high risk
    if (file.includes('package.json') || file.includes('tsconfig') || file.includes('.env') || file.includes('Makefile')) {
      return 'high'
    }
    // 3+ sessions on same file is high risk
    if (taskIds.length >= 3) return 'high'
    // 2 sessions on same file is medium risk
    return 'medium'
  }

  private suggestOverlapResolution(file: string, risk: OverlapRisk, sessionCount: number): string {
    if (risk === 'high') {
      return `High-risk overlap on "${file}" (${sessionCount} sessions). Consider sequential access or splitting the file.`
    }
    return `Medium-risk overlap on "${file}" (${sessionCount} sessions). Coordinate merge order to avoid conflicts.`
  }

  private findCycles(nodes: string[], adjacency: Map<string, string[]>): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const dfs = (node: string, path: string[]): boolean => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node)
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart))
        }
        return true
      }
      if (visited.has(node)) return false

      visited.add(node)
      inStack.add(node)
      path.push(node)

      for (const neighbor of adjacency.get(node) ?? []) {
        if (nodes.includes(neighbor)) {
          dfs(neighbor, path)
        }
      }

      path.pop()
      inStack.delete(node)
      return false
    }

    for (const node of nodes) {
      if (!visited.has(node)) dfs(node, [])
    }

    return cycles
  }

  private buildRecommendations(
    activeTasks: SessionTask[],
    overlaps: FileOverlap[],
    blockedTasks: Array<{ taskId: string; blockedBy: string[] }>,
  ): string[] {
    const recs: string[] = []

    if (activeTasks.length > this.config.maxConcurrentSessions) {
      recs.push(`${activeTasks.length} active tasks exceed max concurrent limit (${this.config.maxConcurrentSessions}). Consider finishing some before starting new ones.`)
    }

    const highRiskOverlaps = overlaps.filter(o => o.risk === 'high')
    if (highRiskOverlaps.length > 0) {
      recs.push(`${highRiskOverlaps.length} high-risk file overlap(s) detected. Review and coordinate before merging.`)
    }

    if (blockedTasks.length > 0) {
      recs.push(`${blockedTasks.length} task(s) are blocked by unfinished dependencies.`)
    }

    const cycles = this.getTopologicalOrder().cycles
    if (cycles.length > 0) {
      recs.push(`${cycles.length} circular dependency cycle(s) detected. Break cycles to unblock execution.`)
    }

    if (recs.length === 0) {
      recs.push('No coordination issues detected. All sessions are clear to proceed.')
    }

    return recs
  }
}

// ============================================================================
// Summary Formatter
// ============================================================================

export function summarizeCoordinationStatus(status: CoordinationStatus): string {
  const lines: string[] = [
    '## Session Coordination Status',
    '',
    `**Active Sessions:** ${status.activeSessions}`,
    `**Active Tasks:** ${status.activeTasks.length}`,
    '',
  ]

  if (status.fileOverlaps.length > 0) {
    lines.push('### File Overlaps')
    for (const overlap of status.fileOverlaps) {
      const sessionIds = overlap.sessions.map(s => s.sessionId).join(', ')
      lines.push(`- \`${overlap.file}\` [${overlap.risk}] — ${sessionIds}`)
      lines.push(`  ${overlap.suggestion}`)
    }
    lines.push('')
  }

  if (status.blockedTasks.length > 0) {
    lines.push('### Blocked Tasks')
    for (const blocked of status.blockedTasks) {
      lines.push(`- ${blocked.taskId} blocked by: ${blocked.blockedBy.join(', ')}`)
    }
    lines.push('')
  }

  if (status.conflicts.length > 0) {
    lines.push(`### Conflicts (${status.conflicts.length})`)
    for (const conflict of status.conflicts) {
      lines.push(`- \`${conflict.file}\` — ${conflict.resolution} (${conflict.sessions.join(', ')})`)
    }
    lines.push('')
  }

  if (status.recommendations.length > 0) {
    lines.push('### Recommendations')
    for (const rec of status.recommendations) lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}
