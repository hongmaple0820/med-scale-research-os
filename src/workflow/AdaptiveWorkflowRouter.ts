// SCALE Engine — Adaptive Workflow Router v1
// Routes evaluator risk/uncertainty and tool strategy signals into a concrete workflow profile.

import type { GovernanceMode, ProgressiveGovernanceReport } from '../governance/ProgressiveGovernance.js'
import type { AiOsEvaluatorGateId, AiOsEvaluatorIntelligence, AiOsToolStrategyPlan } from '../runtime/AiOsRuntime.js'
import { selectTemplate } from './WorkflowTemplates.js'

export type WorkflowProfile = 'light' | 'standard' | 'strict' | 'critical'

const PROFILE_ORDER: WorkflowProfile[] = ['light', 'standard', 'strict', 'critical']

export interface GateOverride {
  gateId: string
  action: 'add' | 'elevate'
  reason: string
  source: 'evaluator' | 'tool-strategy' | 'governance'
}

export interface BehavioralConstraint {
  id: string
  description: string
  required: boolean
  profile: WorkflowProfile
}

export interface AdaptiveWorkflowProfile {
  profile: WorkflowProfile
  templateId: string
  strategy: 'adaptive-workflow-router-v1'
  escalationReasons: string[]
  gateOverrides: GateOverride[]
  behavioralConstraints: BehavioralConstraint[]
  exitCriteria: string[]
  inputSignals: {
    governanceMode: GovernanceMode
    evaluatorRisk: 'low' | 'medium' | 'high'
    uncertaintyScore: number
    toolHighRiskSteps: number
    toolFallbackCoverage: number
    requiredEvaluatorGates: number
  }
}

export interface AdaptiveWorkflowRouterInput {
  governance: ProgressiveGovernanceReport
  evaluator: AiOsEvaluatorIntelligence
  toolStrategy: AiOsToolStrategyPlan
}

export function routeAdaptiveWorkflow(input: AdaptiveWorkflowRouterInput): AdaptiveWorkflowProfile {
  const { governance, evaluator, toolStrategy } = input
  const reasons: string[] = []
  const gateOverrides: GateOverride[] = []

  const signals: AdaptiveWorkflowProfile['inputSignals'] = {
    governanceMode: governance.effectiveMode,
    evaluatorRisk: evaluator.riskLevel,
    uncertaintyScore: evaluator.uncertainty.score,
    toolHighRiskSteps: toolStrategy.summary.highRiskSteps,
    toolFallbackCoverage: toolStrategy.summary.fallbackCoveredSteps / Math.max(1, toolStrategy.summary.totalSteps),
    requiredEvaluatorGates: evaluator.gates.filter(g => g.required).length,
  }

  // Start from governance mode baseline
  let profile = governanceModeToProfile(governance.effectiveMode)
  if (profile !== 'light') {
    reasons.push(`Governance mode "${governance.effectiveMode}" sets baseline profile "${profile}".`)
  }

  // Escalate from evaluator risk
  const evaluatorProfile = evaluatorRiskToProfile(evaluator.riskLevel)
  if (profileRank(evaluatorProfile) > profileRank(profile)) {
    reasons.push(`Evaluator risk "${evaluator.riskLevel}" escalates profile to "${evaluatorProfile}".`)
    profile = evaluatorProfile
  }

  // Escalate from uncertainty score
  if (evaluator.uncertainty.score >= 0.8) {
    if (profileRank('critical') > profileRank(profile)) {
      reasons.push(`Uncertainty score ${evaluator.uncertainty.score} >= 0.8 escalates profile to "critical".`)
      profile = 'critical'
    }
  } else if (evaluator.uncertainty.score >= 0.6) {
    if (profileRank('strict') > profileRank(profile)) {
      reasons.push(`Uncertainty score ${evaluator.uncertainty.score} >= 0.6 escalates profile to "strict".`)
      profile = 'strict'
    }
  }

  // Escalate from tool strategy high-risk steps
  if (toolStrategy.summary.highRiskSteps >= 2) {
    if (profileRank('strict') > profileRank(profile)) {
      reasons.push(`${toolStrategy.summary.highRiskSteps} high-risk tool steps escalates profile to "strict".`)
      profile = 'strict'
    }
  }

  // Escalate from required security/release evaluator gates
  const hasSecurityGate = evaluator.gates.some(g => g.id === 'security-threat-model' && g.required)
  const hasReleaseGate = evaluator.gates.some(g => g.id === 'release-readiness-review' && g.required)
  if (hasSecurityGate || hasReleaseGate) {
    if (profileRank('critical') > profileRank(profile)) {
      const gateName = hasSecurityGate ? 'security-threat-model' : 'release-readiness-review'
      reasons.push(`Required evaluator gate "${gateName}" escalates profile to "critical".`)
      profile = 'critical'
    }
  }

  // Escalate from fallback coverage gaps
  if (toolStrategy.summary.totalSteps > 0 && signals.toolFallbackCoverage < 0.5) {
    if (profileRank('strict') > profileRank(profile)) {
      reasons.push(`Tool fallback coverage ${Math.round(signals.toolFallbackCoverage * 100)}% < 50% escalates profile to "strict".`)
      profile = 'strict'
    }
  }

  // Build gate overrides from evaluator gates
  for (const gate of evaluator.gates) {
    if (gate.required) {
      gateOverrides.push({
        gateId: gate.id,
        action: 'add',
        reason: gate.reason,
        source: 'evaluator',
      })
    }
  }

  // Build gate overrides from tool strategy high-risk nodes
  if (toolStrategy.summary.highRiskSteps > 0) {
    gateOverrides.push({
      gateId: 'tool-risk-review',
      action: 'add',
      reason: `${toolStrategy.summary.highRiskSteps} high-risk tool step(s) require execution review.`,
      source: 'tool-strategy',
    })
  }

  const behavioralConstraints = buildBehavioralConstraints(profile, signals)
  const exitCriteria = buildExitCriteria(profile, evaluator, toolStrategy)

  const template = selectTemplate({ profile, task: '', level: profile === 'critical' ? 'CRITICAL' : profile === 'strict' ? 'L' : 'M' })

  return {
    profile,
    templateId: template.id,
    strategy: 'adaptive-workflow-router-v1',
    escalationReasons: reasons,
    gateOverrides,
    behavioralConstraints,
    exitCriteria,
    inputSignals: signals,
  }
}

function governanceModeToProfile(mode: GovernanceMode): WorkflowProfile {
  switch (mode) {
    case 'minimal': return 'light'
    case 'standard': return 'standard'
    case 'expanded': return 'strict'
    case 'critical': return 'critical'
  }
}

function evaluatorRiskToProfile(risk: 'low' | 'medium' | 'high'): WorkflowProfile {
  switch (risk) {
    case 'low': return 'light'
    case 'medium': return 'standard'
    case 'high': return 'strict'
  }
}

function profileRank(profile: WorkflowProfile): number {
  return PROFILE_ORDER.indexOf(profile)
}

function buildBehavioralConstraints(
  profile: WorkflowProfile,
  signals: AdaptiveWorkflowProfile['inputSignals'],
): BehavioralConstraint[] {
  const constraints: BehavioralConstraint[] = []

  // All profiles get verification evidence
  constraints.push({
    id: 'record-verification-evidence',
    description: 'Record verification evidence before claiming completion.',
    required: profile !== 'light',
    profile,
  })

  if (profile === 'standard' || profile === 'strict' || profile === 'critical') {
    constraints.push({
      id: 'summarize-context-budget',
      description: 'Summarize context budget and explain included/omitted sections.',
      required: true,
      profile,
    })
    constraints.push({
      id: 'skill-radar',
      description: 'Run skill radar when tool, browser, UI, or external CLI signals apply.',
      required: true,
      profile,
    })
  }

  if (profile === 'strict' || profile === 'critical') {
    constraints.push({
      id: 'code-review',
      description: 'Code review is required before merge or promotion.',
      required: true,
      profile,
    })
    if (signals.evaluatorRisk === 'high' || signals.uncertaintyScore >= 0.6) {
      constraints.push({
        id: 'uncertainty-logging',
        description: 'Log uncertainty score, rejected alternatives, and evidence gaps.',
        required: true,
        profile,
      })
    }
  }

  if (profile === 'critical') {
    constraints.push({
      id: 'security-review',
      description: 'Security review is mandatory for critical profile tasks.',
      required: true,
      profile,
    })
    constraints.push({
      id: 'rollback-plan',
      description: 'Record rollback or disable strategy before shipping.',
      required: true,
      profile,
    })
    constraints.push({
      id: 'human-review-destructive',
      description: 'Require human review for destructive, data, auth, or production changes.',
      required: true,
      profile,
    })
  }

  if (signals.toolHighRiskSteps > 0) {
    constraints.push({
      id: 'tool-risk-review',
      description: `Review ${signals.toolHighRiskSteps} high-risk tool step(s) before autonomous execution.`,
      required: profile !== 'light',
      profile,
    })
  }

  return constraints
}

function buildExitCriteria(
  profile: WorkflowProfile,
  evaluator: AiOsEvaluatorIntelligence,
  toolStrategy: AiOsToolStrategyPlan,
): string[] {
  const criteria: string[] = [
    'Context compiler explains included and omitted sections.',
    'Memory recall records provider, score, and evidence paths.',
    'Skill plan lists required proof and fallback policy.',
    'Governance ROI states benefit and overhead before completion.',
  ]

  if (profile === 'standard' || profile === 'strict' || profile === 'critical') {
    criteria.push('Verification evidence is recorded for the completed task.')
  }

  if (profile === 'strict' || profile === 'critical') {
    criteria.push('Code review evidence is recorded.')
    if (evaluator.gates.some(g => g.required)) {
      criteria.push('Required evaluator gates record critique outcome and follow-up.')
    }
  }

  if (profile === 'critical') {
    criteria.push('Security review or threat model evidence is recorded.')
    criteria.push('Rollback or disable strategy is documented.')
  }

  if (toolStrategy.summary.highRiskSteps > 0) {
    criteria.push('High-risk tool steps have execution review evidence.')
  }

  if (evaluator.uncertainty.score >= 0.6) {
    criteria.push('Uncertainty decision log records rejected alternatives and evidence gaps.')
  }

  return criteria
}
