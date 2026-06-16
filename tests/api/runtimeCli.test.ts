import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('runtime CLI', () => {
  it('records runtime evidence and passes final check for scoped M work', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')

    const start = await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-CLI',
      '--task-id',
      'TASK-CLI',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(start.exitCode).toBe(0)
    expect(parseJson<{ sessionId: string }>(start.stdout).sessionId).toBe('SESSION-CLI')

    const record = await runScale([
      'runtime',
      'record',
      '--title',
      'build',
      '--status',
      'passed',
      '--command',
      'npm run build -- --token raw-token',
      '--exit-code',
      '0',
      '--summary',
      'build passed',
      '--json',
    ], scaleDir, projectDir)
    expect(record.exitCode).toBe(0)
    const evidence = parseJson<{ id: string; command: string; taskId: string; sessionId: string }>(record.stdout)
    expect(evidence.taskId).toBe('TASK-CLI')
    expect(evidence.sessionId).toBe('SESSION-CLI')
    expect(evidence.command).not.toContain('raw-token')

    const finalCheck = await runScale([
      'runtime',
      'final-check',
      '--task-id',
      'TASK-CLI',
      '--session-id',
      'SESSION-CLI',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(finalCheck.exitCode).toBe(0)
    expect(parseJson<{ ready: boolean }>(finalCheck.stdout).ready).toBe(true)
    expect(existsSync(join(scaleDir, 'events', 'sessions', 'SESSION-CLI.jsonl'))).toBe(true)
  }, 120_000)

  it('records model usage alongside runtime evidence when usage payload is provided', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-USAGE',
      '--task-id',
      'TASK-USAGE',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    const record = await runScale([
      'runtime',
      'record',
      '--title',
      'codex run',
      '--status',
      'passed',
      '--summary',
      'provider response captured',
      '--provider',
      'openai',
      '--model',
      'gpt-4.1',
      '--usage-json',
      '{"usage":{"input_tokens":800,"output_tokens":120,"input_tokens_details":{"cached_tokens":300}}}',
      '--json',
    ], scaleDir, projectDir)

    expect(record.exitCode).toBe(0)
    const output = parseJson<{
      evidence: { taskId: string; sessionId: string }
      usage: { provider: string; model: string; totalTokens: number; cachedTokens: number; cacheSavingsTokens: number }
    }>(record.stdout)
    expect(output.evidence.taskId).toBe('TASK-USAGE')
    expect(output.evidence.sessionId).toBe('SESSION-USAGE')
    expect(output.usage).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
      totalTokens: 920,
      cachedTokens: 300,
      cacheSavingsTokens: 300,
    })
  }, 120_000)

  it('fails final check when no passed evidence exists for M work', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')

    const result = await runScale([
      'runtime',
      'final-check',
      '--task-id',
      'TASK-NO-EVIDENCE',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const output = parseJson<{ ready: boolean; reasons: string[] }>(result.stdout)
    expect(output.ready).toBe(false)
    expect(output.reasons.join('\n')).toContain('No passed evidence')
  }, 120_000)

  it('allows expected red reproduction evidence when later passed evidence exists', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-RED',
      '--task-id',
      'TASK-RED',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    const red = await runScale([
      'runtime',
      'record',
      '--task-id',
      'TASK-RED',
      '--session-id',
      'SESSION-RED',
      '--title',
      'red reproduction',
      '--status',
      'failed',
      '--exit-code',
      '1',
      '--summary',
      'expected red reproduced bug',
      '--metadata-json',
      '{"expectedRed":true,"phase":"reproduce"}',
      '--json',
    ], scaleDir, projectDir)
    expect(red.exitCode).toBe(0)

    const green = await runScale([
      'runtime',
      'record',
      '--task-id',
      'TASK-RED',
      '--session-id',
      'SESSION-RED',
      '--title',
      'green regression',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'regression passed',
      '--json',
    ], scaleDir, projectDir)
    expect(green.exitCode).toBe(0)

    const finalCheck = await runScale([
      'runtime',
      'final-check',
      '--task-id',
      'TASK-RED',
      '--session-id',
      'SESSION-RED',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(finalCheck.exitCode).toBe(0)
    expect(parseJson<{ ready: boolean; report: { evidence: { expectedRed: number; failed: number } } }>(finalCheck.stdout)).toMatchObject({
      ready: true,
      report: {
        evidence: {
          expectedRed: 1,
          failed: 0,
        },
      },
    })
  }, 120_000)

  it('blocks final check under productSmokeGate=block until product smoke evidence is recorded', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      profiles: { default: { commands: {} } },
      policy: { productSmokeGate: 'block' },
    }, null, 2), 'utf-8')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-SMOKE',
      '--task-id',
      'TASK-SMOKE',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    await runScale([
      'runtime',
      'record',
      '--task-id',
      'TASK-SMOKE',
      '--session-id',
      'SESSION-SMOKE',
      '--title',
      'unit tests',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'unit tests passed',
      '--json',
    ], scaleDir, projectDir)

    const blocked = await runScale([
      'runtime',
      'final-check',
      '--task-id',
      'TASK-SMOKE',
      '--session-id',
      'SESSION-SMOKE',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(blocked.exitCode).toBe(1)
    expect(parseJson<{ reasons: string[] }>(blocked.stdout).reasons.join('\n')).toContain('No passed product smoke evidence')

    const smoke = await runScale([
      'runtime',
      'record',
      '--task-id',
      'TASK-SMOKE',
      '--session-id',
      'SESSION-SMOKE',
      '--title',
      'Product smoke: cross-driver copy',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'gateway -> netdisk -> storage task completed',
      '--metadata-json',
      '{"productSmoke":true}',
      '--json',
    ], scaleDir, projectDir)
    expect(smoke.exitCode).toBe(0)

    const ready = await runScale([
      'runtime',
      'final-check',
      '--task-id',
      'TASK-SMOKE',
      '--session-id',
      'SESSION-SMOKE',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(ready.exitCode).toBe(0)
    expect(parseJson<{ ready: boolean }>(ready.stdout).ready).toBe(true)
  }, 120_000)

  it('auto-records runtime evidence when productSmoke preflight passes', async () => {
    const scaleDir = makeDir('scale-runtime-cli-scale-')
    const projectDir = makeDir('scale-runtime-cli-project-')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'productSmoke',
      profiles: {
        productSmoke: {
          commands: {
            smoke: 'node -p 42',
          },
        },
      },
      policy: {
        productSmokeGate: 'block',
      },
    }, null, 2), 'utf-8')

    const preflight = await runScale([
      'preflight',
      '--profile',
      'productSmoke',
      '--json',
    ], scaleDir, projectDir)
    expect(preflight.exitCode).toBe(0)
    expect(parseJson<{ passed: boolean; gates: string[] }>(preflight.stdout)).toMatchObject({
      passed: true,
      gates: ['G8'],
    })

    const finalCheck = await runScale([
      'runtime',
      'final-check',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(finalCheck.exitCode).toBe(0)
    const readiness = parseJson<{ ready: boolean; report: { evidence: { passed: number } } }>(finalCheck.stdout)
    expect(readiness.ready).toBe(true)
    expect(readiness.report.evidence.passed).toBe(1)
  }, 120_000)
})
