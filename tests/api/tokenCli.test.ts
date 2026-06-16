import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

describe('token CLI', () => {
  it('records model usage from provider payloads and reports usage by day', async () => {
    const scaleDir = makeDir('scale-token-cli-scale-')
    const projectDir = makeDir('scale-token-cli-project-')

    const anthropic = await runScale([
      'token',
      'record',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4',
      '--task-id',
      'TASK-ANTHROPIC',
      '--usage-json',
      '{"usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":700,"cache_read_input_tokens":500}}',
      '--timestamp',
      '2026-05-23T10:00:00.000Z',
      '--json',
    ], scaleDir, projectDir)
    expect(anthropic.exitCode).toBe(0)
    expect(parseJson<{ totalTokens: number }>(anthropic.stdout).totalTokens).toBe(1200)

    const openai = await runScale([
      'token',
      'record',
      '--provider',
      'openai',
      '--model',
      'gpt-4.1',
      '--task-id',
      'TASK-OPENAI',
      '--usage-json',
      '{"usage":{"prompt_tokens":400,"completion_tokens":80,"prompt_tokens_details":{"cached_tokens":220}}}',
      '--timestamp',
      '2026-05-24T10:00:00.000Z',
      '--json',
    ], scaleDir, projectDir)
    expect(openai.exitCode).toBe(0)
    expect(parseJson<{ cacheSavingsTokens: number }>(openai.stdout).cacheSavingsTokens).toBe(220)

    const report = await runScale([
      'token',
      'report',
      '--day',
      '2026-05-23',
      '--json',
    ], scaleDir, projectDir)
    expect(report.exitCode).toBe(0)
    expect(parseJson<{
      summary: { totalRecords: number; totalTokens: number; cacheReadInputTokens: number }
      byProvider: Array<{ key: string; totalTokens: number }>
      byTask: Array<{ key: string }>
      records: Array<{ provider: string; model: string }>
    }>(report.stdout)).toMatchObject({
      summary: {
        totalRecords: 1,
        totalTokens: 1200,
        cacheReadInputTokens: 500,
      },
      byProvider: [
        { key: 'anthropic', totalTokens: 1200 },
      ],
      byTask: [
        { key: 'TASK-ANTHROPIC' },
      ],
      records: [
        { provider: 'anthropic', model: 'claude-sonnet-4' },
      ],
    })
  }, 120_000)
})
