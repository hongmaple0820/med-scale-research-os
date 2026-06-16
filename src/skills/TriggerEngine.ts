// SCALE Engine — Trigger Engine (v0.7.0)
// 技能触发引擎：监听事件，触发技能推荐

import type { IEventBus } from '../core/eventBus.js'
// import type { Event } from '../artifact/types.js'  // unused - kept for future use
import type { ISkillRegistry, SkillTriggerCondition, SkillRecommendation } from './SkillRegistry.js'
import { logger } from '../core/logger.js'

export interface TriggerEvent {
  type: 'tool_used' | 'artifact_created' | 'artifact_transitioned' | 'detector_triggered' | 'phase_changed' | 'error_occurred'
  payload: Record<string, unknown>
  sessionId: string
  timestamp: number
}

export interface ITriggerEngine {
  start(): void
  stop(): void
  subscribe(eventType: string, handler: (event: TriggerEvent) => void): void
  emit(event: TriggerEvent): void
  triggerSkillRecommendation(context: SkillTriggerCondition): Promise<SkillRecommendation[]>
  injectRecommendationToContext(sessionId: string, recommendations: SkillRecommendation[]): void
  updateSessionContext(sessionId: string, updates: Partial<SkillTriggerCondition>): void
  getSessionContext(sessionId: string): SkillTriggerCondition | undefined
}

export class TriggerEngine implements ITriggerEngine {
  private eventBus: IEventBus
  private skillRegistry: ISkillRegistry
  private subscriptions = new Map<string, ((event: TriggerEvent) => void)[]>()
  private sessionContexts = new Map<string, SkillTriggerCondition>()
  private running = false

  constructor(eventBus: IEventBus, skillRegistry: ISkillRegistry) {
    this.eventBus = eventBus
    this.skillRegistry = skillRegistry
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.eventBus.on('tool.used', (e) => this.handleToolUsed(e.payload as Record<string, unknown>))
    this.eventBus.on('artifact.created', (e) => this.handleArtifactCreated(e.payload as Record<string, unknown>))
    this.eventBus.on('artifact.transitioned', (e) => this.handleArtifactTransitioned(e.payload as Record<string, unknown>))
    this.eventBus.on('detector.triggered', (e) => this.handleDetectorTriggered(e.payload as Record<string, unknown>))
    logger.info('TriggerEngine started')
  }

  stop(): void {
    this.running = false
    this.subscriptions.clear()
    this.sessionContexts.clear()
    logger.info('TriggerEngine stopped')
  }

  subscribe(eventType: string, handler: (event: TriggerEvent) => void): void {
    const subs = this.subscriptions.get(eventType) ?? []
    subs.push(handler)
    this.subscriptions.set(eventType, subs)
  }

  emit(event: TriggerEvent): void {
    const subs = this.subscriptions.get(event.type)
    if (!subs) return
    for (const handler of subs) {
      try { handler(event) } catch (err) { logger.error({ err }, 'Trigger handler error') }
    }
  }

  async triggerSkillRecommendation(context: SkillTriggerCondition): Promise<SkillRecommendation[]> {
    const recommendations = this.skillRegistry.recommend(context)
    if (recommendations.length > 0) {
      logger.info({ count: recommendations.length, topSkill: recommendations[0]?.skillId }, 'Skills recommended')
      this.eventBus.emit('skill.recommended', { recommendations, context })
    }
    return recommendations
  }

  injectRecommendationToContext(sessionId: string, recommendations: SkillRecommendation[]): void {
    if (recommendations.length === 0) return
    const block = this.formatRecommendationBlock(recommendations)
    this.eventBus.emit('context.inject', { sessionId, block, type: 'skill_recommendations' })
  }

  private handleToolUsed(data: Record<string, unknown>): void {
    const sessionId = (data.sessionId as string) ?? 'default'
    const tool = data.tool as string
    const context = this.sessionContexts.get(sessionId) ?? {}
    if (tool === 'Bash') {
      const cmd = ((data.args as { command?: string })?.command) ?? ''
      context.keywords = this.extractKeywords(cmd)
    }
    this.sessionContexts.set(sessionId, context)
    this.emit({ type: 'tool_used', payload: { tool }, sessionId, timestamp: Date.now() })
    this.triggerAndInject(sessionId, context)
  }

  private handleArtifactCreated(data: Record<string, unknown>): void {
    const sessionId = (data.sessionId as string) ?? 'default'
    const artifactType = data.type as string
    const context = this.sessionContexts.get(sessionId) ?? {}
    context.artifactType = artifactType
    context.taskType = this.mapArtifactToTask(artifactType)
    this.sessionContexts.set(sessionId, context)
    this.emit({ type: 'artifact_created', payload: { artifactId: data.id, type: artifactType }, sessionId, timestamp: Date.now() })
    this.triggerAndInject(sessionId, context)
  }

  private handleArtifactTransitioned(data: Record<string, unknown>): void {
    const sessionId = (data.sessionId as string) ?? 'default'
    const newStatus = data.newStatus as string
    const context = this.sessionContexts.get(sessionId) ?? {}
    context.artifactStatus = newStatus
    context.phase = this.mapStatusToPhase(newStatus)
    this.sessionContexts.set(sessionId, context)
    this.emit({ type: 'artifact_transitioned', payload: { artifactId: data.id, newStatus }, sessionId, timestamp: Date.now() })
    this.triggerAndInject(sessionId, context)
  }

  private handleDetectorTriggered(data: Record<string, unknown>): void {
    const sessionId = (data.sessionId as string) ?? 'default'
    const detector = data.detector as string
    const context = this.sessionContexts.get(sessionId) ?? {}
    context.detectorTriggered = detector
    this.sessionContexts.set(sessionId, context)
    this.emit({ type: 'detector_triggered', payload: { detector }, sessionId, timestamp: Date.now() })
    this.triggerAndInject(sessionId, context)
  }

  private async triggerAndInject(sessionId: string, context: SkillTriggerCondition): Promise<void> {
    const recommendations = await this.triggerSkillRecommendation(context)
    this.injectRecommendationToContext(sessionId, recommendations)
  }

  private formatRecommendationBlock(recommendations: SkillRecommendation[]): string {
    const lines = recommendations.map((r, i) => 
      `${i + 1}. **${r.skillId}** (priority ${r.priority}) - ${r.reason}`
    )
    return `\n## Recommended Skills\n\n${lines.join('\n')}\n`
  }

  private extractKeywords(cmd: string): string[] {
    const keywords: string[] = []
    if (/test|spec|verify/i.test(cmd)) keywords.push('test')
    if (/build|compile|make/i.test(cmd)) keywords.push('build')
    if (/lint|check|audit/i.test(cmd)) keywords.push('lint')
    if (/fix|bug|error|issue/i.test(cmd)) keywords.push('bug-fix')
    if (/refactor|clean|optimize/i.test(cmd)) keywords.push('refactor')
    if (/add|create|new|implement/i.test(cmd)) keywords.push('feature')
    return keywords
  }

  private mapArtifactToTask(type: string): string {
    const map: Record<string, string> = { Spec: 'planning', Plan: 'planning', Task: 'execution', Change: 'execution', Defect: 'bug-fix', Evidence: 'verification', Lesson: 'evolution' }
    return map[type] ?? 'unknown'
  }

  private mapStatusToPhase(status: string): SkillTriggerCondition['phase'] {
    const map: Record<string, SkillTriggerCondition['phase']> = { DRAFT: 'plan', REVIEWING: 'plan', FROZEN: 'plan', APPROVED: 'implement', IN_PROGRESS: 'implement', BLOCKED: 'implement', DONE: 'verify', CLOSED: 'evolve' }
    return map[status] ?? 'explore'
  }

  updateSessionContext(sessionId: string, updates: Partial<SkillTriggerCondition>): void {
    const ctx = this.sessionContexts.get(sessionId) ?? {}
    Object.assign(ctx, updates)
    this.sessionContexts.set(sessionId, ctx)
  }

  getSessionContext(sessionId: string): SkillTriggerCondition | undefined {
    return this.sessionContexts.get(sessionId)
  }
}
