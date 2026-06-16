// SCALE Engine — Agent Pool (v0.8.0)
// Agent 实例池管理：生命周期、任务分配、状态跟踪

import type { ArtifactId, Timestamp } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import type { AgentRuntime, AgentStatus, AgentProfile, ModelConfig, ModelTier, AgentResult } from './types.js'
import { AgentProfileRegistry, defaultProfileRegistry } from './profiles.js'
import type { IModelRouter } from '../routing/ModelRouter.js'

// ============================================================================
// AgentPool 接口
// ============================================================================

export interface IAgentPool {
  spawn(profileId: string): AgentRuntime
  getIdleAgents(profileId?: string): AgentRuntime[]
  getAgent(agentId: string): AgentRuntime | undefined
  assignTask(agentId: string, taskId: ArtifactId): void
  complete(agentId: string, outputArtifacts: ArtifactId[]): void
  fail(agentId: string, reason: string): void
  block(agentId: string, blockedBy: string[]): void
  unblock(agentId: string): void
  recycle(agentId: string): void
  getStatus(agentId: string): AgentStatus | null
  listAll(): AgentRuntime[]
  getActiveCount(): number
}

// ============================================================================
// AgentPool 实现
// ============================================================================

export class AgentPool implements IAgentPool {
  private agents = new Map<string, AgentRuntime>()
  private seq = 0
  private registry: AgentProfileRegistry
  private modelRouter?: IModelRouter
  private eventBus?: IEventBus

  constructor(
    registry?: AgentProfileRegistry,
    modelRouter?: IModelRouter,
    eventBus?: IEventBus
  ) {
    this.registry = registry ?? defaultProfileRegistry
    this.modelRouter = modelRouter
    this.eventBus = eventBus
  }

  // ========== 实例管理 ==========

  /** 创建 Agent 实例 */
  spawn(profileId: string): AgentRuntime {
    const profile = this.registry.get(profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const id = `AGENT-${profileId}-${++this.seq}`
    const model = this.resolveModel(profile)

    const runtime: AgentRuntime = {
      id,
      profile,
      status: 'idle',
      model,
      startedAt: Date.now() as Timestamp,
      outputArtifacts: [],
      messages: [],
      retryCount: 0
    }

    this.agents.set(id, runtime)

    if (this.eventBus) {
      this.eventBus.emit('agent.spawned', { agentId: id, profileId }, {})
    }

    return runtime
  }

  /** 获取空闲 Agent */
  getIdleAgents(profileId?: string): AgentRuntime[] {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'idle')
      .filter(a => !profileId || a.profile.id === profileId)
  }

  /** 获取 Agent */
  getAgent(agentId: string): AgentRuntime | undefined {
    return this.agents.get(agentId)
  }

  // ========== 任务分配 ==========

  /** 分配任务 */
  assignTask(agentId: string, taskId: ArtifactId): void {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }
    if (agent.status !== 'idle') {
      throw new Error(`Agent not available (status: ${agent.status})`)
    }

    agent.status = 'running'
    agent.assignedTask = taskId

    if (this.eventBus) {
      this.eventBus.emit('agent.task_assigned', { agentId, taskId }, {})
    }
  }

  /** 完成任务 */
  complete(agentId: string, outputArtifacts: ArtifactId[]): void {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    agent.status = 'completed'
    agent.completedAt = Date.now() as Timestamp
    agent.outputArtifacts = outputArtifacts

    if (this.eventBus) {
      this.eventBus.emit('agent.completed', { agentId, outputs: outputArtifacts }, {})
    }
  }

  /** 任务失败 */
  fail(agentId: string, reason: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    agent.status = 'failed'
    agent.completedAt = Date.now() as Timestamp
    agent.retryCount++

    if (this.eventBus) {
      this.eventBus.emit('agent.failed', { agentId, reason, retryCount: agent.retryCount }, {})
    }
  }

  /** 阻塞 Agent */
  block(agentId: string, blockedBy: string[]): void {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    agent.status = 'blocked'
    agent.blockedBy = blockedBy

    if (this.eventBus) {
      this.eventBus.emit('agent.blocked', { agentId, blockedBy }, {})
    }
  }

  /** 解除阻塞 */
  unblock(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.status !== 'blocked') return

    agent.status = 'idle'
    agent.blockedBy = undefined

    if (this.eventBus) {
      this.eventBus.emit('agent.unblocked', { agentId }, {})
    }
  }

  // ========== 资源回收 ==========

  /** 回收 Agent */
  recycle(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return

    this.agents.delete(agentId)

    if (this.eventBus) {
      this.eventBus.emit('agent.recycled', { agentId }, {})
    }
  }

  /** 批量回收已完成的 Agent */
  recycleCompleted(): string[] {
    const toRecycle = Array.from(this.agents.values())
      .filter(a => a.status === 'completed' || a.status === 'failed')
      .map(a => a.id)

    for (const id of toRecycle) {
      this.recycle(id)
    }

    return toRecycle
  }

  // ========== 状态查询 ==========

  /** 获取状态 */
  getStatus(agentId: string): AgentStatus | null {
    return this.agents.get(agentId)?.status ?? null
  }

  /** 获取所有 Agent */
  listAll(): AgentRuntime[] {
    return Array.from(this.agents.values())
  }

  /** 获取活跃 Agent 数量 */
  getActiveCount(): number {
    return this.listAll().filter(a => a.status === 'running' || a.status === 'blocked').length
  }

  /** 获取 Agent 执行结果 */
  getResult(agentId: string): AgentResult | null {
    const agent = this.agents.get(agentId)
    if (!agent) return null

    return {
      agentId: agent.id,
      status: agent.status,
      outputArtifacts: agent.outputArtifacts,
      duration: agent.completedAt ? agent.completedAt - agent.startedAt : 0,
      retryCount: agent.retryCount
    }
  }

  // ========== Private Methods ==========

  /** 解析模型配置 */
  private resolveModel(profile: AgentProfile): ModelConfig {
    // 如果有 ModelRouter，使用它选择模型
    if (this.modelRouter) {
      const routed = this.modelRouter.route({
        taskComplexity: profile.preferredModel === 'powerful' ? 0.8 :
                        profile.preferredModel === 'fast' ? 0.3 : 0.5,
        artifactType: 'Task'
      })
      // 从模型名称推断 provider
      const provider = routed.name.includes('claude') ? 'anthropic' :
                       routed.name.includes('gpt') ? 'openai' : 'anthropic'
      return {
        provider,
        modelId: routed.name,
        tier: routed.tier === 'local' ? 'fast' : routed.tier as ModelTier
      }
    }

    // 默认模型配置
    const defaultModels: Record<string, ModelConfig> = {
      'fast': { provider: 'anthropic', modelId: 'claude-haiku-4', tier: 'fast' },
      'balanced': { provider: 'anthropic', modelId: 'claude-sonnet-4', tier: 'balanced' },
      'powerful': { provider: 'anthropic', modelId: 'claude-opus-4', tier: 'powerful' }
    }

    return defaultModels[profile.preferredModel] || defaultModels['balanced']
  }
}

/** 默认 Pool 实例 */
export const defaultAgentPool = new AgentPool()
