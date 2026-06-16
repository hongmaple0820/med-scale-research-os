import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { detectVerificationCommands } from '../../src/workflow/VerificationCommands.js'

let dirs: string[] = []

function makeProject(packageJson: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-commands-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8')
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content, 'utf-8')
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('detectVerificationCommands', () => {
  it('uses npm when package-lock is present', () => {
    const dir = makeProject({
      scripts: { build: 'tsc', lint: 'eslint .', test: 'vitest' },
    }, { 'package-lock.json': '{}' })

    const commands = detectVerificationCommands(dir)

    expect(commands.packageManager).toBe('npm')
    expect(commands.build.command).toBe('npm run build')
    expect(commands.build.cwd).toBe(dir)
    expect(commands.lint.command).toBe('npm run lint')
    expect(commands.test.command).toBe('npm test')
    expect(commands.coverage.source).toBe('missing')
    expect(commands.coverage.reason).toContain('no "coverage" script')
  })

  it('uses an explicit coverage script instead of guessing coverage flags', () => {
    const dir = makeProject({
      scripts: { test: 'vitest', coverage: 'vitest run --coverage' },
    })

    const commands = detectVerificationCommands(dir)

    expect(commands.coverage.command).toBe('npm run coverage')
    expect(commands.coverage.source).toBe('package-script')
  })

  it('honors declared packageManager before lockfiles', () => {
    const dir = makeProject({
      packageManager: 'pnpm@9.0.0',
      scripts: { typecheck: 'tsc --noEmit', test: 'vitest' },
    }, { 'package-lock.json': '{}', 'pnpm-lock.yaml': '' })

    const commands = detectVerificationCommands(dir)

    expect(commands.packageManager).toBe('pnpm')
    expect(commands.build.command).toBe('pnpm run typecheck')
    expect(commands.build.source).toBe('fallback')
    expect(commands.test.command).toBe('pnpm test')
  })

  it('returns missing commands when package scripts are absent', () => {
    const dir = makeProject({ scripts: {} })

    const commands = detectVerificationCommands(dir)

    expect(commands.lint.source).toBe('missing')
    expect(commands.test.source).toBe('missing')
    expect(commands.coverage.source).toBe('missing')
    expect(commands.smoke.source).toBe('missing')
  })

  it('uses overrides over detected scripts', () => {
    const dir = makeProject({
      scripts: { build: 'tsc', lint: 'eslint .', test: 'vitest', coverage: 'vitest --coverage', smoke: 'node smoke.js' },
    })

    const commands = detectVerificationCommands(dir, {
      build: 'custom build',
      lint: 'custom lint',
      test: 'custom test',
      coverage: 'custom coverage',
      smoke: 'custom smoke',
    })

    expect(commands.build.command).toBe('custom build')
    expect(commands.lint.command).toBe('custom lint')
    expect(commands.test.command).toBe('custom test')
    expect(commands.coverage.command).toBe('custom coverage')
    expect(commands.smoke.command).toBe('custom smoke')
  })

  it('detects package smoke scripts for product path checks', () => {
    const dir = makeProject({
      scripts: { smoke: 'node smoke.js' },
    })

    const commands = detectVerificationCommands(dir)

    expect(commands.smoke.command).toBe('npm run smoke')
    expect(commands.smoke.source).toBe('package-script')
  })
})
