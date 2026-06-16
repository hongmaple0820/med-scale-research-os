// Phase Marker Tracker — Unit Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PhaseMarkerTracker, parsePhaseMarker } from '../../src/workflow/PhaseMarkerTracker.js'

let dirs: string[] = []

function makeScaleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-marker-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('PhaseMarkerTracker', () => {
  describe('parseMarkers', () => {
    it('parses DEFINE marker with correct format', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[DEFINE] ✓ ambiguity 15% ✓ | spec SPEC-001 ✓')

      expect(result.DEFINE).toBeDefined()
      expect(result.DEFINE!.completed).toBe(true)
      expect(result.DEFINE!.details).toEqual({
        ambiguity: '15',
        specId: 'SPEC-001',
      })
    })

    it('parses PLAN marker with correct format', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan PLAN-042 ✓')

      expect(result.PLAN).toBeDefined()
      expect(result.PLAN!.completed).toBe(true)
      expect(result.PLAN!.details).toEqual({
        planId: 'PLAN-042',
      })
    })

    it('parses EXECUTE marker with correct format', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task TASK-001 ✓')

      expect(result.EXECUTE).toBeDefined()
      expect(result.EXECUTE!.completed).toBe(true)
      expect(result.EXECUTE!.details).toEqual({
        taskId: 'TASK-001',
      })
    })

    it('parses REVIEW marker with correct format', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[REVIEW] ✓ files 5 ✓ | findings 3 ✓ | CRITICAL 0 ✓ | HIGH 1 ✓ | principles 7/8 ✓')

      expect(result.REVIEW).toBeDefined()
      expect(result.REVIEW!.completed).toBe(true)
      expect(result.REVIEW!.details).toEqual({
        files: '5',
        findings: '3',
        critical: '0',
        high: '1',
        principles: '7',
      })
    })

    it('parses SHIP marker with push', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[SHIP] ✓ evidence ✓ | staged 3 ✓ | commit abc1234 ✓ | push ✓ | report ✓')

      expect(result.SHIP).toBeDefined()
      expect(result.SHIP!.completed).toBe(true)
      expect(result.SHIP!.details).toEqual({
        staged: '3',
        commit: 'abc1234',
        push: 'push',
      })
    })

    it('parses SHIP marker with skip (no push)', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[SHIP] ✓ evidence ✓ | staged 1 ✓ | commit deadbeef ✓ | skip ✓ | report ✓')

      expect(result.SHIP).toBeDefined()
      expect(result.SHIP!.details).toEqual({
        staged: '1',
        commit: 'deadbeef',
        push: 'skip',
      })
    })

    it('returns empty when no markers found', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('Just some random text without markers')

      expect(Object.keys(result)).toHaveLength(0)
    })

    it('parses multiple markers from same text', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const text = `
        [DEFINE] ✓ ambiguity 12% ✓ | spec SPEC-100 ✓
        Some text in between
        [PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan PLAN-200 ✓
      `
      const result = tracker.parseMarkers(text)

      expect(result.DEFINE).toBeDefined()
      expect(result.PLAN).toBeDefined()
      expect(Object.keys(result)).toHaveLength(2)
    })

    it('handles decimal ambiguity score', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const result = tracker.parseMarkers('[DEFINE] ✓ ambiguity 8.5% ✓ | spec SPEC-999 ✓')

      expect(result.DEFINE!.details!.ambiguity).toBe('8.5')
    })
  })

  describe('state management', () => {
    it('returns default state when no file exists', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const state = tracker.getState()

      expect(state.DEFINE.completed).toBe(false)
      expect(state.PLAN.completed).toBe(false)
      expect(state.EXECUTE.completed).toBe(false)
      expect(state.VERIFY.completed).toBe(false)
      expect(state.REVIEW.completed).toBe(false)
      expect(state.SHIP.completed).toBe(false)
    })

    it('persists state after markComplete', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE', { ambiguity: '10', specId: 'SPEC-1' })

      const state = tracker.getState()
      expect(state.DEFINE.completed).toBe(true)
      expect(state.DEFINE.details).toEqual({ ambiguity: '10', specId: 'SPEC-1' })
    })

    it('persists across instances (file-based)', () => {
      const dir = makeScaleDir()

      const tracker1 = new PhaseMarkerTracker(dir)
      tracker1.markComplete('PLAN', { planId: 'PLAN-X' })

      const tracker2 = new PhaseMarkerTracker(dir)
      expect(tracker2.isPhaseComplete('PLAN')).toBe(true)
    })

    it('resetPhase clears specific phase', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')
      tracker.markComplete('PLAN')
      tracker.resetPhase('DEFINE')

      expect(tracker.isPhaseComplete('DEFINE')).toBe(false)
      expect(tracker.isPhaseComplete('PLAN')).toBe(true)
    })

    it('resetAll clears all state', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')
      tracker.markComplete('SHIP')
      tracker.resetAll()

      expect(tracker.isPhaseComplete('DEFINE')).toBe(false)
      expect(tracker.isPhaseComplete('SHIP')).toBe(false)
    })
  })

  describe('parseAndUpdate', () => {
    it('returns 0 for text without markers', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const count = tracker.parseAndUpdate('No markers here')
      expect(count).toBe(0)
    })

    it('returns count of parsed markers and updates state', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      const count = tracker.parseAndUpdate('[DEFINE] ✓ ambiguity 12% ✓ | spec SPEC-100 ✓')
      expect(count).toBe(1)
      expect(tracker.isPhaseComplete('DEFINE')).toBe(true)
    })

    it('accumulates state from multiple parseAndUpdate calls', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.parseAndUpdate('[DEFINE] ✓ ambiguity 10% ✓ | spec SPEC-1 ✓')
      tracker.parseAndUpdate('[PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan PLAN-1 ✓')

      expect(tracker.isPhaseComplete('DEFINE')).toBe(true)
      expect(tracker.isPhaseComplete('PLAN')).toBe(true)
      expect(tracker.isPhaseComplete('EXECUTE')).toBe(false)
    })
  })

  describe('completion queries', () => {
    it('isAllComplete returns false when phases missing', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')
      expect(tracker.isAllComplete()).toBe(false)
    })

    it('isAllComplete returns true when all phases complete', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      for (const phase of ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP'] as const) {
        tracker.markComplete(phase)
      }

      expect(tracker.isAllComplete()).toBe(true)
    })

    it('getMissingPhases returns incomplete phases', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')
      tracker.markComplete('EXECUTE')

      const missing = tracker.getMissingPhases()
      expect(missing).toEqual(['PLAN', 'VERIFY', 'REVIEW', 'SHIP'])
    })

    it('getCompletedPhases returns completed phases', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')
      tracker.markComplete('PLAN')

      expect(tracker.getCompletedPhases()).toEqual(['DEFINE', 'PLAN'])
    })
  })

  describe('generateReport', () => {
    it('shows all phases pending', () => {
      const tracker = new PhaseMarkerTracker(makeScaleDir())
      const report = tracker.generateReport()

      expect(report).toContain('DEFINE: pending')
      expect(report).toContain('PLAN: pending')
      expect(report).toContain('Progress: 0/6 phases')
    })

    it('shows completed phases with details', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE', { ambiguity: '15', specId: 'SPEC-1' })

      const report = tracker.generateReport()
      expect(report).toContain('DEFINE: completed')
      expect(report).toContain('ambiguity: 15')
      expect(report).toContain('Progress: 1/6 phases')
    })

    it('shows celebration when all complete', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      for (const phase of ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP'] as const) {
        tracker.markComplete(phase)
      }

      const report = tracker.generateReport()
      expect(report).toContain('Progress: 6/6 phases')
      expect(report).toContain('All phases complete')
    })
  })

  describe('generateStopHookResult', () => {
    it('returns fail when phases incomplete', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      tracker.markComplete('DEFINE')

      const result = tracker.generateStopHookResult()
      expect(result.pass).toBe(false)
      expect(result.missing).toContain('PLAN')
      expect(result.missing).not.toContain('DEFINE')
    })

    it('returns pass when all phases complete', () => {
      const dir = makeScaleDir()
      const tracker = new PhaseMarkerTracker(dir)

      for (const phase of ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP'] as const) {
        tracker.markComplete(phase)
      }

      const result = tracker.generateStopHookResult()
      expect(result.pass).toBe(true)
      expect(result.missing).toEqual([])
    })
  })
})

describe('parsePhaseMarker standalone helper', () => {
  it('parses DEFINE marker', () => {
    const result = parsePhaseMarker('[DEFINE] ✓ ambiguity 20% ✓ | spec SPEC-50 ✓')

    expect(result).not.toBeNull()
    expect(result!.phase).toBe('DEFINE')
    expect(result!.details).toEqual({ ambiguity: '20', specId: 'SPEC-50' })
  })

  it('returns null for non-marker text', () => {
    expect(parsePhaseMarker('hello world')).toBeNull()
  })

  it('parses SHIP marker', () => {
    const result = parsePhaseMarker('[SHIP] ✓ evidence ✓ | staged 5 ✓ | commit ff00ff ✓ | skip ✓ | report ✓')

    expect(result).not.toBeNull()
    expect(result!.phase).toBe('SHIP')
    expect(result!.details.commit).toBe('ff00ff')
  })
})
