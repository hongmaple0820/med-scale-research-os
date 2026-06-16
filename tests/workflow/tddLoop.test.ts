import { describe, expect, it } from 'vitest'
import {
  createTddSlice,
  evaluateTddSlice,
  renderTddSliceMarkdown,
} from '../../src/workflow/TddLoop.js'

describe('TddLoop', () => {
  it('blocks implementation until RED evidence proves the test fails for the right reason', () => {
    const slice = createTddSlice({
      taskId: 'TDD-1',
      behavior: 'Reject upload when tenant id is missing',
      publicInterface: 'POST /api/upload',
      failingTestCommand: 'npm test -- upload.auth.test.ts',
      testFile: 'tests/upload.auth.test.ts',
      implementationFiles: ['src/upload/handler.ts'],
    })

    const pending = evaluateTddSlice(slice)
    expect(pending.readyForImplementation).toBe(false)
    expect(pending.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('RED evidence'),
    ]))

    const red = evaluateTddSlice({
      ...slice,
      redEvidence: {
        command: 'npm test -- upload.auth.test.ts',
        exitCode: 1,
        outputSummary: 'expected 401, received 200',
      },
    })
    expect(red.readyForImplementation).toBe(true)
    expect(renderTddSliceMarkdown(slice)).toContain('Vertical Slice')
  })

  it('rejects a green first test because it cannot prove behavior changed', () => {
    const slice = createTddSlice({
      taskId: 'TDD-2',
      behavior: 'Mask tokens in application logs',
      publicInterface: 'logger.info',
      failingTestCommand: 'npm test -- logger.masking.test.ts',
      testFile: 'tests/logger.masking.test.ts',
      implementationFiles: ['src/logger.ts'],
      redEvidence: {
        command: 'npm test -- logger.masking.test.ts',
        exitCode: 0,
        outputSummary: 'test passed before implementation',
      },
    })

    const result = evaluateTddSlice(slice)

    expect(result.readyForImplementation).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('already passed'),
    ]))
  })
})
