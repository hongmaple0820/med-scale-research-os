// Tests for GovernanceRoi — ROI collection, summarization, comparison

import { describe, it, expect } from 'vitest'
import {
  collectGovernanceRoi,
  summarizeGovernanceRoi,
  compareRoiReports,
} from '../../src/workflow/GovernanceRoi.js'
import type { GovernanceRoiSummary } from '../../src/workflow/GovernanceRoi.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'governance-roi-'))
}

describe('collectGovernanceRoi', () => {
  it('returns zero-value summary for fresh project with no data', () => {
    const dir = makeTempDir()
    try {
      const roi = collectGovernanceRoi({ projectDir: dir, scaleDir: join(dir, '.scale') })
      expect(roi.cost.totalTokensUsed).toBe(0)
      expect(roi.quality.firstPassRate).toBe(0)
      expect(roi.friction.totalGateChecks).toBe(0)
      // Score is non-zero because formula rewards zero gate blocks (15) and low fix iterations (5)
      expect(roi.roi.overallScore).toBe(20)
      expect(roi.recommendations.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('computes overall score within 0-100 range', () => {
    const dir = makeTempDir()
    try {
      const roi = collectGovernanceRoi({ projectDir: dir, scaleDir: join(dir, '.scale') })
      expect(roi.roi.overallScore).toBeGreaterThanOrEqual(0)
      expect(roi.roi.overallScore).toBeLessThanOrEqual(100)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads security audit when present', () => {
    const dir = makeTempDir()
    const scaleDir = join(dir, '.scale')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'security-audit.json'), JSON.stringify({
      findings: [
        { id: 'f1', resolved: true },
        { id: 'f2', resolved: false },
      ],
    }))
    try {
      const roi = collectGovernanceRoi({ projectDir: dir, scaleDir })
      expect(roi.quality.securityFindingsCount).toBe(2)
      expect(roi.quality.resolvedSecurityFindings).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('summarizeGovernanceRoi', () => {
  it('produces readable report', () => {
    const summary: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 50000, tokensByPhase: {}, contextCompilerSavings: 10000, cacheHitSavings: 5000 },
      quality: {
        firstPassRate: 0.8,
        averageFixIterations: 1.5,
        gatePassRate: 0.9,
        evidenceCompletenessRate: 0.85,
        securityFindingsCount: 3,
        resolvedSecurityFindings: 2,
      },
      friction: { totalGateChecks: 20, gateBlocks: 2, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 1.6, gateEfficiency: 0.45, overallScore: 72 },
      recommendations: ['First pass rate is good.'],
    }
    const text = summarizeGovernanceRoi(summary)
    expect(text).toContain('Governance ROI Report')
    expect(text).toContain('72/100')
    expect(text).toContain('50,000')
    expect(text).toContain('80%')
    expect(text).toContain('Recommendations')
  })
})

describe('compareRoiReports', () => {
  it('detects improvement', () => {
    const baseline: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 100000, tokensByPhase: {}, contextCompilerSavings: 0, cacheHitSavings: 0 },
      quality: { firstPassRate: 0.5, averageFixIterations: 3, gatePassRate: 0.7, evidenceCompletenessRate: 0.6, securityFindingsCount: 0, resolvedSecurityFindings: 0 },
      friction: { totalGateChecks: 10, gateBlocks: 4, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 0.5, gateEfficiency: 0.7, overallScore: 40 },
      recommendations: [],
    }
    const current: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 80000, tokensByPhase: {}, contextCompilerSavings: 20000, cacheHitSavings: 5000 },
      quality: { firstPassRate: 0.8, averageFixIterations: 1.5, gatePassRate: 0.95, evidenceCompletenessRate: 0.9, securityFindingsCount: 0, resolvedSecurityFindings: 0 },
      friction: { totalGateChecks: 20, gateBlocks: 1, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 1.0, gateEfficiency: 0.475, overallScore: 75 },
      recommendations: [],
    }
    const delta = compareRoiReports(baseline, current)
    expect(delta.roiDelta.overallScoreChange).toBe(35)
    expect(delta.summary).toContain('improved')
    expect(delta.costDelta.totalTokensUsed).toBe(-20000)
  })

  it('detects decline', () => {
    const baseline: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 50000, tokensByPhase: {}, contextCompilerSavings: 10000, cacheHitSavings: 5000 },
      quality: { firstPassRate: 0.8, averageFixIterations: 1.5, gatePassRate: 0.9, evidenceCompletenessRate: 0.85, securityFindingsCount: 0, resolvedSecurityFindings: 0 },
      friction: { totalGateChecks: 20, gateBlocks: 2, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 1.6, gateEfficiency: 0.45, overallScore: 72 },
      recommendations: [],
    }
    const current: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 100000, tokensByPhase: {}, contextCompilerSavings: 0, cacheHitSavings: 0 },
      quality: { firstPassRate: 0.4, averageFixIterations: 4, gatePassRate: 0.6, evidenceCompletenessRate: 0.5, securityFindingsCount: 0, resolvedSecurityFindings: 0 },
      friction: { totalGateChecks: 15, gateBlocks: 6, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 0.4, gateEfficiency: 0.6, overallScore: 35 },
      recommendations: [],
    }
    const delta = compareRoiReports(baseline, current)
    expect(delta.roiDelta.overallScoreChange).toBe(-37)
    expect(delta.summary).toContain('decreased')
  })

  it('detects unchanged', () => {
    const summary: GovernanceRoiSummary = {
      cost: { totalTokensUsed: 50000, tokensByPhase: {}, contextCompilerSavings: 0, cacheHitSavings: 0 },
      quality: { firstPassRate: 0.7, averageFixIterations: 2, gatePassRate: 0.8, evidenceCompletenessRate: 0.7, securityFindingsCount: 0, resolvedSecurityFindings: 0 },
      friction: { totalGateChecks: 10, gateBlocks: 2, averageGateLatencyMs: 0, skippedPhases: 0, manualOverrides: 0 },
      roi: { tokenEfficiency: 0.7, gateEfficiency: 0.8, overallScore: 50 },
      recommendations: [],
    }
    const delta = compareRoiReports(summary, { ...summary })
    expect(delta.roiDelta.overallScoreChange).toBe(0)
    expect(delta.summary).toBe('Governance ROI unchanged.')
  })
})
