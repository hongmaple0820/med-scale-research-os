// SCALE Engine — 11 种 Artifact 的 FSM 定义
// 设计参考：docs/02-DATA-MODEL.md §三

import type { FSMDefinition, SpecPayload, PlanPayload, DefectPayload, TaskPayload } from './types.js'

// ============================================================================
// Need
// ============================================================================
export const NeedFSM: FSMDefinition = {
  type: 'Need',
  states: ['DRAFT', 'CLARIFIED', 'FULFILLED', 'ABANDONED'] as const,
  initial: 'DRAFT',
  terminal: ['FULFILLED', 'ABANDONED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'refine', to: 'CLARIFIED' },
    { from: 'DRAFT', action: 'discard', to: 'ABANDONED' },
    { from: 'CLARIFIED', action: 'fulfill', to: 'FULFILLED' },
    { from: 'CLARIFIED', action: 'discard', to: 'ABANDONED' },
  ],
}

// ============================================================================
// Insight
// ============================================================================
export const InsightFSM: FSMDefinition = {
  type: 'Insight',
  states: ['DRAFT', 'VERIFIED', 'INVALIDATED'] as const,
  initial: 'DRAFT',
  terminal: ['INVALIDATED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'verify', to: 'VERIFIED' },
    { from: 'DRAFT', action: 'invalidate', to: 'INVALIDATED' },
    { from: 'VERIFIED', action: 'invalidate', to: 'INVALIDATED' },
  ],
}

// ============================================================================
// Spec (核心)
// ============================================================================
export const SpecFSM: FSMDefinition = {
  type: 'Spec',
  states: ['DRAFT', 'REVIEWING', 'FROZEN', 'REVISING', 'OBSOLETED'] as const,
  initial: 'DRAFT',
  terminal: ['OBSOLETED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'refine', to: 'REVIEWING' },
    { from: 'REVIEWING', action: 'reject', to: 'DRAFT' },
    {
      from: 'REVIEWING',
      action: 'approve',
      to: 'FROZEN',
      guards: [
        {
          name: 'ambiguity_below_threshold',
          check: (a) => ((a.payload as Partial<SpecPayload>) as { ambiguityScore?: number }).ambiguityScore !== undefined
            ? (((a.payload as { ambiguityScore?: number }).ambiguityScore!) <= 0.2)
            : true, // 若未设置则放行（开发期友好）
          errorMessage: 'Spec 模糊度必须 ≤ 0.2 才能 FROZEN',
        },
        {
          name: 'has_success_criteria',
          check: (a) => ((a.payload as Partial<SpecPayload>).successCriteria?.length ?? 0) > 0,
          errorMessage: 'Spec 必须有至少一条 successCriteria',
        },
      ],
    },
    { from: 'FROZEN', action: 'challenge', to: 'REVISING' },
    { from: 'REVISING', action: 'finalize', to: 'FROZEN' },
    { from: 'FROZEN', action: 'supersede', to: 'OBSOLETED' },
    { from: 'REVISING', action: 'supersede', to: 'OBSOLETED' },
    // Fallback: evidence failure after freeze → re-enter review
    { from: 'FROZEN', action: 'evidence_fails', to: 'REVISING' },
    { from: 'OBSOLETED', action: 'reopen', to: 'DRAFT' },
  ],
}

// ============================================================================
// Plan
// ============================================================================
export const PlanFSM: FSMDefinition = {
  type: 'Plan',
  states: ['DRAFT', 'APPROVED', 'IMPLEMENTING', 'DONE', 'IN_REVISION', 'REVISING', 'SUPERSEDED'] as const,
  initial: 'DRAFT',
  terminal: ['SUPERSEDED'] as const,
  transitions: [
    {
      from: 'DRAFT',
      action: 'review',
      to: 'APPROVED',
      guards: [
        {
          name: 'has_rollback_strategy',
          check: (a) => !!(a.payload as Partial<PlanPayload>).rollbackStrategy,
          errorMessage: 'Plan 必须填写 rollbackStrategy 才能 APPROVED',
        },
      ],
    },
    { from: 'APPROVED', action: 'implement', to: 'IMPLEMENTING' },
    { from: 'IMPLEMENTING', action: 'complete', to: 'DONE' },
    { from: 'APPROVED', action: 'invalidate', to: 'REVISING' },
    { from: 'IMPLEMENTING', action: 'invalidate', to: 'REVISING' },
    { from: 'REVISING', action: 'review', to: 'APPROVED' },
    { from: 'DRAFT', action: 'supersede', to: 'SUPERSEDED' },
    { from: 'DONE', action: 'supersede', to: 'SUPERSEDED' },
    // Fallback edges: evidence failure → rollback
    { from: 'IMPLEMENTING', action: 'evidence_fails', to: 'APPROVED' },
    // Reopen support
    { from: 'DONE', action: 'reopen', to: 'IN_REVISION' },
    { from: 'IN_REVISION', action: 'review', to: 'APPROVED' },
    { from: 'IN_REVISION', action: 'supersede', to: 'SUPERSEDED' },
  ],
}

// ============================================================================
// TestPlan
// ============================================================================
export const TestPlanFSM: FSMDefinition = {
  type: 'TestPlan',
  states: ['DRAFT', 'APPROVED', 'EXECUTING', 'PASSED', 'FAILED'] as const,
  initial: 'DRAFT',
  terminal: ['PASSED', 'FAILED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'approve', to: 'APPROVED' },
    { from: 'APPROVED', action: 'execute', to: 'EXECUTING' },
    { from: 'EXECUTING', action: 'pass', to: 'PASSED' },
    { from: 'EXECUTING', action: 'fail', to: 'FAILED' },
    { from: 'FAILED', action: 'retry', to: 'EXECUTING' },
  ],
}

// ============================================================================
// Task
// ============================================================================
export const TaskFSM: FSMDefinition = {
  type: 'Task',
  states: ['PENDING', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'IN_REVISION', 'FAILED', 'CANCELLED'] as const,
  initial: 'PENDING',
  terminal: ['COMPLETED', 'FAILED', 'CANCELLED'] as const,
  transitions: [
    { from: 'PENDING', action: 'schedule', to: 'READY' },
    { from: 'PENDING', action: 'cancel', to: 'CANCELLED' },
    { from: 'READY', action: 'start', to: 'RUNNING' },
    { from: 'READY', action: 'cancel', to: 'CANCELLED' },
    { from: 'RUNNING', action: 'pause', to: 'PAUSED' },
    {
      from: 'RUNNING',
      action: 'complete',
      to: 'COMPLETED',
      guards: [
        {
          name: 'build_passed',
          check: (a) => {
            const payload = a.payload as Partial<TaskPayload>
            // 必须运行验证且通过才可完成
            if (!payload.buildStatus) return false
            return payload.buildStatus === 'success' && (payload.buildExitCode ?? 0) === 0
          },
          errorMessage: 'Task 完成前必须运行 build 验证且通过（buildStatus=success, exitCode=0）。运行: scale verify-task <id>',
        },
        {
          name: 'lint_passed',
          check: (a) => {
            const payload = a.payload as Partial<TaskPayload>
            if (!payload.lintStatus) return false
            return payload.lintStatus === 'success'
          },
          errorMessage: 'Task 完成前必须运行 lint 验证且通过（lintStatus=success）。运行: scale verify-task <id>',
        },
        {
          name: 'tests_passed',
          check: (a) => {
            const payload = a.payload as Partial<TaskPayload>
            if (!payload.testPassed) return false
            // Coverage is optional - if not set, only require testPassed
            if (payload.testCoverage === undefined) return payload.testPassed === true
            return payload.testPassed === true && payload.testCoverage >= 80
          },
          errorMessage: 'Task 完成前必须运行测试验证且通过（testPassed=true）。如果设置了覆盖率，需 ≥ 80%。运行: scale verify-task <id>',
        },
      ],
    },
    { from: 'RUNNING', action: 'fail', to: 'FAILED' },
    { from: 'PAUSED', action: 'resume', to: 'RUNNING' },
    { from: 'PAUSED', action: 'cancel', to: 'CANCELLED' },
    { from: 'FAILED', action: 'retry', to: 'READY' },
    { from: 'COMPLETED', action: 'reopen', to: 'IN_REVISION' },
    { from: 'IN_REVISION', action: 'start', to: 'RUNNING' },
    { from: 'IN_REVISION', action: 'cancel', to: 'CANCELLED' },
  ],
}

// ============================================================================
// Change
// ============================================================================
export const ChangeFSM: FSMDefinition = {
  type: 'Change',
  states: ['DRAFT', 'COMMITTED', 'VERIFIED', 'REVERTED'] as const,
  initial: 'DRAFT',
  terminal: ['REVERTED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'commit', to: 'COMMITTED' },
    { from: 'COMMITTED', action: 'verify', to: 'VERIFIED' },
    { from: 'COMMITTED', action: 'revert', to: 'REVERTED' },
    { from: 'VERIFIED', action: 'revert', to: 'REVERTED' },
    { from: 'VERIFIED', action: 'evidence_fails', to: 'COMMITTED' },
  ],
}

// ============================================================================
// Evidence
// ============================================================================
export const EvidenceFSM: FSMDefinition = {
  type: 'Evidence',
  states: ['COLLECTED', 'PASS', 'FAIL'] as const,
  initial: 'COLLECTED',
  terminal: ['PASS', 'FAIL'] as const,
  transitions: [
    { from: 'COLLECTED', action: 'pass', to: 'PASS' },
    { from: 'COLLECTED', action: 'fail', to: 'FAIL' },
  ],
}

// ============================================================================
// Defect
// ============================================================================
export const DefectFSM: FSMDefinition = {
  type: 'Defect',
  states: ['OPEN', 'INVESTIGATING', 'DIAGNOSED', 'FIXED', 'CLOSED', 'DUPLICATE'] as const,
  initial: 'OPEN',
  terminal: ['CLOSED', 'DUPLICATE'] as const,
  transitions: [
    { from: 'OPEN', action: 'assign', to: 'INVESTIGATING' },
    { from: 'OPEN', action: 'duplicate', to: 'DUPLICATE' },
    {
      from: 'INVESTIGATING',
      action: 'diagnose',
      to: 'DIAGNOSED',
      guards: [
        {
          name: 'has_root_cause',
          check: (a) => {
            const p = a.payload as Partial<DefectPayload>
            return !!p.rootCauseCategory && p.rootCauseCategory !== 'unknown'
          },
          errorMessage: 'Defect 必须填写 rootCauseCategory（且不能是 unknown）才能 DIAGNOSED',
        },
      ],
    },
    { from: 'DIAGNOSED', action: 'fix', to: 'FIXED' },
    { from: 'FIXED', action: 'verify', to: 'CLOSED' },
    { from: 'CLOSED', action: 'reopen', to: 'OPEN' },
    { from: 'INVESTIGATING', action: 'duplicate', to: 'DUPLICATE' },
  ],
}

// ============================================================================
// Lesson
// ============================================================================
export const LessonFSM: FSMDefinition = {
  type: 'Lesson',
  states: ['PROPOSED', 'APPROVED', 'ACTIVE', 'PROMOTED_TO_RULE', 'REJECTED', 'SUPERSEDED'] as const,
  initial: 'PROPOSED',
  terminal: ['REJECTED', 'SUPERSEDED'] as const,
  transitions: [
    { from: 'PROPOSED', action: 'review', to: 'APPROVED' },
    { from: 'PROPOSED', action: 'reject', to: 'REJECTED' },
    { from: 'APPROVED', action: 'promote', to: 'ACTIVE' },
    { from: 'ACTIVE', action: 'evolve', to: 'PROMOTED_TO_RULE' },
    { from: 'ACTIVE', action: 'supersede', to: 'SUPERSEDED' },
  ],
}

// ============================================================================
// Release
// ============================================================================
export const ReleaseFSM: FSMDefinition = {
  type: 'Release',
  states: ['PLANNED', 'READY', 'DEPLOYING', 'DEPLOYED', 'ROLLED_BACK'] as const,
  initial: 'PLANNED',
  terminal: ['DEPLOYED', 'ROLLED_BACK'] as const,
  transitions: [
    { from: 'PLANNED', action: 'prepare', to: 'READY' },
    { from: 'READY', action: 'ship', to: 'DEPLOYING' },
    { from: 'DEPLOYING', action: 'verify', to: 'DEPLOYED' },
    { from: 'DEPLOYING', action: 'rollback', to: 'ROLLED_BACK' },
    { from: 'DEPLOYED', action: 'rollback', to: 'ROLLED_BACK' },
  ],
}

// ============================================================================
// 注册所有 FSM
// ============================================================================
export const ALL_FSMS = [
  NeedFSM, InsightFSM, SpecFSM, PlanFSM, TestPlanFSM, TaskFSM,
  ChangeFSM, EvidenceFSM, DefectFSM, LessonFSM, ReleaseFSM,
] as const

import type { IFSM } from './fsm.js'
import type { ArtifactType } from './types.js'

export function registerAllFSMs(fsm: IFSM): void {
  for (const def of ALL_FSMS) {
    fsm.register(def)
  }
}

/** 各 Artifact 类型的初始状态查询表 */
export const INITIAL_STATES: Record<ArtifactType, string> = Object.fromEntries(
  ALL_FSMS.map((f) => [f.type, f.initial])
) as Record<ArtifactType, string>

// (Plan -> 自动失效下游) — 在引擎启动后注入 effects (避免循环依赖)
// 使用见 src/index.ts wireEffects()
