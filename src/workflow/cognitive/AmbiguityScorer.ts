// SCALE Engine - Ambiguity Scorer
// Requirement ambiguity scorer with seven weighted dimensions.

import type { AmbiguityDimensions, AmbiguityScoreResult } from '../types.js'

const WEIGHTS: AmbiguityDimensions = {
  goalClarity: 0.20,
  inputOutputBoundary: 0.15,
  techStackConstraints: 0.15,
  timeConstraints: 0.10,
  qualityStandards: 0.15,
  riskBoundaries: 0.10,
  acceptanceCriteria: 0.15
}

export class AmbiguityScorer {
  private dimensions: AmbiguityDimensions = {
    goalClarity: 0,
    inputOutputBoundary: 0,
    techStackConstraints: 0,
    timeConstraints: 0,
    qualityStandards: 0,
    riskBoundaries: 0,
    acceptanceCriteria: 0
  }
  private threshold: number = 0.20

  setThreshold(value: number): void {
    this.threshold = value
  }

  setGoalClarity(score: number): void {
    this.dimensions.goalClarity = Math.max(0, Math.min(1, score))
  }

  setInputOutputBoundary(score: number): void {
    this.dimensions.inputOutputBoundary = Math.max(0, Math.min(1, score))
  }

  setTechStackConstraints(score: number): void {
    this.dimensions.techStackConstraints = Math.max(0, Math.min(1, score))
  }

  setTimeConstraints(score: number): void {
    this.dimensions.timeConstraints = Math.max(0, Math.min(1, score))
  }

  setQualityStandards(score: number): void {
    this.dimensions.qualityStandards = Math.max(0, Math.min(1, score))
  }

  setRiskBoundaries(score: number): void {
    this.dimensions.riskBoundaries = Math.max(0, Math.min(1, score))
  }

  setAcceptanceCriteria(score: number): void {
    this.dimensions.acceptanceCriteria = Math.max(0, Math.min(1, score))
  }

  calculate(): AmbiguityScoreResult {
    const totalScore = this.calculateWeightedSum()
    const shouldProceed = totalScore <= this.threshold
    const requiresQuestioning = totalScore > this.threshold && totalScore <= 0.40
    const blocked = totalScore > 0.40

    return {
      totalScore,
      dimensions: this.dimensions,
      threshold: this.threshold,
      shouldProceed,
      requiresQuestioning,
      blocked
    }
  }

  private calculateWeightedSum(): number {
    return (
      this.dimensions.goalClarity * WEIGHTS.goalClarity +
      this.dimensions.inputOutputBoundary * WEIGHTS.inputOutputBoundary +
      this.dimensions.techStackConstraints * WEIGHTS.techStackConstraints +
      this.dimensions.timeConstraints * WEIGHTS.timeConstraints +
      this.dimensions.qualityStandards * WEIGHTS.qualityStandards +
      this.dimensions.riskBoundaries * WEIGHTS.riskBoundaries +
      this.dimensions.acceptanceCriteria * WEIGHTS.acceptanceCriteria
    )
  }

  analyzeRequirement(requirement: string): AmbiguityScoreResult {
    // Simple heuristic analysis
    const normalized = requirement.toLowerCase()
    const hasAny = (keywords: string[]) => keywords.some(keyword => normalized.includes(keyword.toLowerCase()))

    const hasGoal = hasAny(['implement', 'build', 'create', 'deliver', '实现', '完成', '构建'])
    const hasInput = hasAny(['input', 'receive', 'accept', 'argument', '输入', '接收', '参数'])
    const hasOutput = hasAny(['output', 'return', 'persist', 'emit', '输出', '返回', '持久化'])
    const hasTech = hasAny(['react', 'typescript', 'node', 'cli', 'vitest', '技术栈', '使用'])
    const hasTime = hasAny(['deadline', 'time', 'duration', 'today', '期限', '时间'])
    const hasQuality = hasAny(['quality', 'standard', 'performance', 'lint', 'typecheck', '质量', '标准', '性能'])
    const hasRisk = hasAny(['risk', 'boundary', 'constraint', 'rollback', '风险', '边界', '约束', '回滚'])
    const hasAcceptance = hasAny(['acceptance', 'test', 'verify', 'verification', 'evidence', '验收', '测试', '验证'])

    this.setGoalClarity(hasGoal ? 0.1 : 0.8)
    this.setInputOutputBoundary((hasInput && hasOutput) ? 0.1 : 0.7)
    this.setTechStackConstraints(hasTech ? 0.1 : 0.6)
    this.setTimeConstraints(hasTime ? 0.1 : 0.5)
    this.setQualityStandards(hasQuality ? 0.1 : 0.6)
    this.setRiskBoundaries(hasRisk ? 0.1 : 0.7)
    this.setAcceptanceCriteria(hasAcceptance ? 0.1 : 0.8)

    return this.calculate()
  }
  formatReport(result: AmbiguityScoreResult): string {
    const lines: string[] = ['=== Ambiguity Score Report ===']
    lines.push(`Total Score: ${result.totalScore.toFixed(2)} (threshold: ${result.threshold})`)
    lines.push('')
    lines.push('Dimensions:')
    Object.entries(result.dimensions).forEach(([key, value]) => {
      const weight = WEIGHTS[key as keyof AmbiguityDimensions]
      lines.push(`  ${key}: ${value.toFixed(2)} (weight: ${weight})`)
    })
    lines.push('')
    lines.push(`Status: ${result.blocked ? 'BLOCKED' : result.requiresQuestioning ? 'QUESTIONING REQUIRED' : 'PROCEED'}`)
    return lines.join('\n')
  }
}