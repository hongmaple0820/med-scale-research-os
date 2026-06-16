// SCALE Engine — FSM Effects Wiring (W9)
// 上游 Artifact 状态变更时自动影响下游
// 设计参考：docs/01-ARCHITECTURE.md §二 L4

import type { IFSM } from '../artifact/fsm.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IEventBus } from '../core/eventBus.js'
import type { Artifact, TransitionContext } from '../artifact/types.js'
import { logger } from '../core/logger.js'

/**
 * 注入所有跨 Artifact 的 effects
 * 在引擎启动后调用（避免循环依赖）
 */
export function wireEffects(
  fsm: IFSM,
  store: IArtifactStore,
  eventBus: IEventBus,
): void {
  // Effect 1: Spec 进入 REVISING → 自动 invalidate 下游 Plan
  const specDef = fsm.getDefinition('Spec')
  if (specDef) {
    const challengeTx = specDef.transitions.find(
      (t) => t.from === 'FROZEN' && t.action === 'challenge',
    )
    if (challengeTx && !challengeTx.effects) {
      challengeTx.effects = []
    }
    if (challengeTx) {
      challengeTx.effects!.push({
        name: 'invalidate_downstream_plans',
        run: async (artifact: Artifact, _ctx: TransitionContext) => {
          const children = await store.findChildren(artifact.id)
          const plans = children.filter(
            (c) => c.type === 'Plan' && ['APPROVED', 'IMPLEMENTING'].includes(c.status),
          )
          for (const plan of plans) {
            try {
              await fsm.transition(plan.id, 'invalidate', {
                actor: { kind: 'system', component: 'EffectsWiring' },
                reason: `Parent Spec ${artifact.id} entered REVISING`,
              })
              logger.info({ planId: plan.id, specId: artifact.id }, 'Plan auto-invalidated due to Spec challenge')
            } catch (e) {
              logger.warn(
                { planId: plan.id, error: (e as Error).message },
                'Failed to invalidate downstream Plan',
              )
            }
          }
        },
      })
    }
  }

  // Effect 2: Plan 进入 DONE → 自动完成关联的未完成 Task
  const planDef = fsm.getDefinition('Plan')
  if (planDef) {
    const completeTx = planDef.transitions.find(
      (t) => t.from === 'IMPLEMENTING' && t.action === 'complete',
    )
    if (completeTx && !completeTx.effects) {
      completeTx.effects = []
    }
    if (completeTx) {
      completeTx.effects!.push({
        name: 'check_incomplete_tasks',
        run: async (artifact: Artifact) => {
          const children = await store.findChildren(artifact.id)
          const incompleteTasks = children.filter(
            (c) => c.type === 'Task' && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(c.status),
          )
          if (incompleteTasks.length > 0) {
            logger.warn(
              { planId: artifact.id, incompleteTasks: incompleteTasks.map((t) => t.id) },
              'Plan completed but has incomplete tasks — review needed',
            )
            eventBus.emit('artifact.gate_checked', {
              artifactId: artifact.id,
              warning: `${incompleteTasks.length} incomplete tasks remain`,
              taskIds: incompleteTasks.map((t) => t.id),
            })
          }
        },
      })
    }
  }

  // Effect 3: Defect CLOSED → 自动提取 Lesson (触发事件)
  const defectDef = fsm.getDefinition('Defect')
  if (defectDef) {
    const verifyTx = defectDef.transitions.find(
      (t) => t.from === 'FIXED' && t.action === 'verify',
    )
    if (verifyTx && !verifyTx.effects) {
      verifyTx.effects = []
    }
    if (verifyTx) {
      verifyTx.effects!.push({
        name: 'trigger_lesson_extraction',
        run: async (artifact: Artifact) => {
          eventBus.emit('lesson.proposed', {
            defectId: artifact.id,
            trigger: 'defect_closed',
            rootCause: (artifact.payload as Record<string, unknown>).rootCauseCategory,
          })
          logger.info({ defectId: artifact.id }, 'Lesson extraction triggered from closed defect')
        },
      })
    }
  }

  logger.info('FSM effects wired successfully')
}


