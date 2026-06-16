import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { auditDependencies, dependencyAuditPolicyTemplate } from '../../src/guardrails/DependencyAuditor.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-deps-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

function writeLock(projectDir: string): void {
  write(projectDir, 'package.json', JSON.stringify({
    dependencies: {
      'risky-pkg': '^1.0.0',
      'script-pkg': '^2.0.0',
    },
  }, null, 2))
  write(projectDir, 'package-lock.json', JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {
        dependencies: {
          'risky-pkg': '^1.0.0',
          'script-pkg': '^2.0.0',
        },
      },
      'node_modules/risky-pkg': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/risky-pkg/-/risky-pkg-1.0.0.tgz',
        integrity: 'sha512-test',
        main: 'index.js',
      },
      'node_modules/script-pkg': {
        version: '2.0.0',
        hasInstallScript: true,
        bin: {
          'script-pkg': 'cli.js',
        },
      },
    },
  }, null, 2))
}

describe('DependencyAuditor', () => {
  it('flags dangerous dependency source and install-time behavior without full node_modules scanning', () => {
    const projectDir = makeProject()
    writeLock(projectDir)
    write(projectDir, 'node_modules/risky-pkg/index.js', 'module.exports = eval("process.env.SECRET")\n')
    write(projectDir, 'node_modules/script-pkg/cli.js', 'console.log("cli")\n')

    const report = auditDependencies({ projectDir, mode: 'compatibility' })

    expect(report.ok).toBe(false)
    expect(report.summary.packagesAudited).toBe(2)
    expect(report.summary.bySeverity.CRITICAL).toBe(1)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageName: 'risky-pkg',
        ruleId: 'dependency.eval',
        severity: 'CRITICAL',
      }),
      expect.objectContaining({
        packageName: 'script-pkg',
        ruleId: 'dependency.install-script',
        severity: 'HIGH',
      }),
      expect.objectContaining({
        packageName: 'script-pkg',
        ruleId: 'dependency.bin-script',
        severity: 'MEDIUM',
      }),
    ]))
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('dependency.eval'),
    ]))
    expect(report.blockers.some(blocker => blocker.includes('dependency.install-script'))).toBe(false)
  })

  it('blocks high dependency findings in strict mode', () => {
    const projectDir = makeProject()
    writeLock(projectDir)

    const report = auditDependencies({ projectDir, mode: 'strict' })

    expect(report.ok).toBe(false)
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('dependency.install-script'),
    ]))
  })

  it('flags built-in ownership instability watchlist versions', () => {
    const projectDir = makeProject()
    write(projectDir, 'package.json', JSON.stringify({
      dependencies: {
        'type-is': '^2.0.1',
      },
    }, null, 2))
    write(projectDir, 'package-lock.json', JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          dependencies: {
            'type-is': '^2.0.1',
          },
        },
        'node_modules/type-is': {
          version: '2.1.0',
        },
      },
    }, null, 2))

    const report = auditDependencies({ projectDir, mode: 'strict' })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageName: 'type-is',
        version: '2.1.0',
        ruleId: 'dependency.ownership-unstable',
        severity: 'HIGH',
      }),
    ]))
  })

  it('suppresses accepted dependency findings through the policy baseline', () => {
    const projectDir = makeProject()
    writeLock(projectDir)
    write(projectDir, 'node_modules/risky-pkg/index.js', 'module.exports = eval("process.env.SECRET")\n')
    write(projectDir, '.scale/security/dependency-policy.json', JSON.stringify({
      ...JSON.parse(dependencyAuditPolicyTemplate()),
      baselineFindings: [
        {
          packageName: 'risky-pkg',
          version: '1.0.0',
          ruleId: 'dependency.eval',
          reason: 'Tracked as legacy dependency risk.',
        },
      ],
    }, null, 2))

    const report = auditDependencies({ projectDir, mode: 'compatibility' })

    expect(report.findings.some(finding => finding.ruleId === 'dependency.eval')).toBe(false)
    expect(report.ok).toBe(true)
  })
})
