// SCALE Engine — Behavior Tracker (W10 完整实现)
// 订阅事件流，统计指标，发现模式
// v0.7.1 增强：自动触发进化周期
// 设计参考：docs/03-CORE-MODULES.md §3.7

import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface AutoEvolveConfig {
  enabled: boolean
  bruteRetryThreshold: number
}

export interface SessionMetrics {
  sessionId: string
  duration: number
  toolCalls: number
  toolFailures: number
  bruteRetryCount: number
  blameShiftCount: number
  prematureDoneCount: number
  artifactsCreated: number
  rolesUsed: string[]
  modelsUsed: Record<string, number>
}

export interface IBehaviorTracker {
  start(): void
  stop(): void
  getSessionMetrics(sessionId: string): Promise<SessionMetrics>
  detectPatterns(): Promise<unknown[]>
  setAutoEvolve(config: AutoEvolveConfig, runCycleFn: () => Promise<void>): void
}

export class BehaviorTracker implements IBehaviorTracker {
  private subs: Array<{ unsubscribe(): void }> = []
  private metrics = new Map<string, SessionMetrics>()
  private autoEvolveConfig: AutoEvolveConfig = { enabled: false, bruteRetryThreshold: 3 }
  private runCycleFn?: () => Promise<void>

  constructor(private eventBus: IEventBus) {}

  setAutoEvolve(config: AutoEvolveConfig, runCycleFn: () => Promise<void>): void {
    this.autoEvolveConfig = config
    this.runCycleFn = runCycleFn
    logger.info({ config }, 'Auto-evolve configured')
  }

  start(): void {
    this.subs.push(
      this.eventBus.on('tool.called', (e) => this.onToolCalled(e.sessionId, e.payload)),
      this.eventBus.on('tool.failed', (e) => this.onToolFailed(e.sessionId)),
      this.eventBus.on('behavior.brute_retry', (e) => this.onBruteRetry(e.sessionId)),
      this.eventBus.on('behavior.blame_shift', (e) => this.onBlameShift(e.sessionId)),
      this.eventBus.on('behavior.premature_done', (e) => this.onPrematureDone(e.sessionId)),
      this.eventBus.on('artifact.created', (e) => this.onArtifactCreated(e.sessionId)),
      this.eventBus.on('role.activated', (e) => this.onRoleActivated(e.sessionId, (e.payload as { role: string }).role)),
    )
    logger.info('BehaviorTracker started')
  }

  stop(): void {
    for (const sub of this.subs) sub.unsubscribe()
    this.subs = []
  }

  async getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    return this.metrics.get(sessionId) ?? this.createEmptyMetrics(sessionId)
  }

  async detectPatterns(): Promise<unknown[]> {
    // W10 实现
    return []
  }

  private getOrCreate(sessionId: string): SessionMetrics {
    if (!this.metrics.has(sessionId)) this.metrics.set(sessionId, this.createEmptyMetrics(sessionId))
    return this.metrics.get(sessionId)!
  }

  private createEmptyMetrics(sessionId: string): SessionMetrics {
    return {
      sessionId, duration: 0, toolCalls: 0, toolFailures: 0,
      bruteRetryCount: 0, blameShiftCount: 0, prematureDoneCount: 0,
      artifactsCreated: 0, rolesUsed: [], modelsUsed: {},
    }
  }

  private onToolCalled(sessionId: string, _payload: unknown): void { this.getOrCreate(sessionId).toolCalls += 1 }
  private onToolFailed(sessionId: string): void { this.getOrCreate(sessionId).toolFailures += 1 }
  private onBruteRetry(sessionId: string): void {
    const metrics = this.getOrCreate(sessionId)
    metrics.bruteRetryCount += 1

    // Auto-trigger evolution cycle when threshold reached
    if (this.autoEvolveConfig.enabled && this.runCycleFn &&
        metrics.bruteRetryCount >= this.autoEvolveConfig.bruteRetryThreshold) {
      logger.warn({ sessionId, bruteRetryCount: metrics.bruteRetryCount }, 'Brute retry threshold reached — triggering auto-evolve')
      this.runCycleFn().catch(err => logger.error({ err }, 'Auto-evolve cycle failed'))
    }
  }
  private onBlameShift(sessionId: string): void { this.getOrCreate(sessionId).blameShiftCount += 1 }
  private onPrematureDone(sessionId: string): void { this.getOrCreate(sessionId).prematureDoneCount += 1 }
  private onArtifactCreated(sessionId: string): void { this.getOrCreate(sessionId).artifactsCreated += 1 }
  private onRoleActivated(sessionId: string, role: string): void {
    const m = this.getOrCreate(sessionId)
    if (!m.rolesUsed.includes(role)) m.rolesUsed.push(role)
  }
}
