import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

async function recordPassedEvidence(scaleDir: string, projectDir: string, taskId: string, sessionId: string) {
  await runScale([
    'runtime',
    'start',
    '--session-id',
    sessionId,
    '--task-id',
    taskId,
    '--level',
    'M',
    '--summary',
    'Memory brain test',
  ], scaleDir, projectDir)
  await runScale([
    'runtime',
    'record',
    '--title',
    'OAuth callback state design',
    '--status',
    'passed',
    '--exit-code',
    '0',
    '--summary',
    'OAuth callback state is verified through Redis state lookup and tests passed.',
  ], scaleDir, projectDir)
}

function writeFailingSuite(scaleDir: string) {
  const suitesDir = join(scaleDir, 'evals', 'suites')
  mkdirSync(suitesDir, { recursive: true })
  writeFileSync(join(suitesDir, 'failing.json'), JSON.stringify({
    version: '1.0',
    id: 'failing',
    name: 'Failing replay suite',
    cases: [
      {
        id: 'missing-proof',
        type: 'bugfix',
        title: 'Missing verification evidence is preserved',
        task: 'Simulate an agent claim without a passing command.',
        phase: 'verify',
        successCriteria: ['command exits 0'],
        expectedFailureCategory: 'missing-verification-evidence',
        attempts: [
          {
            id: 'attempt-1',
            command: 'node -e "console.error(\'no verification evidence\'); process.exit(1)"',
            expectedExitCode: 0,
          },
        ],
      },
    ],
  }, null, 2), 'utf-8')
}

describe('memory brain CLI', () => {
  it('ingests runtime evidence, queries it, and promotes only evidence-backed memory', async () => {
    const scaleDir = makeDir('scale-memory-brain-scale-')
    const projectDir = makeDir('scale-memory-brain-project-')
    await recordPassedEvidence(scaleDir, projectDir, 'TASK-BRAIN', 'SESSION-BRAIN')

    const ingest = await runScale(['memory', 'ingest', '--from', 'evidence', '--task-id', 'TASK-BRAIN', '--json'], scaleDir, projectDir)
    expect(ingest.exitCode).toBe(0)
    const ingestReport = parseJson<{
      ok: boolean
      created: number
      nodes: Array<{ id: string; status: string; evidencePaths: string[] }>
    }>(ingest.stdout)
    expect(ingestReport.ok).toBe(true)
    expect(ingestReport.created).toBe(1)
    expect(ingestReport.nodes[0].status).toBe('candidate')
    expect(ingestReport.nodes[0].evidencePaths.length).toBeGreaterThan(0)

    const query = await runScale(['memory', 'query', 'OAuth Redis state', '--json'], scaleDir, projectDir)
    expect(query.exitCode).toBe(0)
    const queryReport = parseJson<{ count: number; nodes: Array<{ id: string }> }>(query.stdout)
    expect(queryReport.count).toBeGreaterThan(0)
    expect(queryReport.nodes.map(node => node.id)).toContain(ingestReport.nodes[0].id)

    const promote = await runScale(['memory', 'promote', ingestReport.nodes[0].id, '--json'], scaleDir, projectDir)
    expect(promote.exitCode).toBe(0)
    const promoteReport = parseJson<{ ok: boolean; node: { status: string; lastVerifiedAt?: string; evidencePaths: string[] } }>(promote.stdout)
    expect(promoteReport.ok).toBe(true)
    expect(promoteReport.node.status).toBe('active')
    expect(promoteReport.node.lastVerifiedAt).toBeTruthy()
    expect(promoteReport.node.evidencePaths.length).toBeGreaterThan(0)
  }, 120_000)

  it('promotes a reviewed learning candidate into active project memory', async () => {
    const scaleDir = makeDir('scale-memory-brain-scale-')
    const projectDir = makeDir('scale-memory-brain-project-')
    await recordPassedEvidence(scaleDir, projectDir, 'TASK-LEARN', 'SESSION-LEARN')

    const settle = await runScale([
      'memory',
      'settle',
      '--task-id',
      'TASK-LEARN',
      '--session-id',
      'SESSION-LEARN',
      '--task',
      'Settle OAuth state learning',
      '--level',
      'M',
      '--json',
    ], scaleDir, projectDir)
    expect(settle.exitCode).toBe(0)
    const settlement = parseJson<{ candidate: { id: string; promotable: boolean }; files: { json: string } }>(settle.stdout)
    expect(settlement.candidate.promotable).toBe(true)
    expect(existsSync(settlement.files.json)).toBe(true)

    const promote = await runScale(['memory', 'promote', settlement.candidate.id, '--json'], scaleDir, projectDir)
    expect(promote.exitCode).toBe(0)
    const promoteReport = parseJson<{ ok: boolean; node: { status: string; source: string; evidencePaths: string[] } }>(promote.stdout)
    expect(promoteReport.ok).toBe(true)
    expect(promoteReport.node).toMatchObject({
      status: 'active',
      source: 'task-artifact',
    })
    expect(promoteReport.node.evidencePaths.length).toBeGreaterThan(0)
  }, 120_000)

  it('ingests failure replay records as evidence-backed incident memory', async () => {
    const scaleDir = makeDir('scale-memory-brain-scale-')
    const projectDir = makeDir('scale-memory-brain-project-')
    writeFailingSuite(scaleDir)

    const run = await runScale(['eval', 'run', '--suite', 'failing', '--json'], scaleDir, projectDir)
    expect(run.exitCode).toBe(1)
    const runReport = parseJson<{ run: { failureReplayIds: string[] } }>(run.stdout)
    expect(runReport.run.failureReplayIds.length).toBe(1)

    const ingest = await runScale([
      'memory',
      'ingest',
      '--from',
      'failure',
      '--failure-id',
      runReport.run.failureReplayIds[0],
      '--json',
    ], scaleDir, projectDir)
    expect(ingest.exitCode).toBe(0)
    const ingestReport = parseJson<{
      ok: boolean
      created: number
      nodes: Array<{ id: string; type: string; source: string; status: string; evidencePaths: string[]; metadata: { category: string } }>
    }>(ingest.stdout)
    expect(ingestReport.ok).toBe(true)
    expect(ingestReport.created).toBe(1)
    expect(ingestReport.nodes[0]).toMatchObject({
      type: 'incident',
      source: 'task-artifact',
      status: 'candidate',
      metadata: { category: 'missing-verification-evidence' },
    })
    expect(ingestReport.nodes[0].evidencePaths[0].replace(/\\/g, '/')).toContain('/evals/failures/')

    const promote = await runScale(['memory', 'promote', ingestReport.nodes[0].id, '--json'], scaleDir, projectDir)
    expect(promote.exitCode).toBe(0)
    const promoteReport = parseJson<{ ok: boolean; node: { status: string; type: string; evidencePaths: string[] } }>(promote.stdout)
    expect(promoteReport.ok).toBe(true)
    expect(promoteReport.node.status).toBe('active')
    expect(promoteReport.node.type).toBe('incident')
    expect(promoteReport.node.evidencePaths.length).toBeGreaterThan(0)
  }, 120_000)

  it('reports contradictions instead of silently resolving conflicting active memory', async () => {
    const scaleDir = makeDir('scale-memory-brain-scale-')
    const projectDir = makeDir('scale-memory-brain-project-')
    const now = '2026-05-19T00:00:00.000Z'
    const file = join(projectDir, 'memory.jsonl')
    const nodes = [
      {
        id: 'MEM-enabled',
        type: 'fact',
        title: 'OAuth callback provider enabled',
        summary: 'OAuth callback provider is enabled for netdisk.',
        entities: ['oauth', 'provider', 'netdisk'],
        source: 'manual',
        evidencePaths: ['docs/evidence-enabled.md'],
        confidence: 0.82,
        scope: 'project',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: now,
        metadata: {},
      },
      {
        id: 'MEM-disabled',
        type: 'fact',
        title: 'OAuth callback provider disabled',
        summary: 'OAuth callback provider is disabled for netdisk.',
        entities: ['oauth', 'provider', 'netdisk'],
        source: 'manual',
        evidencePaths: ['docs/evidence-disabled.md'],
        confidence: 0.8,
        scope: 'project',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: now,
        metadata: {},
      },
    ]
    writeFileSync(file, nodes.map(node => JSON.stringify(node)).join('\n') + '\n', 'utf-8')

    const imported = await runScale(['memory', 'import', file, '--json'], scaleDir, projectDir)
    expect(imported.exitCode).toBe(0)
    const importReport = parseJson<{ imported: number }>(imported.stdout)
    expect(importReport.imported).toBe(2)

    const contradictions = await runScale(['memory', 'contradictions', '--json'], scaleDir, projectDir)
    expect(contradictions.exitCode).toBe(1)
    const report = parseJson<{ ok: boolean; count: number; contradictions: Array<{ nodeIds: string[]; evidencePaths: string[] }> }>(contradictions.stdout)
    expect(report.ok).toBe(false)
    expect(report.count).toBe(1)
    expect(report.contradictions[0].nodeIds).toEqual(expect.arrayContaining(['MEM-enabled', 'MEM-disabled']))
    expect(report.contradictions[0].evidencePaths).toEqual(expect.arrayContaining(['docs/evidence-enabled.md', 'docs/evidence-disabled.md']))
  }, 120_000)
})
