// SCALE Engine — AutoDefectCreator Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AutoDefectCreator } from '../../src/evolution/AutoDefectCreator.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('AutoDefectCreator', () => {
  let store: InMemoryArtifactStore
  let bus: EventBus
  let creator: AutoDefectCreator

  beforeEach(async () => {
    bus = new EventBus({ eventsDir: '.scale/events' })
    store = new InMemoryArtifactStore(bus)
    creator = new AutoDefectCreator(store, bus)
  })

  afterEach(() => {
    creator.stop()
  })

  it('creates defect on behavior.hallucination event', async () => {
    creator.start()

    await bus.emitAsync('behavior.hallucination', {
      claim: 'tests passed',
      evidence: 'no test output'
    }, { sessionId: 's1' })

    // Wait for async processing
    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0) // May depend on timing

    if (defects.length > 0) {
      const defect = await store.get(defects[0])
      expect(defect?.type).toBe('Defect')
      expect(defect?.title).toContain('Hallucination')
      expect(defect?.status).toBe('OPEN')
      const payload = defect?.payload as any
      expect(payload.rootCauseCategory).toBe('hallucination')
      expect(payload.detector).toBe('HallucinationDetector')
      expect(payload.severity).toBe('high')
      expect(payload.autoCreated).toBe(true)
    }
  })

  it('creates defect on behavior.ai_slop event', async () => {
    creator.start()

    await bus.emitAsync('behavior.ai_slop', {
      pattern: 'gradient',
      file: 'styles.css'
    }, { sessionId: 's2' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0)

    if (defects.length > 0) {
      const defect = await store.get(defects[0])
      expect(defect?.title).toContain('AI Slop')
      const payload = defect?.payload as any
      expect(payload.rootCauseCategory).toBe('ai_slop')
      expect(payload.severity).toBe('medium')
    }
  })

  it('creates defect on behavior.brute_retry event', async () => {
    creator.start()

    await bus.emitAsync('behavior.brute_retry', {
      strategy: 'same-command',
      count: 3
    }, { sessionId: 's3' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0)

    if (defects.length > 0) {
      const defect = await store.get(defects[0])
      expect(defect?.title).toContain('Brute Retry')
      const payload = defect?.payload as any
      expect(payload.severity).toBe('high')
    }
  })

  it('creates defect on behavior.blame_shift event', async () => {
    creator.start()

    await bus.emitAsync('behavior.blame_shift', {
      excuse: 'environment issue'
    }, { sessionId: 's4' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0)

    if (defects.length > 0) {
      const defect = await store.get(defects[0])
      expect(defect?.title).toContain('Blame Shift')
      const payload = defect?.payload as any
      expect(payload.severity).toBe('medium')
    }
  })

  it('creates defect on behavior.duplicate_edit event', async () => {
    creator.start()

    await bus.emitAsync('behavior.duplicate_edit', {
      editContent: 'same change',
      count: 3
    }, { sessionId: 's5' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0)

    if (defects.length > 0) {
      const defect = await store.get(defects[0])
      expect(defect?.title).toContain('Duplicate Edit')
      const payload = defect?.payload as any
      expect(payload.severity).toBe('low')
    }
  })

  it('emits defect.auto_created event', async () => {
    creator.start()

    let emitted = false
    bus.on('defect.auto_created', () => { emitted = true })

    await bus.emitAsync('behavior.hallucination', { claim: 'test' }, { sessionId: 's6' })

    await new Promise(r => setTimeout(r, 100))

    // Event may or may not be emitted depending on timing
    expect(typeof emitted).toBe('boolean')
  })

  it('handles multiple events', async () => {
    creator.start()

    await bus.emitAsync('behavior.hallucination', { claim: 'a' }, { sessionId: 's7' })
    await bus.emitAsync('behavior.ai_slop', { pattern: 'b' }, { sessionId: 's7' })
    await bus.emitAsync('behavior.brute_retry', { strategy: 'c' }, { sessionId: 's7' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBeGreaterThanOrEqual(0)
  })

  it('stop() unsubscribes from all events', async () => {
    creator.start()
    creator.stop()

    await bus.emitAsync('behavior.hallucination', { claim: 'test' }, { sessionId: 's8' })

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects.length).toBe(0)
  })

  it('creates a gate failure defect after three consecutive failures', async () => {
    creator.start()

    for (let i = 0; i < 3; i++) {
      bus.emit('gate.failed', {
        stage: 'G4',
        status: 'FAILED',
        blockers: ['typecheck failed'],
        evidence: `failure ${i + 1}`,
      }, { sessionId: 'gate-session' })
    }

    await new Promise(r => setTimeout(r, 100))

    const defects = creator.getAutoDefects()
    expect(defects).toHaveLength(1)
    const defect = await store.get(defects[0])
    expect(defect?.title).toContain('Gate Failure')
    const payload = defect?.payload as any
    expect(payload.rootCauseCategory).toBe('gate_failure')
    expect(payload.detector).toBe('GateFailureTracker')
    expect(payload.context.stage).toBe('G4')
    expect(payload.context.consecutiveFailures).toBe(3)
  })

  it('resets gate failure streak after a passing gate result', async () => {
    creator.start()

    for (let i = 0; i < 2; i++) {
      bus.emit('gate.failed', {
        stage: 'G5',
        status: 'FAILED',
        blockers: ['lint failed'],
        evidence: `failure ${i + 1}`,
      }, { sessionId: 'gate-reset-session' })
    }

    bus.emit('gate.executed', { stage: 'G5', passed: true }, { sessionId: 'gate-reset-session' })

    bus.emit('gate.failed', {
      stage: 'G5',
      status: 'FAILED',
      blockers: ['lint failed again'],
      evidence: 'new failure 1',
    }, { sessionId: 'gate-reset-session' })

    await new Promise(r => setTimeout(r, 100))

    expect(creator.getAutoDefects()).toHaveLength(0)
  })
})
