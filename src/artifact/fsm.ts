/**
 * SCALE Engine — FSM (Finite State Machine) Engine
 *
 * 系统的"宪法执行者"。
 * 所有 Artifact 状态变化必须通过 fsm.transition()，禁止任何代码绕过。
 *
 * 设计参考：docs/02-DATA-MODEL.md §三、docs/03-CORE-MODULES.md §3.2
 */

import type {
  ArtifactType,
  FSMDefinition,
  TransitionContext,
  TransitionResult,
  GuardFailure,
} from './types.js'
import {
  InvalidTransitionError,
  ArtifactNotFoundError,
} from './types.js'
import type { IArtifactStore } from './store.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface IFSM {
  register(definition: FSMDefinition): void
  canTransition(artifactId: string, action: string): Promise<{
    allowed: boolean
    blockedBy?: GuardFailure[]
  }>
  transition(
    artifactId: string,
    action: string,
    context: TransitionContext
  ): Promise<TransitionResult>
  availableActions(artifactId: string): Promise<string[]>
  getDefinition(type: ArtifactType): FSMDefinition | undefined
}

export class FSM implements IFSM {
  private registry = new Map<ArtifactType, FSMDefinition>()
  /** Per-artifact lock chain to prevent concurrent transitions */
  private locks = new Map<string, Promise<void>>()

  constructor(
    private store: IArtifactStore,
    private eventBus: IEventBus
  ) {}

  register(definition: FSMDefinition): void {
    if (this.registry.has(definition.type)) {
      throw new Error(`FSM already registered for type: ${definition.type}`)
    }
    this.registry.set(definition.type, definition)
    logger.debug({ type: definition.type, states: definition.states }, 'FSM registered')
  }

  getDefinition(type: ArtifactType): FSMDefinition | undefined {
    return this.registry.get(type)
  }

  async canTransition(
    artifactId: string,
    action: string
  ): Promise<{ allowed: boolean; blockedBy?: GuardFailure[] }> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)

    const def = this.registry.get(artifact.type)
    if (!def) throw new Error(`No FSM registered for type: ${artifact.type}`)

    const tx = def.transitions.find(
      (t) => t.from === artifact.status && t.action === action
    )
    if (!tx) return { allowed: false, blockedBy: [{ guard: 'transition', message: `No transition from '${artifact.status}' via '${action}'` }] }

    const failures: GuardFailure[] = []
    for (const guard of tx.guards ?? []) {
      try {
        const passed = await guard.check(artifact, {
          actor: { kind: 'system', component: 'FSM.canTransition' },
        })
        if (!passed) failures.push({ guard: guard.name, message: guard.errorMessage })
      } catch (e) {
        failures.push({ guard: guard.name, message: `Guard threw: ${(e as Error).message}` })
      }
    }
    return { allowed: failures.length === 0, blockedBy: failures.length > 0 ? failures : undefined }
  }

  async transition(
    artifactId: string,
    action: string,
    context: TransitionContext
  ): Promise<TransitionResult> {
    // Concurrency lock: serialize transitions per artifact
    const prev = this.locks.get(artifactId) ?? Promise.resolve()
    let releaseLock!: () => void
    const acquired = new Promise<void>((resolve) => { releaseLock = resolve })
    this.locks.set(artifactId, prev.then(() => acquired))
    await prev

    try {
      return await this.executeTransition(artifactId, action, context)
    } finally {
      releaseLock()
      // Clean up lock entry if no pending chain
      if (this.locks.get(artifactId) === prev.then(() => acquired)) {
        this.locks.delete(artifactId)
      }
    }
  }

  private async executeTransition(
    artifactId: string,
    action: string,
    context: TransitionContext
  ): Promise<TransitionResult> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)

    const def = this.registry.get(artifact.type)
    if (!def) throw new Error(`No FSM registered for type: ${artifact.type}`)

    const tx = def.transitions.find(
      (t) => t.from === artifact.status && t.action === action
    )
    if (!tx) throw new InvalidTransitionError(artifact.status, action)

    // Phase 1: 检查所有 guards
    const failures: GuardFailure[] = []
    for (const guard of tx.guards ?? []) {
      try {
        const passed = await guard.check(artifact, context)
        if (!passed) {
          failures.push({ guard: guard.name, message: guard.errorMessage })
        }
      } catch (e) {
        failures.push({
          guard: guard.name,
          message: `Guard threw: ${(e as Error).message}`,
        })
      }
    }

    if (failures.length > 0) {
      logger.info({ artifactId, action, failures }, 'Transition blocked by guards')
      return { success: false, blockedBy: failures, effectsExecuted: [] }
    }

    // Phase 2: 写状态历史 + 更新状态（事件先发，后落 DB）
    const event = this.eventBus.emit('artifact.transitioned', {
      artifactId,
      from: artifact.status,
      to: tx.to,
      reason: context.reason,
    }, {
      sessionId: 'system',
      actor: context.actor,
      artifactId,
    })

    const updated = await this.store.update(artifactId, {
      status: tx.to,
      statusHistory: [
        ...artifact.statusHistory,
        {
          from: artifact.status,
          to: tx.to,
          at: Date.now(),
          by: context.actor,
          reason: context.reason,
          eventId: event.id,
        },
      ],
      updatedAt: Date.now(),
      ...(def.terminal.includes(tx.to) ? { closedAt: Date.now() } : {}),
    })

    logger.info(
      { artifactId, from: artifact.status, to: tx.to, by: context.actor },
      'Transition completed'
    )

    // Phase 3: 异步执行 effects（不阻塞返回，但记录失败）
    const effectsExecuted: string[] = []
    for (const effect of tx.effects ?? []) {
      try {
        await effect.run(updated, context)
        effectsExecuted.push(effect.name)
      } catch (e) {
        logger.error(
          { artifactId, effect: effect.name, error: (e as Error).message },
          'Effect execution failed'
        )
        // Effect 失败不回滚状态迁移（事件已发出，下游可补偿）
      }
    }

    return { success: true, artifact: updated, effectsExecuted }
  }

  /** Number of artifacts with pending lock chains (for testing/monitoring) */
  get pendingLocks(): number {
    return this.locks.size
  }

  async availableActions(artifactId: string): Promise<string[]> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) throw new ArtifactNotFoundError(artifactId)

    const def = this.registry.get(artifact.type)
    if (!def) return []

    return def.transitions
      .filter((t) => t.from === artifact.status)
      .map((t) => t.action)
  }
}

// ============================================================================
// 内置 FSM 定义（11 种 Artifact）
// 这些定义在 src/artifact/fsmDefinitions/ 下完整实现
// 此处只列 Spec 作为示例
// ============================================================================

export const SpecFSM: FSMDefinition = {
  type: 'Spec',
  states: ['DRAFT', 'REVIEWING', 'FROZEN', 'REVISING', 'OBSOLETED'] as const,
  initial: 'DRAFT',
  terminal: ['OBSOLETED'] as const,
  transitions: [
    {
      from: 'DRAFT',
      action: 'refine',
      to: 'REVIEWING',
    },
    {
      from: 'REVIEWING',
      action: 'reject',
      to: 'DRAFT',
    },
    {
      from: 'REVIEWING',
      action: 'approve',
      to: 'FROZEN',
      guards: [
        {
          name: 'ambiguity_below_threshold',
          check: (a) => {
            const payload = a.payload as { ambiguityScore?: number }
            return (payload.ambiguityScore ?? 1) <= 0.2
          },
          errorMessage: 'Spec 模糊度必须 ≤ 0.2 才能 FROZEN',
        },
      ],
    },
    {
      from: 'FROZEN',
      action: 'challenge',
      to: 'REVISING',
      // effects 在运行时由 Engine 注入（避免循环依赖）
    },
    {
      from: 'REVISING',
      action: 'finalize',
      to: 'FROZEN',
    },
    {
      from: 'FROZEN',
      action: 'supersede',
      to: 'OBSOLETED',
    },
  ],
} as const

// 其他 FSM 定义占位（W2 完整实现）
// export const NeedFSM: FSMDefinition = { ... }
// export const PlanFSM: FSMDefinition = { ... }
// export const TaskFSM: FSMDefinition = { ... }
// export const ChangeFSM: FSMDefinition = { ... }
// export const DefectFSM: FSMDefinition = { ... }
// ...

