// SCALE Engine — Skill Frontmatter Parser (v0.31.0)
// Standardized SKILL.md frontmatter format inspired by gstack.
// Enables declarative skill definitions alongside code-based registration.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import yaml from 'js-yaml'
import type { SkillDomain, SkillDefinition, SkillTrigger, SkillExecution, SkillTriggerType } from './SkillRegistry.js'

// ============================================================================
// Types
// ============================================================================

export interface SkillFrontmatter {
  name: string
  'preamble-tier'?: number
  description: string
  'allowed-tools'?: string[]
  triggers?: string[]
  domain?: SkillDomain
  priority?: number
}

export interface FrontmatterParseResult {
  frontmatter: SkillFrontmatter | null
  body: string
  errors: string[]
}

export interface FrontmatterValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// Parser
// ============================================================================

const FRONTMATTER_DELIMITER = '---'

export function parseSkillFrontmatter(content: string): FrontmatterParseResult {
  const trimmed = content.trim()

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: null, body: trimmed, errors: ['Missing opening frontmatter delimiter (---)'] }
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length)
  const endIndex = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`)
  if (endIndex === -1) {
    return { frontmatter: null, body: trimmed, errors: ['Missing closing frontmatter delimiter (---)'] }
  }

  const yamlContent = afterFirst.slice(0, endIndex).trim()
  const body = afterFirst.slice(endIndex + FRONTMATTER_DELIMITER.length + 1).trim()

  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') {
      return { frontmatter: null, body, errors: ['Frontmatter is not a valid YAML object'] }
    }

    const fm: SkillFrontmatter = {
      name: String(parsed.name ?? ''),
      description: String(parsed.description ?? ''),
    }

    if (parsed['preamble-tier'] !== undefined) {
      fm['preamble-tier'] = Number(parsed['preamble-tier'])
    }
    if (Array.isArray(parsed['allowed-tools'])) {
      fm['allowed-tools'] = parsed['allowed-tools'].map(String)
    }
    if (Array.isArray(parsed.triggers)) {
      fm.triggers = parsed.triggers.map(String)
    }
    if (typeof parsed.domain === 'string') {
      fm.domain = parsed.domain as SkillDomain
    }
    if (typeof parsed.priority === 'number') {
      fm.priority = parsed.priority
    }

    const validation = validateFrontmatter(fm)
    return { frontmatter: validation.valid ? fm : null, body, errors: validation.errors }
  } catch (err) {
    return { frontmatter: null, body, errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

// ============================================================================
// Validator
// ============================================================================

const VALID_DOMAINS: SkillDomain[] = ['context', 'planning', 'execution', 'verification', 'evolution', 'deployment']

export function validateFrontmatter(fm: SkillFrontmatter): FrontmatterValidationResult {
  const errors: string[] = []

  if (!fm.name || fm.name.trim().length === 0) {
    errors.push('Missing required field: name')
  }
  if (!fm.description || fm.description.trim().length === 0) {
    errors.push('Missing required field: description')
  }
  if (fm.domain && !VALID_DOMAINS.includes(fm.domain)) {
    errors.push(`Invalid domain: ${fm.domain}. Must be one of: ${VALID_DOMAINS.join(', ')}`)
  }
  if (fm['preamble-tier'] !== undefined && (fm['preamble-tier'] < 1 || fm['preamble-tier'] > 10)) {
    errors.push('preamble-tier must be between 1 and 10')
  }
  if (fm.priority !== undefined && (fm.priority < 0 || fm.priority > 100)) {
    errors.push('priority must be between 0 and 100')
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Converter: Frontmatter → SkillDefinition
// ============================================================================

const TRIGGER_TYPE_MAP: Record<string, SkillTriggerType> = {
  'taskType': 'taskType',
  'phase': 'phase',
  'keyword': 'keyword',
  'manual': 'manual',
}

export function frontmatterToSkillDefinition(fm: SkillFrontmatter, filePath: string): SkillDefinition {
  const triggers: SkillTrigger[] = (fm.triggers ?? []).map(keyword => ({
    type: 'keyword' as SkillTriggerType,
    value: keyword,
    weight: 1.0,
  }))

  const execution: SkillExecution = {
    type: 'skill-file',
    config: {
      skillPath: filePath,
      parameters: {
        'allowed-tools': fm['allowed-tools'] ?? [],
        'preamble-tier': fm['preamble-tier'] ?? 1,
      },
    },
  }

  return {
    id: fm.name,
    name: fm.name,
    description: fm.description,
    domain: fm.domain ?? 'execution',
    triggers,
    execution,
    priority: fm.priority ?? 50,
    installed: true,
    installedAt: Date.now(),
    source: filePath,
    frontmatter: fm,
  }
}

// ============================================================================
// Directory Scanner
// ============================================================================

export interface ScannedSkill {
  filePath: string
  frontmatter: SkillFrontmatter
  definition: SkillDefinition
}

export function scanFrontmatterSkills(dir: string): ScannedSkill[] {
  if (!existsSync(dir)) return []

  const results: ScannedSkill[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = readFileSync(fullPath, 'utf-8')
      const parsed = parseSkillFrontmatter(content)
      if (parsed.frontmatter) {
        results.push({
          filePath: fullPath,
          frontmatter: parsed.frontmatter,
          definition: frontmatterToSkillDefinition(parsed.frontmatter, fullPath),
        })
      }
    } else if (entry.isDirectory()) {
      // Check for SKILL.md in subdirectory
      const skillFile = join(fullPath, 'SKILL.md')
      if (existsSync(skillFile)) {
        const content = readFileSync(skillFile, 'utf-8')
        const parsed = parseSkillFrontmatter(content)
        if (parsed.frontmatter) {
          results.push({
            filePath: skillFile,
            frontmatter: parsed.frontmatter,
            definition: frontmatterToSkillDefinition(parsed.frontmatter, skillFile),
          })
        }
      }
    }
  }

  return results
}
