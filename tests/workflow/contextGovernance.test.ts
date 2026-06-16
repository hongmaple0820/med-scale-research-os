import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  analyzeContextGovernance,
  renderContextGrillPrompt,
  writeContextGovernanceTemplates,
} from '../../src/workflow/ContextGovernance.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-context-governance-'))
  dirs.push(dir)
  return dir
}

describe('ContextGovernance', () => {
  it('blocks M/L work when canonical context documents are missing', () => {
    const projectDir = makeProject()

    const report = analyzeContextGovernance({
      projectDir,
      request: 'Add tenant-aware upload authorization for the netdisk API',
      changedFiles: ['src/upload/handler.ts'],
    })

    expect(report.ok).toBe(false)
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'missing-context-doc',
      'missing-context-map',
      'missing-module-doc',
    ]))
    expect(report.questions.map(question => question.topic)).toEqual(expect.arrayContaining([
      'domain-language',
      'module-boundary',
      'acceptance-evidence',
    ]))
    expect(renderContextGrillPrompt(report)).toContain('Context Grill')
  })

  it('links changed modules to maintained docs and request-specific grill questions', () => {
    const projectDir = makeProject()
    mkdirSync(join(projectDir, 'docs', 'modules', 'upload'), { recursive: true })
    writeFileSync(join(projectDir, 'CONTEXT.md'), [
      '# CONTEXT.md',
      '',
      '| Term | Definition | Examples | Aliases | Source |',
      '|------|------------|----------|---------|--------|',
      '| Tenant | A data isolation boundary | tenant_id | Org | product |',
      '| Upload | A resumable file ingestion flow | chunk upload | - | code |',
    ].join('\n'), 'utf-8')
    writeFileSync(join(projectDir, 'docs', 'CONTEXT-MAP.md'), [
      '# Context Map',
      '',
      '| Module | Owner | Product Doc | Architecture Doc |',
      '| --- | --- | --- | --- |',
      '| upload | storage team | docs/modules/upload/product.md | docs/modules/upload/architecture.md |',
    ].join('\n'), 'utf-8')
    writeFileSync(join(projectDir, 'docs', 'modules', 'upload', 'product.md'), '# Upload Product\n', 'utf-8')
    writeFileSync(join(projectDir, 'docs', 'modules', 'upload', 'architecture.md'), '# Upload Architecture\n', 'utf-8')

    const report = analyzeContextGovernance({
      projectDir,
      request: 'Add tenant-aware upload authorization for the netdisk API',
      changedFiles: ['src/upload/handler.ts'],
    })

    expect(report.ok).toBe(true)
    expect(report.terms).toEqual(expect.arrayContaining(['Tenant', 'Upload']))
    expect(report.moduleDocs.find(item => item.moduleName === 'upload')).toMatchObject({
      productDocExists: true,
      architectureDocExists: true,
    })
    expect(report.questions.some(question => question.question.includes('tenant'))).toBe(true)
  })

  it('writes starter templates for new projects', () => {
    const projectDir = makeProject()

    const result = writeContextGovernanceTemplates({
      projectDir,
      projectName: 'Demo Project',
    })

    expect(result.created.map(item => item.replace(/\\/g, '/'))).toEqual(expect.arrayContaining([
      expect.stringContaining('CONTEXT.md'),
      expect.stringContaining('docs/CONTEXT-MAP.md'),
    ]))
    expect(analyzeContextGovernance({ projectDir, request: 'Design user login' }).findings.map(f => f.code)).not.toContain('missing-context-doc')
  })
})
