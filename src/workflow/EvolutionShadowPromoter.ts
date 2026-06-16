// SCALE Engine — Evolution Shadow Promoter v1
// Connects failure learning candidates to rule maturity shadow validation.
// Lessons become rules only after shadow validation proves they reduce defects.

import {
  createShadowRuleMaturity,
  recordShadowHit,
  evaluateRulePromotion,
  type RuleMaturityRecord,
  type RulePromotionDecision,
  type RulePromotionThresholds,
} from '../evolution/RuleMaturity.js'

export type ShadowProposalSource = 'failure-learning' | 'lesson-extraction' | 'manual'

export interface ShadowRuleProposalInput {
  title: string
  description: string
  source: ShadowProposalSource
  sourceEvidenceIds: string[]
  pattern: string
  enforcement: 'prompt' | 'hook'
  rollback: string
}

export interface ShadowRuleProposal {
  id: string
  title: string
  description: string
  source: ShadowProposalSource
  sourceEvidenceIds: string[]
  pattern: string
  enforcement: 'prompt' | 'hook'
  maturity: RuleMaturityRecord
  createdAt: string
}

export interface ShadowValidationResult {
  proposalId: string
  shadowHits: number
  falsePositiveCount: number
  promotionDecision: RulePromotionDecision
  validationEvidence: string[]
}

export interface EvolutionShadowReport {
  strategy: 'evolution-shadow-promotion-v1'
  proposals: ShadowRuleProposal[]
  validations: ShadowValidationResult[]
  summary: {
    totalProposals: number
    shadowRules: number
    candidateHooks: number
    approvedBlocking: number
    pendingValidation: number
  }
}

let proposalSeq = 0

export function proposeShadowRule(input: ShadowRuleProposalInput): ShadowRuleProposal {
  const id = `SHADOW-RULE-${Date.now()}-${(++proposalSeq).toString().padStart(3, '0')}`
  const maturity = createShadowRuleMaturity({
    ruleId: id,
    rollback: input.rollback,
    defectEvidenceIds: input.sourceEvidenceIds,
  })

  return {
    id,
    title: input.title,
    description: input.description,
    source: input.source,
    sourceEvidenceIds: input.sourceEvidenceIds,
    pattern: input.pattern,
    enforcement: input.enforcement,
    maturity,
    createdAt: new Date().toISOString(),
  }
}

export function recordProposalShadowHit(
  proposal: ShadowRuleProposal,
  evidenceId?: string,
  falsePositive = false,
): ShadowRuleProposal {
  return {
    ...proposal,
    maturity: recordShadowHit(proposal.maturity, { evidenceId, falsePositive }),
  }
}

export function evaluatePromotionReadiness(
  proposal: ShadowRuleProposal,
  thresholds?: RulePromotionThresholds,
): ShadowValidationResult {
  const decision = evaluateRulePromotion(proposal.maturity, thresholds)
  return {
    proposalId: proposal.id,
    shadowHits: proposal.maturity.shadowHits,
    falsePositiveCount: proposal.maturity.falsePositiveCount,
    promotionDecision: decision,
    validationEvidence: proposal.maturity.evidenceIds,
  }
}

export function buildEvolutionShadowReport(proposals: ShadowRuleProposal[]): EvolutionShadowReport {
  const validations = proposals.map(p => evaluatePromotionReadiness(p))

  const stageCount = (stage: string) =>
    proposals.filter(p => p.maturity.stage === stage).length

  return {
    strategy: 'evolution-shadow-promotion-v1',
    proposals,
    validations,
    summary: {
      totalProposals: proposals.length,
      shadowRules: stageCount('shadow'),
      candidateHooks: stageCount('candidate-hook'),
      approvedBlocking: stageCount('approved-blocking'),
      pendingValidation: proposals.filter(p =>
        p.maturity.stage === 'shadow' && p.maturity.shadowHits < 10,
      ).length,
    },
  }
}

export function summarizeEvolutionShadow(report: EvolutionShadowReport): string {
  const { summary } = report
  if (summary.totalProposals === 0) {
    return 'No evolution shadow proposals. Run tasks with failure learning to generate shadow rule candidates.'
  }
  const parts = [`${summary.totalProposals} proposal(s)`]
  if (summary.shadowRules > 0) parts.push(`${summary.shadowRules} shadow`)
  if (summary.candidateHooks > 0) parts.push(`${summary.candidateHooks} candidate-hook`)
  if (summary.approvedBlocking > 0) parts.push(`${summary.approvedBlocking} approved-blocking`)
  if (summary.pendingValidation > 0) parts.push(`${summary.pendingValidation} pending validation`)
  return parts.join('; ') + '.'
}
