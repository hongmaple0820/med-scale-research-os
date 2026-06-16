// SCALE Engine — Ultrawork Engine
// 并行执行引擎 (模型路由)

import type { IEventBus } from '../../core/eventBus.js'
import type { TaskDefinition, ModelTier } from '../types.js'

export interface ITaskRunner {
  run(task: TaskDefinition): Promise<{ success: boolean; output?: unknown; error?: string }>
}

export class UltraworkEngine {
  private eventBus: IEventBus
  private tasks: Map<string, TaskDefinition> = new Map()
  private runners: Map<ModelTier, ITaskRunner> = new Map()
  private results: Map<string, { success: boolean; output?: unknown; error?: string }> = new Map()

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus
    this.runners.set('LOW', new LowTierRunner())
    this.runners.set('MEDIUM', new MediumTierRunner())
    this.runners.set('HIGH', new HighTierRunner())
  }

  addTask(task: TaskDefinition): void {
    this.tasks.set(task.id, task)
  }

  addTasks(tasks: TaskDefinition[]): void {
    tasks.forEach(t => this.addTask(t))
  }

  async executeAll(): Promise<Map<string, { success: boolean; output?: unknown; error?: string }>> {
    const sortedTasks = this.sortByDependencies()
    for (const task of sortedTasks) {
      if (this.canExecute(task)) {
        await this.executeTask(task)
      }
    }
    return this.results
  }

  async executeParallel(): Promise<Map<string, { success: boolean; output?: unknown; error?: string }>> {
    const independentTasks = Array.from(this.tasks.values())
      .filter(t => t.dependencies.length === 0 && t.status === 'PENDING')

    await Promise.all(independentTasks.map(t => this.executeTask(t)))

    // Then execute dependent tasks
    const dependentTasks = Array.from(this.tasks.values())
      .filter(t => t.dependencies.length > 0 && t.status === 'PENDING')

    for (const task of dependentTasks) {
      if (this.canExecute(task)) {
        await this.executeTask(task)
      }
    }

    return this.results
  }

  private sortByDependencies(): TaskDefinition[] {
    const sorted: TaskDefinition[] = []
    const visited = new Set<string>()

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return
      visited.add(taskId)
      const task = this.tasks.get(taskId)
      if (task) {
        task.dependencies.forEach(d => visit(d))
        sorted.push(task)
      }
    }

    for (const taskId of this.tasks.keys()) {
      visit(taskId)
    }

    return sorted
  }

  private canExecute(task: TaskDefinition): boolean {
    return task.dependencies.every(depId => {
      const depResult = this.results.get(depId)
      return depResult?.success === true
    })
  }

  private async executeTask(task: TaskDefinition): Promise<void> {
    task.status = 'RUNNING'
    this.eventBus.emit('ultrawork.task.start', { taskId: task.id, tier: task.tier })

    const runner = this.runners.get(task.tier)
    if (!runner) {
      task.status = 'FAILED'
      this.results.set(task.id, { success: false, error: 'No runner for tier' })
      return
    }

    try {
      const result = await runner.run(task)
      task.status = result.success ? 'COMPLETED' : 'FAILED'
      this.results.set(task.id, result)
      this.eventBus.emit('ultrawork.task.end', { taskId: task.id, success: result.success })
    } catch (e) {
      task.status = 'FAILED'
      this.results.set(task.id, { success: false, error: String(e) })
    }
  }

  getResults(): Map<string, { success: boolean; output?: unknown; error?: string }> {
    return this.results
  }

  getTask(id: string): TaskDefinition | undefined {
    return this.tasks.get(id)
  }

  clear(): void {
    this.tasks.clear()
    this.results.clear()
  }
}

class LowTierRunner implements ITaskRunner {
  async run(task: TaskDefinition): Promise<{ success: boolean; output?: unknown; error?: string }> {
    return { success: true, output: { task: task.id, tier: 'LOW', result: 'quick lookup completed' } }
  }
}

class MediumTierRunner implements ITaskRunner {
  async run(task: TaskDefinition): Promise<{ success: boolean; output?: unknown; error?: string }> {
    return { success: true, output: { task: task.id, tier: 'MEDIUM', result: 'standard execution completed' } }
  }
}

class HighTierRunner implements ITaskRunner {
  async run(task: TaskDefinition): Promise<{ success: boolean; output?: unknown; error?: string }> {
    return { success: true, output: { task: task.id, tier: 'HIGH', result: 'deep analysis completed' } }
  }
}

export class ModelRouter {
  private taskComplexityThresholds = {
    quickLookup: 'LOW',
    codeGeneration: 'MEDIUM',
    architectureDecision: 'HIGH',
    securityAnalysis: 'HIGH',
    debugging: 'MEDIUM',
    refactoring: 'MEDIUM'
  }

  route(taskType: string): ModelTier {
    const tier = this.taskComplexityThresholds[taskType as keyof typeof this.taskComplexityThresholds]
    return (tier as ModelTier) || 'MEDIUM'
  }

  routeByComplexity(complexity: 'simple' | 'moderate' | 'complex'): ModelTier {
    switch (complexity) {
      case 'simple': return 'LOW'
      case 'moderate': return 'MEDIUM'
      case 'complex': return 'HIGH'
    }
  }
}