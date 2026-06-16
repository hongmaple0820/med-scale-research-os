import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeGovernanceDrift, writeGovernanceLock } from '../../src/workflow/GovernanceLock.js'

describe('governance lock', () => {
  it('writes hashes for owned generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-lock-'))
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'workflow\n', 'utf-8')

    const lock = writeGovernanceLock(dir, {
      pack: 'project-scaffold',
      packVersion: 1,
      files: [{ path: 'docs/workflow/README.md', owned: true }],
      scaleVersion: '0.14.0-dev',
    })

    expect(lock.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reports modified generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-lock-'))
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'workflow\n', 'utf-8')
    writeGovernanceLock(dir, {
      pack: 'project-scaffold',
      packVersion: 1,
      files: [{ path: 'docs/workflow/README.md', owned: true }],
      scaleVersion: '0.14.0-dev',
    })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'changed\n', 'utf-8')

    const drift = computeGovernanceDrift(dir)

    expect(drift.lockExists).toBe(true)
    expect(drift.changed.map(item => item.path)).toEqual(['docs/workflow/README.md'])
  })

  it('reports missing generated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-lock-'))
    mkdirSync(join(dir, 'docs', 'workflow'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'workflow', 'README.md'), 'workflow\n', 'utf-8')
    writeGovernanceLock(dir, {
      pack: 'project-scaffold',
      packVersion: 1,
      files: [{ path: 'docs/workflow/README.md', owned: true }],
      scaleVersion: '0.14.0-dev',
    })

    const other = mkdtempSync(join(tmpdir(), 'scale-lock-missing-'))
    mkdirSync(join(other, '.scale'), { recursive: true })
    writeFileSync(join(other, '.scale', 'governance.lock.json'), JSON.stringify({
      version: 1,
      scalePackage: '@hongmaple0820/scale-engine',
      scaleVersion: '0.14.0-dev',
      pack: 'project-scaffold',
      packVersion: 1,
      generatedAt: new Date().toISOString(),
      files: [{ path: 'docs/workflow/README.md', sha256: '0'.repeat(64), owned: true }],
    }, null, 2), 'utf-8')

    const drift = computeGovernanceDrift(other)

    expect(drift.missing.map(item => item.path)).toEqual(['docs/workflow/README.md'])
  })
})
