// SCALE Engine — Role Skills Tests

import { describe, it, expect } from 'vitest'
import {
  ROLE_PERSPECTIVES,
  getRolePerspective,
  getRoleChecklist,
  getAllRoles,
  applyRolePerspective,
  getRolesForPhase,
  type SkillRole,
} from '../../src/skills/RoleSkills.js'

describe('RolePerspectives', () => {
  it('defines all 6 roles', () => {
    const roles = getAllRoles()
    expect(roles.length).toBe(6)
    expect(roles).toContain('eng-manager')
    expect(roles).toContain('security-reviewer')
    expect(roles).toContain('qa-lead')
    expect(roles).toContain('release-engineer')
    expect(roles).toContain('design-reviewer')
    expect(roles).toContain('ceo-reviewer')
  })

  it('each role has non-empty checklist', () => {
    for (const role of getAllRoles()) {
      const perspective = getRolePerspective(role)
      expect(perspective.checklist.length).toBeGreaterThan(0)
      expect(perspective.name.length).toBeGreaterThan(0)
      expect(perspective.description.length).toBeGreaterThan(0)
    }
  })

  it('each role has risk focus areas', () => {
    for (const role of getAllRoles()) {
      const perspective = getRolePerspective(role)
      expect(perspective.riskFocus.length).toBeGreaterThan(0)
    }
  })

  it('each role has a valid output format', () => {
    const validFormats = ['structured', 'narrative', 'checklist']
    for (const role of getAllRoles()) {
      const perspective = getRolePerspective(role)
      expect(validFormats).toContain(perspective.outputFormat)
    }
  })
})

describe('getRolePerspective', () => {
  it('returns correct perspective for eng-manager', () => {
    const p = getRolePerspective('eng-manager')
    expect(p.role).toBe('eng-manager')
    expect(p.name).toBe('Engineering Manager')
    expect(p.riskFocus).toContain('architecture-drift')
  })

  it('returns correct perspective for security-reviewer', () => {
    const p = getRolePerspective('security-reviewer')
    expect(p.role).toBe('security-reviewer')
    expect(p.name).toBe('Security Reviewer')
    expect(p.checklist.length).toBe(10) // OWASP Top 10 aligned
    expect(p.riskFocus).toContain('injection')
    expect(p.riskFocus).toContain('auth-bypass')
  })
})

describe('getRoleChecklist', () => {
  it('returns checklist for qa-lead', () => {
    const checklist = getRoleChecklist('qa-lead')
    expect(checklist.length).toBeGreaterThan(0)
    expect(checklist.some(item => item.includes('boundary'))).toBe(true)
    expect(checklist.some(item => item.includes('error'))).toBe(true)
  })

  it('returns checklist for release-engineer', () => {
    const checklist = getRoleChecklist('release-engineer')
    expect(checklist.some(item => item.includes('version'))).toBe(true)
    expect(checklist.some(item => item.includes('changelog'))).toBe(true)
  })
})

describe('applyRolePerspective', () => {
  it('generates role-specific prompt', () => {
    const prompt = applyRolePerspective('security-reviewer', {
      task: 'Add user authentication',
      files: ['src/auth/login.ts'],
    })

    expect(prompt).toContain('Security Reviewer')
    expect(prompt).toContain('Add user authentication')
    expect(prompt).toContain('src/auth/login.ts')
    expect(prompt).toContain('Checklist')
    expect(prompt).toContain('Risk Focus Areas')
  })

  it('includes diff when provided', () => {
    const prompt = applyRolePerspective('qa-lead', {
      task: 'Fix boundary check',
      diff: '+ if (count > 0) {',
    })

    expect(prompt).toContain('Diff Under Review')
    expect(prompt).toContain('+ if (count > 0) {')
  })

  it('handles missing optional fields', () => {
    const prompt = applyRolePerspective('ceo-reviewer', {
      task: 'Add dark mode',
    })

    expect(prompt).toContain('CEO Reviewer')
    expect(prompt).toContain('Add dark mode')
    expect(prompt).not.toContain('Files:')
    expect(prompt).not.toContain('Diff Under Review')
  })
})

describe('getRolesForPhase', () => {
  it('returns eng-manager for explore', () => {
    const roles = getRolesForPhase('explore')
    expect(roles).toContain('eng-manager')
  })

  it('returns ceo-reviewer and eng-manager for plan', () => {
    const roles = getRolesForPhase('plan')
    expect(roles).toContain('ceo-reviewer')
    expect(roles).toContain('eng-manager')
  })

  it('returns empty for build', () => {
    const roles = getRolesForPhase('build')
    expect(roles.length).toBe(0)
  })

  it('returns qa-lead and security-reviewer for verify', () => {
    const roles = getRolesForPhase('verify')
    expect(roles).toContain('qa-lead')
    expect(roles).toContain('security-reviewer')
  })

  it('returns eng-manager and security-reviewer for review', () => {
    const roles = getRolesForPhase('review')
    expect(roles).toContain('eng-manager')
    expect(roles).toContain('security-reviewer')
  })

  it('returns release-engineer for ship', () => {
    const roles = getRolesForPhase('ship')
    expect(roles).toContain('release-engineer')
  })

  it('returns empty for unknown phase', () => {
    const roles = getRolesForPhase('unknown')
    expect(roles.length).toBe(0)
  })
})
