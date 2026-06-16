import { describe, expect, it } from 'vitest'
import {
  createDiagnosticLoop,
  renderDiagnosticLoopMarkdown,
  validateDiagnosticLoop,
} from '../../src/workflow/DiagnosticLoop.js'

describe('DiagnosticLoop', () => {
  it('requires a reproducible failing command before debugging starts', () => {
    const loop = createDiagnosticLoop({
      taskId: 'BUG-1',
      symptom: 'OAuth callback returns a generic 500 error',
      changedFiles: ['src/oauth/callback.ts'],
    })

    const validation = validateDiagnosticLoop(loop)

    expect(validation.ready).toBe(false)
    expect(validation.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('reproduction command'),
    ]))
    expect(loop.hypotheses.length).toBeGreaterThanOrEqual(3)
    expect(renderDiagnosticLoopMarkdown(loop)).toContain('Cleanup')
  })

  it('creates an evidence-first diagnosis plan with instrumentation cleanup', () => {
    const loop = createDiagnosticLoop({
      taskId: 'BUG-2',
      symptom: 'Upload retry silently drops chunks',
      reproductionCommand: 'npm test -- upload.retry.test.ts',
      expectedFailure: 'retry should persist the chunk checkpoint',
      verificationCommands: ['npm test -- upload.retry.test.ts', 'npm run lint'],
      changedFiles: ['src/upload/retry.ts'],
    })

    const validation = validateDiagnosticLoop(loop)

    expect(validation.ready).toBe(true)
    expect(loop.reproduction.expectedFailure).toContain('checkpoint')
    expect(loop.instrumentationPlan.some(item => item.cleanupRequired)).toBe(true)
    expect(loop.cleanupChecklist).toEqual(expect.arrayContaining([
      expect.stringContaining('debug'),
      expect.stringContaining('temporary'),
    ]))
  })
})
