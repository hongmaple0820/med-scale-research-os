import { describe, expect, it } from 'vitest'
import { compressCommandOutput, estimateCommandOutputTokens } from '../../src/tools/CommandOutputCompressor.js'

describe('compressCommandOutput', () => {
  it('keeps short output raw while still producing token metrics', () => {
    const result = compressCommandOutput({
      command: 'git status --short',
      stdout: ' M src/index.ts',
      exitCode: 0,
    })

    expect(result.strategy).toBe('bounded-raw')
    expect(result.compressedOutput).toBe('M src/index.ts')
    expect(result.rawEstimatedTokens).toBeGreaterThan(0)
    expect(result.savedEstimatedTokens).toBe(0)
    expect(result.rawSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('compresses verbose test output down to the actionable summary lines', () => {
    const noise = Array.from({ length: 180 }, (_, index) => `stdout noise line ${index}`).join('\n')
    const stdout = [
      ' RUN  v2.0.0 /repo',
      noise,
      ' Test Files  12 passed (12)',
      ' Tests  126 passed (126)',
      ' Duration  18.42s',
    ].join('\n')

    const result = compressCommandOutput({
      command: 'npm test',
      stdout,
      exitCode: 0,
      maxChars: 1200,
    })

    expect(result.strategy).toBe('vitest')
    expect(result.compressedOutput).toContain('Test Files')
    expect(result.compressedOutput).toContain('126 passed')
    expect(result.compressedOutput).not.toContain('stdout noise line 90')
    expect(result.savedEstimatedTokens).toBeGreaterThan(200)
    expect(result.truncated).toBe(true)
  })

  it('preserves TypeScript error lines from noisy typecheck output', () => {
    const noise = Array.from({ length: 120 }, (_, index) => `checking dependency ${index}`).join('\n')
    const stderr = [
      noise,
      "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/app.ts(11,5): error TS2552: Cannot find name 'missingValue'.",
    ].join('\n')

    const result = compressCommandOutput({
      command: 'npm run typecheck',
      stderr,
      exitCode: 2,
      maxChars: 1000,
    })

    expect(result.strategy).toBe('typescript')
    expect(result.compressedOutput).toContain('TS2322')
    expect(result.compressedOutput).toContain('TS2552')
    expect(result.compressedOutput).not.toContain('checking dependency 50')
    expect(result.savedEstimatedTokens).toBeGreaterThan(100)
  })

  it('estimates tokens with a stable local heuristic', () => {
    expect(estimateCommandOutputTokens('12345678')).toBe(2)
  })
})
