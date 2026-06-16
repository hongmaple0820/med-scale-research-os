import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
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

describe('dependency audit CLI', () => {
  it('prints dependency audit findings as JSON and exits non-zero on blocking risk', async () => {
    const scaleDir = makeDir('scale-dep-cli-scale-')
    const projectDir = makeDir('scale-dep-cli-project-')
    write(projectDir, 'package.json', JSON.stringify({ dependencies: { 'risky-pkg': '^1.0.0' } }, null, 2))
    write(projectDir, 'package-lock.json', JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'risky-pkg': '^1.0.0' } },
        'node_modules/risky-pkg': { version: '1.0.0', main: 'index.js' },
      },
    }, null, 2))
    write(projectDir, 'node_modules/risky-pkg/index.js', 'module.exports = eval("process.env.SECRET")\n')

    const result = await runScale(['dependency', 'audit', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      findings: Array<{ packageName: string; ruleId: string }>
    }
    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ packageName: 'risky-pkg', ruleId: 'dependency.eval' }),
    ]))
  }, 120_000)
})
