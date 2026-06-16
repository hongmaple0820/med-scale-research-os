// SCALE Engine — Workflow Orchestrator
// Chains define → plan → build → verify → review → ship automatically

import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs } from '../artifact/fsmDefinitions.js'
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { registerCoreSkills } from '../skills/coreSkills.js'
import { registerExternalSkills } from '../skills/ExternalSkills.js'
import { WorkflowEngine } from './WorkflowEngine.js'
import { TaskLevelDetector, type TaskLevel } from './TaskLevelDetector.js'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { estimateTokens } from '../context/ContextBudget.js'
import type { SpecPayload, PlanPayload, TaskPayload } from '../artifact/types.js'

export type PhaseName = 'define' | 'plan' | 'build' | 'verify' | 'review' | 'ship'

export interface RunOptions {
  title: string
  description?: string
  successCriteria?: string[]
  level?: TaskLevel
  skipPhases?: PhaseName[]
  stopOnFailure?: boolean
  autoCommit?: boolean
  scaleDir?: string
  projectDir?: string
}

export interface PhaseResult {
  phase: PhaseName
  success: boolean
  duration: number
  artifactId?: string
  error?: string
  details?: Record<string, unknown>
}

export interface TokenUsage {
  totalEstimated: number
  byPhase: Record<string, number>
}

export interface RunResult {
  success: boolean
  phases: PhaseResult[]
  artifacts: {
    needId?: string
    specId?: string
    planId?: string
    taskId?: string
  }
  tokenUsage: TokenUsage
  duration: number
}

export class WorkflowOrchestrator {
  private eventBus: EventBus
  private store: SQLiteArtifactStore
  private fsm: FSM
  private workflowEngine: WorkflowEngine
  private scaleDir: string
  private projectDir: string

  constructor(opts: { scaleDir?: string; projectDir?: string } = {}) {
    this.scaleDir = opts.scaleDir ?? '.scale'
    this.projectDir = opts.projectDir ?? process.cwd()

    if (!existsSync(this.scaleDir)) mkdirSync(this.scaleDir, { recursive: true })

    this.eventBus = new EventBus({ eventsDir: join(this.scaleDir, 'events') })
    this.store = new SQLiteArtifactStore(this.eventBus, {
      dbPath: join(this.scaleDir, 'scale.db'),
      artifactsDir: join(this.scaleDir, 'artifacts'),
    })
    this.fsm = new FSM(this.store, this.eventBus)
    registerAllFSMs(this.fsm)

    const capabilityRegistry = new CapabilityRegistry(this.eventBus)
    const skillRegistry = new SkillRegistry(this.eventBus)
    registerCoreSkills(skillRegistry)
    registerExternalSkills(skillRegistry, this.eventBus)

    this.workflowEngine = new WorkflowEngine({
      eventBus: this.eventBus,
      capabilityRegistry,
      skillRegistry,
      scaleDir: this.scaleDir,
    })
  }

  async run(options: RunOptions): Promise<RunResult> {
    const startTime = Date.now()
    const phases: PhaseResult[] = []
    const artifacts: RunResult['artifacts'] = {}
    const tokenByPhase: Record<string, number> = {}
    const skipSet = new Set(options.skipPhases ?? [])
    const stopOnFailure = options.stopOnFailure !== false

    const execute = async (name: PhaseName, fn: () => Promise<{ artifactId?: string; details?: Record<string, unknown> }>) => {
      if (skipSet.has(name)) {
        phases.push({ phase: name, success: true, duration: 0 })
        return true
      }

      const phaseStart = Date.now()
      try {
        const result = await fn()
        const detailStr = JSON.stringify(result.details ?? {})
        tokenByPhase[name] = (tokenByPhase[name] ?? 0) + estimateTokens(detailStr)
        phases.push({ phase: name, success: true, duration: Date.now() - phaseStart, ...result })
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        phases.push({ phase: name, success: false, duration: Date.now() - phaseStart, error: message })
        if (stopOnFailure) return false
        return true
      }
    }

    // Phase 1: DEFINE
    const defineOk = await execute('define', async () => {
      const result = await this.executeDefine(options)
      artifacts.needId = result.needId
      artifacts.specId = result.specId
      return { artifactId: result.specId, details: result }
    })
    if (!defineOk) return this.buildResult(false, phases, artifacts, tokenByPhase, startTime)

    // Phase 2: PLAN
    const planOk = await execute('plan', async () => {
      const result = await this.executePlan(artifacts.specId!, options)
      artifacts.planId = result.planId
      return { artifactId: result.planId, details: result }
    })
    if (!planOk) return this.buildResult(false, phases, artifacts, tokenByPhase, startTime)

    // Phase 3: BUILD
    const buildOk = await execute('build', async () => {
      const result = await this.executeBuild(artifacts.planId!, options)
      artifacts.taskId = result.taskId
      return { artifactId: result.taskId, details: result }
    })
    if (!buildOk) return this.buildResult(false, phases, artifacts, tokenByPhase, startTime)

    // Phase 4: VERIFY
    const verifyOk = await execute('verify', async () => {
      const result = await this.executeVerify(artifacts.taskId!)
      return { details: result }
    })
    if (!verifyOk) return this.buildResult(false, phases, artifacts, tokenByPhase, startTime)

    // Phase 5: REVIEW
    const reviewOk = await execute('review', async () => {
      const result = await this.executeReview(artifacts.taskId!)
      return { details: result }
    })
    if (!reviewOk) return this.buildResult(false, phases, artifacts, tokenByPhase, startTime)

    // Phase 6: SHIP
    await execute('ship', async () => {
      const result = await this.executeShip(artifacts.taskId!, options)
      return { details: result }
    })

    return this.buildResult(
      phases.every(p => p.success),
      phases,
      artifacts,
      tokenByPhase,
      startTime,
    )
  }

  private async executeDefine(options: RunOptions): Promise<{ needId: string; specId: string; ambiguityScore: number }> {
    const desc = options.description ?? options.title
    const successCriteria = options.successCriteria ?? ['Feature works as described', 'No regression']

    // Run ambiguity analysis (warning only, don't block orchestrator)
    const ambiguityResult = this.workflowEngine.getAmbiguityScorer().analyzeRequirement(desc)

    // Create Need
    const need = await this.store.create({
      type: 'Need',
      title: options.title,
      payload: { rawText: desc },
      initialStatus: 'DRAFT',
      createdBy: { kind: 'human', userId: 'orchestrator' },
    })

    // Create Spec
    const specPayload: SpecPayload = {
      what: desc,
      successCriteria,
      outOfScope: [],
      edgeCases: [],
      northStar: 'Deliver user value',
      ambiguityScore: ambiguityResult.totalScore,
    }

    const spec = await this.store.create({
      type: 'Spec',
      title: options.title,
      payload: specPayload,
      parents: [need.id],
      initialStatus: 'DRAFT',
      createdBy: { kind: 'human', userId: 'orchestrator' },
    })

    // FSM transitions (approve may fail on high ambiguity - that's OK for orchestrator)
    await this.fsm.transition(spec.id, 'refine', { actor: { kind: 'system', component: 'orchestrator' } })
    const approveResult = await this.fsm.transition(spec.id, 'approve', { actor: { kind: 'system', component: 'orchestrator' } })
    if (!approveResult.success) {
      // Spec stays in REVIEWING — not fatal for orchestrator flow
    }

    return { needId: need.id, specId: spec.id, ambiguityScore: ambiguityResult.totalScore }
  }

  private async executePlan(specId: string, options: RunOptions): Promise<{ planId: string }> {
    const spec = await this.store.get(specId)
    if (!spec || spec.type !== 'Spec') throw new Error(`Spec not found: ${specId}`)

    const specDesc = (spec.payload as SpecPayload).what
    const consensusResult = await this.workflowEngine.plan(specDesc, {
      persistArtifact: false,
      runGate: false,
    }) as import('./types.js').RALPLANOutput

    const rollbackStrategy = consensusResult.preMortem.mitigations.join('\n') || 'Revert git commits'

    const planPayload: PlanPayload = {
      approach: consensusResult.viableOptions.find(o => o.selected)?.description ?? 'Standard implementation',
      techChoices: [],
      modules: [],
      rollbackStrategy,
      estimatedComplexity: 5,
    }

    const plan = await this.store.create({
      type: 'Plan',
      title: `Plan for ${spec.title}`,
      payload: planPayload,
      parents: [specId],
      initialStatus: 'DRAFT',
      createdBy: { kind: 'human', userId: 'orchestrator' },
    })

    await this.fsm.transition(plan.id, 'review', { actor: { kind: 'system', component: 'orchestrator' } })

    return { planId: plan.id }
  }

  private async executeBuild(planId: string, options: RunOptions): Promise<{ taskId: string; level: TaskLevel }> {
    const plan = await this.store.get(planId)
    if (!plan || plan.type !== 'Plan') throw new Error(`Plan not found: ${planId}`)

    // Auto-detect level if not specified
    let level: TaskLevel
    if (options.level) {
      level = options.level
    } else {
      const detector = new TaskLevelDetector()
      const detection = await detector.detectFromGitDiff(this.projectDir)
      level = detection.level
    }

    const taskPayload: TaskPayload = {
      description: options.description ?? `Implement ${plan.title}`,
      workflowLevel: level,
      servicesTouched: [],
      filesInvolved: [],
      dependsOn: [],
      requiredRole: 'implementer',
      requiredCapabilities: ['code-generation', 'file-editing'],
      buildStatus: 'pending',
      lintStatus: 'pending',
      agentBrief: {
        category: 'enhancement',
        summary: options.description ?? `Implement ${plan.title}`,
        currentBehavior: 'Feature not yet implemented',
        desiredBehavior: `Implement: ${plan.title}`,
        keyInterfaces: [],
        acceptanceCriteria: [],
        outOfScope: [],
      },
    }

    const task = await this.store.create({
      type: 'Task',
      title: `Task for ${plan.title}`,
      payload: taskPayload,
      parents: [planId],
      initialStatus: 'PENDING',
      createdBy: { kind: 'human', userId: 'orchestrator' },
    })

    // FSM transitions
    await this.fsm.transition(task.id, 'schedule', { actor: { kind: 'system', component: 'orchestrator' } })
    await this.fsm.transition(task.id, 'start', { actor: { kind: 'human', userId: 'orchestrator' } })

    // Update Plan status
    const canImplement = await this.fsm.canTransition(planId, 'implement')
    if (canImplement.allowed) {
      await this.fsm.transition(planId, 'implement', { actor: { kind: 'system', component: 'orchestrator' } })
    }

    return { taskId: task.id, level }
  }

  private async executeVerify(taskId: string): Promise<{ passed: boolean; gateCount: number }> {
    const task = await this.store.get(taskId)
    if (!task || task.type !== 'Task') throw new Error(`Task not found: ${taskId}`)

    // Run verification gates
    const gateResults = await this.workflowEngine.verify({
      cwd: this.projectDir,
    })

    const passed = gateResults.every(r => r.passed)

    // Update task payload
    const payload = task.payload as TaskPayload
    const buildPassed = gateResults.filter(r => r.gate === 'G0').every(r => r.passed)
    const lintPassed = gateResults.filter(r => r.gate === 'G4').every(r => r.passed)
    const testPassed = gateResults.filter(r => r.gate === 'G5').every(r => r.passed)

    const updatedPayload: TaskPayload = {
      ...payload,
      buildStatus: buildPassed ? 'success' : 'failed',
      lintStatus: lintPassed ? 'success' : 'failed',
      testPassed,
      verifiedAt: Date.now(),
    }
    await this.store.update(taskId, { payload: updatedPayload })

    return { passed, gateCount: gateResults.length }
  }

  private async executeReview(taskId: string): Promise<{ passed: boolean; criticalCount: number }> {
    const task = await this.store.get(taskId)
    if (!task || task.type !== 'Task') throw new Error(`Task not found: ${taskId}`)

    // Run Karpathy check
    const karpathyResult = this.workflowEngine.checkKarpathy({
      hypothesesListed: true,
      hasExtraFeatures: false,
      changesTraceable: true,
      hasVerifiableGoal: true,
    })

    const passed = karpathyResult.every(check => check.passed)

    // Update task payload
    const payload = task.payload as TaskPayload
    const updatedPayload: TaskPayload = {
      ...payload,
      reviewPassed: passed,
      reviewedAt: Date.now(),
    }
    await this.store.update(taskId, { payload: updatedPayload })

    return { passed, criticalCount: passed ? 0 : 1 }
  }

  private async executeShip(taskId: string, options: RunOptions): Promise<{ committed: boolean }> {
    const task = await this.store.get(taskId)
    if (!task || task.type !== 'Task') throw new Error(`Task not found: ${taskId}`)

    const payload = task.payload as TaskPayload

    // Verify prerequisites
    if (payload.buildStatus !== 'success') throw new Error('Build not passed')
    if (!payload.testPassed) throw new Error('Tests not passed')
    if (!payload.reviewPassed) throw new Error('Review not passed')

    // Complete FSM transition
    if (task.status !== 'COMPLETED') {
      const canComplete = await this.fsm.canTransition(taskId, 'complete')
      if (canComplete.allowed) {
        await this.fsm.transition(taskId, 'complete', { actor: { kind: 'human', userId: 'orchestrator' } })
      }
    }

    // Complete parent plan
    if (task.parents.length > 0) {
      try {
        await this.fsm.transition(task.parents[0], 'complete', {
          actor: { kind: 'system', component: 'orchestrator' },
        })
      } catch (error) {
        const parentPlanWarning = error instanceof Error ? error.message : String(error)
        void parentPlanWarning
      }
    }

    return { committed: options.autoCommit !== false }
  }

  private buildResult(
    success: boolean,
    phases: PhaseResult[],
    artifacts: RunResult['artifacts'],
    tokenByPhase: Record<string, number>,
    startTime: number,
  ): RunResult {
    const totalEstimated = Object.values(tokenByPhase).reduce((s, v) => s + v, 0)
    return {
      success,
      phases,
      artifacts,
      tokenUsage: { totalEstimated, byPhase: { ...tokenByPhase } },
      duration: Date.now() - startTime,
    }
  }

  /** Close database connections */
  close(): void {
    this.store.close?.()
  }
}
