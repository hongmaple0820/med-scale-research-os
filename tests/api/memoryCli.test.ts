import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  return runScaleWithEnv(args, scaleDir, projectDir)
}

async function runScaleWithEnv(args: string[], scaleDir: string, projectDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      ...extraEnv,
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

describe('memory CLI', () => {
  it('creates and inspects autonomous memory provider routing policy', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const init = await runScale(['memory', 'provider', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)
    const initReport = parseJson<{ written: boolean; path: string; config: { routing: { defaultOrder: string[] } } }>(init.stdout)
    expect(initReport.written).toBe(true)
    expect(initReport.config.routing.defaultOrder).toEqual(['gbrain', 'scale-local'])
    expect(existsSync(initReport.path)).toBe(true)

    const status = await runScale(['memory', 'provider', 'status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusReport = parseJson<{
      configExists: boolean
      providers: Array<{ id: string; available: boolean; safetyLevel: string; writeMode: string }>
      warnings: string[]
    }>(status.stdout)
    expect(statusReport.configExists).toBe(true)
    expect(statusReport.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agentmemory', available: false, safetyLevel: 'review-required', writeMode: 'disabled' }),
      expect.objectContaining({ id: 'gbrain', safetyLevel: 'review-required', writeMode: 'disabled' }),
      expect.objectContaining({ id: 'scale-local', available: true, safetyLevel: 'trusted-local', writeMode: 'candidate-only' }),
    ]))
    expect(statusReport.warnings).toEqual([])
  }, 120_000)

  it('switches the preferred memory provider and persists routing order', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const init = await runScale(['memory', 'provider', 'init', '--json'], scaleDir, projectDir)
    expect(init.exitCode).toBe(0)

    const switched = await runScale(['memory', 'provider', 'use', 'scale-local', '--json'], scaleDir, projectDir)
    expect(switched.exitCode).toBe(0)
    const switchedReport = parseJson<{
      ok: boolean
      provider: string
      mode: string
      previousOrder: string[]
      nextOrder: string[]
    }>(switched.stdout)
    expect(switchedReport).toMatchObject({
      ok: true,
      provider: 'scale-local',
      mode: 'local-only',
    })
    expect(switchedReport.previousOrder).toEqual(['gbrain', 'scale-local'])
    expect(switchedReport.nextOrder[0]).toBe('scale-local')

    const status = await runScale(['memory', 'provider', 'status', '--json'], scaleDir, projectDir)
    expect(status.exitCode).toBe(0)
    const statusReport = parseJson<{ routing: { mode: string; defaultOrder: string[] } }>(status.stdout)
    expect(statusReport.routing.mode).toBe('local-only')
    expect(statusReport.routing.defaultOrder[0]).toBe('scale-local')
  }, 120_000)

  it('renders a memory context pack for a scoped task', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-MEM',
      '--task-id',
      'TASK-MEM',
      '--level',
      'M',
      '--summary',
      'Memory context pack',
    ], scaleDir, projectDir)
    await runScale([
      'runtime',
      'record',
      '--title',
      'unit tests',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'memory tests passed',
    ], scaleDir, projectDir)

    const result = await runScale([
      'memory',
      'pack',
      '--task-id',
      'TASK-MEM',
      '--session-id',
      'SESSION-MEM',
      '--task',
      'Build a memory context pack',
      '--level',
      'M',
      '--budget',
      '2000',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const pack = parseJson<{ task: { taskId: string }; sections: Array<{ id: string; included: boolean }> }>(result.stdout)
    expect(pack.task.taskId).toBe('TASK-MEM')
    expect(pack.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-evidence', included: true }),
      expect.objectContaining({ id: 'session-events', included: true }),
    ]))
  }, 120_000)

  it('recalls local provider memory and injects it into the context pack', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')
    const memoryFile = join(projectDir, 'memory.jsonl')
    writeFileSync(memoryFile, JSON.stringify({
      id: 'MEM-provider-oauth',
      type: 'decision',
      title: 'OAuth callback uses Redis state',
      summary: 'OAuth callback state must be resolved server-side from Redis before provider binding continues.',
      entities: ['oauth', 'redis', 'callback'],
      source: 'manual',
      evidencePaths: ['docs/oauth-state-evidence.md'],
      confidence: 0.86,
      scope: 'project',
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
      lastVerifiedAt: '2026-05-20T00:00:00.000Z',
      metadata: {},
    }) + '\n', 'utf-8')

    const imported = await runScale(['memory', 'import', memoryFile, '--json'], scaleDir, projectDir)
    expect(imported.exitCode).toBe(0)

    const recall = await runScale([
      'memory',
      'provider',
      'recall',
      'OAuth Redis callback state',
      '--json',
    ], scaleDir, projectDir)
    expect(recall.exitCode).toBe(0)
    const recallReport = parseJson<{
      ok: boolean
      selectedProviders: string[]
      fallbackUsed: boolean
      items: Array<{ provider: string; id: string; title: string }>
      warnings: string[]
    }>(recall.stdout)
    expect(recallReport.ok).toBe(true)
    expect(recallReport.selectedProviders).toContain('scale-local')
    expect(recallReport.fallbackUsed).toBe(true)
    expect(recallReport.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'scale-local', id: 'MEM-provider-oauth' }),
    ]))
    expect(recallReport.warnings).toEqual([])

    const packResult = await runScale([
      'memory',
      'pack',
      '--task',
      'Fix OAuth callback state lookup',
      '--budget',
      '4000',
      '--json',
    ], scaleDir, projectDir)
    expect(packResult.exitCode).toBe(0)
    const pack = parseJson<{ sections: Array<{ id: string; included: boolean; items: Array<{ type: string; provider?: string; id?: string }> }> }>(packResult.stdout)
    const providerMemory = pack.sections.find(section => section.id === 'provider-memory')
    expect(providerMemory).toMatchObject({ included: true })
    expect(providerMemory?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'provider-memory', provider: 'scale-local', id: 'MEM-provider-oauth' }),
    ]))
  }, 120_000)

  it('imports curated markdown into gbrain through the provider CLI', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')
    const binDir = makeDir('scale-memory-cli-bin-')
    const gbrainLog = join(projectDir, 'gbrain-invocations.log')

    writeFileSync(join(projectDir, 'README.md'), '# Repo README\n', 'utf-8')
    const docsDir = join(projectDir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(projectDir, 'AGENTS.md'), '# Agent Guide\n', 'utf-8')
    writeFileSync(join(binDir, 'gbrain.cmd'), [
      '@echo off',
      'echo %*>>"%GBRAIN_TEST_LOG%"',
      'if "%1"=="doctor" (',
      '  echo {"status":"healthy","health_score":100,"checks":[{"name":"connection","status":"ok"},{"name":"schema_version","status":"ok"}]}',
      '  exit /b 0',
      ')',
      'if "%1"=="import" (',
      '  echo Found 2 markdown files',
      '  echo Import complete',
      '  echo   2 pages imported',
      '  exit /b 0',
      ')',
      'echo unsupported %1 1>&2',
      'exit /b 1',
      '',
    ].join('\r\n'), 'utf-8')
    writeFileSync(join(docsDir, 'MEMORY_FABRIC.md'), '# Memory Fabric\n', 'utf-8')

    const init = await runScaleWithEnv(['memory', 'provider', 'init', '--json'], scaleDir, projectDir, {
      PATH: `${binDir};${process.env.PATH ?? ''}`,
      GBRAIN_TEST_LOG: gbrainLog,
    })
    expect(init.exitCode).toBe(0)

    const imported = await runScaleWithEnv([
      'memory',
      'provider',
      'import',
      'gbrain',
      '--files',
      'README.md,docs/MEMORY_FABRIC.md',
      '--json',
    ], scaleDir, projectDir, {
      PATH: `${binDir};${process.env.PATH ?? ''}`,
      GBRAIN_TEST_LOG: gbrainLog,
    })

    expect(imported.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      provider: string
      sourceMode: string
      fileCount: number
      stagingDir?: string
      stagedFiles: string[]
      command?: string
    }>(imported.stdout)
    expect(report).toMatchObject({
      ok: true,
      provider: 'gbrain',
      sourceMode: 'files',
      fileCount: 2,
    })
    expect(report.command).toContain('--no-embed')
    expect(report.stagingDir && existsSync(report.stagingDir)).toBe(true)
    expect(report.stagedFiles).toHaveLength(2)
    const log = existsSync(gbrainLog) ? parseJsonLines(gbrainLog) : []
    expect(log.some(line => line.startsWith('doctor --json'))).toBe(true)
    expect(log.some(line => line.includes('import') && line.includes('--no-embed'))).toBe(true)
  }, 120_000)

  it('fails memory doctor when a context pack would exceed its budget', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    const result = await runScale([
      'memory',
      'doctor',
      '--task',
      'Review a very large cross module architecture change with many known risks and long context',
      '--level',
      'L',
      '--budget',
      '10',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = parseJson<{ ok: boolean; checks: Array<{ name: string; status: string }> }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Context budget', status: 'fail' }),
    ]))
  }, 120_000)

  it('settles a memory learning candidate from runtime evidence', async () => {
    const scaleDir = makeDir('scale-memory-cli-scale-')
    const projectDir = makeDir('scale-memory-cli-project-')

    await runScale([
      'runtime',
      'start',
      '--session-id',
      'SESSION-SETTLE',
      '--task-id',
      'TASK-SETTLE',
      '--level',
      'M',
      '--summary',
      'Memory settlement',
    ], scaleDir, projectDir)
    await runScale([
      'runtime',
      'record',
      '--title',
      'unit tests',
      '--status',
      'passed',
      '--exit-code',
      '0',
      '--summary',
      'memory settle tests passed',
    ], scaleDir, projectDir)

    const result = await runScale([
      'memory',
      'settle',
      '--task-id',
      'TASK-SETTLE',
      '--session-id',
      'SESSION-SETTLE',
      '--task',
      'Settle runtime evidence into learning',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const output = parseJson<{
      candidate: { status: string; recommendedAction: string; promotable: boolean; evidenceIds: string[] }
      files: { json: string; markdown: string }
    }>(result.stdout)
    expect(output.candidate).toMatchObject({
      status: 'candidate',
      recommendedAction: 'review-for-knowledge-base',
      promotable: true,
    })
    expect(output.candidate.evidenceIds.length).toBeGreaterThan(0)
    expect(existsSync(output.files.json)).toBe(true)
    expect(existsSync(output.files.markdown)).toBe(true)
  }, 120_000)
})

function parseJsonLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf-8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}
