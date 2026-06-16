import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ParsedSkillMd } from '../SkillMdStandard.js'

export interface OMCSkill {
  id: string
  triggers: string[]
  agentType: string
  category: string
}

/**
 * Convert a parsed SKILL.md to OMC-compatible skill format.
 */
export function convertToOMC(parsed: ParsedSkillMd): OMCSkill {
  return {
    id: parsed.frontmatter.name,
    triggers: parsed.frontmatter.triggers ?? [],
    agentType: parsed.toolNamespaces['omc']?.join(',') ?? 'general-purpose',
    category: parsed.frontmatter['preamble-tier']?.startsWith('tier-0') ? 'tier-0' : 'tier-1',
  }
}

/**
 * Import an OMC skill into SCALE skill format.
 */
export function importFromOMC(omcSkill: OMCSkill, outputDir: string): void {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const content = [
    '---',
    `name: ${omcSkill.id}`,
    `description: OMC skill: ${omcSkill.category}`,
    `triggers: [${omcSkill.triggers.join(', ')}]`,
    `allowed-tools: [${omcSkill.agentType.split(',').map(t => `omc:${t.trim()}`).join(', ')}]`,
    '---',
    '',
    `# ${omcSkill.id}`,
    '',
    `> Imported from OMC. Category: ${omcSkill.category}`,
  ].join('\n')
  writeFileSync(join(outputDir, `${omcSkill.id.replace(/\s+/g, '-').toLowerCase()}.skill.md`), content)
}
