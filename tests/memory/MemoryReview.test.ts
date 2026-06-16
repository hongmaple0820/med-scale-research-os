import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryBrain, reviewMemoryLearningCandidate, type MemoryLearningCandidate } from '../../src/memory/index.js'

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'medscale-memory-review-'))
}

function writeCandidate(projectDir: string, overrides: Partial<MemoryLearningCandidate> = {}): MemoryLearningCandidate {
  const candidate: MemoryLearningCandidate = {
    version: '1.0',
    id: 'MLC-medical-egfr-lung-cancer',
    status: 'candidate',
    generatedAt: '2026-06-15T00:00:00.000Z',
    title: 'Medical learning candidate: EGFR / lung cancer',
    task: 'Review medical delivery for EGFR in lung cancer',
    taskId: 'medical-delivery-egfr-lung-cancer',
    sessionId: 'medical-memory-gbrain',
    level: 'M',
    summary: 'Quality gate and fact check passed; ready for reviewer decision.',
    recommendedAction: 'review-for-knowledge-base',
    promotable: true,
    tags: ['medical-delivery', 'verified-evidence'],
    evidenceIds: [],
    sessionEventIds: [],
    knowledgeIds: [],
    graphRefs: [],
    artifactPaths: ['target-research-platform/output/manuscripts/EGFR_lung_cancer_delivery_manifest.json'],
    evidenceSummaries: [
      { id: 'quality-gate', status: 'passed', title: 'Quality gate', summary: 'passed' },
    ],
    sessionSummaries: [],
    warnings: [],
    contextBudget: { used: 1, limit: 1, remaining: 0, overBudget: false },
    contentRef: '.scale/memory/learning-candidates/MLC-medical-egfr-lung-cancer.md',
    ...overrides,
  }
  const dir = join(projectDir, '.scale', 'memory', 'learning-candidates')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${candidate.id}.json`), JSON.stringify(candidate, null, 2), 'utf-8')
  writeFileSync(join(dir, `${candidate.id}.md`), '# candidate\n', 'utf-8')
  return candidate
}

describe('MemoryReview', () => {
  it('approves a promotable medical learning candidate into active Memory Brain', () => {
    const projectDir = makeProject()
    try {
      const candidate = writeCandidate(projectDir)
      const report = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'approve',
        reviewer: 'medical-reviewer',
        reason: 'quality and fact checks passed with token=raw-secret-value',
      })

      expect(report.ok).toBe(true)
      expect(report.status).toBe('approved')
      expect(report.promoted).toBe(true)
      expect(report.nodeStatus).toBe('active')
      expect(report.nodeId).toBe(`MEM-${candidate.id}`)
      expect(existsSync(report.reviewPath!)).toBe(true)
      expect(existsSync(report.reviewMarkdownPath!)).toBe(true)

      const brain = new MemoryBrain({ projectDir })
      try {
        expect(brain.get(`MEM-${candidate.id}`)).toMatchObject({
          status: 'active',
          source: 'task-artifact',
        })
      } finally {
        brain.close()
      }

      const serialized = [
        JSON.stringify(report.record),
        readFileSync(report.reviewPath!, 'utf-8'),
        readFileSync(report.reviewMarkdownPath!, 'utf-8'),
      ].join('\n')
      expect(serialized).toContain('[REDACTED]')
      expect(serialized).not.toContain('raw-secret-value')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('records reject, stale, and restore review transitions', () => {
    const projectDir = makeProject()
    try {
      const candidate = writeCandidate(projectDir)

      const rejected = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'reject',
        reviewer: 'medical-reviewer',
        reason: 'insufficient clinical evidence',
      })
      expect(rejected.ok).toBe(true)
      expect(rejected.status).toBe('rejected')
      expect(rejected.nodeStatus).toBe('rejected')

      const stale = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'stale',
        reviewer: 'medical-reviewer',
        reason: 'new guideline superseded the evidence',
      })
      expect(stale.ok).toBe(true)
      expect(stale.status).toBe('stale')
      expect(stale.previousNodeStatus).toBe('rejected')
      expect(stale.nodeStatus).toBe('stale')

      const restored = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'restore',
        reviewer: 'medical-reviewer',
        reason: 'fresh evidence added',
      })
      expect(restored.ok).toBe(true)
      expect(restored.status).toBe('restored')
      expect(restored.previousNodeStatus).toBe('stale')
      expect(restored.nodeStatus).toBe('candidate')
      expect(restored.record?.history.map(event => event.action)).toEqual(['reject', 'stale', 'restore'])
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('blocks approve when a candidate is not promotable', () => {
    const projectDir = makeProject()
    try {
      const candidate = writeCandidate(projectDir, {
        promotable: false,
        recommendedAction: 'resolve-failures-first',
        warnings: ['Fact check failed.'],
      })
      const report = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'approve',
        reviewer: 'medical-reviewer',
      })

      expect(report.ok).toBe(false)
      expect(report.status).toBe('pending')
      expect(report.promoted).toBe(false)
      expect(report.warnings.join('\n')).toContain('not promotable')
      expect(existsSync(report.reviewPath!)).toBe(true)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('reads BOM-prefixed candidate JSON files written by Windows editors', () => {
    const projectDir = makeProject()
    try {
      const candidate = writeCandidate(projectDir)
      const candidatePath = join(projectDir, '.scale', 'memory', 'learning-candidates', `${candidate.id}.json`)
      writeFileSync(candidatePath, `\uFEFF${readFileSync(candidatePath, 'utf-8')}`, 'utf-8')

      const report = reviewMemoryLearningCandidate({
        projectDir,
        candidateId: candidate.id,
        action: 'reject',
        reviewer: 'medical-reviewer',
      })

      expect(report.ok).toBe(true)
      expect(report.status).toBe('rejected')
      expect(report.nodeStatus).toBe('rejected')
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
