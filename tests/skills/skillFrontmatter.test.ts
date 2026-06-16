// SCALE Engine — Skill Frontmatter Tests

import { describe, it, expect } from 'vitest'
import {
  parseSkillFrontmatter,
  validateFrontmatter,
  frontmatterToSkillDefinition,
  scanFrontmatterSkills,
  type SkillFrontmatter,
} from '../../src/skills/SkillFrontmatter.js'

describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const content = `---
name: review
preamble-tier: 4
description: Pre-landing PR review for structural issues.
allowed-tools:
  - Bash
  - Read
  - Edit
triggers:
  - review this pr
  - code review
domain: verification
priority: 80
---

## Instructions

Review the diff carefully.`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).not.toBeNull()
    expect(result.frontmatter!.name).toBe('review')
    expect(result.frontmatter!['preamble-tier']).toBe(4)
    expect(result.frontmatter!.description).toBe('Pre-landing PR review for structural issues.')
    expect(result.frontmatter!['allowed-tools']).toEqual(['Bash', 'Read', 'Edit'])
    expect(result.frontmatter!.triggers).toEqual(['review this pr', 'code review'])
    expect(result.frontmatter!.domain).toBe('verification')
    expect(result.frontmatter!.priority).toBe(80)
    expect(result.body).toContain('## Instructions')
  })

  it('parses minimal frontmatter with only required fields', () => {
    const content = `---
name: simple-skill
description: A simple skill.
---

Body content here.`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).not.toBeNull()
    expect(result.frontmatter!.name).toBe('simple-skill')
    expect(result.frontmatter!.description).toBe('A simple skill.')
    expect(result.frontmatter!['preamble-tier']).toBeUndefined()
    expect(result.frontmatter!['allowed-tools']).toBeUndefined()
    expect(result.frontmatter!.triggers).toBeUndefined()
  })

  it('returns error for missing opening delimiter', () => {
    const content = `name: broken
description: Missing delimiters.
---`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns error for missing closing delimiter', () => {
    const content = `---
name: broken
description: Missing closing delimiter.`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns error for invalid YAML', () => {
    const content = `---
name: [invalid yaml
description: broken
---

Body`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns error for missing name field', () => {
    const content = `---
description: Missing name.
---

Body`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.errors.some(e => e.includes('name'))).toBe(true)
  })

  it('returns error for missing description field', () => {
    const content = `---
name: no-desc
---

Body`

    const result = parseSkillFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.errors.some(e => e.includes('description'))).toBe(true)
  })
})

describe('validateFrontmatter', () => {
  it('passes for valid frontmatter', () => {
    const fm: SkillFrontmatter = { name: 'test', description: 'Test skill' }
    const result = validateFrontmatter(fm)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails for empty name', () => {
    const fm: SkillFrontmatter = { name: '', description: 'Test' }
    const result = validateFrontmatter(fm)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('name'))).toBe(true)
  })

  it('fails for invalid domain', () => {
    const fm: SkillFrontmatter = { name: 'test', description: 'Test', domain: 'invalid' as any }
    const result = validateFrontmatter(fm)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('domain'))).toBe(true)
  })

  it('fails for out-of-range preamble-tier', () => {
    const fm: SkillFrontmatter = { name: 'test', description: 'Test', 'preamble-tier': 15 }
    const result = validateFrontmatter(fm)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('preamble-tier'))).toBe(true)
  })

  it('fails for out-of-range priority', () => {
    const fm: SkillFrontmatter = { name: 'test', description: 'Test', priority: 200 }
    const result = validateFrontmatter(fm)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('priority'))).toBe(true)
  })
})

describe('frontmatterToSkillDefinition', () => {
  it('converts frontmatter to SkillDefinition', () => {
    const fm: SkillFrontmatter = {
      name: 'review',
      description: 'PR review skill',
      'allowed-tools': ['Bash', 'Read'],
      triggers: ['review this pr', 'code review'],
      domain: 'verification',
      priority: 80,
    }

    const def = frontmatterToSkillDefinition(fm, '/path/to/review/SKILL.md')
    expect(def.id).toBe('review')
    expect(def.name).toBe('review')
    expect(def.description).toBe('PR review skill')
    expect(def.domain).toBe('verification')
    expect(def.priority).toBe(80)
    expect(def.installed).toBe(true)
    expect(def.source).toBe('/path/to/review/SKILL.md')
    expect(def.execution.type).toBe('skill-file')
    expect(def.execution.config.skillPath).toBe('/path/to/review/SKILL.md')
    expect(def.triggers).toHaveLength(2)
    expect(def.triggers[0].type).toBe('keyword')
    expect(def.triggers[0].value).toBe('review this pr')
    expect(def.frontmatter).toBe(fm)
  })

  it('uses defaults for optional fields', () => {
    const fm: SkillFrontmatter = { name: 'simple', description: 'Simple skill' }
    const def = frontmatterToSkillDefinition(fm, '/path/simple.md')
    expect(def.domain).toBe('execution')
    expect(def.priority).toBe(50)
    expect(def.triggers).toHaveLength(0)
  })
})

describe('scanFrontmatterSkills', () => {
  it('returns empty for non-existent directory', () => {
    const result = scanFrontmatterSkills('/non/existent/path')
    expect(result).toHaveLength(0)
  })
})
