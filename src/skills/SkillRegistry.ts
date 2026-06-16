// SCALE Engine — Skill Registry (v0.7.0)
// 技能注册表：存储、查询、推荐技能

import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

// ============================================================================
// Types
// ============================================================================

export type SkillDomain = 'context' | 'planning' | 'execution' | 'verification' | 'evolution' | 'deployment' | 'domain'
export type SkillExecutionType = 'cli-command' | 'agent-delegate' | 'mcp-tool' | 'skill-file' | 'builtin-function'
export type SkillTriggerType = 'taskType' | 'phase' | 'detectorTriggered' | 'complexity' | 'keyword' | 'manual' | 'artifactType' | 'artifactStatus'

export interface SkillTrigger {
  type: SkillTriggerType
  value: string | string[]
  weight: number
}

export interface SkillExecution {
  type: SkillExecutionType
  config: {
    command?: string
    agentType?: string
    toolName?: string
    skillPath?: string
    functionName?: string
    parameters?: Record<string, unknown>
  }
  timeout?: number
  retryPolicy?: { maxRetries: number; backoffMs: number }
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  domain: SkillDomain
  triggers: SkillTrigger[]
  execution: SkillExecution
  prerequisites?: string[]
  conflicts?: string[]
  priority: number
  installed: boolean
  installedAt?: number
  source?: string
  frontmatter?: SkillFrontmatterMeta
}

export interface SkillFrontmatterMeta {
  name: string
  'preamble-tier'?: number
  description: string
  'allowed-tools'?: string[]
  triggers?: string[]
  domain?: SkillDomain
  priority?: number
}

export interface SkillRecommendation {
  skillId: string
  priority: number
  reason: string
  triggeredBy: SkillTrigger[]
  executionType: SkillExecutionType
}

export interface SkillTriggerCondition {
  taskType?: string
  phase?: 'explore' | 'plan' | 'implement' | 'verify' | 'evolve'
  detectorTriggered?: string
  complexity?: 'simple' | 'medium' | 'complex'
  keywords?: string[]
  artifactType?: string
  artifactStatus?: string
}

export interface ISkillRegistry {
  register(skill: SkillDefinition): void
  unregister(skillId: string): void
  get(skillId: string): SkillDefinition | undefined
  listAll(domain?: SkillDomain): SkillDefinition[]
  listInstalled(): SkillDefinition[]
  recommend(context: SkillTriggerCondition): SkillRecommendation[]
  evaluateTriggers(skill: SkillDefinition, context: SkillTriggerCondition): { matched: SkillTrigger[]; score: number }
  setInstalled(skillId: string, installed: boolean): void
  getDependencies(skillId: string): SkillDefinition[]
  checkConflicts(skillId: string): string[]
}

// ============================================================================
// SkillRegistry Implementation
// ============================================================================

export class SkillRegistry implements ISkillRegistry {
  private skills = new Map<string, SkillDefinition>()
  private eventBus: IEventBus

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus
  }

  register(skill: SkillDefinition): void {
    if (!skill.id || !skill.name || !skill.execution) {
      throw new Error('Invalid skill definition: missing required fields')
    }
    if (this.skills.has(skill.id) && !skill.installed) {
      logger.warn({ skillId: skill.id }, 'Skill already registered, skipping')
      return
    }
    this.skills.set(skill.id, skill)
    this.eventBus.emit('skill.registered', { skillId: skill.id, domain: skill.domain, installed: skill.installed })
    logger.info({ skillId: skill.id, domain: skill.domain }, 'Skill registered')
  }

  unregister(skillId: string): void {
    const skill = this.skills.get(skillId)
    if (!skill) return
    this.skills.delete(skillId)
    this.eventBus.emit('skill.unregistered', { skillId })
    logger.info({ skillId }, 'Skill unregistered')
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId)
  }

  listAll(domain?: SkillDomain): SkillDefinition[] {
    const all = [...this.skills.values()]
    if (domain) return all.filter(s => s.domain === domain)
    return all.sort((a, b) => b.priority - a.priority)
  }

  listInstalled(): SkillDefinition[] {
    return [...this.skills.values()].filter(s => s.installed).sort((a, b) => b.priority - a.priority)
  }

  recommend(context: SkillTriggerCondition): SkillRecommendation[] {
    const candidates: SkillRecommendation[] = []
    for (const skill of this.skills.values()) {
      if (!skill.installed) continue
      const { matched, score } = this.evaluateTriggers(skill, context)
      if (matched.length > 0 && score > 0.3) {
        const priority = this.calculatePriority(skill, score, context)
        candidates.push({
          skillId: skill.id, priority, reason: this.generateReason(skill, matched),
          triggeredBy: matched, executionType: skill.execution.type,
        })
      }
    }
    return candidates.sort((a, b) => b.priority - a.priority).slice(0, 5)
  }

  evaluateTriggers(skill: SkillDefinition, context: SkillTriggerCondition): { matched: SkillTrigger[]; score: number } {
    const matched: SkillTrigger[] = []
    let totalWeight = 0, matchedWeight = 0
    for (const trigger of skill.triggers) {
      totalWeight += trigger.weight
      if (this.matchesTrigger(trigger, context)) {
        matched.push(trigger)
        matchedWeight += trigger.weight
      }
    }
    return { matched, score: totalWeight > 0 ? matchedWeight / totalWeight : 0 }
  }

  setInstalled(skillId: string, installed: boolean): void {
    const skill = this.skills.get(skillId)
    if (!skill) return
    skill.installed = installed
    skill.installedAt = installed ? Date.now() : undefined
    this.eventBus.emit('skill.installation_changed', { skillId, installed })
  }

  getDependencies(skillId: string): SkillDefinition[] {
    const skill = this.skills.get(skillId)
    if (!skill?.prerequisites) return []
    return skill.prerequisites.map(id => this.skills.get(id)).filter(Boolean) as SkillDefinition[]
  }

  checkConflicts(skillId: string): string[] {
    const skill = this.skills.get(skillId)
    if (!skill?.conflicts) return []
    return skill.conflicts.filter(id => this.skills.get(id)?.installed)
  }

  private matchesTrigger(trigger: SkillTrigger, context: SkillTriggerCondition): boolean {
    switch (trigger.type) {
      case 'taskType':
        return context.taskType === trigger.value || (Array.isArray(trigger.value) && trigger.value.includes(context.taskType ?? ''))
      case 'phase': return context.phase === trigger.value
      case 'detectorTriggered':
        return context.detectorTriggered === trigger.value || (Array.isArray(trigger.value) && trigger.value.includes(context.detectorTriggered ?? ''))
      case 'complexity': return context.complexity === trigger.value
      case 'keyword':
        if (!context.keywords) return false
        const triggerKeywords = Array.isArray(trigger.value) ? trigger.value : [trigger.value]
        return triggerKeywords.some(k => context.keywords!.some(ck => ck.toLowerCase().includes(k.toLowerCase())))
      case 'manual': return false
      default: return false
    }
  }

  private calculatePriority(skill: SkillDefinition, triggerScore: number, context: SkillTriggerCondition): number {
    let priority = skill.priority + triggerScore * 30
    if (context.complexity === 'complex' && skill.domain === 'planning') priority += 10
    if (context.phase === 'verify' && skill.domain === 'verification') priority += 15
    if (context.phase === 'implement' && skill.domain === 'execution') priority += 15
    if (context.detectorTriggered && skill.domain === 'verification') priority += 20
    return Math.min(100, Math.max(0, priority))
  }

  private generateReason(skill: SkillDefinition, matched: SkillTrigger[]): string {
    const triggerNames = matched.map(t => t.type).join(', ')
    return matched.length === 1 ? `${skill.name} 触发条件匹配: ${triggerNames}` : `${skill.name} 多条件匹配: ${triggerNames} (${matched.length} 个触发器)`
  }

  registerBatch(skills: SkillDefinition[]): void { for (const skill of skills) this.register(skill) }

  /** Register a domain-specific skill (site-level selectors/flows) */
  registerDomainSkill(domain: string, skill: { selectors: Record<string, string>; flows: Array<{ name: string; steps: unknown[] }> }): void {
    const hash = Buffer.from(domain).toString('hex').slice(0, 16)
    this.skills.set(`domain:${hash}`, {
      id: `domain:${hash}`,
      name: `Site skill for ${domain}`,
      description: `Domain-specific selectors and flows for ${domain}`,
      domain: 'domain',
      triggers: [],
      execution: {
        type: 'builtin-function',
        config: {
          functionName: 'applyDomainSkill',
          parameters: skill as unknown as Record<string, unknown>,
        },
      },
      priority: 60,
      installed: true,
    })
  }

  clear(): void { this.skills.clear(); this.eventBus.emit('skills.cleared', { clearedAt: Date.now() }) }

  async loadFromFrontmatter(dir: string): Promise<number> {
    const { scanFrontmatterSkills } = await import('./SkillFrontmatter.js')
    const scanned = scanFrontmatterSkills(dir)
    let count = 0
    for (const { definition } of scanned) {
      if (!this.skills.has(definition.id)) {
        this.register(definition)
        count++
      }
    }
    return count
  }
}
