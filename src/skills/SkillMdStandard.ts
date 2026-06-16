import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface SkillMdFrontmatter {
  name: string
  description: string
  version?: string
  'preamble-tier'?: 'tier-0' | 'tier-1' | 'tier-2' | 'tier-3'
  'allowed-tools'?: string[]  // namespace prefixed: 'gstack:browser', 'omc:agent', 'ecc:build'
  triggers?: string[]
  type?: 'rigid' | 'flexible'
}

export interface ParsedSkillMd {
  frontmatter: SkillMdFrontmatter
  body: string
  rawPath: string
  toolNamespaces: Record<string, string[]>  // e.g. { gstack: ['browser', 'deploy'], omc: ['agent'] }
}

/**
 * Parse a SKILL.md file and extract cross-platform tool namespaces.
 *
 * Supported namespaces:
 *   gstack:  — gstack platform tools
 *   omc:     — oh-my-claudecode platform tools
 *   ecc:     — ECC platform tools
 *   scale:   — SCALE Engine tools (native)
 */
export function parseSkillMd(filepath: string): ParsedSkillMd | null {
  const fullPath = resolve(filepath)
  if (!existsSync(fullPath)) return null

  const content = readFileSync(fullPath, 'utf-8')
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
  if (!fmMatch) return null

  const fmLines = fmMatch[1].split('\n')
  const frontmatter: SkillMdFrontmatter = { name: '', description: '' }

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()

    switch (key) {
      case 'name': frontmatter.name = value; break
      case 'description': frontmatter.description = value; break
      case 'version': frontmatter.version = value; break
      case 'preamble-tier': frontmatter['preamble-tier'] = value as SkillMdFrontmatter['preamble-tier']; break
      case 'allowed-tools': frontmatter['allowed-tools'] = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean); break
      case 'triggers': frontmatter.triggers = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean); break
      case 'type': frontmatter.type = value as 'rigid' | 'flexible'; break
    }
  }

  // Parse tool namespaces
  const toolNamespaces: Record<string, string[]> = {}
  for (const tool of frontmatter['allowed-tools'] ?? []) {
    const nsMatch = tool.match(/^([a-z]+):(.+)$/)
    if (nsMatch) {
      const ns = nsMatch[1]
      const name = nsMatch[2]
      if (!toolNamespaces[ns]) toolNamespaces[ns] = []
      toolNamespaces[ns].push(name)
    }
  }

  return {
    frontmatter,
    body: fmMatch[2].trim(),
    rawPath: fullPath,
    toolNamespaces,
  }
}

/**
 * Convert a SCALE skill registry entry to a portable SKILL.md format.
 */
export function skillToMarkdown(skill: {
  id: string
  name: string
  description?: string
}): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description ?? skill.id}`,
    'allowed-tools: []',
    '---',
    '',
    `# ${skill.name}`,
    '',
    `> Auto-generated from SCALE Engine skill registry.`,
    `> Skill ID: ${skill.id}`,
  ].join('\n')
}
