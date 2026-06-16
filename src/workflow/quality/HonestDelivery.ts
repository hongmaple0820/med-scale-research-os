// SCALE Engine — Honest Delivery
// 诚实交付报告生成器

import type { DeliveryReport, VerificationResult } from '../types.js'

export class HonestDelivery {
  private completedItems: string[] = []
  private verifiedItems: VerificationResult[] = []
  private unverifiedItems: string[] = []
  private blockers: string[] = []
  private recommendations: string[] = []

  addCompleted(item: string): void {
    this.completedItems.push(item)
  }

  addVerified(result: VerificationResult): void {
    this.verifiedItems.push(result)
  }

  addUnverified(item: string): void {
    this.unverifiedItems.push(item)
  }

  addBlocker(blocker: string): void {
    this.blockers.push(blocker)
  }

  addRecommendation(rec: string): void {
    this.recommendations.push(rec)
  }

  generate(): DeliveryReport {
    return {
      completed: this.completedItems,
      verified: this.verifiedItems,
      unverified: this.unverifiedItems,
      blockers: this.blockers,
      recommendations: this.recommendations
    }
  }

  formatReport(report: DeliveryReport): string {
    const lines: string[] = []
    lines.push('=== Honest Delivery Report ===')
    lines.push('')
    lines.push('[COMPLETED]')
    report.completed.forEach(item => lines.push(`  - ${item}`))
    lines.push('')
    lines.push('[VERIFIED]')
    report.verified.forEach(v => {
      const status = v.passed ? '[PASS]' : '[FAIL]'
      lines.push(`  ${status} ${v.criterion}: ${v.evidence}`)
    })
    lines.push('')
    if (report.unverified.length > 0) {
      lines.push('[UNVERIFIED] - Must mark with ⚠️[UNVERIFIED]')
      report.unverified.forEach(item => lines.push(`  ⚠️[UNVERIFIED] ${item}`))
      lines.push('')
    }
    if (report.blockers.length > 0) {
      lines.push('[BLOCKERS]')
      report.blockers.forEach(b => lines.push(`  - ${b}`))
      lines.push('')
    }
    if (report.recommendations.length > 0) {
      lines.push('[RECOMMENDATIONS]')
      report.recommendations.forEach(r => lines.push(`  - ${r}`))
    }
    return lines.join('\n')
  }

  static createFromGateResults(gateResults: Map<string, { passed: boolean; evidence: string }>): DeliveryReport {
    const delivery = new HonestDelivery()
    for (const [gate, result] of gateResults) {
      if (result.passed) {
        delivery.addVerified({ criterion: gate, passed: true, evidence: result.evidence })
      } else {
        delivery.addBlocker(`${gate}: ${result.evidence}`)
      }
    }
    return delivery.generate()
  }
}