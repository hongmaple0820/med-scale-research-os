// SCALE Engine - Grilling Session Skill (mattpocock/skills style)
// 递归决策树探索，一次一个问题

import type { IEventBus } from "../core/eventBus.js"
import type { Timestamp } from "../artifact/types.js"
import { getGrillingTemplate, type GrillingTopic } from "./GrillingTemplates.js"
import { logger } from "../core/logger.js"

export interface GrillingOption {
  id: string
  label: string
  explanation: string
  risk?: string
}

export interface GrillingQuestion {
  id: string
  question: string
  options: GrillingOption[]
  branchMap: Record<string, string>
  contextHint?: string
}

export interface GrillingSession {
  id: string
  topic: GrillingTopic
  currentNodeId: string
  history: Array<{ questionId: string; selectedOption: string; timestamp: Timestamp }>
  concluded: boolean
  conclusion?: GrillingConclusion
}

export interface GrillingConclusion {
  summary: string
  decisions: string[]
  risks: string[]
  nextSteps: string[]
  artifactsToUpdate: string[]
}

export interface GrillingResponse {
  type: "question" | "conclusion"
  question?: GrillingQuestion
  conclusion?: GrillingConclusion
}

export interface IGrillingSessionManager {
  startSession(topic: GrillingTopic): GrillingSession
  handleAnswer(sessionId: string, selectedOption: string): GrillingResponse
  getSession(sessionId: string): GrillingSession | undefined
  endSession(sessionId: string): GrillingConclusion | undefined
}

export class GrillingSessionManager implements IGrillingSessionManager {
  private sessions = new Map<string, GrillingSession>()
  private templates: Record<GrillingTopic, GrillingQuestion[]>
  private eventBus: IEventBus | null

  constructor(eventBus?: IEventBus) {
    this.eventBus = eventBus ?? null
    this.templates = getGrillingTemplate as unknown as Record<GrillingTopic, GrillingQuestion[]>
  }

  startSession(topic: GrillingTopic): GrillingSession {
    const template = this.templates[topic] ?? getGrillingTemplate(topic)
    const id = "GRILL-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)
    const session: GrillingSession = { id, topic, currentNodeId: template[0]?.id ?? "Q1", history: [], concluded: false }
    this.sessions.set(id, session)
    logger.info({ sessionId: id, topic }, "Grilling session started")
    this.eventBus?.emit("grilling.session_started", { sessionId: id, topic })
    return session
  }

  handleAnswer(sessionId: string, selectedOption: string): GrillingResponse {
    const session = this.sessions.get(sessionId)
    if (!session || session.concluded) return { type: "conclusion", conclusion: session?.conclusion }

    session.history.push({ questionId: session.currentNodeId, selectedOption, timestamp: Date.now() })
    const currentQuestion = this.getCurrentQuestion(session)
    if (!currentQuestion) return this.concludeSession(session)

    const nextNodeId = currentQuestion.branchMap[selectedOption]
    if (nextNodeId === "CONCLUSION" || !nextNodeId) return this.concludeSession(session)

    session.currentNodeId = nextNodeId
    const nextQuestion = this.getCurrentQuestion(session)
    return { type: "question", question: nextQuestion }
  }

  getSession(sessionId: string): GrillingSession | undefined { return this.sessions.get(sessionId) }

  endSession(sessionId: string): GrillingConclusion | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    if (!session.concluded) this.concludeSession(session)
    this.sessions.delete(sessionId)
    this.eventBus?.emit("grilling.session_ended", { sessionId })
    return session.conclusion
  }

  private getCurrentQuestion(session: GrillingSession): GrillingQuestion | undefined {
    const template = this.templates[session.topic]
    return template?.find(q => q.id === session.currentNodeId)
  }

  private concludeSession(session: GrillingSession): GrillingResponse {
    session.concluded = true
    const decisions = this.extractDecisions(session.history)
    const risks = this.extractRisks(session.history)
    session.conclusion = {
      summary: this.generateSummary(decisions),
      decisions,
      risks,
      nextSteps: this.generateNextSteps(decisions),
      artifactsToUpdate: this.suggestArtifactUpdates(decisions),
    }
    logger.info({ sessionId: session.id, decisions: decisions.length }, "Grilling concluded")
    this.eventBus?.emit("grilling.concluded", { sessionId: session.id, conclusion: session.conclusion })
    return { type: "conclusion", conclusion: session.conclusion }
  }

  private extractDecisions(history: GrillingSession["history"]): string[] {
    return history.map(h => h.selectedOption)
  }

  private extractRisks(history: GrillingSession["history"]): string[] {
    const risks: string[] = []
    for (const h of history) {
      const question = this.findQuestion(h.questionId)
      const option = question?.options.find(o => o.id === h.selectedOption)
      if (option?.risk) risks.push(option.risk)
    }
    return risks
  }

  private findQuestion(id: string): GrillingQuestion | undefined {
    for (const template of Object.values(this.templates)) {
      const q = template.find(t => t.id === id)
      if (q) return q
    }
    return undefined
  }

  private generateSummary(decisions: string[]): string {
    return "Decisions made: " + decisions.join(" -> ")
  }

  private generateNextSteps(decisions: string[]): string[] {
    const steps: string[] = []
    if (decisions.includes("internal")) steps.push("Review internal user workflow")
    if (decisions.includes("external")) steps.push("Design public UX")
    if (decisions.includes("deep")) steps.push("Define interface contract")
    if (decisions.includes("shallow")) steps.push("Plan module composition")
    return steps
  }

  private suggestArtifactUpdates(decisions: string[]): string[] {
    const artifacts: string[] = []
    if (decisions.length > 3) artifacts.push("CONTEXT.md")
    if (decisions.includes("enterprise") || decisions.includes("k8s")) artifacts.push("ADR")
    return artifacts
  }
}

export function createGrillingSessionManager(eventBus?: IEventBus): IGrillingSessionManager {
  return new GrillingSessionManager(eventBus)
}
