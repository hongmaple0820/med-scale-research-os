// SCALE Engine — FSM Agent Bridge (v0.7.0)
// 让 Agent 能感知 FSM 状态约束

import type { Artifact, EventType } from "../artifact/types.js"
import type { IArtifactStore } from "../artifact/store.js"
import type { IFSM } from "../artifact/fsm.js"
import type { IEventBus } from "../core/eventBus.js"

export interface FSMContextSnapshot {
  artifactId: string
  artifactType: string
  currentStatus: string
  allowedTransitions: string[]
  blockingReasons: string[]
  downstreamImpact: string[]
  parentStatus?: string
  childrenStatuses: string[]
}

export interface SessionFSMContext {
  sessionId: string
  artifacts: FSMContextSnapshot[]
  recalledLessons: string[]
  recommendations: string[]
  generatedAt: number
}

export interface IFSMAgentBridge {
  getFSMContext(artifactId: string): Promise<FSMContextSnapshot | null>
  getSessionContext(sessionId: string, eventBus: IEventBus): Promise<SessionFSMContext>
  checkOperation(artifactId: string, operation: string): Promise<{ allowed: boolean; reasons: string[] }>
  getCreationPrerequisites(artifactType: string): Promise<{ requiredParentStatus: string[]; message: string }>
  injectFSMContextToPrompt(prompt: string, artifactIds: string[]): Promise<string>
}

export class FSMAgentBridge implements IFSMAgentBridge {
  constructor(
    private fsm: IFSM,
    private store: IArtifactStore,
  ) {}

  async getFSMContext(artifactId: string): Promise<FSMContextSnapshot | null> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) return null

    const fsmDef = this.fsm.getDefinition(artifact.type)
    if (!fsmDef) return null

    // 计算允许的迁移
    const availableActions = await this.fsm.availableActions(artifactId)
    
    // 计算阻塞原因
    const blockingReasons: string[] = []

    // 找出从当前状态出发的所有迁移
    const transitionsFromCurrent = fsmDef.transitions.filter(t => t.from === artifact.status)

    for (const tx of transitionsFromCurrent) {
      const result = await this.fsm.canTransition(artifactId, tx.action)
      if (!result.allowed && result.blockedBy) {
        blockingReasons.push(`${tx.action}: ${result.blockedBy.map(g => g.message).join(', ')}`)
      }
    }

    // 下游影响
    const downstreamImpact = await this.calculateDownstreamImpact(artifact)

    // 父子状态
    const parentStatus = artifact.parents.length > 0
      ? (await this.store.get(artifact.parents[0]))?.status
      : undefined
    const childrenStatuses = (await this.store.findChildren(artifactId))
      .map(c => c.status)

    return {
      artifactId,
      artifactType: artifact.type,
      currentStatus: artifact.status,
      allowedTransitions: availableActions,
      blockingReasons,
      downstreamImpact,
      parentStatus,
      childrenStatuses,
    }
  }

  async checkOperation(artifactId: string, operation: string): Promise<{ allowed: boolean; reasons: string[] }> {
    const artifact = await this.store.get(artifactId)
    if (!artifact) return { allowed: false, reasons: ['Artifact not found'] }

    const fsmDef = this.fsm.getDefinition(artifact.type)
    if (!fsmDef) return { allowed: false, reasons: ['No FSM definition for this artifact type'] }

    // 检查是否是合法迁移
    const transitionsFromCurrent = fsmDef.transitions.filter(t => t.from === artifact.status)
    const transition = transitionsFromCurrent.find(t => t.action === operation)

    if (!transition) {
      const allowed = transitionsFromCurrent.map(t => t.action).join(', ') || 'none'
      return {
        allowed: false,
        reasons: [`"${operation}" is not a valid transition from ${artifact.status}. Allowed: ${allowed}`]
      }
    }

    // 检查 Guards
    const result = await this.fsm.canTransition(artifactId, operation)
    if (!result.allowed && result.blockedBy) {
      return { allowed: false, reasons: result.blockedBy.map(g => g.message) }
    }

    return { allowed: true, reasons: [] }
  }

  async getCreationPrerequisites(artifactType: string): Promise<{ requiredParentStatus: string[]; message: string }> {
    // 基于 FSM 定义判断创建条件
    const fsmDef = this.fsm.getDefinition(artifactType as any)
    if (!fsmDef) return { requiredParentStatus: [], message: 'No FSM definition available' }

    // 从 FSM 定义中提取依赖关系（简化实现）
    const deps: Record<string, { parentType: string; parentStatus: string }> = {
      Plan: { parentType: 'Spec', parentStatus: 'FROZEN' },
      Task: { parentType: 'Plan', parentStatus: 'APPROVED' },
      Change: { parentType: 'Task', parentStatus: 'IN_PROGRESS' },
      Evidence: { parentType: 'Task', parentStatus: 'DONE' },
    }

    const dep = deps[artifactType]
    if (dep) {
      return {
        requiredParentStatus: [`${dep.parentType} must be in ${dep.parentStatus} status`],
        message: `Creating ${artifactType} requires parent ${dep.parentType} to be ${dep.parentStatus}`,
      }
    }

    return { requiredParentStatus: [], message: 'No special prerequisites' }
  }

  /**
   * Get FSM context for all artifacts related to a session
   * This is the primary method for SessionStart hook to inject context
   */
  async getSessionContext(
    sessionId: string,
    eventBus: IEventBus
  ): Promise<SessionFSMContext> {
    // Find all artifacts related to this session
    const events = await eventBus.query({
      sessionId,
      types: ['artifact.created', 'artifact.transitioned'] as EventType[],
      limit: 50,
    })

    const artifactIds = new Set<string>()
    for (const event of events) {
      if (event.artifactId) artifactIds.add(event.artifactId)
    }

    // Get FSM snapshots for each artifact
    const snapshots = await Promise.all(
      Array.from(artifactIds).map(id => this.getFSMContext(id))
    )
    const validSnapshots = snapshots.filter(Boolean) as FSMContextSnapshot[]

    // Generate recommendations based on FSM state
    const recommendations = this.generateRecommendations(validSnapshots)

    return {
      sessionId,
      artifacts: validSnapshots,
      recalledLessons: [], // Will be filled by context inject command
      recommendations,
      generatedAt: Date.now(),
    }
  }

  /**
   * Generate actionable recommendations from FSM state
   */
  private generateRecommendations(snapshots: FSMContextSnapshot[]): string[] {
    const recs: string[] = []

    for (const s of snapshots) {
      // Spec needs to be frozen before implementation
      if (s.artifactType === 'Spec' && s.currentStatus === 'REVIEWING') {
        if (s.allowedTransitions.includes('freeze')) {
          recs.push(`Spec ${s.artifactId} is ready to freeze — execute 'scale transition ${s.artifactId} freeze'`)
        } else {
          recs.push(`Spec ${s.artifactId} blocked from freezing: ${s.blockingReasons.join('; ')}`)
        }
      }

      // Plan needs approval before implementation
      if (s.artifactType === 'Plan' && s.currentStatus === 'DRAFT') {
        recs.push(`Plan ${s.artifactId} needs review before implementation`)
      }

      // Task ready to start
      if (s.artifactType === 'Task' && s.currentStatus === 'READY') {
        recs.push(`Task ${s.artifactId} is ready to implement`)
      }

      // Warning for blocked artifacts
      if (s.blockingReasons.length > 0 && s.allowedTransitions.length === 0) {
        recs.push(`⚠️ ${s.artifactId} (${s.artifactType}) is blocked in ${s.currentStatus}`)
      }
    }

    return recs
  }

async injectFSMContextToPrompt(prompt: string, artifactIds: string[]): Promise<string> {
    if (artifactIds.length === 0) return prompt

    const snapshots = await Promise.all(
      artifactIds.map(id => this.getFSMContext(id))
    )

    const validSnapshots = snapshots.filter(Boolean) as FSMContextSnapshot[]
    if (validSnapshots.length === 0) return prompt

    const fsmBlock = this.formatFSMBlock(validSnapshots)

    // 插入到 prompt 的合适位置
    const insertPoints = ['<context_summary>', '## Task', '## Context', '## 上下文']
    for (const point of insertPoints) {
      if (prompt.includes(point)) {
        return prompt.replace(point, fsmBlock + '\n' + point)
      }
    }

    // 如果找不到合适位置，添加到末尾
    return prompt + '\n' + fsmBlock
  }

  private async calculateDownstreamImpact(artifact: Artifact): Promise<string[]> {
    const children = await this.store.findChildren(artifact.id)
    return children.map(c => `${c.id} (${c.type}:${c.status})`)
  }

  private formatFSMBlock(snapshots: FSMContextSnapshot[]): string {
    const lines = snapshots.map(s => {
      const allowed = s.allowedTransitions.length > 0 ? s.allowedTransitions.join(', ') : 'none'
      const blocked = s.blockingReasons.length > 0 ? s.blockingReasons.slice(0, 3).join('; ') : 'none'
      const impact = s.downstreamImpact.length > 0 ? `${s.downstreamImpact.length} children` : 'none'
      
      return `### ${s.artifactId} (${s.artifactType})
- Status: **${s.currentStatus}**
- Allowed actions: ${allowed}
- Blocked: ${blocked}
- Downstream impact: ${impact}
- Parent: ${s.parentStatus ?? 'none'}
- Children: ${s.childrenStatuses.length > 0 ? s.childrenStatuses.join(', ') : 'none'}`
    })

    return `\n## FSM Status Constraints

${lines.join('\n\n')}

> **Important**: Only execute actions listed in "Allowed actions". Blocked actions require resolving constraints first.
`
  }
}
