import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function writeProject(projectDir: string) {
  mkdirSync(join(projectDir, 'docs', 'plans'), { recursive: true })
  mkdirSync(join(projectDir, '.scale'), { recursive: true })
  writeFileSync(join(projectDir, 'AGENTS.md'), '# Agent Rules\nAlways verify.\n', 'utf-8')
  writeFileSync(join(projectDir, 'CLAUDE.md'), '# Claude Rules\nKeep evidence.\n', 'utf-8')
  writeFileSync(join(projectDir, '.scale', 'verification.json'), '{"version":"1.0"}', 'utf-8')
  writeFileSync(join(projectDir, 'docs', 'plans', 'old-plan.md'), '# Historical Plan\n' + 'detail\n'.repeat(40), 'utf-8')
  writeFileSync(join(projectDir, 'docs', 'report.html'), '<html><body>generated</body></html>', 'utf-8')
}

describe('context budget CLI', () => {
  it('reports context categories and always-loaded tokens', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)

    const result = await runScale(['context', 'budget', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      thresholds: { maxAlwaysTokens: number; maxTaskTokens: number }
      summary: { alwaysTokens: number; byCategory: Record<string, { files: number }> }
      entries: Array<{ path: string; category: string }>
      promptCache: { provider: string; strategy: string; cacheEligibleTokens: number; cacheEligiblePaths: string[] }
    }>(result.stdout)
    expect(report.thresholds).toEqual({ maxAlwaysTokens: 1500, maxTaskTokens: 4000 })
    expect(report.summary.alwaysTokens).toBeGreaterThan(0)
    expect(report.summary.byCategory.always.files).toBeGreaterThan(0)
    expect(report.promptCache.provider).toBe('generic')
    expect(report.promptCache.strategy).toBe('usage-ledger-only')
    expect(report.promptCache.cacheEligibleTokens).toBe(report.summary.alwaysTokens)
    expect(report.promptCache.cacheEligiblePaths).toContain('AGENTS.md')
    expect(report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'AGENTS.md', category: 'always' }),
      expect.objectContaining({ path: 'docs/report.html', category: 'generated' }),
    ]))
  }, 120_000)

  it('reports provider-specific prompt cache policy for Anthropic', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)

    const result = await runScale(['context', 'budget', '--provider', 'anthropic', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      promptCache: {
        provider: string
        supported: boolean
        strategy: string
        usageMetrics: { cacheCreationInputTokens?: string; cacheReadInputTokens?: string }
      }
    }>(result.stdout)
    expect(report.promptCache.provider).toBe('anthropic')
    expect(report.promptCache.supported).toBe(true)
    expect(report.promptCache.strategy).toBe('anthropic-ephemeral')
    expect(report.promptCache.usageMetrics.cacheCreationInputTokens).toBe('cache_creation_input_tokens')
    expect(report.promptCache.usageMetrics.cacheReadInputTokens).toBe('cache_read_input_tokens')
  }, 120_000)

  it('scans an absolute SCALE_DIR as logical .scale context', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeFileSync(join(projectDir, 'AGENTS.md'), '# Agent Rules\nAlways verify.\n', 'utf-8')
    writeFileSync(join(scaleDir, 'verification.json'), '{"version":"1.0"}', 'utf-8')

    const result = await runScale(['context', 'budget', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      entries: Array<{ path: string; category: string }>
    }>(result.stdout)
    expect(report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.scale/verification.json', category: 'always' }),
    ]))
  }, 120_000)

  it('keeps lockfiles and nested agent worktrees out of the default context scan', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)
    mkdirSync(join(projectDir, '.claude', 'worktrees', 'agent-run'), { recursive: true })
    mkdirSync(join(projectDir, '.claude', 'skills', 'scale-engine'), { recursive: true })
    writeFileSync(join(projectDir, 'package-lock.json'), '{"lockfileVersion":3}', 'utf-8')
    writeFileSync(join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf-8')
    writeFileSync(join(projectDir, '.claude', 'worktrees', 'agent-run', 'README.md'), '# stale copy\n', 'utf-8')
    writeFileSync(join(projectDir, '.claude', 'skills', 'scale-engine', 'SKILL.md'), '# Active skill\n', 'utf-8')

    const result = await runScale(['context', 'budget', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{ entries: Array<{ path: string }> }>(result.stdout)
    const paths = report.entries.map(entry => entry.path)
    expect(paths).not.toContain('package-lock.json')
    expect(paths).not.toContain('pnpm-lock.yaml')
    expect(paths).not.toContain('.claude/worktrees/agent-run/README.md')
    expect(paths).toContain('.claude/skills/scale-engine/SKILL.md')
  }, 120_000)

  it('fails context doctor when always-loaded threshold is too low', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)

    const result = await runScale(['context', 'doctor', '--max-always', '1', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = parseJson<{ ok: boolean; checks: Array<{ name: string; status: string }> }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Always-loaded context', status: 'fail' }),
    ]))
  }, 120_000)

  it('separates task pack budget from large context inventory', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)
    mkdirSync(join(projectDir, '.scale', 'evidence'), { recursive: true })
    writeFileSync(
      join(projectDir, '.scale', 'evidence', 'huge-run.json'),
      JSON.stringify({ detail: 'runtime evidence\n'.repeat(10_000) }),
      'utf-8',
    )

    const result = await runScale([
      'context',
      'doctor',
      '--max-task',
      '1000',
      '--task',
      'Verify implementation with runtime evidence',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      checks: Array<{ name: string; status: string; message: string }>
      report: { entries?: unknown; largestEntries: unknown[] }
      taskPack: {
        totalEstimatedTokens: number
        omitted: Array<{ id: string }>
        sections: Array<{ id: string; pathCount: number; samplePaths: string[]; paths?: unknown }>
      }
    }>(result.stdout)
    expect(report.ok).toBe(true)
    expect(report.report).not.toHaveProperty('entries')
    expect(report.report.largestEntries.length).toBeLessThanOrEqual(8)
    expect(report.taskPack.totalEstimatedTokens).toBeLessThanOrEqual(1000)
    expect(report.taskPack.omitted.map(item => item.id)).toContain('runtime-evidence')
    const evidenceSection = report.taskPack.sections.find(section => section.id === 'runtime-evidence')
    expect(evidenceSection?.pathCount).toBeGreaterThan(0)
    expect(evidenceSection?.samplePaths.length).toBeLessThanOrEqual(8)
    expect(evidenceSection).not.toHaveProperty('paths')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Task context budget', status: 'pass' }),
      expect.objectContaining({ name: 'Context inventory', status: 'warn' }),
    ]))
  }, 120_000)

  it('builds a lazy-loaded context pack with explicit omissions under tight budget', async () => {
    const scaleDir = makeDir('scale-context-cli-scale-')
    const projectDir = makeDir('scale-context-cli-project-')
    writeProject(projectDir)

    const result = await runScale([
      'context',
      'pack',
      '--task',
      'Review release plan with browser evidence',
      '--level',
      'L',
      '--budget',
      '20',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const pack = parseJson<{
      lazyLoaded: Array<{ id: string }>
      omitted: Array<{ id: string }>
      sections: Array<{ id: string; included: boolean }>
    }>(result.stdout)
    expect(pack.sections.length).toBeGreaterThan(0)
    expect(pack.omitted.length).toBeGreaterThan(0)
  }, 120_000)
})
