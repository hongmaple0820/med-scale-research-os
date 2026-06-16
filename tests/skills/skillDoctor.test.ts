import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectRequiredWorkflowSkills, inspectWorkflowSkills } from '../../src/skills/SkillDoctor.js'

describe('SkillDoctor', () => {
  it('reports workflow skill installation status from real skill files', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const skillDir = join(homeDir, '.agents', 'skills', 'frontend-design')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: frontend-design\n---\n', 'utf-8')

      const report = inspectWorkflowSkills({ projectDir, homeDir })
      const frontend = report.skills.find(skill => skill.id === 'frontend-design')
      const reviewer = report.skills.find(skill => skill.id === 'code-reviewer')

      expect(report.total).toBeGreaterThan(0)
      expect(frontend).toMatchObject({
        id: 'frontend-design',
        installed: true,
        status: 'installed',
      })
      expect(frontend?.detectedPath).toBe(join(skillDir, 'SKILL.md'))
      expect(reviewer).toMatchObject({
        id: 'code-reviewer',
        installed: false,
        status: 'missing',
      })
      expect(reviewer?.installCommand).toContain('google-gemini')
      expect(report.ok).toBe(false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('reports required skill installation gaps for a task', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const skillDir = join(homeDir, '.agents', 'skills', 'frontend-design')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: frontend-design\n---\n', 'utf-8')

      const report = inspectRequiredWorkflowSkills(['frontend-design', 'code-reviewer', 'unknown-skill'], {
        projectDir,
        homeDir,
      })

      expect(report.ok).toBe(false)
      expect(report.installed).toEqual(['frontend-design'])
      expect(report.missing).toEqual(['code-reviewer', 'unknown-skill'])
      expect(report.unknown).toEqual(['unknown-skill'])
      expect(report.skills.map(skill => skill.id)).toEqual(['frontend-design', 'code-reviewer'])
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('understands tool orchestration skills required by routing policy', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      for (const skillId of ['web-access', 'ui-ux-pro-max']) {
        const skillDir = join(homeDir, '.agents', 'skills', skillId)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skillId}\n---\n`, 'utf-8')
      }

      const report = inspectRequiredWorkflowSkills(['web-access', 'ui-ux-pro-max', 'cua'], {
        projectDir,
        homeDir,
      })

      expect(report.unknown).toEqual([])
      expect(report.installed).toEqual(['web-access', 'ui-ux-pro-max'])
      expect(report.missing).toEqual(['cua'])
      expect(report.skills.find(skill => skill.id === 'web-access')?.source).toBe('https://github.com/eze-is/web-access')
      expect(report.skills.find(skill => skill.id === 'ui-ux-pro-max')?.source).toBe('https://github.com/nextlevelbuilder/ui-ux-pro-max-skill')
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
