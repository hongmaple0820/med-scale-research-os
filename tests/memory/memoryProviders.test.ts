import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const externalCommand = vi.hoisted(() => ({
  externalCommandExists: vi.fn(),
}))

const gbrainRuntime = vi.hoisted(() => ({
  runGbrainCommandSync: vi.fn(),
}))

vi.mock('../../src/core/ExternalCommand.js', () => externalCommand)
vi.mock('../../src/core/GbrainRuntime.js', () => gbrainRuntime)

import { importMemoryProviderKnowledge, inspectGbrainCliHealth, inspectMemoryProviders } from '../../src/memory/MemoryProviders.js'

const degradedDoctor = JSON.stringify({
  schema_version: 2,
  status: 'unhealthy',
  health_score: 55,
  checks: [
    { name: 'resolver_health', status: 'fail', message: 'skill resolver warnings' },
    { name: 'connection', status: 'ok', message: 'Connected, 0 pages' },
    { name: 'schema_version', status: 'ok', message: 'Version 80' },
    { name: 'brain_score', status: 'ok', message: 'Brain score 100/100' },
  ],
})

describe('MemoryProviders gbrain health', () => {
  beforeEach(() => {
    externalCommand.externalCommandExists.mockReset()
    gbrainRuntime.runGbrainCommandSync.mockReset()
  })

  it('treats configured gbrain as available when only non-recall doctor checks fail', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: `${degradedDoctor}\n[doctor.db_checks] done`,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const health = inspectGbrainCliHealth()

    expect(health).toMatchObject({
      available: true,
      degraded: false,
      status: 'unhealthy',
      healthScore: 55,
    })
    expect(health.reason).toContain('optional doctor warnings: resolver_health')
  })

  it('keeps gbrain unavailable when no brain is configured', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: '',
      stderr: 'No brain configured. Run: gbrain init',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const report = inspectMemoryProviders()
    const gbrain = report.providers.find(provider => provider.id === 'gbrain')

    expect(gbrain).toMatchObject({
      available: false,
      reason: 'gbrain CLI is installed but no brain is configured; run `gbrain init --pglite` before autonomous recall',
    })
  })

  it('marks gbrain provider available for recall-ready doctor output with optional warnings', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: degradedDoctor,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const report = inspectMemoryProviders()
    const gbrain = report.providers.find(provider => provider.id === 'gbrain')

    expect(gbrain).toMatchObject({
      id: 'gbrain',
      available: true,
    })
    expect(gbrain?.reason).toContain('optional doctor warnings: resolver_health')
  })

  it('recalls gbrain query output that times out after producing results', async () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') return {
        stdout: JSON.stringify({
          status: 'healthy',
          health_score: 100,
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      if (args[0] === 'query') {
        return {
          stdout: '[1.0000] scale-note -- Sentinel memory result',
          stderr: 'spawnSync bun.exe ETIMEDOUT',
          exitCode: 1,
          timedOut: true,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const { recallMemoryProviders } = await import('../../src/memory/MemoryProviders.js')
    const report = await recallMemoryProviders({
      provider: 'gbrain',
      query: 'Sentinel',
      limit: 3,
    })

    expect(report.ok).toBe(true)
    expect(report.selectedProviders).toEqual(['gbrain'])
    expect(report.items[0]).toMatchObject({
      provider: 'gbrain',
      title: 'scale-note',
      summary: 'Sentinel memory result',
    })
  })

  it('falls back to gbrain search when query returns no results in no-embed mode', async () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') return {
        stdout: JSON.stringify({
          status: 'healthy',
          health_score: 100,
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      if (args[0] === 'query') {
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      if (args[0] === 'search') {
        return {
          stdout: '[0.9000] medical-delivery -- fact check and quality gate workflow',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const { recallMemoryProviders } = await import('../../src/memory/MemoryProviders.js')
    const report = await recallMemoryProviders({
      provider: 'gbrain',
      query: 'fact check quality gate',
      limit: 3,
    })

    expect(report.ok).toBe(true)
    expect(report.selectedProviders).toEqual(['gbrain'])
    expect(report.items[0]).toMatchObject({
      provider: 'gbrain',
      title: 'medical-delivery',
      summary: 'fact check and quality gate workflow',
    })
    expect(gbrainRuntime.runGbrainCommandSync).toHaveBeenCalledWith(
      ['search', 'fact check quality gate'],
      expect.any(Object),
    )
  })

  it('stages curated markdown files and runs gbrain import with no-embed', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    const commands: string[][] = []
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      commands.push(args)
      if (args[0] === 'doctor') {
        return {
          stdout: JSON.stringify({
            status: 'healthy',
            health_score: 100,
            checks: [
              { name: 'connection', status: 'ok' },
              { name: 'schema_version', status: 'ok' },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      if (args[0] === 'import') {
        return {
          stdout: 'Found 2 markdown files\nImport complete:\n  2 pages imported',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const projectDir = mkdtempSync(join(tmpdir(), 'scale-memory-provider-import-'))
    try {
      writeFileSync(join(projectDir, 'README.md'), '# Repo README\n', 'utf-8')
      writeFileSync(join(projectDir, 'AGENTS.md'), '# Agent Guide\n', 'utf-8')
      const report = importMemoryProviderKnowledge({
        projectDir,
        scaleDir: '.scale',
        provider: 'gbrain',
        files: ['README.md', 'AGENTS.md'],
      })

      expect(report.ok).toBe(true)
      expect(report.fileCount).toBe(2)
      expect(report.command).toContain('gbrain import')
      expect(report.command).toContain('--no-embed')
      expect(report.stagingDir).toBeDefined()
      expect(report.stagedFiles).toHaveLength(2)
      expect(report.stagedFiles.every(file => existsSync(file))).toBe(true)
      expect(commands).toEqual(expect.arrayContaining([
        ['doctor', '--json'],
        ['import', report.stagingDir!, '--no-embed'],
      ]))
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('stages structured json artifacts with search hints for no-embed recall', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') {
        return {
          stdout: JSON.stringify({
            status: 'healthy',
            health_score: 100,
            checks: [
              { name: 'connection', status: 'ok' },
              { name: 'schema_version', status: 'ok' },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      return {
        stdout: 'Found 1 markdown files\nImport complete:\n  1 pages imported',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const projectDir = mkdtempSync(join(tmpdir(), 'scale-memory-provider-json-import-'))
    try {
      const reportPath = join(projectDir, 'EGFR_lung_cancer_manuscript_quality.json')
      writeFileSync(reportPath, JSON.stringify({ passed: true, score: 100, quality_gate: 'A' }), 'utf-8')

      const report = importMemoryProviderKnowledge({
        projectDir,
        scaleDir: '.scale',
        provider: 'gbrain',
        files: ['EGFR_lung_cancer_manuscript_quality.json'],
      })

      expect(report.ok).toBe(true)
      const staged = report.stagedFiles[0]
      expect(existsSync(staged)).toBe(true)
      const content = readFileSync(staged, 'utf-8')
      expect(content).toContain('Search hints: EGFR lung cancer manuscript quality')
      expect(content).toContain('Top-level keys: passed, score, quality_gate')
      expect(content).toContain('```json')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
