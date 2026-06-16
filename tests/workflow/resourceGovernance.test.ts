import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  doctorResourceAssets,
  resourceManifestPath,
  resourcePolicyPath,
  resourcePolicyTemplate,
  scanResourceAssets,
  settleResourceAssets,
} from '../../src/workflow/ResourceGovernance.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-resource-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content = 'x'): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

describe('ResourceGovernance', () => {
  it('resolves absolute scale directories without nesting them under the project path', () => {
    const projectDir = makeProject()
    const scaleDir = makeProject()

    expect(resourcePolicyPath(projectDir, scaleDir)).toBe(join(scaleDir, 'resource-policy.json'))
    expect(resourceManifestPath(projectDir, scaleDir)).toBe(join(scaleDir, 'assets.json'))
  })

  it('classifies maintained docs, task artifacts, runtime evidence, scripts, and media', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/resource-policy.json', resourcePolicyTemplate())
    write(projectDir, 'docs/modules/auth/architecture.md', '# Auth architecture\n')
    write(projectDir, '.planning/tasks/2026-05-15-demo/reality-check.md', '# Reality Check\n')
    write(projectDir, 'docs/worklog/tasks/2026-05-15-demo/summary.md', '# Summary\n')
    write(projectDir, 'docs/worklog/tasks/2026-05-15-demo/artifacts/release-report.html', '<!doctype html>\n')
    write(projectDir, 'docs/worklog/tasks/2026-05-15-demo/artifact-manifest.json', '{}\n')
    write(projectDir, 'test-results/upload-flow/report.json', '{}\n')
    write(projectDir, 'scripts/verify.sh', '#!/usr/bin/env bash\n')
    write(projectDir, 'tmp/probe.sql', 'select 1;\n')
    write(projectDir, 'docs/imgs/screenshot.png', 'png\n')
    write(projectDir, 'openapi/auth.openapi.yaml', 'openapi: 3.0.0\n')

    const report = scanResourceAssets({ projectDir })

    expect(report.summary.byType['canonical-doc']).toBeGreaterThanOrEqual(2)
    expect(report.summary.byType['task-artifact']).toBe(4)
    expect(report.summary.byType['evidence-report']).toBe(1)
    expect(report.summary.byType.temporary).toBe(1)
    expect(report.summary.byType['reusable-script']).toBe(1)
    expect(report.summary.byType.contract).toBe(1)
    expect(report.assets.find(asset => asset.path === 'test-results/upload-flow/report.json')).toMatchObject({
      gitPolicy: 'ignore',
      lifecycle: 'generated',
    })
    expect(report.assets.find(asset => asset.path === 'docs/modules/auth/architecture.md')).toMatchObject({
      gitPolicy: 'commit',
      sourceOfTruth: true,
      module: 'auth',
    })
  })

  it('classifies Python bytecode caches as temporary ignored resources', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/resource-policy.json', resourcePolicyTemplate())
    write(projectDir, 'scripts/lib/__pycache__/workflow_state.cpython-313.pyc', 'bytecode\n')

    const report = scanResourceAssets({ projectDir })

    expect(report.assets.find(asset => asset.path === 'scripts/lib/__pycache__/workflow_state.cpython-313.pyc')).toMatchObject({
      type: 'temporary',
      lifecycle: 'temporary',
      gitPolicy: 'ignore',
    })
  })

  it('reports tracked runtime outputs and large tracked files', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/resource-policy.json', JSON.stringify({
      version: 1,
      maxGitFileSizeBytes: 10,
      retainedRuntimeDirectories: ['test-results', 'tmp'],
    }))
    write(projectDir, 'test-results/run/video.webm', 'raw-video')
    write(projectDir, 'docs/modules/auth/product.md', '01234567890123456789')

    const report = doctorResourceAssets({
      projectDir,
      trackedPaths: ['test-results/run/video.webm', 'docs/modules/auth/product.md'],
    })

    expect(report.ok).toBe(false)
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'forbidden-tracked-resource',
      'large-tracked-resource',
    ]))
  })

  it('writes task resource settlement evidence', () => {
    const projectDir = makeProject()
    const artifactDir = '.planning/tasks/2026-05-15-demo'
    write(projectDir, '.scale/resource-policy.json', resourcePolicyTemplate())
    write(projectDir, 'docs/modules/auth/architecture.md', '# Auth architecture\n')

    const report = settleResourceAssets({
      projectDir,
      taskId: 'TASK-ASSETS',
      artifactsDir: artifactDir,
    })

    expect(report.ok).toBe(true)
    expect(report.resourceImpactPath).toBe(join(projectDir, '.planning', 'tasks', '2026-05-15-demo', 'resource-impact.md'))
    expect(report.doctor.findings).toHaveLength(0)
  })

  it('checks manifest source-of-truth assets for missing and stale maintained docs', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/resource-policy.json', resourcePolicyTemplate())
    write(projectDir, '.scale/assets.json', JSON.stringify({
      version: 1,
      assets: [
        {
          path: 'docs/modules/auth/architecture.md',
          type: 'canonical-doc',
          sourceOfTruth: true,
          lifecycle: 'maintained',
          owner: 'auth-team',
          lastReviewedAt: '2026-01-01',
          reviewIntervalDays: 30,
        },
        {
          path: 'docs/modules/auth/product.md',
          type: 'canonical-doc',
          sourceOfTruth: true,
          lifecycle: 'maintained',
          owner: 'auth-team',
        },
      ],
    }, null, 2))
    write(projectDir, 'docs/modules/auth/architecture.md', '# Auth architecture\n')

    const report = doctorResourceAssets({
      projectDir,
      now: new Date('2026-05-15T00:00:00Z'),
    })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warn',
        code: 'stale-maintained-resource',
        path: 'docs/modules/auth/architecture.md',
      }),
      expect.objectContaining({
        severity: 'fail',
        code: 'missing-source-of-truth',
        path: 'docs/modules/auth/product.md',
      }),
    ]))
  })
})
