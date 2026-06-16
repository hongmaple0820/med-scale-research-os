// SCALE Engine - Harness Engineering: 强制评审阶段
// 文章启发："将做事的 Agent 和评判的 Agent 分开，是一个强有力的杠杆"

import type { Artifact, TaskPayload } from '../artifact/types.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IFSM } from '../artifact/fsm.js'
import { GateEvaluator } from '../guardrails/GateEvaluator.js'
import { logger } from '../core/logger.js'

/**
 * ReviewEnforcer - 编码完成后强制调用评审 Agent
 *
 * 文章证据：评审 Agent 发现了编码 Agent 遗漏的渠道判断逻辑（潜在线上故障）
 *
 * 工作流程：
 * 1. Task 状态从 IN_PROGRESS → REVIEW_REQUIRED (新增状态)
 * 2. 自动触发 code-reviewer agent 评审
 * 3. 评审通过 → REVIEW_PASSED → DONE
 * 4. 评审不通过 → REVIEW_FAILED → 回退到 IN_PROGRESS
 */
export class ReviewEnforcer {
  constructor(private store: IArtifactStore, private eventBus: IEventBus, private fsm: IFSM) {}

  /**
   * Harness: 检查是否需要强制评审
   */
  async shouldEnforceReview(taskId: string): Promise<boolean> {
    const task = await this.store.get(taskId)
    if (!task) return false

    // 已完成的任务不需要评审
    if (task.status === 'DONE' || task.status === 'CANCELLED') return false

    // IN_PROGRESS 状态的任务，检查是否修改了代码
    if (task.status === 'IN_PROGRESS') {
      const payload = task.payload as TaskPayload
      // 有代码变更但未评审
      if (payload.filesInvolved?.length > 0 && !payload.reviewPassed) {
        return true
      }
    }

    return false
  }

  /**
   * Harness: 强制评审入口
   * 编码完成后自动触发，不依赖人工
   */
  async enforceReview(taskId: string): Promise<ReviewResult> {
    const task = await this.store.get(taskId)
    if (!task) throw new Error('Task not found: ' + taskId)

    logger.info({ taskId }, 'Enforcing mandatory review')

    // 1. 发射评审事件（触发 code-reviewer agent）
    this.eventBus.emit('review.required', {
      taskId,
      artifactId: taskId,
      filesInvolved: (task.payload as TaskPayload).filesInvolved ?? [],
      requiredChecks: [
        '代码质量检查',
        '安全漏洞扫描',
        '业务逻辑验证',
        '测试覆盖检查',
      ],
    })

    // 2. 等待评审结果（简化版：直接检查 payload）
    // 实际实现中应该等待 agent 完成评审并更新 payload
    const payload = task.payload as TaskPayload

    // 3. 检查 Harness Gates（程序化质量门禁）
    const gateResult = GateEvaluator.checkHarnessGates(payload, ['ci-strict', 'coverage-80', 'lint-clean'])

    // 4. 根据评审结果决定下一步
    if (gateResult.passed && payload.reviewPassed) {
      this.eventBus.emit('review.passed', { taskId, gateResults: gateResult.gateResults })
      return { passed: true, taskId, gateResults: gateResult.gateResults }
    } else {
      const reasons = gateResult.gateResults.filter(r => !r.passed).map(r => r.reason ?? r.gate.name)
      this.eventBus.emit('review.failed', { taskId, reasons })
      return { passed: false, taskId, reasons, gateResults: gateResult.gateResults }
    }
  }

  /**
   * Harness: 自动回退机制
   * 评审不通过时，自动回退到 IN_PROGRESS 状态
   */
  async rollbackOnReviewFailure(taskId: string, reasons: string[]): Promise<void> {
    const task = await this.store.get(taskId)
    if (!task) return

    logger.warn({ taskId, reasons }, 'Review failed, rolling back')

    // 发射回退事件
    this.eventBus.emit('task.review_failed', {
      taskId,
      previousStatus: task.status,
      rollbackTo: 'IN_PROGRESS',
      reasons,
    })

    // 更新 payload 记录失败原因
    const payload = task.payload as TaskPayload
    payload.reviewPassed = false

    // 触发 FSM transition（实际实现需要调用 fsm.transition）
    // await this.fsm.transition(taskId, 'review_failed')
  }

  /**
   * Harness: 评审循环上限
   * 文章启发：评审最多 2 轮，超出升级人工决策
   */
  async checkReviewIteration(taskId: string): Promise<{ exceeded: boolean; iteration: number }> {
    const events = await this.eventBus.query({
      sessionId: '', // 需要 session context
      types: ['review.required', 'review.passed', 'review.failed'],
      filter: (e) => (e.payload as any).taskId === taskId,
    })

    const reviewEvents = events.filter(e => e.type === 'review.required' || e.type === 'review.failed')
    const iteration = reviewEvents.length

    // Harness: 最多 2 轮评审
    return { exceeded: iteration >= 2, iteration }
  }
}

export interface ReviewResult {
  passed: boolean
  taskId: string
  reasons?: string[]
  gateResults?: Array<{ gate: any; passed: boolean; reason?: string }>
}
