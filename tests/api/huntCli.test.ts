import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { engineeringStandardsPolicyTemplate } from '../../src/workflow/EngineeringStandards.js'

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

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
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

function writeRiskyProject(projectDir: string): void {
  write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
  write(projectDir, 'src/service/payment.ts', `
export function paymentConfig() {
  const apiToken = "sk_live_1234567890abcdef"
  return { apiToken }
}
`)
}

describe('hunt CLI', () => {
  it('scans, diagnoses, and ignores readonly hunt findings', async () => {
    const scaleDir = makeDir('scale-hunt-cli-scale-')
    const projectDir = makeDir('scale-hunt-cli-project-')
    writeRiskyProject(projectDir)

    const scan = await runScale(['hunt', 'scan', '--json'], scaleDir, projectDir)

    expect(scan.exitCode).toBe(0)
    const report = parseJson<{
      summary: { open: number; ignored: number }
      findings: Array<{ id: string; path: string; status: string }>
    }>(scan.stdout)
    expect(report.summary.open).toBe(1)
    expect(report.findings[0]).toEqual(expect.objectContaining({
      path: 'src/service/payment.ts',
      status: 'open',
    }))

    const diagnose = await runScale(['hunt', 'diagnose', report.findings[0].id, '--json'], scaleDir, projectDir)

    expect(diagnose.exitCode).toBe(0)
    const diagnostic = parseJson<{
      loop: { changedFiles: string[]; verificationCommands: string[] }
      validation: { ready: boolean }
    }>(diagnose.stdout)
    expect(diagnostic.loop.changedFiles).toEqual(['src/service/payment.ts'])
    expect(diagnostic.loop.verificationCommands).toContain('scale standards doctor --changed-files src/service/payment.ts')

    const ignore = await runScale([
      'hunt',
      'ignore',
      report.findings[0].id,
      '--reason',
      'Synthetic fixture accepted.',
      '--json',
    ], scaleDir, projectDir)

    expect(ignore.exitCode).toBe(0)
    const ignored = await runScale(['hunt', 'scan', '--json'], scaleDir, projectDir)
    const ignoredReport = parseJson<{ summary: { open: number; ignored: number } }>(ignored.stdout)
    expect(ignoredReport.summary.open).toBe(0)
    expect(ignoredReport.summary.ignored).toBe(1)
  }, 120_000)
})
