import { describe, expect, it } from 'vitest'
import { blockingWorkflowOpenTasks, nextWorkflowOpenTask, removeWorkflowOpenTask, toolEvidenceRunCompletesOpenTask } from '../../src/workflow/WorkflowOpenTasks.js'

describe('WorkflowOpenTasks', () => {
  it('removes a completed workflow command by kind', () => {
    const tasks = [
      'scale context grill --task-id TASK-1',
      'scale diagnose plan --task-id TASK-1',
      'scale tdd slice --task-id TASK-1',
    ]

    expect(removeWorkflowOpenTask(tasks, 'context-grill')).toEqual([
      'scale diagnose plan --task-id TASK-1',
      'scale tdd slice --task-id TASK-1',
    ])
  })

  it('surfaces blockers before later executable commands', () => {
    expect(nextWorkflowOpenTask([
      'Diagnostic loop needs reproduction command.',
      'scale tdd slice --task-id TASK-1',
    ])).toEqual({
      kind: 'blocker',
      value: 'Diagnostic loop needs reproduction command.',
    })
  })

  it('blocks verification until prior workflow open tasks are complete', () => {
    expect(blockingWorkflowOpenTasks([
      'scale context grill --task-id TASK-1',
      'scale verify TASK-1',
      'Diagnostic loop needs reproduction command.',
    ], 'TASK-1')).toEqual([
      'scale context grill --task-id TASK-1',
      'Diagnostic loop needs reproduction command.',
    ])
  })

  it('only completes tool evidence tasks after real passed evidence', () => {
    expect(toolEvidenceRunCompletesOpenTask({
      ok: true,
      dryRun: false,
      evidence: [{ status: 'passed' }],
    })).toBe(true)
    expect(toolEvidenceRunCompletesOpenTask({
      ok: true,
      dryRun: true,
      evidence: [{ status: 'skipped' }],
    })).toBe(false)
    expect(toolEvidenceRunCompletesOpenTask({
      ok: true,
      dryRun: false,
      evidence: [{ status: 'skipped' }],
    })).toBe(false)
  })
})
