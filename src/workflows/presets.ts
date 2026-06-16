// SCALE Engine — Workflow Presets (v0.5.0)
// 10 种工作流预设：覆盖开发、测试、审查、安全、自主循环等场景
// 设计参考：SCALE v10.0 工作流系统

import type { WorkflowPreset, ScenarioMode } from '../artifact/types.js'

// ============================================================================
// 10 Workflow Presets
// ============================================================================

/** 1. 基础开发流 — 标准的 Explore→Plan→Implement→Verify→Learn 循环 */
export const BASIC_DEV: WorkflowPreset = {
  id: 'basic-dev',
  name: 'Basic Development',
  nameZh: '基础开发流',
  description: 'Standard Explore→Plan→Implement→Verify→Learn cycle for feature development',
  scenarioMode: 'standard',
  requiredArtifacts: [],
  steps: [
    { stepId: 'explore', action: 'explore', isMandatory: true, description: 'Read codebase, understand context' },
    { stepId: 'create-spec', skillId: 'spec-creator', action: 'scale create Spec', isMandatory: true, description: 'Create specification artifact', verificationGate: 'ambiguity ≤ 0.2' },
    { stepId: 'approve-spec', action: 'scale transition SPEC-xxx approve', isMandatory: true, description: 'Approve spec after refinement', verificationGate: 'spec.status == FROZEN' },
    { stepId: 'create-plan', skillId: 'plan-designer', action: 'scale create Plan', isMandatory: true, description: 'Create implementation plan', verificationGate: 'rollbackStrategy present' },
    { stepId: 'approve-plan', action: 'scale transition PLAN-xxx approve', isMandatory: true, description: 'Approve plan', verificationGate: 'plan.status == APPROVED' },
    { stepId: 'implement', action: 'implement', isMandatory: true, description: 'Write code per plan', verificationGate: 'build passes' },
    { stepId: 'verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Run build/lint/test', verificationGate: 'all checks pass' },
    { stepId: 'complete', action: 'scale transition TASK-xxx complete', isMandatory: true, description: 'Mark task complete' },
  ],
}

/** 2. TDD功能开发 — Test-Driven Development 工作流 */
export const TDD_DEV: WorkflowPreset = {
  id: 'tdd-dev',
  name: 'TDD Feature Development',
  nameZh: 'TDD功能开发',
  description: 'Test-Driven Development: write failing test → implement → refactor',
  scenarioMode: 'standard',
  requiredArtifacts: [{ type: 'Spec', status: 'FROZEN' }],
  steps: [
    { stepId: 'explore', action: 'explore', isMandatory: true, description: 'Understand spec and existing code' },
    { stepId: 'create-testplan', action: 'scale create TestPlan', isMandatory: true, description: 'Define test cases before implementation' },
    { stepId: 'write-failing-test', action: 'write-test', isMandatory: true, description: 'Write failing test for the feature', verificationGate: 'test fails as expected' },
    { stepId: 'implement-minimal', action: 'implement', isMandatory: true, description: 'Write minimal code to pass test', verificationGate: 'test passes' },
    { stepId: 'refactor', action: 'refactor', isMandatory: false, description: 'Refactor while keeping tests green', verificationGate: 'all tests still pass' },
    { stepId: 'verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Full verification suite', verificationGate: 'build+lint+test all pass' },
    { stepId: 'complete', action: 'scale transition TASK-xxx complete', isMandatory: true, description: 'Mark task complete' },
  ],
}

/** 3. Bug修复 — 快速定位→修复→验证→防止复发 */
export const BUG_FIX: WorkflowPreset = {
  id: 'bug-fix',
  name: 'Bug Fix',
  nameZh: 'Bug修复',
  description: 'Reproduce → Diagnose → Fix → Verify → Prevent recurrence',
  scenarioMode: 'standard',
  requiredArtifacts: [],
  steps: [
    { stepId: 'reproduce', action: 'reproduce', isMandatory: true, description: 'Reproduce the bug reliably' },
    { stepId: 'create-defect', action: 'scale create Defect', isMandatory: true, description: 'Document the defect' },
    { stepId: 'diagnose', action: 'diagnose', isMandatory: true, description: 'Find root cause', verificationGate: 'rootCauseCategory identified' },
    { stepId: 'write-regression-test', action: 'write-test', isMandatory: true, description: 'Write test that reproduces bug', verificationGate: 'test fails with current code' },
    { stepId: 'fix', action: 'implement', isMandatory: true, description: 'Implement fix', verificationGate: 'regression test passes' },
    { stepId: 'verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Full verification', verificationGate: 'all checks pass' },
    { stepId: 'extract-lesson', action: 'scale evolve', isMandatory: true, description: 'Extract lesson from defect' },
  ],
}

/** 4. SDD — Spec-Driven Development 严格契约驱动 */
export const SDD: WorkflowPreset = {
  id: 'sdd',
  name: 'Spec-Driven Development',
  nameZh: 'SDD',
  description: 'Strict contract-driven: Spec must be FROZEN before any code. Ambiguity must be ≤ 0.1.',
  scenarioMode: 'critical',
  requiredArtifacts: [],
  steps: [
    { stepId: 'explore', action: 'explore', isMandatory: true, description: 'Deep exploration of requirements' },
    { stepId: 'create-spec', action: 'scale create Spec', isMandatory: true, description: 'Write comprehensive spec', verificationGate: 'ambiguity ≤ 0.1' },
    { stepId: 'refine-spec', action: 'scale transition SPEC-xxx refine', isMandatory: true, description: 'Iterative refinement', verificationGate: 'ambiguity ≤ 0.1' },
    { stepId: 'review-spec', action: 'scale transition SPEC-xxx review', isMandatory: true, description: 'Human review required', verificationGate: 'human approval' },
    { stepId: 'approve-spec', action: 'scale transition SPEC-xxx approve', isMandatory: true, description: 'Freeze spec', verificationGate: 'spec.status == FROZEN' },
    { stepId: 'create-testplan', action: 'scale create TestPlan', isMandatory: true, description: 'Acceptance criteria as tests' },
    { stepId: 'create-plan', action: 'scale create Plan', isMandatory: true, description: 'Technical design per spec', verificationGate: 'rollbackStrategy defined' },
    { stepId: 'approve-plan', action: 'scale transition PLAN-xxx approve', isMandatory: true, description: 'Human approve plan', verificationGate: 'human approval' },
    { stepId: 'implement', action: 'implement', isMandatory: true, description: 'Implement per frozen spec', verificationGate: 'build passes' },
    { stepId: 'verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Full verification against spec', verificationGate: 'all acceptance tests pass' },
    { stepId: 'complete', action: 'scale transition TASK-xxx complete', isMandatory: true, description: 'Mark complete' },
  ],
}

/** 5. 代码审查 — 系统化审查流程 */
export const CODE_REVIEW: WorkflowPreset = {
  id: 'code-review',
  name: 'Code Review',
  nameZh: '代码审查',
  description: 'Systematic code review: style → logic → security → performance',
  scenarioMode: 'standard',
  requiredArtifacts: [{ type: 'Change' }],
  steps: [
    { stepId: 'read-spec', action: 'read-spec', isMandatory: true, description: 'Understand what the change should do' },
    { stepId: 'review-style', action: 'review', isMandatory: true, description: 'Code style and conventions check' },
    { stepId: 'review-logic', action: 'review', isMandatory: true, description: 'Logic correctness review' },
    { stepId: 'review-security', action: 'review', isMandatory: true, description: 'Security vulnerability scan' },
    { stepId: 'review-performance', action: 'review', isMandatory: false, description: 'Performance review' },
    { stepId: 'create-defects', action: 'scale create Defect', isMandatory: false, description: 'Document issues found' },
    { stepId: 'summarize', action: 'review-summary', isMandatory: true, description: 'Write review summary' },
  ],
}

/** 6. 安全审计 — 全面安全审查 */
export const SECURITY_AUDIT: WorkflowPreset = {
  id: 'security-audit',
  name: 'Security Audit',
  nameZh: '安全审计',
  description: 'Comprehensive security audit: secrets → injection → auth → data → deps',
  scenarioMode: 'critical',
  requiredArtifacts: [],
  steps: [
    { stepId: 'scan-secrets', action: 'scan', isMandatory: true, description: 'Scan for hardcoded secrets and credentials' },
    { stepId: 'scan-injection', action: 'scan', isMandatory: true, description: 'SQL injection, XSS, command injection checks' },
    { stepId: 'scan-auth', action: 'scan', isMandatory: true, description: 'Authentication and authorization review' },
    { stepId: 'scan-data', action: 'scan', isMandatory: true, description: 'Data exposure and PII handling' },
    { stepId: 'scan-deps', action: 'scan', isMandatory: true, description: 'Dependency vulnerability scan' },
    { stepId: 'create-defects', action: 'scale create Defect', isMandatory: true, description: 'Document security findings' },
    { stepId: 'prioritize', action: 'prioritize', isMandatory: true, description: 'CVSS scoring and remediation priority' },
    { stepId: 'report', action: 'audit-report', isMandatory: true, description: 'Generate audit report' },
  ],
}

/** 7. Ralph自主循环 — 全自动 AI 自主执行循环 */
export const RALPH_LOOP: WorkflowPreset = {
  id: 'ralph-loop',
  name: 'Ralph Autonomous Loop',
  nameZh: 'Ralph自主循环',
  description: 'Fully autonomous AI loop: self-plan → execute → verify → evolve. Maximum automation, sandbox mode.',
  scenarioMode: 'sandbox',
  requiredArtifacts: [],
  steps: [
    { stepId: 'receive-task', action: 'receive', isMandatory: true, description: 'Receive task description' },
    { stepId: 'auto-plan', action: 'auto-plan', isMandatory: true, description: 'AI autonomously creates Spec+Plan+Tasks' },
    { stepId: 'auto-implement', action: 'implement', isMandatory: true, description: 'Implement task by task' },
    { stepId: 'auto-verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Auto-verify each task', verificationGate: 'build+lint+test pass' },
    { stepId: 'auto-fix', action: 'fix', isMandatory: false, description: 'Auto-fix failures (up to maxRetries)', verificationGate: 'failures resolved' },
    { stepId: 'auto-complete', action: 'scale transition TASK-xxx complete', isMandatory: true, description: 'Mark tasks complete' },
    { stepId: 'auto-evolve', action: 'scale evolve', isMandatory: false, description: 'Extract lessons from the cycle' },
  ],
}

/** 8. 快速原型 — 快速探索和原型验证 */
export const RAPID_PROTO: WorkflowPreset = {
  id: 'rapid-proto',
  name: 'Rapid Prototype',
  nameZh: '快速原型',
  description: 'Fast exploration and prototyping. Minimal ceremony, sandbox mode.',
  scenarioMode: 'sandbox',
  requiredArtifacts: [],
  steps: [
    { stepId: 'ideate', action: 'explore', isMandatory: true, description: 'Rapid exploration and ideation' },
    { stepId: 'prototype', action: 'implement', isMandatory: true, description: 'Build prototype quickly' },
    { stepId: 'demo', action: 'demo', isMandatory: true, description: 'Run/demo the prototype' },
    { stepId: 'evaluate', action: 'evaluate', isMandatory: true, description: 'Evaluate if prototype meets goals' },
  ],
}

/** 9. 大规模重构 — 安全的大型代码重构 */
export const MASSIVE_REFACTOR: WorkflowPreset = {
  id: 'massive-refactor',
  name: 'Massive Refactor',
  nameZh: '大规模重构',
  description: 'Safe large-scale refactoring: inventory → test → refactor → verify incrementally',
  scenarioMode: 'critical',
  requiredArtifacts: [{ type: 'Spec', status: 'FROZEN' }],
  steps: [
    { stepId: 'inventory', action: 'explore', isMandatory: true, description: 'Catalog all files and dependencies affected' },
    { stepId: 'baseline-tests', action: 'run-tests', isMandatory: true, description: 'Ensure all existing tests pass (baseline)', verificationGate: 'all baseline tests pass' },
    { stepId: 'create-plan', action: 'scale create Plan', isMandatory: true, description: 'Detailed refactor plan with incremental steps', verificationGate: 'rollbackStrategy defined' },
    { stepId: 'refactor-increment-1', action: 'implement', isMandatory: true, description: 'First incremental refactor', verificationGate: 'tests still pass' },
    { stepId: 'verify-1', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Verify after first increment' },
    { stepId: 'refactor-increment-2', action: 'implement', isMandatory: false, description: 'Second incremental refactor', verificationGate: 'tests still pass' },
    { stepId: 'verify-2', action: 'scale verify-task TASK-xxx', isMandatory: false, description: 'Verify after second increment' },
    { stepId: 'final-verify', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Full verification suite', verificationGate: 'all checks pass' },
  ],
}

/** 10. 并行执行 — 多任务并行开发 */
export const PARALLEL_EXEC: WorkflowPreset = {
  id: 'parallel-exec',
  name: 'Parallel Execution',
  nameZh: '并行执行',
  description: 'Execute multiple independent tasks in parallel. Standard mode with dependency awareness.',
  scenarioMode: 'standard',
  requiredArtifacts: [{ type: 'Plan', status: 'APPROVED' }],
  steps: [
    { stepId: 'decompose', action: 'decompose', isMandatory: true, description: 'Break plan into independent task groups' },
    { stepId: 'identify-dependencies', action: 'analyze', isMandatory: true, description: 'Map task dependencies' },
    { stepId: 'create-tasks', action: 'scale create Task', isMandatory: true, description: 'Create all tasks with dependencies' },
    { stepId: 'parallel-implement', action: 'parallel-implement', isMandatory: true, description: 'Execute independent tasks in parallel' },
    { stepId: 'sequential-implement', action: 'implement', isMandatory: false, description: 'Execute dependent tasks sequentially' },
    { stepId: 'verify-all', action: 'scale verify-task TASK-xxx', isMandatory: true, description: 'Verify all tasks', verificationGate: 'all tasks pass' },
    { stepId: 'integrate', action: 'integrate', isMandatory: true, description: 'Integration test all changes together', verificationGate: 'integration tests pass' },
  ],
}

// ============================================================================
// Preset Registry
// ============================================================================

export const WORKFLOW_PRESETS: Record<string, WorkflowPreset> = {
  [BASIC_DEV.id]: BASIC_DEV,
  [TDD_DEV.id]: TDD_DEV,
  [BUG_FIX.id]: BUG_FIX,
  [SDD.id]: SDD,
  [CODE_REVIEW.id]: CODE_REVIEW,
  [SECURITY_AUDIT.id]: SECURITY_AUDIT,
  [RALPH_LOOP.id]: RALPH_LOOP,
  [RAPID_PROTO.id]: RAPID_PROTO,
  [MASSIVE_REFACTOR.id]: MASSIVE_REFACTOR,
  [PARALLEL_EXEC.id]: PARALLEL_EXEC,
}

/**
 * Get a workflow preset by ID.
 */
export function getWorkflowPreset(id: string): WorkflowPreset | undefined {
  return WORKFLOW_PRESETS[id]
}

/**
 * List all available workflow presets.
 */
export function listWorkflowPresets(): WorkflowPreset[] {
  return Object.values(WORKFLOW_PRESETS)
}

/**
 * Get presets filtered by scenario mode.
 */
export function getPresetsByScenario(mode: ScenarioMode): WorkflowPreset[] {
  return Object.values(WORKFLOW_PRESETS).filter((p) => p.scenarioMode === mode)
}
