// SCALE Engine — Consensus Planner
// 共识规划引擎 (三角色循环: Planner -> Architect -> Critic)

import type { IEventBus } from '../../core/eventBus.js'
import type { RALPLANOutput, ViableOption, PreMortemAnalysis, Verdict, ConsensusRound } from '../types.js'

export interface IConsensusRole {
  name: string
  process(input: string): Promise<string>
}

export class ConsensusPlanner {
  private eventBus: IEventBus
  private maxIterations: number = 5
  private rounds: ConsensusRound[] = []
  private planner: IConsensusRole
  private architect: IConsensusRole
  private critic: IConsensusRole

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus
    this.planner = new PlannerRole()
    this.architect = new ArchitectRole()
    this.critic = new CriticRole()
  }

  setMaxIterations(n: number): void {
    this.maxIterations = n
  }

  async execute(requirement: string): Promise<RALPLANOutput> {
    this.rounds = []
    let currentInput = requirement
    let verdict: Verdict = 'ITERATE'
    let iterationCount = 0

    while (verdict === 'ITERATE' && iterationCount < this.maxIterations) {
      iterationCount++
      const plannerOutput = await this.planner.process(currentInput)
      const architectReview = await this.architect.process(plannerOutput)
      const criticReview = await this.critic.process(architectReview)
      verdict = this.evaluateVerdict(plannerOutput, architectReview, criticReview)

      const round: ConsensusRound = {
        round: iterationCount,
        plannerOutput,
        architectReview,
        criticReview,
        verdict
      }
      this.rounds.push(round)
      this.eventBus.emit('consensus.round', round)

      if (verdict === 'ITERATE') {
        currentInput = this.synthesizeFeedback(plannerOutput, architectReview, criticReview)
      }
    }

    return this.generateRALPLANOutput(verdict, iterationCount)
  }

  private evaluateVerdict(planner: string, architect: string, critic: string): Verdict {
    const architectApproved = architect.includes('APPROVE') || architect.includes('可行')
    const criticApproved = critic.includes('APPROVE') || critic.includes('无风险')
    const hasBlockingIssues = critic.includes('BLOCK') || critic.includes('CRITICAL')

    if (hasBlockingIssues) return 'REJECT'
    if (architectApproved && criticApproved) return 'APPROVE'
    return 'ITERATE'
  }

  private synthesizeFeedback(planner: string, architect: string, critic: string): string {
    return `Previous Plan:\n${planner}\n\nArchitect Feedback:\n${architect}\n\nCritic Concerns:\n${critic}\n\nPlease revise the plan addressing all concerns.`
  }

  private generateRALPLANOutput(verdict: Verdict, iterations: number): RALPLANOutput {
    const lastRound = this.rounds[this.rounds.length - 1]
    return {
      principles: this.extractPrinciples(lastRound?.plannerOutput || ''),
      decisionDrivers: this.extractDrivers(lastRound?.architectReview || ''),
      viableOptions: this.extractOptions(lastRound?.plannerOutput || ''),
      preMortem: this.extractPreMortem(lastRound?.criticReview || ''),
      verdict,
      iterationCount: iterations
    }
  }

  private extractPrinciples(text: string): string[] {
    const match = text.match(/原则[:：]\s*([\s\S]*?)(?=驱动|$)/)
    if (match) {
      return match[1].split('\n').map(s => s.trim()).filter(s => s.length > 0)
    }
    return ['可维护性优先', '渐进式实现', '测试驱动']
  }

  private extractDrivers(text: string): string[] {
    const match = text.match(/驱动[:：]\s*([\s\S]*?)(?=方案|$)/)
    if (match) {
      return match[1].split('\n').map(s => s.trim()).filter(s => s.length > 0).slice(0, 3)
    }
    return ['性能要求', '安全约束', '向下兼容']
  }

  private extractOptions(text: string): ViableOption[] {
    return [
      { name: '方案A', description: '标准实现路径', pros: ['稳定'], cons: ['慢'], selected: true },
      { name: '方案B', description: '快速实现路径', pros: ['快'], cons: ['风险高'], selected: false }
    ]
  }

  private extractPreMortem(text: string): PreMortemAnalysis {
    return {
      assumedFailure: '实现超时',
      rootCauses: ['技术债务', '需求变更'],
      mitigations: ['增量交付', '及时沟通']
    }
  }

  getRounds(): ConsensusRound[] {
    return this.rounds
  }

  formatReport(output: RALPLANOutput): string {
    const lines: string[] = ['=== RALPLAN-DR Report ===']
    lines.push(`Verdict: ${output.verdict} (${output.iterationCount} iterations)`)
    lines.push('')
    lines.push('Principles:')
    output.principles.forEach(p => lines.push(`  - ${p}`))
    lines.push('')
    lines.push('Decision Drivers (Top 3):')
    output.decisionDrivers.forEach(d => lines.push(`  - ${d}`))
    lines.push('')
    lines.push('Viable Options:')
    output.viableOptions.forEach(o => {
      lines.push(`  ${o.selected ? '[SELECTED]' : '[ALT]'} ${o.name}: ${o.description}`)
    })
    lines.push('')
    lines.push('Pre-Mortem Analysis:')
    lines.push(`  Assumed Failure: ${output.preMortem.assumedFailure}`)
    lines.push(`  Root Causes: ${output.preMortem.rootCauses.join(', ')}`)
    lines.push(`  Mitigations: ${output.preMortem.mitigations.join(', ')}`)
    return lines.join('\n')
  }
}

class PlannerRole implements IConsensusRole {
  name = 'Planner'

  async process(input: string): Promise<string> {
    return `Plan for: ${input}\n\n原则：\n- 渐进式实现\n- 测试驱动\n- 最小变更\n\n驱动因素：\n1. 用户需求\n2. 技术约束\n3. 时间限制\n\n方案A：标准路径（推荐）\n方案B：快速路径`
  }
}

class ArchitectRole implements IConsensusRole {
  name = 'Architect'

  async process(input: string): Promise<string> {
    return `Architecture Review:\n\nAPPROVE - 技术可行性确认\n\n架构建议：\n- 模块化设计\n- 接口抽象\n- 依赖隔离`
  }
}

class CriticRole implements IConsensusRole {
  name = 'Critic'

  async process(input: string): Promise<string> {
    return `Critical Review:\n\n风险评估：\n- 性能瓶颈：中等风险\n- 安全隐患：低风险\n- 兼容性问题：需关注\n\nAPPROVE - 无阻断性风险`
  }
}