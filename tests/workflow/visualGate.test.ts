import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { VisualGate } from '../../src/workflow/gates/VisualGate.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-visual-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

describe('VisualGate', () => {
  it('skips without visual configuration', async () => {
    const gate = new VisualGate({ projectDir: makeProject() })

    const result = await gate.execute()

    expect(result.gate).toBe('G9')
    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].label).toBe('Visual gate skipped')
  })

  it('fails when enabled visual checks have no report artifact', async () => {
    const projectDir = makeProject()
    write(projectDir, 'docs/ui/UI-SPEC.md', '# UI Spec\n')
    const gate = new VisualGate({
      projectDir,
      config: {
        enabled: true,
        baseUrl: 'http://localhost:5173',
        specPath: 'docs/ui/UI-SPEC.md',
        routes: ['/'],
        reportPath: 'docs/worklog/tasks/demo/visual-report.json',
      },
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('visual report'),
    ]))
  })

  it('blocks high severity visual findings from a structured report', async () => {
    const projectDir = makeProject()
    write(projectDir, 'docs/ui/UI-SPEC.md', '# UI Spec\n')
    write(projectDir, 'docs/worklog/tasks/demo/visual-report.json', JSON.stringify({
      screenshots: [{ route: '/', path: 'screenshots/home.png' }],
      findings: [
        {
          severity: 'high',
          route: '/',
          message: 'Primary action overlaps the navigation bar.',
          evidence: 'overlap ratio 0.42',
        },
      ],
    }, null, 2))
    const gate = new VisualGate({
      projectDir,
      config: {
        enabled: true,
        baseUrl: 'http://localhost:5173',
        specPath: 'docs/ui/UI-SPEC.md',
        routes: ['/'],
        reportPath: 'docs/worklog/tasks/demo/visual-report.json',
      },
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.evidence).toContain('Primary action overlaps')
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('high visual finding'),
    ]))
  })
})
