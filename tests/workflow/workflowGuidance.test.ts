import { describe, expect, it } from 'vitest'
import { createWorkflowGuidance, renderWorkflowGuidance } from '../../src/workflow/WorkflowGuidance.js'

describe('WorkflowGuidance', () => {
  it('recommends context, diagnosis, TDD, and verification commands for M bug work', () => {
    const guidance = createWorkflowGuidance({
      taskId: 'TASK-bug-404',
      description: 'Fix gateway 404 regression for upload route',
      level: 'M',
      artifactDir: 'docs/worklog/tasks/2026-05-18-bug-404',
      files: ['src/routes/upload.ts'],
    })

    expect(guidance.requiredCommandCount).toBeGreaterThanOrEqual(4)
    expect(guidance.items.map(item => item.id)).toEqual([
      'context-grill',
      'diagnostic-loop',
      'tdd-slice',
      'verification',
    ])
    expect(guidance.items[0].command).toContain('scale context grill')
    expect(guidance.items[0].command).toContain('--write')
    expect(guidance.items[1].command).toContain('scale diagnose plan')
    expect(guidance.items[2].command).toContain('scale tdd slice')
    expect(guidance.items[3].command).toBe('scale verify TASK-bug-404')
  })

  it('keeps S work lightweight', () => {
    const guidance = createWorkflowGuidance({
      taskId: 'TASK-small',
      description: 'Fix typo in README',
      level: 'S',
    })

    expect(guidance.items).toHaveLength(1)
    expect(guidance.items[0]).toMatchObject({
      id: 'verification',
      required: true,
      command: 'scale verify TASK-small',
    })
  })

  it('adds tool evidence guidance when UI or browser automation skills are involved', () => {
    const guidance = createWorkflowGuidance({
      taskId: 'TASK-ui',
      description: 'Improve upload dashboard empty state',
      level: 'M',
      artifactDir: 'docs/worklog/tasks/2026-05-18-ui',
      skillIntents: ['ui-ux', 'browser-automation'],
      requiredSkillVerification: ['visual QA screenshot required'],
    })

    const toolEvidence = guidance.items.find(item => item.id === 'tool-evidence')
    expect(toolEvidence?.required).toBe(true)
    expect(toolEvidence?.command).toContain('scale tool run')
    expect(toolEvidence?.command).toContain('--task-id TASK-ui')
    expect(renderWorkflowGuidance(guidance)).toContain('Next workflow commands')
  })
})
