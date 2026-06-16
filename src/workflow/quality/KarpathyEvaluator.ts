// SCALE Engine — Karpathy Evaluator
// Karpathy 编码原则检查器

import type { KarpathyCheck } from '../types.js'

export class KarpathyEvaluator {
  private checks: KarpathyCheck[] = []

  checkK1(hypothesesListed: boolean): KarpathyCheck {
    const check: KarpathyCheck = {
      principle: 'K1',
      description: 'THINK: 列出假设，再动手',
      passed: hypothesesListed,
      violation: hypothesesListed ? undefined : '未列出假设就开始编码'
    }
    this.checks.push(check)
    return check
  }

  checkK2(hasExtraFeatures: boolean): KarpathyCheck {
    const check: KarpathyCheck = {
      principle: 'K2',
      description: 'SIMPLE: 禁止未要求的功能',
      passed: !hasExtraFeatures,
      violation: hasExtraFeatures ? '添加了未要求的功能' : undefined
    }
    this.checks.push(check)
    return check
  }

  checkK3(changesTraceable: boolean): KarpathyCheck {
    const check: KarpathyCheck = {
      principle: 'K3',
      description: 'SURGICAL: 修改可追溯，最小变更',
      passed: changesTraceable,
      violation: changesTraceable ? undefined : '修改不可追溯或范围过大'
    }
    this.checks.push(check)
    return check
  }

  checkK4(hasVerifiableGoal: boolean): KarpathyCheck {
    const check: KarpathyCheck = {
      principle: 'K4',
      description: 'GOAL: 可验证目标，明确验收',
      passed: hasVerifiableGoal,
      violation: hasVerifiableGoal ? undefined : '缺少可验证目标'
    }
    this.checks.push(check)
    return check
  }

  evaluateAll(context: {
    hypothesesListed: boolean
    hasExtraFeatures: boolean
    changesTraceable: boolean
    hasVerifiableGoal: boolean
  }): KarpathyCheck[] {
    this.checks = []
    this.checkK1(context.hypothesesListed)
    this.checkK2(context.hasExtraFeatures)
    this.checkK3(context.changesTraceable)
    this.checkK4(context.hasVerifiableGoal)
    return this.checks
  }

  getChecks(): KarpathyCheck[] {
    return this.checks
  }

  allPassed(): boolean {
    return this.checks.every(c => c.passed)
  }

  getViolations(): string[] {
    return this.checks.filter(c => !c.passed).map(c => `${c.principle}: ${c.violation}`)
  }

  formatReport(): string {
    const lines: string[] = ['=== Karpathy Principles Check ===']
    this.checks.forEach(c => {
      const status = c.passed ? '[PASS]' : '[FAIL]'
      lines.push(`${status} ${c.principle} (${c.description})`)
      if (c.violation) {
        lines.push(`     Violation: ${c.violation}`)
      }
    })
    return lines.join('\n')
  }
}