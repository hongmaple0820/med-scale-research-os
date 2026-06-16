// SCALE Engine — Evolution Layer (W7)
// 4 级自进化：Defect → Lesson → Rule → Hook
// 设计参考：docs/01-ARCHITECTURE.md §二 L6

import type { IEventBus } from '../core/eventBus.js'
import type { IKnowledgeBase } from '../knowledge/KnowledgeBase.js'
import type { IArtifactStore } from '../artifact/store.js'
import type { ArtifactId, KnowledgeEntry } from '../artifact/types.js'
import { logger } from '../core/logger.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { approveRuleMaturity, createShadowRuleMaturity, type RuleMaturityRecord } from './RuleMaturity.js'

// ============================================================================
// Types
// ============================================================================

export interface ProposedRule {
  id: string
  title: string
  description: string
  sourceLesson: string
  pattern: string       // what to check
  enforcement: 'prompt' | 'hook'
  createdAt: number
  approved: boolean
  approvedBy?: string
  maturity: RuleMaturityRecord
}

export interface GeneratedHook {
  id: string
  ruleId: string
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop'
  matcher: string
  scriptPath: string
  createdAt: number
}

export interface EvolutionStats {
  lessonsExtracted: number
  rulesProposed: number
  shadowRules: number
  rulesApproved: number
  hooksGenerated: number
}

// ============================================================================
// LessonExtractor — 从 Defect 中提炼 Lesson
// ============================================================================

export interface ILessonExtractor {
  extract(defectId: ArtifactId): Promise<KnowledgeEntry | null>
  scanForPatterns(): Promise<KnowledgeEntry[]>
}

export class LessonExtractor implements ILessonExtractor {
  constructor(
    private store: IArtifactStore,
    private kb: IKnowledgeBase,
    private eventBus: IEventBus,
  ) {}

  /**
   * 从已关闭的 Defect 中提取 Lesson
   * Gate 1: Defect 必须在 DIAGNOSED/FIXED/CLOSED 状态
   * Gate 2: 必须有 rootCauseCategory
   * Gate 3: 不重复（标题相似度检查）
   */
  async extract(defectId: ArtifactId): Promise<KnowledgeEntry | null> {
    const defect = await this.store.get(defectId)
    if (!defect) return null

    // Gate 1: 状态检查
    if (!['DIAGNOSED', 'FIXED', 'CLOSED'].includes(defect.status)) {
      logger.debug({ defectId, status: defect.status }, 'Defect not ready for lesson extraction')
      return null
    }

    // Gate 2: 根因检查
    const payload = defect.payload as Record<string, unknown>
    const rootCause = payload.rootCauseCategory as string | undefined
    if (!rootCause || rootCause === 'unknown') {
      logger.debug({ defectId }, 'Defect has no root cause')
      return null
    }

    // Gate 3: 去重
    const title = `[${rootCause}] ${defect.title}`
    const existing = await this.kb.recall({ tags: [rootCause] })
    const isDupe = existing.some((e) => this.similarity(e.title, title) > 0.85)
    if (isDupe) {
      logger.debug({ defectId, title }, 'Similar lesson already exists — skipping')
      return null
    }

    // 创建 Lesson
    const entry = await this.kb.add({
      type: 'lesson',
      title,
      tags: [rootCause, defect.type, ...(payload.tags as string[] ?? [])],
      contentRef: `lessons/${defectId}.md`,
      verified: false,
      sourceArtifact: defectId,
    })

    this.eventBus.emit('lesson.proposed', {
      lessonId: entry.id,
      defectId,
      rootCause,
      title,
    })

    logger.info({ lessonId: entry.id, defectId }, 'Lesson extracted from defect')
    return entry
  }

  /**
   * 扫描所有已关闭的 Defect，批量提取 lessons
   */
  async scanForPatterns(): Promise<KnowledgeEntry[]> {
    const defects = await this.store.query({ type: 'Defect' })
    const closedDefects = defects.filter((d) =>
      ['DIAGNOSED', 'FIXED', 'CLOSED'].includes(d.status)
    )

    const extracted: KnowledgeEntry[] = []
    for (const defect of closedDefects) {
      const lesson = await this.extract(defect.id)
      if (lesson) extracted.push(lesson)
    }

    // 检测重复模式：同类根因出现 ≥3 次 → 标记为高优先
    const causeCount = new Map<string, number>()
    for (const d of closedDefects) {
      const cause = (d.payload as Record<string, unknown>).rootCauseCategory as string
      if (cause) causeCount.set(cause, (causeCount.get(cause) ?? 0) + 1)
    }

    for (const [cause, count] of causeCount) {
      if (count >= 3) {
        logger.warn({ cause, count }, 'Recurring defect pattern detected — consider promoting to Rule')
      }
    }

    return extracted
  }

  private similarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/))
    const setB = new Set(b.toLowerCase().split(/\s+/))
    const intersection = [...setA].filter((w) => setB.has(w))
    return intersection.length / Math.max(setA.size, setB.size)
  }
}

// ============================================================================
// RuleProposer — 从 Lesson 提议 Rule
// ============================================================================

export interface IRuleProposer {
  proposeFromLesson(lessonId: string): Promise<ProposedRule | null>
  scanAndPropose(): Promise<ProposedRule[]>
  approve(ruleId: string, approvedBy: string): Promise<ProposedRule>
  getProposedRules(): ProposedRule[]
  writeRuleFile(rule: ProposedRule, rulesDir: string): string
}

export class RuleProposer implements IRuleProposer {
  private rules = new Map<string, ProposedRule>()
  private seq = 0

  constructor(
    private kb: IKnowledgeBase,
    private eventBus: IEventBus,
  ) {}

  async proposeFromLesson(lessonId: string): Promise<ProposedRule | null> {
    const lessons = await this.kb.recall({})
    const lesson = lessons.find((l) => l.id === lessonId)
    if (!lesson) return null

    // 只对 verified + active 的 lesson 提议
    if (!lesson.verified) {
      logger.debug({ lessonId }, 'Lesson not verified — cannot propose rule')
      return null
    }

    const ruleId = `RULE-${Date.now()}-${(++this.seq).toString().padStart(3, '0')}`
    const rule: ProposedRule = {
      id: ruleId,
      title: `Rule: ${lesson.title}`,
      description: `Auto-proposed from lesson ${lessonId}. Tags: ${lesson.tags.join(', ')}`,
      sourceLesson: lessonId,
      pattern: lesson.tags[0] ?? 'general',
      enforcement: lesson.accessCount >= 5 ? 'hook' : 'prompt',
      createdAt: Date.now(),
      approved: false,
      maturity: createShadowRuleMaturity({
        ruleId,
        rollback: 'Remove the generated hook and keep the rule as prompt-only guidance.',
        defectEvidenceIds: lesson.sourceArtifact ? [lesson.sourceArtifact] : [],
      }),
    }

    this.rules.set(rule.id, rule)

    this.eventBus.emit('rule.proposed', {
      ruleId: rule.id,
      lessonId,
      enforcement: rule.enforcement,
    })

    logger.info({ ruleId: rule.id, lessonId }, 'Rule proposed from lesson')
    return rule
  }

  async scanAndPropose(): Promise<ProposedRule[]> {
    const lessons = await this.kb.recall({ verifiedOnly: true })
    const proposed: ProposedRule[] = []

    for (const lesson of lessons) {
      // 只对 relevance ≥ 0.6 且 accessCount ≥ 3 的 lesson 自动提议
      if (lesson.relevance >= 0.6 && lesson.accessCount >= 3) {
        const existing = [...this.rules.values()].find((r) => r.sourceLesson === lesson.id)
        if (!existing) {
          const rule = await this.proposeFromLesson(lesson.id)
          if (rule) proposed.push(rule)
        }
      }
    }

    return proposed
  }

  async approve(ruleId: string, approvedBy: string): Promise<ProposedRule> {
    const rule = this.rules.get(ruleId)
    if (!rule) throw new Error(`Rule not found: ${ruleId}`)
    const approvedMaturity = approveRuleMaturity(rule.maturity, approvedBy)
    rule.approved = true
    rule.approvedBy = approvedBy
    rule.maturity = approvedMaturity

    this.eventBus.emit('rule.enforced', { ruleId, approvedBy })
    logger.info({ ruleId, approvedBy }, 'Rule approved')
    return rule
  }

  getProposedRules(): ProposedRule[] {
    return [...this.rules.values()]
  }

  writeRuleFile(rule: ProposedRule, rulesDir: string): string {
    mkdirSync(rulesDir, { recursive: true })
    const filename = `${rule.id}.md`
    const path = join(rulesDir, filename)
    const content = `# ${rule.title}

> Source: ${rule.sourceLesson}
> Enforcement: ${rule.enforcement}
> Approved: ${rule.approved ? `Yes (by ${rule.approvedBy})` : 'Pending'}
> Created: ${new Date(rule.createdAt).toISOString()}

## Description

${rule.description}

## Pattern

\`${rule.pattern}\`
`
    writeFileSync(path, content, 'utf-8')
    return path
  }
}

// ============================================================================
// HookGenerator — 从 Rule 生成 Hook 脚本
// ============================================================================

export interface IHookGenerator {
  generate(rule: ProposedRule, hooksDir: string): GeneratedHook | null
  getGeneratedHooks(): GeneratedHook[]
}

export class HookGenerator implements IHookGenerator {
  private hooks: GeneratedHook[] = []

  constructor(private eventBus: IEventBus) {}

  generate(rule: ProposedRule, hooksDir: string): GeneratedHook | null {
    if (!rule.approved) {
      logger.debug({ ruleId: rule.id }, 'Rule not approved — cannot generate hook')
      return null
    }
    if (rule.maturity && rule.maturity.stage !== 'approved-blocking') {
      logger.debug({ ruleId: rule.id, stage: rule.maturity.stage }, 'Rule is not approved for blocking hook generation')
      return null
    }
    if (rule.enforcement !== 'hook') {
      logger.debug({ ruleId: rule.id }, 'Rule enforcement is prompt, not hook — skipping')
      return null
    }

    mkdirSync(hooksDir, { recursive: true })

    const hookType = this.inferHookType(rule.pattern)
    const matcher = this.inferMatcher(rule.pattern)
    const scriptName = `${rule.id}.sh`
    const scriptPath = join(hooksDir, scriptName)

    // Generate shell script
    const script = `#!/bin/bash
# Auto-generated hook from Rule: ${rule.id}
# Source lesson: ${rule.sourceLesson}
# Pattern: ${rule.pattern}
# Hook type: ${hookType} | Matcher: ${matcher}
#
# This hook was automatically promoted from a recurring lesson.
# Edit with caution — it enforces a hard constraint.

# Read tool input from stdin
INPUT=$(cat)

# Check condition
# TODO: Implement specific check for pattern "${rule.pattern}"
# For now, this is a placeholder that always passes.
echo "Hook ${rule.id} checked (pattern: ${rule.pattern})" >&2
exit 0
`
    writeFileSync(scriptPath, script, 'utf-8')

    const hook: GeneratedHook = {
      id: `HOOK-${Date.now()}`,
      ruleId: rule.id,
      hookType,
      matcher,
      scriptPath,
      createdAt: Date.now(),
    }

    this.hooks.push(hook)

    this.eventBus.emit('hook.generated', {
      hookId: hook.id,
      ruleId: rule.id,
      hookType,
      matcher,
      scriptPath,
    })

    logger.info({ hookId: hook.id, ruleId: rule.id, hookType }, 'Hook generated from rule')
    return hook
  }

  getGeneratedHooks(): GeneratedHook[] {
    return [...this.hooks]
  }

  private inferHookType(pattern: string): 'PreToolUse' | 'PostToolUse' | 'Stop' {
    if (/test|verify|lint|build/i.test(pattern)) return 'Stop'
    if (/edit|write|delete/i.test(pattern)) return 'PreToolUse'
    return 'PostToolUse'
  }

  private inferMatcher(pattern: string): string {
    if (/bash|command|shell/i.test(pattern)) return 'Bash'
    if (/edit|write/i.test(pattern)) return 'Edit|Write|MultiEdit'
    return ''
  }
}

// ============================================================================
// EvolutionEngine — 编排 4 级进化
// ============================================================================

export class EvolutionEngine {
  private eventBus: IEventBus
  constructor(
    private extractor: ILessonExtractor,
    private proposer: IRuleProposer,
    private generator: IHookGenerator,
    eventBus: IEventBus,
    private scaleDir: string = '.scale',
  ) {
    this.eventBus = eventBus
  }

  /**
   * 完整进化周期：
   * 1. 扫描 Defects → 提取 Lessons
   * 2. 扫描 Lessons → 提议 Rules
   * 3. (人审后) 已批准 Rules → 生成 Hooks
   */
  async runCycle(): Promise<EvolutionStats> {
    const stats: EvolutionStats = {
      lessonsExtracted: 0,
      rulesProposed: 0,
      shadowRules: 0,
      rulesApproved: 0,
      hooksGenerated: 0,
    }

    // Step 1: Extract lessons
    const lessons = await this.extractor.scanForPatterns()
    stats.lessonsExtracted = lessons.length

    // Step 2: Propose rules
    const rules = await this.proposer.scanAndPropose()
    stats.rulesProposed = rules.length
    stats.shadowRules = this.proposer.getProposedRules().filter((r) => r.maturity.stage === 'shadow').length

    // Step 3: Generate hooks for approved rules
    const approvedRules = this.proposer.getProposedRules().filter((r) =>
      r.approved && r.enforcement === 'hook' && r.maturity.stage === 'approved-blocking'
    )
    stats.rulesApproved = approvedRules.length

    const hooksDir = join(this.scaleDir, 'hooks')
    for (const rule of approvedRules) {
      const hook = this.generator.generate(rule, hooksDir)
      if (hook) stats.hooksGenerated++
    }

    logger.info(stats, 'Evolution cycle completed')
    this.eventBus.emit('evolution.cycle_completed', stats)
    return stats
  }

  getStats(): EvolutionStats {
    return {
      lessonsExtracted: 0, // Would need persistence
      rulesProposed: this.proposer.getProposedRules().length,
      shadowRules: this.proposer.getProposedRules().filter((r) => r.maturity.stage === 'shadow').length,
      rulesApproved: this.proposer.getProposedRules().filter((r) => r.approved).length,
      hooksGenerated: this.generator.getGeneratedHooks().length,
    }
  }
}

