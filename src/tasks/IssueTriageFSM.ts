// SCALE Engine - Issue Triage FSM (mattpocock/skills style)
// Issue 分类 + 状态机流转

import type { IEventBus } from "../core/eventBus.js"
import type { IssueRole, IssueState, IssueTriageTransition, IssueInput, TriageResult, ArtifactId } from "../artifact/types.js"
import { logger } from "../core/logger.js"

// Re-export types for convenience
export type { IssueRole, IssueState, IssueTriageTransition, TriageResult, IssueInput } from "../artifact/types.js"

// ========== State Machine Definition ==========
export const ISSUE_TRIAGE_MACHINE: IssueTriageTransition[] = [
  { from: "needs-triage", to: "needs-info", condition: "Insufficient info", auto: false, agentAction: "ask-for-info" },
  { from: "needs-triage", to: "ready-for-agent", condition: "Complete info + complexity <= 0.7", auto: true },
  { from: "needs-triage", to: "ready-for-human", condition: "Complexity > 0.7 or high risk", auto: true },
  { from: "needs-triage", to: "wontfix", condition: "Invalid request", auto: false, agentAction: "explain-rejection" },
  { from: "needs-info", to: "needs-triage", condition: "Info supplemented", auto: true },
  { from: "ready-for-agent", to: "in-progress", condition: "Agent accepts task", auto: true },
  { from: "in-progress", to: "blocked", condition: "Dependency blocked", auto: true },
  { from: "in-progress", to: "completed", condition: "Execution success", auto: true },
  { from: "in-progress", to: "ready-for-human", condition: "Agent cannot continue", auto: true, agentAction: "escalate" },
  { from: "blocked", to: "in-progress", condition: "Dependency resolved", auto: true },
  { from: "ready-for-human", to: "in-progress", condition: "Human starts", auto: false },
]

// ========== FSM Implementation ==========
export interface IIssueTriageFSM {
  evaluate(input: IssueInput): TriageResult
  canTransition(from: IssueState, to: IssueState): boolean
  getTransitions(from: IssueState): IssueTriageTransition[]
  classifyRole(input: IssueInput): IssueRole
  estimateComplexity(input: IssueInput): number
  assessRisk(input: IssueInput): "low" | "medium" | "high"
}

export class IssueTriageFSM implements IIssueTriageFSM {
  private transitions: IssueTriageTransition[]
  private eventBus: IEventBus | null

  constructor(eventBus?: IEventBus) {
    this.transitions = ISSUE_TRIAGE_MACHINE
    this.eventBus = eventBus ?? null
  }

  evaluate(input: IssueInput): TriageResult {
    const role = this.classifyRole(input)
    const complexity = this.estimateComplexity(input)
    const risk = this.assessRisk(input)
    const hasInfo = this.checkInfoSufficiency(input)

    let state: IssueState = "needs-triage"
    let action: string | undefined
    let reason: string | undefined

    if (!hasInfo) {
      state = "needs-info"
      action = "ask-for-info"
      reason = "Insufficient information provided"
    } else if (complexity > 0.7 || risk === "high") {
      state = "ready-for-human"
      reason = "High complexity or risk requires human oversight"
    } else if (this.isValidRequest(input)) {
      state = "ready-for-agent"
      reason = "Ready for automated execution"
    } else {
      state = "wontfix"
      action = "explain-rejection"
      reason = "Invalid or out-of-scope request"
    }

    this.eventBus?.emit("issue.triaged", { role, state, complexity, risk })
    logger.info({ role, state, complexity }, "Issue triaged")
    return { state, action, reason }
  }

  canTransition(from: IssueState, to: IssueState): boolean {
    return this.transitions.some(t => t.from === from && t.to === to)
  }

  getTransitions(from: IssueState): IssueTriageTransition[] {
    return this.transitions.filter(t => t.from === from)
  }

  classifyRole(input: IssueInput): IssueRole {
    if (input.type) return input.type
    const lowerDesc = input.description.toLowerCase()
    if (lowerDesc.includes("bug") || lowerDesc.includes("fix") || lowerDesc.includes("error") || lowerDesc.includes("broken")) return "bug"
    return "enhancement"
  }

  estimateComplexity(input: IssueInput): number {
    if (input.complexity !== undefined) return input.complexity
    let score = 0.3
    const fileCount = input.filesInvolved?.length ?? 0
    if (fileCount > 5) score += 0.3
    if (fileCount > 10) score += 0.2
    const depCount = input.dependsOn?.length ?? 0
    if (depCount > 2) score += 0.2
    const descLength = input.description.length
    if (descLength > 500) score += 0.1
    return Math.min(score, 1)
  }

  assessRisk(input: IssueInput): "low" | "medium" | "high" {
    if (input.riskLevel) return input.riskLevel
    const lowerDesc = input.description.toLowerCase()
    if (lowerDesc.includes("auth") || lowerDesc.includes("security") || lowerDesc.includes("payment") || lowerDesc.includes("production")) return "high"
    if (lowerDesc.includes("migration") || lowerDesc.includes("database") || lowerDesc.includes("config")) return "medium"
    return "low"
  }

  private checkInfoSufficiency(input: IssueInput): boolean {
    return input.title.length > 10 && input.description.length > 50
  }

  private isValidRequest(input: IssueInput): boolean {
    const lowerDesc = input.description.toLowerCase()
    if (lowerDesc.includes("spam") || lowerDesc.includes("nonsense") || lowerDesc.includes("test issue")) return false
    return true
  }
}

export function createIssueTriageFSM(eventBus?: IEventBus): IIssueTriageFSM {
  return new IssueTriageFSM(eventBus)
}
