// SCALE Engine — Auto Defect Creator (v0.7.1)
// 自动从检测器事件创建 Defect artifact

import type { IEventBus } from '../core/eventBus.js'
import type { IArtifactStore, CreateArtifactInput } from '../artifact/store.js'
import type { ArtifactId, Event, SessionId } from '../artifact/types.js'
import type { GateStage } from '../workflow/types.js'
import { logger } from '../core/logger.js'

export interface DefectPayload {
  rootCauseCategory: string
  evidence: string
  detector: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  autoCreated: boolean
  sessionId: SessionId
  timestamp: number
  context?: Record<string, unknown>
}

export interface IAutoDefectCreator {
  start(): void
  stop(): void
  getAutoDefects(): ArtifactId[]
}

export interface AutoDefectCreatorOptions {
  gateFailureThreshold?: number
}

interface GateFailurePayload {
  stage?: GateStage
  status?: string
  blockers?: string[]
  evidence?: string
  evidenceRecordId?: string
}

export class AutoDefectCreator implements IAutoDefectCreator {
  private subs: Array<{ unsubscribe(): void }> = []
  private autoDefects: ArtifactId[] = []
  private gateFailureStreaks = new Map<string, number>()
  private gateDefectCreated = new Set<string>()
  private handledGateEventIds = new Set<string>()
  private gateFailureThreshold: number

  constructor(
    private store: IArtifactStore,
    private eventBus: IEventBus,
    options: AutoDefectCreatorOptions = {},
  ) {
    this.gateFailureThreshold = options.gateFailureThreshold ?? 3
  }

  start(): void {
    this.subs.push(
      this.eventBus.on('behavior.hallucination', (e) => this.onHallucination(e)),
      this.eventBus.on('behavior.ai_slop', (e) => this.onAISlop(e)),
      this.eventBus.on('behavior.duplicate_edit', (e) => this.onDuplicateEdit(e)),
      this.eventBus.on('behavior.brute_retry', (e) => this.onBruteRetry(e)),
      this.eventBus.on('behavior.blame_shift', (e) => this.onBlameShift(e)),
      this.eventBus.on('gate.failed', (e) => this.onGateFailure(e as Event<GateFailurePayload>)),
      this.eventBus.on('gate.executed', (e) => this.onGateExecuted(e as Event<{ stage?: GateStage; passed?: boolean }>)),
    )
    logger.info('AutoDefectCreator started')
  }

  stop(): void {
    for (const sub of this.subs) sub.unsubscribe()
    this.subs = []
  }

  getAutoDefects(): ArtifactId[] {
    return [...this.autoDefects]
  }

  private async onHallucination(event: { sessionId: SessionId; payload: unknown }): Promise<void> {
    const payload = event.payload as { claim?: string; evidence?: string }
    await this.createDefect({
      rootCauseCategory: 'hallucination',
      evidence: payload.claim ?? 'Unverified success claim',
      detector: 'HallucinationDetector',
      severity: 'high',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: payload,
    }, `Hallucination: ${payload.claim ?? 'unverified claim'}`)
  }

  private async onAISlop(event: { sessionId: SessionId; payload: unknown }): Promise<void> {
    const payload = event.payload as { pattern?: string; file?: string }
    await this.createDefect({
      rootCauseCategory: 'ai_slop',
      evidence: `Pattern: ${payload.pattern} in ${payload.file}`,
      detector: 'AISlopDetector',
      severity: 'medium',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: payload,
    }, `AI Slop: ${payload.pattern}`)
  }

  private async onDuplicateEdit(event: { sessionId: SessionId; payload: unknown }): Promise<void> {
    const payload = event.payload as { editContent?: string; count?: number }
    await this.createDefect({
      rootCauseCategory: 'duplicate_edit',
      evidence: `Repeated ${payload.count ?? 2} times`,
      detector: 'DuplicateEditDetector',
      severity: 'low',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: payload,
    }, 'Duplicate Edit Detected')
  }

  private async onBruteRetry(event: { sessionId: SessionId; payload: unknown }): Promise<void> {
    const payload = event.payload as { strategy?: string; count?: number }
    await this.createDefect({
      rootCauseCategory: 'brute_retry',
      evidence: `Strategy "${payload.strategy}" failed ${payload.count ?? 3} times`,
      detector: 'BruteRetryDetector',
      severity: 'high',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: payload,
    }, `Brute Retry: ${payload.strategy}`)
  }

  private async onBlameShift(event: { sessionId: SessionId; payload: unknown }): Promise<void> {
    const payload = event.payload as { excuse?: string }
    await this.createDefect({
      rootCauseCategory: 'blame_shift',
      evidence: payload.excuse ?? 'Shifted blame',
      detector: 'BlameShiftDetector',
      severity: 'medium',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: payload,
    }, 'Blame Shift Detected')
  }

  private async onGateFailure(event: Event<GateFailurePayload>): Promise<void> {
    if (this.handledGateEventIds.has(event.id)) return
    this.handledGateEventIds.add(event.id)

    const stage = event.payload.stage ?? 'G0'
    const key = `${event.sessionId}:${stage}`
    const consecutiveFailures = (this.gateFailureStreaks.get(key) ?? 0) + 1
    this.gateFailureStreaks.set(key, consecutiveFailures)

    if (consecutiveFailures < this.gateFailureThreshold || this.gateDefectCreated.has(key)) {
      return
    }

    const blockers = event.payload.blockers ?? []
    await this.createDefect({
      rootCauseCategory: 'gate_failure',
      evidence: event.payload.evidence ?? (blockers.join('\n') || `Gate ${stage} failed ${consecutiveFailures} consecutive times.`),
      detector: 'GateFailureTracker',
      severity: 'high',
      autoCreated: true,
      sessionId: event.sessionId,
      timestamp: Date.now(),
      context: {
        stage,
        status: event.payload.status,
        blockers,
        evidenceRecordId: event.payload.evidenceRecordId,
        consecutiveFailures,
      },
    }, `Gate Failure: ${stage} failed ${consecutiveFailures} times`)
    this.gateDefectCreated.add(key)
  }

  private onGateExecuted(event: Event<{ stage?: GateStage; passed?: boolean }>): void {
    if (!event.payload.passed) return
    const stage = event.payload.stage ?? 'G0'
    const key = `${event.sessionId}:${stage}`
    this.gateFailureStreaks.delete(key)
    this.gateDefectCreated.delete(key)
  }

  async createDefect(payload: DefectPayload, title: string): Promise<ArtifactId | null> {
    try {
      const input: CreateArtifactInput = {
        type: 'Defect',
        title,
        initialStatus: 'OPEN',
        payload,
        tags: ['auto-created', payload.rootCauseCategory, payload.detector],
        parents: [],
      }
      const defect = await this.store.create(input)
      this.autoDefects.push(defect.id)
      this.eventBus.emit('defect.auto_created', {
        defectId: defect.id,
        rootCause: payload.rootCauseCategory,
        severity: payload.severity,
        sessionId: payload.sessionId,
      })
      logger.info({ defectId: defect.id, rootCause: payload.rootCauseCategory }, 'Auto-defect created')
      return defect.id
    } catch (err) {
      logger.error({ err, payload }, 'Failed to create auto-defect')
      return null
    }
  }
}
