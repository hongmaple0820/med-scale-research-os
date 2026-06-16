import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BackgroundHunter, HuntFindingStore } from '../../src/workflow/autonomous/BackgroundHunter.js'
import { engineeringStandardsPolicyTemplate } from '../../src/workflow/EngineeringStandards.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-hunter-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

describe('BackgroundHunter', () => {
  it('finds standards debt and turns it into a diagnostic loop input without modifying code', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/service/payment.ts', `
export function paymentConfig() {
  const apiToken = "sk_live_1234567890abcdef"
  return { apiToken }
}
`)
    const before = readFileSync(join(projectDir, 'src', 'service', 'payment.ts'), 'utf-8')

    const report = new BackgroundHunter({ projectDir }).scan({ now: new Date('2026-05-20T00:00:00Z') })

    expect(report.summary.open).toBe(1)
    expect(report.summary.bySource['engineering-standards']).toBe(1)
    expect(report.findings[0]).toEqual(expect.objectContaining({
      source: 'engineering-standards',
      status: 'open',
      ruleId: 'hardcoded-secret',
      path: 'src/service/payment.ts',
      severity: 'fail',
    }))
    expect(report.findings[0].diagnosticInput).toEqual(expect.objectContaining({
      taskId: expect.stringMatching(/^HUNT-/),
      changedFiles: ['src/service/payment.ts'],
      verificationCommands: ['scale standards doctor --changed-files src/service/payment.ts'],
    }))
    expect(readFileSync(join(projectDir, 'src', 'service', 'payment.ts'), 'utf-8')).toBe(before)
  })

  it('keeps ignored findings out of the open queue using a stable fingerprint', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/service/payment.ts', `
export function paymentConfig() {
  const apiToken = "sk_live_1234567890abcdef"
  return { apiToken }
}
`)
    const hunter = new BackgroundHunter({ projectDir })
    const firstReport = hunter.scan({ now: new Date('2026-05-20T00:00:00Z') })
    const finding = firstReport.findings[0]

    new HuntFindingStore({ projectDir }).ignore({
      id: finding.id,
      fingerprint: finding.fingerprint,
      reason: 'Accepted fixture risk for this synthetic project.',
      ignoredAt: '2026-05-20T00:00:00.000Z',
    })
    const secondReport = hunter.scan({ now: new Date('2026-05-20T00:00:00Z') })

    expect(secondReport.summary.open).toBe(0)
    expect(secondReport.summary.ignored).toBe(1)
    expect(secondReport.findings[0]).toEqual(expect.objectContaining({
      id: finding.id,
      fingerprint: finding.fingerprint,
      status: 'ignored',
      ignoreReason: 'Accepted fixture risk for this synthetic project.',
    }))
  })
})
