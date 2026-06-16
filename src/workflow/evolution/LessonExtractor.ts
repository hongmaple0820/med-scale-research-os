// SCALE Engine — Lesson Extractor
// 从会话 Defect 事件提取可复用的 Lessons
// 设计参考：docs/03-CORE-MODULES.md §3.6 + L6 Evolution

import type { IEventBus } from '../../core/eventBus.js'
import type { Artifact, LessonPayload, DefectPayload } from '../../artifact/types.js'

// Alias types for convenience - use Artifact with unknown payload to avoid strict type checking
type Lesson = Artifact
type Defect = Artifact

/**
 * Lesson 提取候选
 */
export interface LessonCandidate {
  pattern: string // 问题模式描述
  solution: string // 解决方案
  context: string // 上下文（何时适用）
  defectIds: string[] // 关联的 Defect IDs
  frequency: number // 出现频率
  verified: boolean // 是否经过验证
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
}

/**
 * Defect 分析结果
 */
export interface DefectAnalysis {
  defectId: string
  rootCause: string
  resolutionSteps: string[]
  timeToFix: number // 毫秒
  attempts: number // 尝试次数
  patternsIdentified: string[]
}

/**
 * Lesson Extractor
 *
 * 从会话历史中提取可复用的 Lessons：
 * 1. 查询 defect.opened 事件
 * 2. 分析修复过程和根因
 * 3. 提取 pattern-solution 对
 * 4. 聚合高频模式
 * 5. 生成 Lesson Candidates
 */
export class LessonExtractor {
  private eventBus: IEventBus
  private minOccurrences: number = 2 // 成为 Lesson 的最小出现次数

  constructor(eventBus: IEventBus, minOccurrences: number = 2) {
    this.eventBus = eventBus
    this.minOccurrences = minOccurrences
  }

  /**
   * 从会话提取 Lessons
   */
  async extractFromSession(sessionId: string): Promise<LessonCandidate[]> {
    this.eventBus.emit('lesson.extract.start', { sessionId })

    // 1. 查询 defect 相关事件
    const defectEvents = await this.eventBus.query({
      sessionId,
      types: ['defect.opened', 'defect.resolved'],
      limit: 50
    })

    if (defectEvents.length === 0) {
      this.eventBus.emit('lesson.extract.empty', { sessionId })
      return []
    }

    // 2. 分析每个 Defect
    const analyses: DefectAnalysis[] = []
    for (const defectEvent of defectEvents.filter(e => e.type === 'defect.opened')) {
      const analysis = await this.analyzeDefect(sessionId, defectEvent)
      if (analysis) {
        analyses.push(analysis)
      }
    }

    // 3. 提取 Patterns
    const patterns = this.identifyPatterns(analyses)

    // 4. 聚合为 Lesson Candidates
    const candidates = this.aggregateToLessons(patterns, analyses)

    this.eventBus.emit('lesson.extract.end', {
      sessionId,
      defectsAnalyzed: analyses.length,
      candidatesGenerated: candidates.length
    })

    return candidates
  }

  /**
   * 分析单个 Defect
   */
  private async analyzeDefect(sessionId: string, defectEvent: { payload: unknown }): Promise<DefectAnalysis | null> {
    const defect = defectEvent.payload as Defect
    if (!defect?.id) return null

    // 查询该 defect 的修复过程
    const fixEvents = await this.eventBus.query({
      sessionId,
      types: ['tool.completed', 'tool.failed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args: { file_path?: string } }
        // 查找与缺陷修复相关的工具调用
        return ['Edit', 'Write', 'Bash'].includes(p.tool)
      },
      limit: 20
    })

    // 计算修复时间和尝试次数
    const openedAt = defect.createdAt ?? Date.now()
    const resolvedEvents = await this.eventBus.query({
      sessionId,
      types: ['defect.resolved'],
      filter: (e) => {
        const p = e.payload as { defectId?: string }
        return p.defectId === defect.id
      },
      limit: 1
    })

    const resolvedAt = resolvedEvents[0]?.timestamp ?? Date.now()
    const timeToFix = resolvedAt - openedAt

    // 分析根因
    const rootCause = this.inferRootCause(defect, fixEvents)
    const resolutionSteps = this.extractResolutionSteps(fixEvents)

    // 识别模式
    const patternsIdentified = this.extractPatternsFromFix(rootCause, resolutionSteps)

    return {
      defectId: defect.id,
      rootCause,
      resolutionSteps,
      timeToFix,
      attempts: fixEvents.filter(e => e.type === 'tool.failed').length + 1,
      patternsIdentified
    }
  }

  /**
   * 推断根因
   */
  private inferRootCause(defect: Defect, fixEvents: { payload: unknown }[]): string {
    // 从缺陷 payload 和修复历史推断根因
    const payload = defect.payload as unknown as DefectPayload
    const symptom = payload?.symptom ?? ''
    const title = defect.title ?? ''

    // 常见根因模式
    if (symptom.includes('undefined') || symptom.includes('null')) {
      return 'Missing null check or initialization'
    }
    if (symptom.includes('type') || symptom.includes('TypeScript')) {
      return 'Type mismatch or incorrect type definition'
    }
    if (symptom.includes('async') || symptom.includes('await')) {
      return 'Async/await handling issue'
    }
    if (symptom.includes('import') || symptom.includes('module')) {
      return 'Missing or incorrect import'
    }
    if (symptom.includes('test') && fixEvents.some(e => {
      const p = e.payload as { args?: { command?: string } }
      return p.args?.command?.includes('test')
    })) {
      return 'Test assertion failure or test setup issue'
    }

    // 默认：从标题推断
    return title ?? 'Unknown root cause'
  }

  /**
   * 提取修复步骤
   */
  private extractResolutionSteps(fixEvents: { payload: unknown }[]): string[] {
    const steps: string[] = []

    for (const event of fixEvents) {
      const p = event.payload as { tool?: string; args?: { file_path?: string; command?: string } }

      if (p.tool === 'Edit' && p.args?.file_path) {
        steps.push(`Edit ${p.args.file_path}`)
      }
      if (p.tool === 'Write' && p.args?.file_path) {
        steps.push(`Write ${p.args.file_path}`)
      }
      if (p.tool === 'Bash' && p.args?.command) {
        steps.push(`Run: ${p.args.command}`)
      }
    }

    return steps
  }

  /**
   * 从修复过程提取模式
   */
  private extractPatternsFromFix(rootCause: string, steps: string[]): string[] {
    const patterns: string[] = []

    // 根因到模式的映射
    const rootCausePatterns: Record<string, string> = {
      'Missing null check or initialization': 'Always check for null/undefined before accessing properties',
      'Type mismatch or incorrect type definition': 'Use strict type checking and avoid type assertions',
      'Async/await handling issue': 'Always await async operations and handle promise errors',
      'Missing or incorrect import': 'Verify imports before using; check module exports',
      'Test assertion failure or test setup issue': 'Ensure test data and mocks are properly initialized'
    }

    if (rootCausePatterns[rootCause]) {
      patterns.push(rootCausePatterns[rootCause])
    }

    // 从修复步骤提取模式
    for (const step of steps) {
      if (step.includes('Edit') && patterns.length === 0) {
        patterns.push(`Fix involved: ${step}`)
      }
    }

    return patterns
  }

  /**
   * 识别重复模式
   */
  private identifyPatterns(analyses: DefectAnalysis[]): Map<string, DefectAnalysis[]> {
    const patternMap = new Map<string, DefectAnalysis[]>()

    for (const analysis of analyses) {
      for (const pattern of analysis.patternsIdentified) {
        const existing = patternMap.get(pattern) ?? []
        existing.push(analysis)
        patternMap.set(pattern, existing)
      }
    }

    return patternMap
  }

  /**
   * 聚合为 Lesson Candidates
   */
  private aggregateToLessons(
    patternMap: Map<string, DefectAnalysis[]>,
    analyses: DefectAnalysis[]
  ): LessonCandidate[] {
    const candidates: LessonCandidate[] = []

    for (const [pattern, relatedAnalyses] of patternMap.entries()) {
      // 只有高频模式才成为 Lesson
      if (relatedAnalyses.length < this.minOccurrences) continue

      // 生成解决方案
      const solutions = relatedAnalyses.map(a => a.resolutionSteps.join(' → '))
      const commonSolution = this.findCommonSolution(solutions)

      // 计算优先级
      const avgTimeToFix = relatedAnalyses.reduce((sum, a) => sum + a.timeToFix, 0) / relatedAnalyses.length
      const totalAttempts = relatedAnalyses.reduce((sum, a) => sum + a.attempts, 0)

      const priority = avgTimeToFix > 300000 || totalAttempts > 5 ? 'HIGH'
        : avgTimeToFix > 60000 || totalAttempts > 2 ? 'MEDIUM'
        : 'LOW'

      candidates.push({
        pattern,
        solution: commonSolution,
        context: this.generateContext(pattern, relatedAnalyses),
        defectIds: relatedAnalyses.map(a => a.defectId),
        frequency: relatedAnalyses.length,
        verified: false, // 需要后续验证
        priority
      })
    }

    // 按频率和优先级排序
    return candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === 'HIGH' ? -1 : 1
      }
      return b.frequency - a.frequency
    })
  }

  /**
   * 找到共同解决方案
   */
  private findCommonSolution(solutions: string[]): string {
    if (solutions.length === 0) return 'No solution found'
    if (solutions.length === 1) return solutions[0]

    // 找出最短的共同路径
    const steps = solutions[0].split(' → ')
    const commonSteps: string[] = []

    for (const step of steps) {
      if (solutions.every(s => s.includes(step))) {
        commonSteps.push(step)
      }
    }

    return commonSteps.length > 0 ? commonSteps.join(' → ') : solutions[0]
  }

  /**
   * 生成上下文描述
   */
  private generateContext(pattern: string, analyses: DefectAnalysis[]): string {
    const avgFixTime = Math.round(analyses.reduce((s, a) => s + a.timeToFix, 0) / analyses.length / 1000)

    return `This pattern occurred ${analyses.length} times with average fix time of ${avgFixTime}s. ` +
           `Apply when: ${pattern}`
  }

  /**
   * 转换为 Lesson Artifact
   */
  toLessonArtifact(candidate: LessonCandidate): Lesson {
    const lessonPayload: LessonPayload = {
      type: 'lesson',
    } as LessonPayload

    return {
      id: `lesson-${Date.now()}-${candidate.defectIds[0]}`,
      type: 'Lesson',
      version: 1,
      title: candidate.pattern,
      status: candidate.verified ? 'VERIFIED' : 'DRAFT',
      statusHistory: [],
      parents: [],
      children: [],
      contentRef: '',
      payload: lessonPayload,
      gates: [],
      createdBy: { kind: 'system', component: 'LessonExtractor' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [`priority:${candidate.priority}`, `frequency:${candidate.frequency}`],
      labels: {},
    }
  }

  /**
   * 批量转换
   */
  toLessonArtifacts(candidates: LessonCandidate[]): Lesson[] {
    return candidates.map(c => this.toLessonArtifact(c))
  }
}

/**
 * 从多个会话聚合 Lessons
 */
export async function aggregateLessonsFromSessions(
  eventBus: IEventBus,
  sessionIds: string[]
): Promise<LessonCandidate[]> {
  const extractor = new LessonExtractor(eventBus)
  const allCandidates: LessonCandidate[] = []

  for (const sessionId of sessionIds) {
    const candidates = await extractor.extractFromSession(sessionId)
    allCandidates.push(...candidates)
  }

  // 聚合相同模式的候选
  const patternCounts = new Map<string, LessonCandidate[]>()

  for (const candidate of allCandidates) {
    const existing = patternCounts.get(candidate.pattern) ?? []
    existing.push(candidate)
    patternCounts.set(candidate.pattern, existing)
  }

  // 合并高频模式
  const merged: LessonCandidate[] = []

  for (const [pattern, candidates] of patternCounts.entries()) {
    const totalFrequency = candidates.reduce((s, c) => s + c.frequency, 0)
    const allDefectIds = candidates.flatMap(c => c.defectIds)

    merged.push({
      pattern,
      solution: candidates[0].solution,
      context: candidates[0].context,
      defectIds: allDefectIds,
      frequency: totalFrequency,
      verified: candidates.some(c => c.verified),
      priority: candidates.some(c => c.priority === 'HIGH') ? 'HIGH'
        : candidates.some(c => c.priority === 'MEDIUM') ? 'MEDIUM'
        : 'LOW'
    })
  }

  return merged.sort((a, b) => b.frequency - a.frequency)
}