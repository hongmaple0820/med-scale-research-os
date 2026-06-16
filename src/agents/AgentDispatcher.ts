// SCALE Engine — Agent Dispatcher
// 任务分发器：根据任务类型选择合适的 Agent Profile

import type { AgentRuntime, TaskProfileMap } from './types.js'
import type { ArtifactId, Artifact } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IAgentPool } from './AgentPool.js'
import type { IAgentRegistry } from './AgentRegistry.js'
import { logger } from '../core/logger.js'

// Default task -> profile mappings
const DEFAULT_TASK_PROFILE_MAPPINGS: TaskProfileMap = {
  'frontend': ['frontend-agent', 'ui-design-agent'],
  'backend': ['backend-agent', 'database-agent'],
  'testing': ['test-agent'],
  'deployment': ['ops-agent'],
  'review': ['code-review-agent', 'security-agent'],
  'spec': ['product-agent', 'ui-design-agent'],
  'documentation': ['docs-agent'],
  'architecture': ['architect-agent'],
  'performance': ['performance-agent']
}

export interface IAgentDispatcher {
  dispatch(taskId: ArtifactId): Promise<string[]>
  dispatchParallel(taskIds: ArtifactId[]): Promise<Map<ArtifactId, string[]>>
  resolveProfiles(task: Artifact): string[]
}

export class AgentDispatcher implements IAgentDispatcher {
  private mappings: TaskProfileMap

  constructor(
    private pool: IAgentPool,
    private registry: IAgentRegistry,
    private store: IArtifactStore,
    private eventBus: IEventBus,
    mappings?: TaskProfileMap,
  ) {
    this.mappings = mappings ?? DEFAULT_TASK_PROFILE_MAPPINGS
  }

  async dispatch(taskId: ArtifactId): Promise<string[]> {
    const task = await this.store.get(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const profiles = this.resolveProfiles(task)
    if (profiles.length === 0) {
      logger.warn({ taskId }, 'No matching agent profiles for task')
      return []
    }

    const agents: AgentRuntime[] = []
    for (const profileId of profiles) {
      const idleAgents = this.pool.getIdleAgents(profileId)
      if (idleAgents.length > 0) {
        agents.push(idleAgents[0])
      } else {
        agents.push(this.pool.spawn(profileId))
      }
    }

    for (const agent of agents) {
      this.pool.assignTask(agent.id, taskId)
    }

    this.eventBus.emit('agent.dispatched', { taskId, agentIds: agents.map(a => a.id) }, { artifactId: taskId })
    logger.info({ taskId, agentIds: agents.map(a => a.id) }, 'Task dispatched to agents')

    return agents.map(a => a.id)
  }

  async dispatchParallel(taskIds: ArtifactId[]): Promise<Map<ArtifactId, string[]>> {
    const results = new Map<ArtifactId, string[]>()

    const independent: ArtifactId[] = []
    const dependent: ArtifactId[] = []

    for (const taskId of taskIds) {
      if (await this.hasDependencies(taskId)) {
        dependent.push(taskId)
      } else {
        independent.push(taskId)
      }
    }

    for (const taskId of independent) {
      results.set(taskId, await this.dispatch(taskId))
    }

    for (const taskId of dependent) {
      await this.waitForDependencies(taskId)
      results.set(taskId, await this.dispatch(taskId))
    }

    return results
  }

  resolveProfiles(task: Artifact): string[] {
    const tags = task.tags
    const payload = task.payload as Record<string, unknown>
    const requiredRole = (payload as { requiredRole?: string }).requiredRole

    if (requiredRole) {
      const byRole = this.registry.getByRole(requiredRole)
      if (byRole.length > 0) {
        return byRole.map(p => p.id)
      }
    }

    for (const [taskType, profiles] of Object.entries(this.mappings)) {
      if (tags.includes(taskType)) {
        return profiles
      }
    }

    const defaultProfile = this.registry.getByRole('Implementer')
    return defaultProfile.length > 0 ? [defaultProfile[0].id] : []
  }

  private async hasDependencies(taskId: ArtifactId): Promise<boolean> {
    const task = await this.store.get(taskId)
    if (!task) return false

    const payload = task.payload as { dependsOn?: ArtifactId[] }
    return (payload.dependsOn?.length ?? 0) > 0
  }

  private async waitForDependencies(taskId: ArtifactId): Promise<void> {
    const task = await this.store.get(taskId)
    if (!task) return

    const payload = task.payload as { dependsOn?: ArtifactId[] }
    const deps = payload.dependsOn ?? []

    for (const depId of deps) {
      const dep = await this.store.get(depId)
      if (dep && dep.status !== 'COMPLETED') {
        this.eventBus.emit('agent.dispatch_blocked', { taskId, blockedBy: [depId] })
        logger.warn({ taskId, blockedBy: depId }, 'Task blocked by dependency')
      }
    }
  }
}
