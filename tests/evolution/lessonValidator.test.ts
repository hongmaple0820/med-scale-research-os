// W8 Tests: LessonValidator — 4-Gate Validation (Trigger, Googleability, Context-Specific, Dedup)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { LessonValidator } from '../../src/evolution/LessonValidator.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-lesson-validator'
const me = { kind: 'human' as const, userId: 'tester' }

describe('LessonValidator', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM
  let kb: KnowledgeBase
  let validator: LessonValidator

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    kb = new KnowledgeBase(bus)
    validator = new LessonValidator(bus, kb)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  describe('validate', () => {
    it('validates lesson with context-specific content', async () => {
      // Use validator without KB to skip deduplication check
      const validatorNoKb = new LessonValidator(bus)
      const entry = {
        type: 'lesson' as const,
        title: 'Transaction handler null pointer prevention', // No generic terms like 'fix', 'error', 'how to'
        tags: ['transaction', 'null-check'],
        contentRef: 'lessons/null-check.md - relates to spec-20260421-005',
        sourceArtifact: 'DEFECT-20260421-001',
        verified: false,
      }
      const result = await validatorNoKb.validate(entry)
      // All gates should pass: trigger (hardcoded), googleability (no generic terms), context (tags + artifact + spec ref), dedup (no KB)
      expect(result.valid).toBe(true)
      expect(result.gateResults.length).toBe(4)
      expect(result.gateResults.every(g => g.passed)).toBe(true)
    })

    it('rejects generic googleable title', async () => {
      const entry = {
        type: 'lesson' as const,
        title: 'How to fix error in JavaScript',
        tags: [],
        contentRef: 'lessons/generic.md',
        verified: false,
      }
      const result = await validator.validate(entry)
      expect(result.valid).toBe(false)
      const googleGate = result.gateResults.find(g => g.gateName === 'googleability')
      expect(googleGate?.passed).toBe(false)
    })

    it('rejects lesson without context markers', async () => {
      const entry = {
        type: 'lesson' as const,
        title: 'Some specific title',
        tags: [],
        contentRef: 'plain content without references',
        verified: false,
      }
      const result = await validator.validate(entry)
      expect(result.valid).toBe(false)
      const contextGate = result.gateResults.find(g => g.gateName === 'context_specific')
      expect(contextGate?.passed).toBe(false)
    })
  })

  describe('checkGoogleability', () => {
    it('passes specific technical title', async () => {
      const result = await validator.checkGoogleability('SCALE Engine artifact lifecycle transition')
      expect(result.passed).toBe(true)
      expect(result.score).toBeGreaterThan(0.5)
    })

    it('fails generic tutorial title', async () => {
      const result = await validator.checkGoogleability('How to tutorial guide example')
      expect(result.passed).toBe(false)
      expect(result.details).toContain('generic terms')
    })
  })

  describe('checkContextSpecific', () => {
    it('passes with artifact reference', async () => {
      const entry = {
        type: 'lesson' as const,
        title: 'Test',
        tags: ['api'],
        contentRef: 'See art-20260421-001 for details',
        sourceArtifact: 'DEFECT-001',
        verified: false,
      }
      const result = await validator.checkContextSpecific(entry)
      expect(result.passed).toBe(true)
    })

    it('passes with spec reference in content', async () => {
      const entry = {
        type: 'lesson' as const,
        title: 'Test',
        tags: [],
        contentRef: 'This relates to spec-20260421-005 implementation',
        verified: false,
      }
      const result = await validator.checkContextSpecific(entry)
      expect(result.score).toBeGreaterThan(0)
    })

    it('fails without context', async () => {
      const entry = {
        type: 'lesson' as const,
        title: 'Test',
        tags: [],
        contentRef: 'Generic advice about coding',
        verified: false,
      }
      const result = await validator.checkContextSpecific(entry)
      expect(result.passed).toBe(false)
    })
  })

  describe('checkDuplicate', () => {
    it('passes when no similar lesson exists', async () => {
      const result = await validator.checkDuplicate('Unique new lesson title', 'content')
      expect(result.passed).toBe(true)
    })

    it('fails when similar lesson exists', async () => {
      await kb.add({
        type: 'lesson',
        title: 'Handle null response from API endpoint',
        tags: ['api'],
        contentRef: 'lessons/api-null.md',
        verified: false,
      })

      const result = await validator.checkDuplicate('Handle null response from API', 'other content')
      expect(result.passed).toBe(false)
      expect(result.details).toContain('similarity')
    })

    it('passes without KB', async () => {
      const noKbValidator = new LessonValidator(bus)
      const result = await noKbValidator.checkDuplicate('Any title', 'content')
      expect(result.passed).toBe(true)
      expect(result.details).toContain('No KB available')
    })
  })

  describe('event emission', () => {
    it('emits lesson.validated event', async () => {
      let emitted = false
      bus.on('lesson.validated', () => { emitted = true })

      await validator.validate({
        type: 'lesson',
        title: 'Specific title with art-001',
        tags: ['test'],
        contentRef: 'content',
        verified: false,
      })

      await new Promise(r => setTimeout(r, 20))
      expect(emitted).toBe(true)
    })
  })
})
