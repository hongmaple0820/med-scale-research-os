// SCALE Engine — Workflow Executor (v0.7.0)
// 工作流执行器：执行预设工作流步骤

import type { WorkflowPreset, WorkflowStep } from "../artifact/types.js"
import type { IEventBus } from "../core/eventBus.js"
import type { IArtifactStore } from "../artifact/store.js"
import { GateParser, GateResult } from "./GateParser.js"
import { logger } from "../core/logger.js"

export interface WorkflowSession {
  id: string
  presetId: string
  presetName: string
  currentStep: number
  totalSteps: number
  status: "running" | "paused" | "completed" | "failed" | "blocked"
  blockingReason?: string
  verifiedSteps: number[]
  stepHistory: StepHistoryEntry[]
  startedAt: number
  pausedAt?: number
  completedAt?: number
  context: Record<string, unknown>
}

export interface StepHistoryEntry {
  stepId: string
  stepIndex: number
  action: string
  status: "pending" | "running" | "verified" | "failed" | "skipped"
  startedAt: number
  completedAt?: number
  output?: unknown
  error?: string
  gateResult?: GateResult
}

export interface IWorkflowExecutor {
  start(preset: WorkflowPreset, context: Record<string, unknown>): Promise<WorkflowSession>
  getStatus(sessionId: string): Promise<WorkflowSession | null>
  pause(sessionId: string, reason?: string): Promise<void>
  resume(sessionId: string): Promise<void>
  executeStep(sessionId: string, stepIndex?: number): Promise<StepHistoryEntry>
  runAll(sessionId: string): Promise<WorkflowSession>
  getHistory(sessionId: string): Promise<StepHistoryEntry[]>
}

export class WorkflowExecutor implements IWorkflowExecutor {
  private sessions = new Map<string, WorkflowSession>()
  private gateParser = new GateParser()
  private eventBus: IEventBus
  private store: IArtifactStore

  constructor(eventBus: IEventBus, store: IArtifactStore) {
    this.eventBus = eventBus
    this.store = store
  }

  async start(preset: WorkflowPreset, context: Record<string, unknown>): Promise<WorkflowSession> {
    const session: WorkflowSession = {
      id: `WF-${Date.now()}`,
      presetId: preset.id,
      presetName: preset.name,
      currentStep: 0,
      totalSteps: preset.steps.length,
      status: "running",
      verifiedSteps: [],
      stepHistory: preset.steps.map((s, i) => ({
        stepId: s.stepId, stepIndex: i, action: s.action, status: "pending", startedAt: 0
      })),
      startedAt: Date.now(),
      context,
    }
    this.sessions.set(session.id, session)
    this.eventBus.emit("workflow.started", { sessionId: session.id, presetId: preset.id })
    logger.info({ sessionId: session.id, presetId: preset.id }, "Workflow started")
    return session
  }

  async getStatus(sessionId: string): Promise<WorkflowSession | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async pause(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.status = "paused"
    session.pausedAt = Date.now()
    session.blockingReason = reason
    this.eventBus.emit("workflow.paused", { sessionId, reason })
    logger.info({ sessionId, reason }, "Workflow paused")
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== "paused") return
    session.status = "running"
    session.pausedAt = undefined
    session.blockingReason = undefined
    this.eventBus.emit("workflow.resumed", { sessionId })
    logger.info({ sessionId }, "Workflow resumed")
  }

  async executeStep(sessionId: string, stepIndex?: number): Promise<StepHistoryEntry> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error("Session not found")
    if (session.status === "paused") throw new Error("Session is paused")
    
    const idx = stepIndex ?? session.currentStep
    const step = session.stepHistory[idx]
    if (!step) throw new Error("Step not found")

    step.status = "running"
    step.startedAt = Date.now()

    try {
      // 执行动作（模拟）
      step.output = await this.executeAction(session.context, step.action)

      // 验证门控
      const presetStep = this.getPresetStep(session.presetId, idx)
      if (presetStep?.verificationGate) {
        const gateResult = await this.gateParser.evaluateString(presetStep.verificationGate, {
          artifact: await this.getRelatedArtifact(session.context),
          runCommand: async (_cmd: string) => ({ success: true, output: "" })
        })
        step.gateResult = gateResult
        if (!gateResult.passed) {
          step.status = "failed"
          step.error = gateResult.reason
          session.status = "blocked"
          session.blockingReason = gateResult.reason
          return step
        }
      }

      step.status = "verified"
      step.completedAt = Date.now()
      session.verifiedSteps.push(idx)
      session.currentStep = idx + 1

      if (session.currentStep >= session.totalSteps) {
        session.status = "completed"
        session.completedAt = Date.now()
        this.eventBus.emit("workflow.completed", { sessionId })
      }

      return step
    } catch (err) {
      step.status = "failed"
      step.error = String(err)
      step.completedAt = Date.now()
      session.status = "failed"
      throw err
    }
  }

  async runAll(sessionId: string): Promise<WorkflowSession> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error("Session not found")

    for (let i = 0; i < session.totalSteps; i++) {
      if (session.status === "blocked" || session.status === "failed") break
      await this.executeStep(sessionId, i)
    }
    return session
  }

  async getHistory(sessionId: string): Promise<StepHistoryEntry[]> {
    const session = this.sessions.get(sessionId)
    return session?.stepHistory ?? []
  }

  private async executeAction(_context: Record<string, unknown>, action: string): Promise<unknown> {
    // 模拟执行，实际由 Agent 或 CLI 处理
    if (action.startsWith("scale ")) return { command: action, executed: true }
    return { action, result: "simulated" }
  }

  private getPresetStep(presetId: string, stepIndex: number): WorkflowStep | undefined {
    // 从 presets.ts 导入的预设中获取 - 简化版本
    const presets: Record<string, WorkflowStep[]> = {
      "basic-dev": [{ stepId: "explore", action: "explore", isMandatory: true }],
      "tdd-dev": [{ stepId: "explore", action: "explore", isMandatory: true }],
      "bug-fix": [{ stepId: "reproduce", action: "reproduce", isMandatory: true }],
    }
    return presets[presetId]?.[stepIndex]
  }

  private async getRelatedArtifact(context: Record<string, unknown>): Promise<import("../artifact/types.js").Artifact | undefined> {
    const artifactId = context.artifactId as string | undefined
    if (!artifactId) return undefined
    const artifact = await this.store.get(artifactId)
    return artifact ?? undefined
  }
}
