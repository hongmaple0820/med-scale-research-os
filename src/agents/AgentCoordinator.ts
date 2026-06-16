// SCALE Engine — Agent Coordinator
// 协调器：任务分解、团队组建、进度监控、结果聚合

import type { AgentTeam, TeamConfig, TeamExecutionResult, AgentResult, ProgressReport, AgentRuntime } from './types.js'
import type { ArtifactId, Artifact } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IAgentPool } from './AgentPool.js'
import type { IAgentDispatcher } from './AgentDispatcher.js'
import type { IAgentChannel } from './AgentChannel.js'
import type { ITaskEngine, TaskDecomposition } from '../tasks/TaskEngine.js'
import { logger } from '../core/logger.js'

// SYSTEM_ACTOR 预留用于未来 FSM 状态触发
// const SYSTEM_ACTOR = { kind: 'system' as const, component: 'AgentCoordinator' }

export interface IAgentCoordinator {
  executeTeamTask(taskId: ArtifactId, config: TeamConfig): Promise<TeamExecutionResult>
  formTeam(taskId: ArtifactId, config: TeamConfig): Promise<AgentTeam>
  dissolveTeam(team: AgentTeam): Promise<void>
  monitorProgress(team: AgentTeam): Promise<ProgressReport>
}

export class AgentCoordinator implements IAgentCoordinator {
  constructor(
    private pool: IAgentPool,
    private dispatcher: IAgentDispatcher,
    private channel: IAgentChannel,
    private store: IArtifactStore,
    private taskEngine: ITaskEngine,
    private eventBus: IEventBus,
  ) {}

  async executeTeamTask(taskId: ArtifactId, config: TeamConfig): Promise<TeamExecutionResult> {
    const startTime = Date.now()
    const task = await this.store.get(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    logger.info({ taskId, profiles: config.profiles }, 'Starting team task execution')

    const subtasks = await this.decomposeTask(task, config)
    const team = await this.formTeam(taskId, config)
    
    await this.dispatcher.dispatchParallel(subtasks.map(s => s.id))

    const progress = await this.monitorProgress(team)
    
    while (progress.running > 0 && progress.completed < subtasks.length) {
      await new Promise(r => setTimeout(r, 1000))
      progress.completed++
      progress.running--
    }

    const result = await this.aggregateResults(team, startTime)
    await this.dissolveTeam(team)

    this.eventBus.emit('team.completed', { teamId: team.id, success: result.success })
    logger.info({ teamId: team.id, success: result.success, duration: result.duration }, 'Team task completed')

    return result
  }

  async formTeam(taskId: ArtifactId, config: TeamConfig): Promise<AgentTeam> {
    const agents: AgentRuntime[] = []

    for (const profileId of config.profiles) {
      const idle = this.pool.getIdleAgents(profileId)
      if (idle.length > 0) {
        agents.push(idle[0])
      } else {
        agents.push(this.pool.spawn(profileId))
      }
    }

    const team: AgentTeam = {
      id: `TEAM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agents,
      leader: agents[0],
      startedAt: Date.now(),
      taskId,
    }

    for (const agent of agents) {
      this.channel.subscribe(agent.id, team.id)
    }

    this.eventBus.emit('team.formed', { teamId: team.id, agentCount: agents.length })
    logger.info({ teamId: team.id, agents: agents.map(a => a.id) }, 'Team formed')

    return team
  }

  async dissolveTeam(team: AgentTeam): Promise<void> {
    for (const agent of team.agents) {
      this.channel.unsubscribe(agent.id, team.id)
      if (agent.status === 'completed' || agent.status === 'failed') {
        this.pool.recycle(agent.id)
      }
    }

    team.dissolvedAt = Date.now()
    this.eventBus.emit('team.dissolved', { teamId: team.id })
    logger.info({ teamId: team.id }, 'Team dissolved')
  }

  async monitorProgress(team: AgentTeam): Promise<ProgressReport> {
    const statuses = team.agents.map(a => a.status)

    return {
      teamId: team.id,
      taskId: team.taskId,
      total: team.agents.length,
      completed: statuses.filter(s => s === 'completed').length,
      running: statuses.filter(s => s === 'running').length,
      blocked: statuses.filter(s => s === 'blocked').length,
      failed: statuses.filter(s => s === 'failed').length,
      idle: statuses.filter(s => s === 'idle').length,
      agents: team.agents.map(a => ({
        agentId: a.id,
        profileId: a.profile.id,
        status: a.status,
        duration: a.completedAt ? a.completedAt - a.startedAt : Date.now() - a.startedAt
      }))
    }
  }

  private async decomposeTask(task: Artifact, config: TeamConfig): Promise<Artifact[]> {
    const decomposition: TaskDecomposition = {
      parentTaskId: task.id,
      subtasks: config.profiles.map(profileId => ({
        title: `${task.title} - ${profileId}`,
        payload: { requiredRole: profileId.split('-')[0] },
        dependencies: [],
      })),
    }

    const subtaskIds = await this.taskEngine.decompose(decomposition)
    const subtasks: Artifact[] = []

    for (const id of subtaskIds) {
      const artifact = await this.store.get(id)
      if (artifact) subtasks.push(artifact)
    }

    logger.info({ taskId: task.id, subtaskCount: subtasks.length }, 'Task decomposed')
    return subtasks
  }

  private async aggregateResults(team: AgentTeam, startTime: number): Promise<TeamExecutionResult> {
    const agentResults = new Map<string, AgentResult>()
    const outputs: ArtifactId[] = []

    for (const agent of team.agents) {
      const duration = (agent.completedAt ?? Date.now()) - agent.startedAt
      const result: AgentResult = {
        agentId: agent.id,
        status: agent.status,
        outputArtifacts: agent.outputArtifacts,
        duration,
        retryCount: agent.retryCount ?? 0,
      }
      agentResults.set(agent.id, result)
      outputs.push(...agent.outputArtifacts)

      if (agent.profile.domain === 'frontend' && agent.outputArtifacts.length > 0) {
        this.channel.send(agent.id, 'code-review-agent', 'output-share', { artifacts: agent.outputArtifacts })
      }
    }

    return {
      teamId: team.id,
      success: outputs.length > 0,
      outputArtifacts: outputs,
      duration: Date.now() - startTime,
      agentResults,
    }
  }
}
