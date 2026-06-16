// Tests for WorkflowTemplates — template selection, customization, formatting

import { describe, it, expect } from 'vitest'
import {
  selectTemplate,
  customizeTemplate,
  listTemplates,
  getTemplateSteps,
  formatTemplateForAgent,
  WORKFLOW_TEMPLATES,
} from '../../src/workflow/WorkflowTemplates.js'

describe('selectTemplate', () => {
  it('selects light-docs for light profile', () => {
    const template = selectTemplate({ profile: 'light', task: 'update config', level: 'S' })
    expect(template.id).toBe('light-docs')
  })

  it('selects standard-code for standard profile', () => {
    const template = selectTemplate({ profile: 'standard', task: 'add feature', level: 'M' })
    expect(template.id).toBe('standard-code')
  })

  it('selects strict-feature for strict profile', () => {
    const template = selectTemplate({ profile: 'strict', task: 'refactor module', level: 'L' })
    expect(template.id).toBe('strict-feature')
  })

  it('selects critical-security when task contains security keywords', () => {
    const keywords = ['auth', 'security', 'crypto', 'password', 'token', 'secret', 'credential', 'oauth', 'jwt']
    for (const kw of keywords) {
      const template = selectTemplate({ profile: 'light', task: `fix ${kw} issue`, level: 'S' })
      expect(template.id).toBe('critical-security')
    }
  })

  it('selects light-docs for doc keywords with light profile', () => {
    const template = selectTemplate({ profile: 'light', task: 'update readme documentation', level: 'S' })
    expect(template.id).toBe('light-docs')
  })

  it('escalates to strict-feature when 3+ risk factors', () => {
    const template = selectTemplate({
      profile: 'standard',
      task: 'update module',
      level: 'M',
      riskFactors: ['db-change', 'api-breaking', 'migration'],
    })
    expect(template.id).toBe('strict-feature')
  })

  it('escalates to strict-feature for CRITICAL level', () => {
    const template = selectTemplate({ profile: 'standard', task: 'update module', level: 'CRITICAL' })
    expect(template.id).toBe('strict-feature')
  })

  it('escalates to strict-feature for L level', () => {
    const template = selectTemplate({ profile: 'light', task: 'update module', level: 'L' })
    expect(template.id).toBe('strict-feature')
  })

  it('defaults to standard-code for unknown profile', () => {
    const template = selectTemplate({ profile: 'unknown' as any, task: 'do stuff', level: 'S' })
    expect(template.id).toBe('standard-code')
  })
})

describe('customizeTemplate', () => {
  it('overrides name and description', () => {
    const base = WORKFLOW_TEMPLATES['light-docs']
    const customized = customizeTemplate(base, { name: 'Custom', description: 'Custom desc' })
    expect(customized.name).toBe('Custom')
    expect(customized.description).toBe('Custom desc')
    expect(customized.steps).toBe(base.steps) // steps preserved
  })

  it('overrides steps when provided', () => {
    const base = WORKFLOW_TEMPLATES['light-docs']
    const customSteps = [base.steps[0]]
    const customized = customizeTemplate(base, { steps: customSteps })
    expect(customized.steps).toBe(customSteps)
  })
})

describe('listTemplates', () => {
  it('returns all 4 built-in templates', () => {
    const templates = listTemplates()
    expect(templates).toHaveLength(4)
    const ids = templates.map(t => t.id)
    expect(ids).toContain('light-docs')
    expect(ids).toContain('standard-code')
    expect(ids).toContain('strict-feature')
    expect(ids).toContain('critical-security')
  })
})

describe('getTemplateSteps', () => {
  it('returns steps for valid template', () => {
    const steps = getTemplateSteps('standard-code')
    expect(steps.length).toBeGreaterThan(0)
    expect(steps[0].type).toBe('explore')
  })

  it('returns empty array for unknown template', () => {
    const steps = getTemplateSteps('nonexistent')
    expect(steps).toEqual([])
  })
})

describe('formatTemplateForAgent', () => {
  it('produces readable formatted output', () => {
    const template = WORKFLOW_TEMPLATES['strict-feature']
    const text = formatTemplateForAgent(template)
    expect(text).toContain('Workflow Template: Strict Feature')
    expect(text).toContain('**Profile:** strict')
    expect(text).toContain('## Steps')
    expect(text).toContain('### Explore')
    expect(text).toContain('### Build')
    expect(text).toContain('## Exit Criteria')
    expect(text).toContain('Coverage >= 80%')
  })

  it('marks required and optional steps', () => {
    const template = WORKFLOW_TEMPLATES['standard-code']
    const text = formatTemplateForAgent(template)
    expect(text).toContain('*(required)*')
    expect(text).toContain('*(optional)*')
  })

  it('includes evidence requirements when present', () => {
    const template = WORKFLOW_TEMPLATES['critical-security']
    const text = formatTemplateForAgent(template)
    expect(text).toContain('Evidence:')
  })

  it('includes skip conditions when present', () => {
    const template = WORKFLOW_TEMPLATES['standard-code']
    const text = formatTemplateForAgent(template)
    expect(text).toContain('Skip when:')
  })
})
