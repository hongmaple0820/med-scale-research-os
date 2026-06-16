// SCALE Engine — Skill Creator
// Purpose: Convert verified patterns into reusable skills
// Enhanced: mattpoclock/skills style write-a-skill

import type { Pattern, IPatternExtractor } from './PatternExtractor.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface SkillProposal {
  id: string
  name: string
  description: string
  triggers: string[]
  triggerConditions: string[]      // mattpoclock style: "Use when X"
  agents: string[]
  steps: SkillStep[]
  examples: SkillExample[]         // New: concrete examples
  antipatterns: string[]           // New: what to avoid
  sourcePattern: string
  sourceConversation?: string      // New: extracted from conversation
  meetsCriteria?: SkillCriteria    // New: extraction criteria check
  status: 'draft' | 'proposed' | 'approved' | 'published'
  createdAt: number
}

export interface SkillStep {
  phase: string
  actions: string[]
  checklist: string[]
}

export interface SkillExample {
  title: string
  code?: string
  description: string
}

export interface SkillCriteria {
  notGoogleable: boolean     // Cannot find on Google
  contextSpecific: boolean   // Project/domain specific
  executable: boolean        // Has concrete steps
  hardWon: boolean           // Learned from failure
}

export interface SkillCandidate {
  id: string
  detectedPattern: string
  potentialTriggers: string[]
  estimatedValue: number
  meetsCriteria: SkillCriteria
}

export interface ISkillCreator {
  patternToSkill(pattern: Pattern): SkillProposal
  detectSkillCandidate(conversationId: string): SkillCandidate | null
  validateTriggerConditions(proposal: SkillProposal): { valid: boolean; reason?: string }
  proposeToUser(skill: SkillProposal): Promise<boolean>
  publish(skill: SkillProposal, skillsDir: string): string
  getProposals(): SkillProposal[]
}

export class SkillCreator implements ISkillCreator {
  private proposals: Map<string, SkillProposal> = new Map()
  private seq = 0

  constructor(
    private extractor: IPatternExtractor,
    private eventBus: IEventBus,
  ) {}

  patternToSkill(pattern: Pattern): SkillProposal {
    const skill: SkillProposal = {
      id: 'SKILL-' + Date.now() + '-' + (++this.seq).toString().padStart(3, '0'),
      name: this.skillNameFromPattern(pattern),
      description: pattern.description,
      triggers: this.inferTriggers(pattern),
      triggerConditions: this.inferTriggerConditions(pattern),
      agents: this.inferAgents(pattern),
      steps: this.convertSteps(pattern.steps),
      examples: [],
      antipatterns: [],
      sourcePattern: pattern.id,
      status: 'draft',
      createdAt: Date.now(),
    }

    this.proposals.set(skill.id, skill)
    logger.info({ skillId: skill.id, patternId: pattern.id }, 'Pattern converted to skill draft')
    return skill
  }

  async proposeToUser(skill: SkillProposal): Promise<boolean> {
    skill.status = 'proposed'
    this.eventBus.emit('skill.proposed', { skillId: skill.id, name: skill.name })
    logger.info({ skillId: skill.id }, 'Skill proposed for user approval')
    return true
  }

  publish(skill: SkillProposal, skillsDir: string): string {
    if (skill.status !== 'approved') {
      logger.warn({ skillId: skill.id }, 'Skill not approved - cannot publish')
      throw new Error('Skill must be approved before publishing')
    }

    mkdirSync(skillsDir, { recursive: true })
    const skillDir = join(skillsDir, skill.name.toLowerCase().replace(/\s+/g, '-'))
    mkdirSync(skillDir, { recursive: true })

    const skillPath = join(skillDir, 'SKILL.md')
    const content = this.generateSkillMarkdown(skill)
    writeFileSync(skillPath, content, 'utf-8')

    skill.status = 'published'
    this.eventBus.emit('skill.published', { skillId: skill.id, path: skillPath })
    logger.info({ skillId: skill.id, path: skillPath }, 'Skill published')
    return skillPath
  }

  getProposals(): SkillProposal[] {
    return Array.from(this.proposals.values())
  }

  // ========== mattpoclock/skills style: write-a-skill ==========

  detectSkillCandidate(conversationId: string): SkillCandidate | null {
    // Placeholder: In real implementation, would analyze conversation history
    // For now, return null to indicate no candidate detected
    logger.debug({ conversationId }, 'Scanning conversation for skill candidates')
    return null
  }

  validateTriggerConditions(proposal: SkillProposal): { valid: boolean; reason?: string } {
    // mattpoclock detection: trigger conditions should describe SCENARIOS, not ACTIONS
    const actionWords = ['implement', 'build', 'create', 'write', 'develop', 'code', 'fix', 'add']

    for (const trigger of proposal.triggerConditions) {
      for (const action of actionWords) {
        if (trigger.toLowerCase().includes(action)) {
          return {
            valid: false,
            reason: `Trigger "${trigger}" describes action, not scenario. Use "when X happens" instead.`,
          }
        }
      }
    }

    // Check that triggers use mattpoclock style: "Use when X"
    for (const trigger of proposal.triggerConditions) {
      if (!trigger.toLowerCase().includes('when') && !trigger.toLowerCase().includes('if')) {
        return {
          valid: false,
          reason: `Trigger "${trigger}" should use "Use when X" format`,
        }
      }
    }

    return { valid: true }
  }

  private generateSkillMarkdownEnhanced(skill: SkillProposal): string {
    // mattpoclock/skills YAML frontmatter format
    const frontmatter = {
      name: skill.name,
      description: `Use when ${skill.triggerConditions.join(' OR ')}`,
      version: '1.0.0',
      author: 'scale-engine',
      extractedFrom: skill.sourceConversation,
    }

    let md = '---\n'
    md += `name: ${frontmatter.name}\n`
    md += `description: ${frontmatter.description}\n`
    md += `version: ${frontmatter.version}\n`
    if (frontmatter.author) md += `author: ${frontmatter.author}\n`
    if (frontmatter.extractedFrom) md += `extractedFrom: ${frontmatter.extractedFrom}\n`
    md += '---\n\n'

    md += `## When to Use\n\n`
    for (const t of skill.triggerConditions) md += `- ${t}\n`
    md += '\n'

    md += '## Steps\n\n'
    for (const step of skill.steps) {
      md += `${step.phase}:\n`
      for (const action of step.actions) md += `1. ${action}\n`
      md += '\n'
    }

    if (skill.examples?.length) {
      md += '## Examples\n\n'
      for (const ex of skill.examples) {
        md += `### ${ex.title}\n${ex.description}\n`
        if (ex.code) md += `\n\`\`\`\n${ex.code}\n\`\`\`\n`
        md += '\n'
      }
    }

    if (skill.antipatterns?.length) {
      md += '## Anti-patterns\n\n'
      for (const a of skill.antipatterns) md += `- ${a}\n`
      md += '\n'
    }

    return md
  }

  private skillNameFromPattern(pattern: Pattern): string {
    return pattern.name.replace(' Pattern', '').replace(' Workflow', '')
  }

  private inferTriggers(pattern: Pattern): string[] {
    const triggers: string[] = []
    for (const step of pattern.steps) {
      const words = step.action.toLowerCase().split(/\s+/)
      triggers.push(...words.filter(w => w.length > 3))
    }
    return [...new Set(triggers)].slice(0, 5)
  }

  private inferTriggerConditions(pattern: Pattern): string[] {
    // mattpoclock style: "Use when X" format, not action descriptions
    const conditions: string[] = []
    const name = this.skillNameFromPattern(pattern).toLowerCase()

    // Generate scenario-based triggers
    if (name.includes('auth')) conditions.push('Use when implementing authentication features')
    if (name.includes('api')) conditions.push('Use when building API endpoints')
    if (name.includes('test')) conditions.push('Use when writing tests')
    if (name.includes('deploy')) conditions.push('Use when deploying to production')
    if (name.includes('refactor')) conditions.push('Use when restructuring existing code')

    // Default fallback
    if (conditions.length === 0) conditions.push(`Use when working with ${name}`)

    return conditions
  }

  private inferAgents(pattern: Pattern): string[] {
    const agentMap: Record<string, string[]> = {
      plan: ['planner'],
      implement: ['implementer'],
      test: ['tester'],
      review: ['reviewer'],
      debug: ['debugger'],
      document: ['doc-writer'],
    }

    const agents: string[] = []
    for (const step of pattern.steps) {
      for (const [keyword, agentList] of Object.entries(agentMap)) {
        if (step.action.toLowerCase().includes(keyword)) {
          agents.push(...agentList)
        }
      }
    }
    return [...new Set(agents)]
  }

  private convertSteps(patternSteps: any[]): SkillStep[] {
    const phases = ['Setup', 'Execute', 'Verify']
    return patternSteps.map((ps, i) => ({
      phase: phases[i] ?? 'Step ' + (i + 1),
      actions: [ps.action],
      checklist: ['Verify ' + ps.expectedOutcome],
    }))
  }

  private generateSkillMarkdown(skill: SkillProposal): string {
    let md = '---\n'
    md += 'name: ' + skill.name + '\n'
    md += 'version: 1.0.0\n'
    md += 'description: ' + skill.description + '\n'
    md += 'triggers:\n'
    for (const t of skill.triggers) md += '  - ' + t + '\n'
    md += 'agents:\n'
    for (const a of skill.agents) md += '  - ' + a + '\n'
    md += '---\n\n'
    md += '# ' + skill.name + '\n\n'
    md += 'Auto-generated from pattern: ' + skill.sourcePattern + '\n\n'

    for (const step of skill.steps) {
      md += '## ' + step.phase + '\n\n'
      for (const action of step.actions) md += '1. ' + action + '\n'
      md += '\n**Checklist:**\n'
      for (const item of step.checklist) md += '- [ ] ' + item + '\n'
      md += '\n'
    }

    return md
  }
}
