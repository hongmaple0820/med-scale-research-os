import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ParsedSkillMd } from '../SkillMdStandard.js'

export interface GStackSkill {
  name: string
  tier: string
  commands: string[]
  scope: string
}

/**
 * Convert a parsed SKILL.md to gstack-compatible skill format.
 */
export function convertToGStack(parsed: ParsedSkillMd): GStackSkill {
  return {
    name: parsed.frontmatter.name,
    tier: parsed.frontmatter['preamble-tier'] ?? 'tier-1',
    commands: parsed.toolNamespaces['gstack'] ?? [],
    scope: parsed.frontmatter.type === 'rigid' ? 'system' : 'user',
  }
}

/**
 * Import a gstack skill into SCALE skill format.
 */
export function importFromGStack(gstackSkill: GStackSkill, outputDir: string): void {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const content = [
    '---',
    `name: ${gstackSkill.name}`,
    `description: gstack skill: ${gstackSkill.scope}`,
    `preamble-tier: ${gstackSkill.tier}`,
    `allowed-tools: [${gstackSkill.commands.map(c => `gstack:${c}`).join(', ')}]`,
    '---',
    '',
    `# ${gstackSkill.name}`,
    '',
    `> Imported from gstack. Scope: ${gstackSkill.scope}`,
  ].join('\n')
  writeFileSync(join(outputDir, `${gstackSkill.name.replace(/\s+/g, '-').toLowerCase()}.skill.md`), content)
}
