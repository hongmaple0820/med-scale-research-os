import { describe, expect, it } from 'vitest'
import { normalizeGbrainSpawnResult } from '../../scripts/workflow/lib/gbrain-runtime.mjs'

describe('workflow gbrain runtime helper', () => {
  it('normalizes recoverable query timeouts for workflow smoke scripts', () => {
    const result = normalizeGbrainSpawnResult(['query', 'Sentinel'], {
      status: 1,
      stdout: '[1.0000] scale-note -- Sentinel memory result',
      stderr: '',
      error: new Error('spawnSync bun.exe ETIMEDOUT'),
    })

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      recoveredTimeout: true,
      stderr: '',
    })
  })

  it('does not normalize timeout failures without usable output', () => {
    const result = normalizeGbrainSpawnResult(['query', 'Sentinel'], {
      status: 1,
      stdout: '',
      stderr: '',
      error: new Error('spawnSync bun.exe ETIMEDOUT'),
    })

    expect(result).toMatchObject({
      exitCode: 1,
      timedOut: true,
      recoveredTimeout: false,
    })
  })
})
