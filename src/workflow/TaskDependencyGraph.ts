// SCALE Engine — Task Dependency Graph (v0.36.0)
// Dependency declaration, topological sort, cycle detection for parallel task coordination

export type DependencyType = 'blocks' | 'soft-dep' | 'data-flow'

export interface TaskNode {
  taskId: string
  sessionId: string
  files: string[]
  status: 'planned' | 'active' | 'blocked' | 'done' | 'failed'
  startedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export interface DependencyEdge {
  from: string    // task ID that is the prerequisite
  to: string      // task ID that depends on `from`
  type: DependencyType
  reason: string
}

export interface TaskDependencyGraphOptions {
  maxTasks?: number
}

export interface TopologyResult {
  order: string[]           // task IDs in dependency order
  levels: string[][]        // parallel groups (level 0 = no deps, level 1 = depends on level 0, etc.)
  hasCycle: boolean
  cyclePath?: string[]      // if hasCycle, the cycle path
}

export interface BlockedTask {
  taskId: string
  waitingFor: string[]      // task IDs that must complete first
  reason: string[]
}

export interface DependencyGraphSummary {
  totalTasks: number
  totalEdges: number
  completedTasks: number
  activeTasks: number
  blockedTasks: number
  readyTasks: string[]      // tasks with all deps satisfied
  longestPath: number       // longest dependency chain
}

export class TaskDependencyGraph {
  private nodes = new Map<string, TaskNode>()
  private edges: DependencyEdge[] = []
  private maxTasks: number

  constructor(options: TaskDependencyGraphOptions = {}) {
    this.maxTasks = options.maxTasks ?? 100
  }

  addTask(task: TaskNode): void {
    if (this.nodes.size >= this.maxTasks && !this.nodes.has(task.taskId)) {
      throw new Error(`Task graph capacity (${this.maxTasks}) reached`)
    }
    this.nodes.set(task.taskId, task)
  }

  removeTask(taskId: string): void {
    this.nodes.delete(taskId)
    this.edges = this.edges.filter(e => e.from !== taskId && e.to !== taskId)
  }

  addDependency(edge: DependencyEdge): { ok: boolean; error?: string } {
    if (!this.nodes.has(edge.from)) {
      return { ok: false, error: `Source task "${edge.from}" not found` }
    }
    if (!this.nodes.has(edge.to)) {
      return { ok: false, error: `Target task "${edge.to}" not found` }
    }
    if (edge.from === edge.to) {
      return { ok: false, error: 'Self-dependency is not allowed' }
    }

    // Check for duplicate
    const exists = this.edges.some(e => e.from === edge.from && e.to === edge.to)
    if (exists) return { ok: true }

    // Check if adding this edge creates a cycle
    const cycle = this.detectCycleWithEdge(edge)
    if (cycle) {
      return { ok: false, error: `Dependency creates cycle: ${cycle.join(' → ')}` }
    }

    this.edges.push(edge)
    return { ok: true }
  }

  getTask(taskId: string): TaskNode | undefined {
    return this.nodes.get(taskId)
  }

  updateTaskStatus(taskId: string, status: TaskNode['status']): void {
    const node = this.nodes.get(taskId)
    if (!node) return
    node.status = status
    if (status === 'done' || status === 'failed') {
      node.completedAt = new Date().toISOString()
    }
  }

  getDependencies(taskId: string): DependencyEdge[] {
    return this.edges.filter(e => e.to === taskId)
  }

  getDependents(taskId: string): DependencyEdge[] {
    return this.edges.filter(e => e.from === taskId)
  }

  getBlockedTasks(): BlockedTask[] {
    const blocked: BlockedTask[] = []
    for (const [taskId, node] of this.nodes) {
      if (node.status === 'done' || node.status === 'failed') continue

      const deps = this.getDependencies(taskId)
      const waitingFor: string[] = []
      const reason: string[] = []

      for (const dep of deps) {
        const depNode = this.nodes.get(dep.from)
        if (depNode && depNode.status !== 'done') {
          waitingFor.push(dep.from)
          reason.push(`${dep.from} (${depNode.status}): ${dep.reason}`)
        }
      }

      if (waitingFor.length > 0) {
        blocked.push({ taskId, waitingFor, reason })
      }
    }
    return blocked
  }

  getReadyTasks(): string[] {
    const ready: string[] = []
    for (const [taskId, node] of this.nodes) {
      if (node.status !== 'planned') continue
      const deps = this.getDependencies(taskId)
      const allMet = deps.every(dep => {
        const depNode = this.nodes.get(dep.from)
        return depNode?.status === 'done'
      })
      if (allMet) ready.push(taskId)
    }
    return ready
  }

  topologicalSort(): TopologyResult {
    const ids = [...this.nodes.keys()]
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()

    for (const id of ids) {
      inDegree.set(id, 0)
      adjList.set(id, [])
    }

    for (const edge of this.edges) {
      adjList.get(edge.from)!.push(edge.to)
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    }

    // Kahn's algorithm with level tracking
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const order: string[] = []
    const levels: string[][] = []

    while (queue.length > 0) {
      const levelSize = queue.length
      const currentLevel: string[] = []

      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!
        currentLevel.push(current)
        order.push(current)

        for (const neighbor of adjList.get(current) ?? []) {
          const newDeg = inDegree.get(neighbor)! - 1
          inDegree.set(neighbor, newDeg)
          if (newDeg === 0) queue.push(neighbor)
        }
      }

      levels.push(currentLevel)
    }

    if (order.length !== ids.length) {
      // Find the cycle
      const cycle = this.findCycle()
      return { order, levels, hasCycle: true, cyclePath: cycle ?? undefined }
    }

    return { order, levels, hasCycle: false }
  }

  summarize(): DependencyGraphSummary {
    const nodes = [...this.nodes.values()]
    const totalTasks = nodes.length
    const completedTasks = nodes.filter(n => n.status === 'done').length
    const activeTasks = nodes.filter(n => n.status === 'active').length
    const blockedTasks = this.getBlockedTasks().length
    const readyTasks = this.getReadyTasks()
    const longestPath = this.computeLongestPath()

    return {
      totalTasks,
      totalEdges: this.edges.length,
      completedTasks,
      activeTasks,
      blockedTasks,
      readyTasks,
      longestPath,
    }
  }

  listTasks(): TaskNode[] {
    return [...this.nodes.values()]
  }

  listEdges(): DependencyEdge[] {
    return [...this.edges]
  }

  toJSON(): { nodes: TaskNode[]; edges: DependencyEdge[] } {
    return { nodes: this.listTasks(), edges: this.listEdges() }
  }

  static fromJSON(data: { nodes: TaskNode[]; edges: DependencyEdge[] }): TaskDependencyGraph {
    const graph = new TaskDependencyGraph({ maxTasks: data.nodes.length + 50 })
    for (const node of data.nodes) graph.addTask(node)
    for (const edge of data.edges) graph.addDependency(edge)
    return graph
  }

  // --- Private ---

  private detectCycleWithEdge(newEdge: DependencyEdge): string[] | null {
    this.edges.push(newEdge)
    const cycle = this.findCycle()
    this.edges.pop()
    return cycle
  }

  private findCycle(): string[] | null {
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const parent = new Map<string, string>()

    const adjList = new Map<string, string[]>()
    for (const id of this.nodes.keys()) adjList.set(id, [])
    for (const edge of this.edges) adjList.get(edge.from)?.push(edge.to)

    for (const start of this.nodes.keys()) {
      if (visited.has(start)) continue
      const result = this.dfsCycle(start, visited, inStack, parent, adjList)
      if (result) return result
    }
    return null
  }

  private dfsCycle(
    current: string,
    visited: Set<string>,
    inStack: Set<string>,
    parent: Map<string, string>,
    adjList: Map<string, string[]>,
  ): string[] | null {
    visited.add(current)
    inStack.add(current)

    for (const neighbor of adjList.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, current)
        const result = this.dfsCycle(neighbor, visited, inStack, parent, adjList)
        if (result) return result
      } else if (inStack.has(neighbor)) {
        // Reconstruct cycle
        const cycle = [neighbor, current]
        let node = current
        while (node !== neighbor) {
          node = parent.get(node)!
          cycle.push(node)
        }
        return cycle.reverse()
      }
    }

    inStack.delete(current)
    return null
  }

  private computeLongestPath(): number {
    const topo = this.topologicalSort()
    if (topo.hasCycle) return -1

    const dist = new Map<string, number>()
    for (const id of this.nodes.keys()) dist.set(id, 0)

    const adjList = new Map<string, string[]>()
    for (const id of this.nodes.keys()) adjList.set(id, [])
    for (const edge of this.edges) adjList.get(edge.from)?.push(edge.to)

    for (const node of topo.order) {
      for (const neighbor of adjList.get(node) ?? []) {
        dist.set(neighbor, Math.max(dist.get(neighbor)!, dist.get(node)! + 1))
      }
    }

    let max = 0
    for (const d of dist.values()) max = Math.max(max, d)
    return max
  }
}
