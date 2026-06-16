import { ToolEvidenceStore, type ToolEvidenceAdapter, type ToolEvidenceStatus, type ToolRunEvidence } from './ToolEvidenceStore.js'
import type { ToolExecutionPlan, ToolExecutionStep } from './ToolOrchestrator.js'
import type { ToolOrchestrationMode } from './ToolPolicy.js'

export type ToolEvidenceGateTaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'

export interface ToolEvidenceGateItem {
  toolId: string
  domain: string
  adapter: ToolEvidenceAdapter
  required: boolean
  reason: string
  evidenceId?: string
  evidenceStatus?: ToolEvidenceStatus
  completedAt?: string
}

export interface ToolEvidenceGateResult {
  taskId?: string
  mode: ToolOrchestrationMode
  enforceLevels: ToolEvidenceGateTaskLevel[]
  applies: boolean
  checked: boolean
  complete: boolean
  blocked: boolean
  requiredTools: string[]
  passed: ToolEvidenceGateItem[]
  missing: ToolEvidenceGateItem[]
  failed: ToolEvidenceGateItem[]
  skipped: ToolEvidenceGateItem[]
  warnings: string[]
}

export interface EvaluateToolEvidenceGateOptions {
  projectDir?: string
  level: ToolEvidenceGateTaskLevel
  plan?: ToolExecutionPlan | null
  evidenceStore?: ToolEvidenceStore
  mode?: ToolOrchestrationMode
  enforceLevels?: ToolEvidenceGateTaskLevel[]
  allowSkipped?: boolean
}

export function evaluateToolEvidenceGate(options: EvaluateToolEvidenceGateOptions): ToolEvidenceGateResult {
  const mode = options.mode ?? options.plan?.mode ?? 'evidence-required'
  const enforceLevels = options.enforceLevels ?? ['M', 'L', 'CRITICAL']
  const applies = mode !== 'off' && enforceLevels.includes(options.level)

  if (!applies) {
    return {
      taskId: options.plan?.taskId,
      mode,
      enforceLevels,
      applies,
      checked: false,
      complete: true,
      blocked: false,
      requiredTools: [],
      passed: [],
      missing: [],
      failed: [],
      skipped: [],
      warnings: [],
    }
  }

  if (!options.plan) {
    return {
      mode,
      enforceLevels,
      applies,
      checked: true,
      complete: false,
      blocked: blocksOnIncomplete(mode),
      requiredTools: [],
      passed: [],
      missing: [],
      failed: [],
      skipped: [],
      warnings: ['No tool execution plan was provided.'],
    }
  }

  const requiredSteps = options.plan.steps.filter(step => step.required)
  const evidenceStore = options.evidenceStore ?? new ToolEvidenceStore({ projectDir: options.projectDir })
  const latestEvidence = latestEvidenceByTool(evidenceStore.list(options.plan.taskId))
  const passed: ToolEvidenceGateItem[] = []
  const missing: ToolEvidenceGateItem[] = []
  const failed: ToolEvidenceGateItem[] = []
  const skipped: ToolEvidenceGateItem[] = []

  for (const step of requiredSteps) {
    const evidence = latestEvidence.get(step.toolId)
    const item = evidenceItem(step, evidence)
    if (!evidence) {
      missing.push({
        ...item,
        reason: step.status === 'missing'
          ? step.reason
          : 'No execution evidence was recorded for this required tool.',
      })
      continue
    }
    if (evidence.status === 'passed') {
      passed.push(item)
      continue
    }
    if (evidence.status === 'failed') {
      failed.push(item)
      continue
    }
    if (evidence.status === 'skipped' && options.allowSkipped) {
      passed.push(item)
    } else {
      skipped.push({
        ...item,
        reason: 'Skipped or dry-run evidence does not satisfy required tool execution.',
      })
    }
  }

  const complete = missing.length === 0 && failed.length === 0 && skipped.length === 0
  const blocked = blocksOnIncomplete(mode) && !complete
  return {
    taskId: options.plan.taskId,
    mode,
    enforceLevels,
    applies,
    checked: true,
    complete,
    blocked,
    requiredTools: requiredSteps.map(step => step.toolId),
    passed,
    missing,
    failed,
    skipped,
    warnings: options.plan.warnings,
  }
}

function latestEvidenceByTool(records: ToolRunEvidence[]): Map<string, ToolRunEvidence> {
  const byTool = new Map<string, ToolRunEvidence>()
  for (const record of records) {
    if (!byTool.has(record.tool)) byTool.set(record.tool, record)
  }
  return byTool
}

function evidenceItem(step: ToolExecutionStep, evidence?: ToolRunEvidence): ToolEvidenceGateItem {
  return {
    toolId: step.toolId,
    domain: step.domain,
    adapter: step.adapter,
    required: step.required,
    reason: evidence?.outputSummary ?? step.reason,
    evidenceId: evidence?.id,
    evidenceStatus: evidence?.status,
    completedAt: evidence?.completedAt,
  }
}

function blocksOnIncomplete(mode: ToolOrchestrationMode): boolean {
  return mode === 'evidence-required' || mode === 'block'
}
