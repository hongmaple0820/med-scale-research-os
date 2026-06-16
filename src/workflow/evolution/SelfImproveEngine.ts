// SCALE Engine — Self-Improve Engine
// Defect → Lesson → Rule → Hook 自改进闭环
// 设计参考：docs/03-CORE-MODULES.md §3.6 + L6 Evolution

import type { IEventBus } from '../../core/eventBus.js'
import type { Artifact, LessonPayload } from '../../artifact/types.js'
import { LessonExtractor, type LessonCandidate } from './LessonExtractor.js'

// Alias types for convenience
type Lesson = Artifact<'Lesson'>
type Rule = Artifact<'Rule'>

/**
 * Hook 配置格式（用于 settings.json）
 */
interface HookConfig {
  matcher: string
  command: string
  description?: string
  timeout?: number
}

/**
 * 自改进闭环状态
 */
export interface SelfImproveState {
  lessonsExtracted: number
  lessonsVerified: number
  rulesCreated: number
  rulesActive: number
  hooksGenerated: number
  lastRunAt: number
}

/**
 * Rule 候选
 */
export interface RuleCandidate {
  id: string
  name: string
  pattern: RegExp | string
  severity: 'block' | 'warn' | 'info'
  description: string
  remediation: string
  lessonId: string
  hitCount: number
  lastHitAt: number
  active: boolean
}

/**
 * Hook 生成结果
 */
export interface HookGenerationResult {
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop'
  matcher: string
  command: string
  description: string
  ruleId: string
}

/**
 * 自改进阈值配置
 */
export interface SelfImproveThresholds {
  lessonVerificationThreshold: number // Lesson 成为 Verified 需要的验证次数
  ruleActivationThreshold: number // Rule 成为 Active 需要的触发次数
  hookGenerationThreshold: number // Hook 自动生成的触发次数阈值
  maxHooks: number // 最大生成的 Hooks 数量
}

/**
 * Self-Improve Engine
 *
 * 实现自改进闭环：
 * 1. Defect → Lesson: 从缺陷提取可复用教训
 * 2. Lesson → Rule: 经过验证的教训转化为规则
 * 3. Rule → Hook: 高频规则转化为自动化 Hook
 *
 * 闭环流程：
 * - Lesson 需要 verified 3 次才能晋升为 Rule Candidate
 * - Rule 需要 hit 10 换才能晋升为 Hook Candidate
 * - Hook 生成后自动注册到 Gateway
 */
export class SelfImproveEngine {
  private eventBus: IEventBus
  private lessonExtractor: LessonExtractor
  private thresholds: SelfImproveThresholds
  private state: SelfImproveState

  // 存储候选
  private lessonCandidates: Map<string, LessonCandidate> = new Map()
  private ruleCandidates: Map<string, RuleCandidate> = new Map()
  private generatedHooks: HookGenerationResult[] = []

  constructor(
    eventBus: IEventBus,
    thresholds?: Partial<SelfImproveThresholds>
  ) {
    this.eventBus = eventBus
    this.thresholds = {
      lessonVerificationThreshold: 3,
      ruleActivationThreshold: 10,
      hookGenerationThreshold: 20,
      maxHooks: 10,
      ...thresholds
    }
    this.lessonExtractor = new LessonExtractor(eventBus, 2)
    this.state = {
      lessonsExtracted: 0,
      lessonsVerified: 0,
      rulesCreated: 0,
      rulesActive: 0,
      hooksGenerated: 0,
      lastRunAt: 0
    }
  }

  /**
   * 运行自改进闭环
   */
  async run(sessionId: string): Promise<SelfImproveState> {
    this.eventBus.emit('self-improve.start', { sessionId, thresholds: this.thresholds })
    const startTime = Date.now()

    // Phase 1: Extract Lessons from Defects
    const lessons = await this.extractLessons(sessionId)

    // Phase 2: Verify and Promote Lessons to Rules
    const rules = await this.verifyAndPromoteLessons(lessons)

    // Phase 3: Activate Rules and Track Hits
    const activeRules = await this.activateRules(rules)

    // Phase 4: Generate Hooks from High-Frequency Rules
    const hooks = await this.generateHooksFromRules(activeRules)

    // 更新状态
    this.state = {
      lessonsExtracted: lessons.length,
      lessonsVerified: this.lessonCandidates.size,
      rulesCreated: rules.length,
      rulesActive: activeRules.length,
      hooksGenerated: hooks.length,
      lastRunAt: startTime
    }

    this.eventBus.emit('self-improve.end', {
      sessionId,
      state: this.state,
      durationMs: Date.now() - startTime
    })

    return this.state
  }

  /**
   * Phase 1: 从会话提取 Lessons
   */
  private async extractLessons(sessionId: string): Promise<LessonCandidate[]> {
    this.eventBus.emit('self-improve.phase.extract', { sessionId })

    const candidates = await this.lessonExtractor.extractFromSession(sessionId)

    // 存储候选
    for (const candidate of candidates) {
      const existing = this.lessonCandidates.get(candidate.pattern) ?? candidate
      existing.frequency += candidate.frequency
      existing.defectIds.push(...candidate.defectIds)
      this.lessonCandidates.set(candidate.pattern, existing)
    }

    return candidates
  }

  /**
   * Phase 2: 验证并晋升 Lessons 为 Rules
   */
  private async verifyAndPromoteLessons(candidates: LessonCandidate[]): Promise<RuleCandidate[]> {
    this.eventBus.emit('self-improve.phase.verify', { candidatesCount: candidates.length })

    const rules: RuleCandidate[] = []

    for (const [pattern, candidate] of this.lessonCandidates.entries()) {
      // 检查是否达到验证阈值
      if (candidate.frequency >= this.thresholds.lessonVerificationThreshold) {
        candidate.verified = true

        // 创建 Rule Candidate
        const ruleCandidate = this.createRuleCandidate(candidate)
        this.ruleCandidates.set(ruleCandidate.id, ruleCandidate)
        rules.push(ruleCandidate)

        this.eventBus.emit('self-improve.lesson.promoted', {
          pattern,
          ruleId: ruleCandidate.id
        })
      }
    }

    return rules
  }

  /**
   * 创建 Rule Candidate
   */
  private createRuleCandidate(lesson: LessonCandidate): RuleCandidate {
    return {
      id: `rule-${Date.now()}-${lesson.defectIds[0]}`,
      name: lesson.pattern.slice(0, 50).replace(/\s+/g, '-').toLowerCase(),
      pattern: this.patternToRegExp(lesson.pattern),
      severity: lesson.priority === 'HIGH' ? 'block' : lesson.priority === 'MEDIUM' ? 'warn' : 'info',
      description: lesson.pattern,
      remediation: lesson.solution,
      lessonId: lesson.defectIds[0],
      hitCount: 0,
      lastHitAt: 0,
      active: false
    }
  }

  /**
   * 将模式字符串转换为 RegExp
   */
  private patternToRegExp(pattern: string): RegExp {
    // 常见模式的 RegExp 转换
    const patternMappings: Record<string, RegExp> = {
      'Missing null check': /\?\s*\.\s*\w+|undefined\s*\.\s*\w+/,
      'Async/await handling': /async\s+\w+\s*\([^)]*\)\s*\{[^}]*\breturn\b[^}]*\}/,
      'Type mismatch': /as\s+any|:\s*any\b|@ts-ignore/,
      'Missing import': /import\s+.*from\s+['"]undefined['"]|^.*\b\w+\b.*\n.*\b\w+\s*\(/,
    }

    // 尝试匹配已知模式
    for (const [key, regex] of Object.entries(patternMappings)) {
      if (pattern.includes(key)) {
        return regex
      }
    }

    // 默认：创建简单文本匹配
    const safePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)
    return new RegExp(safePattern, 'i')
  }

  /**
   * Phase 3: 激活 Rules 并跟踪触发次数
   */
  private async activateRules(rules: RuleCandidate[]): Promise<RuleCandidate[]> {
    this.eventBus.emit('self-improve.phase.activate', { rulesCount: rules.length })

    const activeRules: RuleCandidate[] = []

    // 检查现有规则的触发历史
    for (const [id, rule] of this.ruleCandidates.entries()) {
      // 查询历史触发次数（通过 eventBus）
      const hits = await this.eventBus.query({
        types: ['rule.hit'],
        filter: (e) => {
          const p = e.payload as { ruleId?: string }
          return p.ruleId === id
        },
        limit: 100
      })

      rule.hitCount = hits.length
      rule.lastHitAt = hits[0]?.timestamp ?? 0

      // 达到阈值则激活
      if (rule.hitCount >= this.thresholds.ruleActivationThreshold) {
        rule.active = true
        activeRules.push(rule)

        this.eventBus.emit('self-improve.rule.activated', {
          ruleId: id,
          hitCount: rule.hitCount
        })
      }
    }

    return activeRules
  }

  /**
   * Phase 4: 从高频 Rules 生成 Hooks
   */
  private async generateHooksFromRules(rules: RuleCandidate[]): Promise<HookGenerationResult[]> {
    this.eventBus.emit('self-improve.phase.hooks', { activeRulesCount: rules.length })

    const hooks: HookGenerationResult[] = []

    for (const rule of rules) {
      // 检查是否达到 Hook 生成阈值
      if (rule.hitCount >= this.thresholds.hookGenerationThreshold && this.generatedHooks.length < this.thresholds.maxHooks) {
        const hook = this.generateHookFromRule(rule)
        hooks.push(hook)
        this.generatedHooks.push(hook)

        this.eventBus.emit('self-improve.hook.generated', {
          hookType: hook.hookType,
          ruleId: rule.id,
          matcher: hook.matcher
        })
      }
    }

    return hooks
  }

  /**
   * 从 Rule 生成 Hook 配置
   */
  private generateHookFromRule(rule: RuleCandidate): HookGenerationResult {
    // 确定 Hook 类型
    const hookType: 'PreToolUse' | 'PostToolUse' | 'Stop' = rule.severity === 'block' ? 'PreToolUse' : 'PostToolUse'

    // 确定 Matcher
    const matcher = rule.severity === 'block' ? 'Write|Edit|MultiEdit' : 'Write|Edit'

    // 生成检查命令
    const command = this.generateHookCommand(rule)

    return {
      hookType,
      matcher,
      command,
      description: `Auto-generated from rule: ${rule.name}`,
      ruleId: rule.id
    }
  }

  /**
   * 生成 Hook 检查命令
   */
  private generateHookCommand(rule: RuleCandidate): string {
    // 生成 Node.js 检查脚本
    const script = `
const pattern = ${rule.pattern.toString()};
const content = process.argv[2] || '';
const matches = content.match(pattern);
if (matches) {
  console.error('[RULE: ${rule.name}] ${rule.description}');
  console.error('Remediation: ${rule.remediation}');
  process.exit(${rule.severity === 'block' ? '1' : '0'});
}
process.exit(0);
`

    return `node -e "${script.replace(/\n/g, ' ').replace(/"/g, '\\"')}" "$CONTENT"`
  }

  /**
   * 获取生成的 Hooks 配置（用于注册到 settings.json）
   */
  getGeneratedHooksConfig(): Record<string, HookConfig[]> {
    const hooks: Record<string, HookConfig[]> = {
      PreToolUse: [],
      PostToolUse: [],
      Stop: []
    }

    for (const hook of this.generatedHooks) {
      hooks[hook.hookType].push({
        matcher: hook.matcher,
        command: hook.command,
        description: hook.description,
        timeout: 5000
      })
    }

    return hooks
  }

  /**
   * 记录 Rule 触发（用于跟踪）
   */
  recordRuleHit(ruleId: string): void {
    const rule = this.ruleCandidates.get(ruleId)
    if (rule) {
      rule.hitCount++
      rule.lastHitAt = Date.now()
      this.eventBus.emit('rule.hit', { ruleId, hitCount: rule.hitCount })
    }
  }

  /**
   * 获取当前状态
   */
  getState(): SelfImproveState {
    return this.state
  }

  /**
   * 获取所有 Lesson Candidates
   */
  getLessonCandidates(): LessonCandidate[] {
    return Array.from(this.lessonCandidates.values())
  }

  /**
   * 获取所有 Rule Candidates
   */
  getRuleCandidates(): RuleCandidate[] {
    return Array.from(this.ruleCandidates.values())
  }

  /**
   * 获取所有生成的 Hooks
   */
  getGeneratedHooks(): HookGenerationResult[] {
    return this.generatedHooks
  }

  /**
   * 生成自改进报告
   */
  generateReport(): string {
    const lines: string[] = [
      '=== Self-Improve Engine Report ===',
      '',
      '[STATE]',
      `  Lessons Extracted: ${this.state.lessonsExtracted}`,
      `  Lessons Verified: ${this.state.lessonsVerified}`,
      `  Rules Created: ${this.state.rulesCreated}`,
      `  Rules Active: ${this.state.rulesActive}`,
      `  Hooks Generated: ${this.state.hooksGenerated}`,
      '',
      '[TOP LESSONS]',
      ...this.getLessonCandidates().slice(0, 5).map(l =>
        `  - ${l.pattern} (${l.frequency} occurrences, ${l.priority})`
      ),
      '',
      '[ACTIVE RULES]',
      ...this.getRuleCandidates().filter(r => r.active).map(r =>
        `  - ${r.name} (${r.hitCount} hits)`
      ),
      '',
      '[GENERATED HOOKS]',
      ...this.generatedHooks.map(h =>
        `  - ${h.hookType}: ${h.matcher} (${h.description})`
      ),
      ''
    ]

    return lines.join('\n')
  }

  /**
   * 重置引擎状态
   */
  reset(): void {
    this.lessonCandidates.clear()
    this.ruleCandidates.clear()
    this.generatedHooks = []
    this.state = {
      lessonsExtracted: 0,
      lessonsVerified: 0,
      rulesCreated: 0,
      rulesActive: 0,
      hooksGenerated: 0,
      lastRunAt: 0
    }
    this.eventBus.emit('self-improve.reset', {})
  }
}

/**
 * 手动验证 Lesson（用于外部确认）
 */
export async function verifyLesson(
  engine: SelfImproveEngine,
  pattern: string
): Promise<void> {
  const candidates = engine.getLessonCandidates()
  const candidate = candidates.find(c => c.pattern === pattern)

  if (candidate) {
    candidate.verified = true
    candidate.frequency += 1

    // 检查是否达到阈值晋升
    if (candidate.frequency >= engine.getState().lessonsVerified) {
      // 触发晋升流程
      engine.recordRuleHit(`lesson-${pattern}`)
    }
  }
}

/**
 * 从多个会话运行自改进
 */
export async function runSelfImproveFromSessions(
  eventBus: IEventBus,
  sessionIds: string[]
): Promise<SelfImproveState[]> {
  const engine = new SelfImproveEngine(eventBus)
  const states: SelfImproveState[] = []

  for (const sessionId of sessionIds) {
    const state = await engine.run(sessionId)
    states.push(state)
  }

  return states
}