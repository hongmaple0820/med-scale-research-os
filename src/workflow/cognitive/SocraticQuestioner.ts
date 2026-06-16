// SCALE Engine — Socratic Questioner
// 苏格拉底提问器 - 需求精炼 (六问重构框架)
// 来源借鉴: OMC deep-interview + gstack office-hours

import type { IEventBus } from '../../core/eventBus.js'
import type { AmbiguityScoreResult, SocraticQuestion, SocraticSession, RefinementRound } from '../types.js'

export interface ISocraticQuestioner {
  startSession(requirement: string, ambiguityResult: AmbiguityScoreResult): SocraticSession
  askNextQuestion(session: SocraticSession): SocraticQuestion | null
  recordAnswer(sessionId: string, questionId: string, answer: string): void
  evaluateProgress(session: SocraticSession): { refined: boolean; newAmbiguity: number }
  shouldBlock(session: SocraticSession): boolean
  generateRefinedRequirement(session: SocraticSession): string
}

// 六问重构框架
const SIX_QUESTIONS: SocraticQuestion[] = [
  {
    id: 'q-goal',
    category: 'goal',
    question: '你想要达成什么具体结果？请描述期望的最终状态。',
    followUps: [
      '这个结果是否可量化？',
      '达成后用户会如何使用？',
      '有没有参考案例？'
    ],
    answered: false,
    clarityScore: 0
  },
  {
    id: 'q-constraint',
    category: 'constraint',
    question: '有哪些不可逾越的边界？包括技术、时间、资源限制。',
    followUps: [
      '技术栈是否已确定？',
      '有固定的截止日期吗？',
      '预算/人力约束是什么？'
    ],
    answered: false,
    clarityScore: 0
  },
  {
    id: 'q-acceptance',
    category: 'acceptance',
    question: '如何验证成功？请给出可测试的验收标准。',
    followUps: [
      '能否用具体指标描述？',
      '用户如何确认满足需求？',
      '最小可接受标准是什么？'
    ],
    answered: false,
    clarityScore: 0
  },
  {
    id: 'q-context',
    category: 'context',
    question: '现有系统/依赖有哪些需要兼容？',
    followUps: [
      '是否需要向下兼容？',
      '有哪些现有接口需要保持？',
      '数据迁移需求？'
    ],
    answered: false,
    clarityScore: 0
  },
  {
    id: 'q-risk',
    category: 'risk',
    question: '最可能的2种失败场景是什么？',
    followUps: [
      '如果数据丢失会怎样？',
      '如果性能下降会怎样？',
      '回滚方案是什么？'
    ],
    answered: false,
    clarityScore: 0
  },
  {
    id: 'q-priority',
    category: 'priority',
    question: '如果只能完成一半，哪些必须先做？',
    followUps: [
      '核心功能是什么？',
      '哪些可以后续迭代？',
      'MVP 定义是什么？'
    ],
    answered: false,
    clarityScore: 0
  }
]

export class SocraticQuestioner implements ISocraticQuestioner {
  private eventBus: IEventBus
  private sessions: Map<string, SocraticSession> = new Map()
  private maxRounds: number = 3

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus
  }

  startSession(requirement: string, ambiguityResult: AmbiguityScoreResult): SocraticSession {
    const sessionId = `socratic-${Date.now()}`
    const session: SocraticSession = {
      sessionId,
      requirement,
      initialAmbiguity: ambiguityResult,
      questions: SIX_QUESTIONS.map(q => ({ ...q, clarityScore: 0 })),
      currentRound: 0,
      maxRounds: this.maxRounds,
      status: 'in_progress',
      refinementHistory: []
    }
    this.sessions.set(sessionId, session)
    this.eventBus.emit('socratic.session.started', { sessionId, initialAmbiguity: ambiguityResult.totalScore })
    return session
  }

  askNextQuestion(session: SocraticSession): SocraticQuestion | null {
    if (session.status !== 'in_progress') return null

    // 找到未回答的最高优先级问题
    const unanswered = session.questions
      .filter(q => !q.answered)
      .sort((a, b) => this.getQuestionPriority(a) - this.getQuestionPriority(b))

    if (unanswered.length === 0) {
      // 所有问题已回答，评估是否需要继续
      const progress = this.evaluateProgress(session)
      if (progress.refined) {
        session.status = 'refined'
        return null
      }
      // 需要深入追问
      return this.generateFollowUp(session)
    }

    return unanswered[0]
  }

  recordAnswer(sessionId: string, questionId: string, answer: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const question = session.questions.find(q => q.id === questionId)
    if (!question) return

    question.answered = true
    question.answer = answer
    question.clarityScore = this.evaluateAnswerClarity(answer)

    this.eventBus.emit('socratic.answer.recorded', { sessionId, questionId, clarityScore: question.clarityScore })
  }

  evaluateProgress(session: SocraticSession): { refined: boolean; newAmbiguity: number } {
    const answeredCount = session.questions.filter(q => q.answered).length
    const totalClarity = session.questions.reduce((sum, q) => sum + q.clarityScore, 0)
    const avgClarity = answeredCount > 0 ? totalClarity / answeredCount : 0

    // 计算新的模糊度
    const initialAmbiguity = session.initialAmbiguity.totalScore
    const reductionFactor = avgClarity * 0.5  // 每个清晰回答减少最多 50% 模糊度
    const newAmbiguity = Math.max(0.05, initialAmbiguity * (1 - reductionFactor))

    // 记录本轮
    const round: RefinementRound = {
      round: session.currentRound + 1,
      questionsAsked: session.questions.filter(q => q.answered).map(q => q.id),
      answersReceived: session.questions.filter(q => q.answered && q.answer).map(q => q.answer || ''),
      ambiguityBefore: session.refinementHistory.length > 0
        ? session.refinementHistory[session.refinementHistory.length - 1].ambiguityAfter
        : initialAmbiguity,
      ambiguityAfter: newAmbiguity
    }
    session.refinementHistory.push(round)
    session.currentRound++

    const refined = newAmbiguity <= 0.20
    if (refined) {
      session.status = 'refined'
      session.finalAmbiguity = {
        ...session.initialAmbiguity,
        totalScore: newAmbiguity,
        shouldProceed: true,
        requiresQuestioning: false,
        blocked: false
      }
    }

    return { refined, newAmbiguity }
  }

  shouldBlock(session: SocraticSession): boolean {
    // 连续 3 轮仍未达标
    if (session.currentRound >= session.maxRounds && session.status === 'in_progress') {
      session.status = 'blocked'
      this.eventBus.emit('socratic.session.blocked', { sessionId: session.sessionId })
      return true
    }
    return false
  }

  generateRefinedRequirement(session: SocraticSession): string {
    const parts: string[] = []

    // 目标
    const goalQ = session.questions.find(q => q.id === 'q-goal')
    if (goalQ?.answer) parts.push(`目标: ${goalQ.answer}`)

    // 约束
    const constraintQ = session.questions.find(q => q.id === 'q-constraint')
    if (constraintQ?.answer) parts.push(`约束: ${constraintQ.answer}`)

    // 验收标准
    const acceptanceQ = session.questions.find(q => q.id === 'q-acceptance')
    if (acceptanceQ?.answer) parts.push(`验收标准: ${acceptanceQ.answer}`)

    // 上下文
    const contextQ = session.questions.find(q => q.id === 'q-context')
    if (contextQ?.answer) parts.push(`上下文: ${contextQ.answer}`)

    // 风险
    const riskQ = session.questions.find(q => q.id === 'q-risk')
    if (riskQ?.answer) parts.push(`风险边界: ${riskQ.answer}`)

    // 优先级
    const priorityQ = session.questions.find(q => q.id === 'q-priority')
    if (priorityQ?.answer) parts.push(`优先级: ${priorityQ.answer}`)

    return parts.join('\n\n')
  }

  getSession(sessionId: string): SocraticSession | undefined {
    return this.sessions.get(sessionId)
  }

  formatSessionReport(session: SocraticSession): string {
    const lines: string[] = []
    lines.push('=== Socratic Questioning Report ===')
    lines.push(`Session: ${session.sessionId}`)
    lines.push(`Status: ${session.status}`)
    lines.push(`Rounds: ${session.currentRound}/${session.maxRounds}`)
    lines.push('')
    lines.push(`Initial Ambiguity: ${session.initialAmbiguity.totalScore.toFixed(2)}`)
    if (session.finalAmbiguity) {
      lines.push(`Final Ambiguity: ${session.finalAmbiguity.totalScore.toFixed(2)}`)
    }
    lines.push('')
    lines.push('Questions:')
    session.questions.forEach(q => {
      const status = q.answered ? `[✓]` : `[ ]`
      lines.push(`  ${status} ${q.category}: ${q.question}`)
      if (q.answer) {
        lines.push(`       Answer: ${q.answer.slice(0, 100)}...`)
        lines.push(`       Clarity: ${q.clarityScore.toFixed(2)}`)
      }
    })

    if (session.status === 'refined') {
      lines.push('')
      lines.push('Refined Requirement:')
      lines.push(this.generateRefinedRequirement(session))
    }

    return lines.join('\n')
  }

  // 私有方法

  private getQuestionPriority(question: SocraticQuestion): number {
    // 目标 > 验收 > 约束 > 上下文 > 风险 > 优先级
    const priorities: Record<string, number> = {
      goal: 1,
      acceptance: 2,
      constraint: 3,
      context: 4,
      risk: 5,
      priority: 6
    }
    return priorities[question.category] ?? 7
  }

  private evaluateAnswerClarity(answer: string): number {
    if (!answer || answer.length < 10) return 0.2
    if (answer.length < 30) return 0.4
    if (answer.includes('具体') || answer.includes('明确') || answer.includes('标准')) return 0.8
    if (answer.includes('可能') || answer.includes('也许') || answer.includes('大概')) return 0.3
    return 0.6
  }

  private generateFollowUp(session: SocraticSession): SocraticQuestion | null {
    // 找到模糊度最高的已回答问题，生成追问
    const lowClarity = session.questions
      .filter(q => q.answered && q.clarityScore < 0.5)
      .sort((a, b) => a.clarityScore - b.clarityScore)

    if (lowClarity.length === 0) return null

    const target = lowClarity[0]
    const followUpIndex = Math.floor(Math.random() * target.followUps.length)

    return {
      id: `${target.id}-follow-${followUpIndex}`,
      category: target.category,
      question: target.followUps[followUpIndex],
      followUps: [],
      answered: false,
      clarityScore: 0
    }
  }
}