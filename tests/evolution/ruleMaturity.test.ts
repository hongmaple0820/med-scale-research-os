import { describe, expect, it } from 'vitest'
import {
  approveRuleMaturity,
  createShadowRuleMaturity,
  evaluateRulePromotion,
  recordShadowHit,
} from '../../src/evolution/RuleMaturity.js'

describe('RuleMaturity', () => {
  it('keeps new rules in shadow mode before promotion evidence exists', () => {
    const maturity = createShadowRuleMaturity({
      ruleId: 'RULE-1',
      rollback: 'Delete .scale/hooks/RULE-1.sh and remove the rule record.',
    })

    expect(maturity.stage).toBe('shadow')
    expect(maturity.shadowHits).toBe(0)

    const decision = evaluateRulePromotion(maturity)
    expect(decision.eligible).toBe(false)
    expect(decision.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('shadow hits'),
      expect.stringContaining('defect evidence'),
    ]))
  })

  it('promotes only after enough shadow hits, defect evidence, rollback, and approval', () => {
    let maturity = createShadowRuleMaturity({
      ruleId: 'RULE-2',
      rollback: 'Remove generated hook and keep rule as prompt-only.',
      defectEvidenceIds: ['DEFECT-1'],
    })

    for (let i = 0; i < 10; i++) {
      maturity = recordShadowHit(maturity, { evidenceId: `EVID-${i}` })
    }

    const decision = evaluateRulePromotion(maturity)
    expect(decision).toMatchObject({
      eligible: true,
      nextStage: 'candidate-hook',
    })

    const approved = approveRuleMaturity(maturity, 'lead')
    expect(approved.stage).toBe('approved-blocking')
    expect(approved.approvedBy).toBe('lead')
  })
})
