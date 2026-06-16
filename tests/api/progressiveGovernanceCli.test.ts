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

describe('progressive governance CLI', () => {
  it('keeps low-risk README work in minimal mode', async () => {
    const scaleDir = makeDir('scale-governance-cli-scale-')
    const projectDir = makeDir('scale-governance-cli-project-')

    const result = await runScale([
      'governance',
      'mode',
      '--task',
      'Fix README typo',
      '--files',
      'README.md',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{ recommendedMode: string; effectiveMode: string; signals: Array<{ id: string }> }>(result.stdout)
    expect(report.recommendedMode).toBe('minimal')
    expect(report.effectiveMode).toBe('minimal')
    expect(report.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'docs-only-low-risk' }),
    ]))
  }, 120_000)

  it('escalates critical work even when minimal mode is requested', async () => {
    const scaleDir = makeDir('scale-governance-cli-scale-')
    const projectDir = makeDir('scale-governance-cli-project-')

    const result = await runScale([
      'governance',
      'mode',
      '--task',
      'Change auth permissions and database migration',
      '--files',
      'src/auth/user.ts,migrations/001_create_user.sql',
      '--requested-mode',
      'minimal',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{ recommendedMode: string; effectiveMode: string; escalated: boolean; signals: Array<{ id: string }> }>(result.stdout)
    expect(report.recommendedMode).toBe('critical')
    expect(report.effectiveMode).toBe('critical')
    expect(report.escalated).toBe(true)
    expect(report.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'critical-risk-domain' }),
    ]))
  }, 120_000)

  it('reports governance ROI with context and progressive governance modules', async () => {
    const scaleDir = makeDir('scale-governance-cli-scale-')
    const projectDir = makeDir('scale-governance-cli-project-')

    const result = await runScale([
      'governance',
      'roi',
      '--task-id',
      'TASK-ROI',
      '--task',
      'Review frontend route with browser evidence',
      '--files',
      'src/routes/upload.tsx',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{ taskId: string; modules: Array<{ module: string; evidenceLevel: string }> }>(result.stdout)
    expect(report.taskId).toBe('TASK-ROI')
    expect(report.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'context-budget', evidenceLevel: 'estimated' }),
      expect.objectContaining({ module: 'progressive-governance', evidenceLevel: 'estimated' }),
    ]))
  }, 120_000)
})
