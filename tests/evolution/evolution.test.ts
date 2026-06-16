// W7 Tests: Evolution Layer — LessonExtractor + RuleProposer + HookGenerator + EvolutionEngine
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import {
  LessonExtractor,
  RuleProposer,
  HookGenerator,
  EvolutionEngine,
} from '../../src/evolution/EvolutionEngine.js'
import { recordShadowHit } from '../../src/evolution/RuleMaturity.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'

const TMP = './tmp/test-evolution'
const me = { kind: 'human' as const, userId: 'tester' }

describe('Evolution Layer', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM
  let kb: KnowledgeBase

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    kb = new KnowledgeBase(bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  // Helper: create a diagnosed defect
  async function createDiagnosedDefect(title: string, rootCause: string) {
    const defect = await store.create({
      type: 'Defect',
      title,
      payload: { rootCauseCategory: rootCause, tags: ['test'] },
      initialStatus: INITIAL_STATES.Defect,
      createdBy: me,
    })
    await fsm.transition(defect.id, 'assign', { actor: me })
    await store.update(defect.id, {
      payload: { rootCauseCategory: rootCause, tags: ['test'] },
    })
    await fsm.transition(defect.id, 'diagnose', { actor: me })
    return defect
  }

  // ==========================================================================
  // LessonExtractor
  // ==========================================================================
  describe('LessonExtractor', () => {
    it('extracts lesson from diagnosed defect', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const defect = await createDiagnosedDefect('Missing null check', 'null_reference')
      const lesson = await extractor.extract(defect.id)
      expect(lesson).not.toBeNull()
      expect(lesson!.title).toContain('null_reference')
      expect(lesson!.tags).toContain('null_reference')
    })

    it('skips defect in OPEN state', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const defect = await store.create({
        type: 'Defect', title: 'Open bug',
        payload: { rootCauseCategory: 'logic_error' },
        initialStatus: INITIAL_STATES.Defect, createdBy: me,
      })
      const lesson = await extractor.extract(defect.id)
      expect(lesson).toBeNull()
    })

    it('skips defect without rootCauseCategory', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const defect = await store.create({
        type: 'Defect', title: 'No root cause',
        payload: {},
        initialStatus: INITIAL_STATES.Defect, createdBy: me,
      })
      await fsm.transition(defect.id, 'assign', { actor: me })
      // Can't diagnose without rootCause (guard blocks it)
      const lesson = await extractor.extract(defect.id)
      expect(lesson).toBeNull()
    })

    it('deduplicates similar lessons', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const d1 = await createDiagnosedDefect('Null check missing in handler', 'null_reference')
      const d2 = await createDiagnosedDefect('Null check missing in handler again', 'null_reference')

      const l1 = await extractor.extract(d1.id)
      const l2 = await extractor.extract(d2.id)
      expect(l1).not.toBeNull()
      expect(l2).toBeNull() // duplicate
    })

    it('scanForPatterns extracts from all closed defects', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      await createDiagnosedDefect('Bug A', 'type_error')
      await createDiagnosedDefect('Bug B', 'race_condition')
      const lessons = await extractor.scanForPatterns()
      expect(lessons.length).toBe(2)
    })
  })

  // ==========================================================================
  // RuleProposer
  // ==========================================================================
  describe('RuleProposer', () => {
    it('proposes rule from verified lesson', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Always check null',
        tags: ['null_reference'], contentRef: 'a', verified: false,
      })
      await kb.verify(entry.id, 'admin')
      const rule = await proposer.proposeFromLesson(entry.id)
      expect(rule).not.toBeNull()
      expect(rule!.id).toMatch(/^RULE-/)
      expect(rule!.sourceLesson).toBe(entry.id)
      expect(rule!.approved).toBe(false)
      expect(rule!.maturity.stage).toBe('shadow')
    })

    it('rejects unverified lesson', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Unverified',
        tags: [], contentRef: 'a', verified: false,
      })
      const rule = await proposer.proposeFromLesson(entry.id)
      expect(rule).toBeNull()
    })

    it('approve marks rule as approved', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Check',
        tags: ['check'], contentRef: 'a', verified: false, sourceArtifact: 'DEFECT-1',
      })
      await kb.verify(entry.id, 'admin')
      const rule = await proposer.proposeFromLesson(entry.id)
      expect(rule!.approved).toBe(false)
      for (let i = 0; i < 10; i++) rule!.maturity = recordShadowHit(rule!.maturity)

      const approved = await proposer.approve(rule!.id, 'boss')
      expect(approved.approved).toBe(true)
      expect(approved.approvedBy).toBe('boss')
      expect(approved.maturity.stage).toBe('approved-blocking')
    })

    it('rejects blocking approval before shadow maturity is eligible', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Check later',
        tags: ['check'], contentRef: 'a', verified: false, sourceArtifact: 'DEFECT-1',
      })
      await kb.verify(entry.id, 'admin')
      const rule = await proposer.proposeFromLesson(entry.id)

      await expect(proposer.approve(rule!.id, 'boss')).rejects.toThrow('not eligible')
      expect(rule!.approved).toBe(false)
      expect(rule!.approvedBy).toBeUndefined()
      expect(rule!.maturity.stage).toBe('shadow')
    })

    it('writeRuleFile creates markdown', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Never skip tests',
        tags: ['testing'], contentRef: 'a', verified: false,
      })
      await kb.verify(entry.id, 'admin')
      const rule = await proposer.proposeFromLesson(entry.id)
      const rulesDir = `${TMP}/rules`
      const path = proposer.writeRuleFile(rule!, rulesDir)
      expect(existsSync(path)).toBe(true)
      const content = readFileSync(path, 'utf-8')
      expect(content).toContain('Never skip tests')
      expect(content).toContain(entry.id)
    })

    it('scanAndPropose finds eligible lessons', async () => {
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Hot lesson',
        tags: ['hot'], contentRef: 'a', verified: false,
      })
      await kb.verify(entry.id, 'admin')
      // Boost relevance and access count
      for (let i = 0; i < 5; i++) await kb.markHelpful(entry.id, 's1')

      const proposed = await proposer.scanAndPropose()
      expect(proposed.length).toBe(1)
    })
  })

  // ==========================================================================
  // HookGenerator
  // ==========================================================================
  describe('HookGenerator', () => {
    it('generates hook script for approved rule', async () => {
      const gen = new HookGenerator(bus)
      const proposer = new RuleProposer(kb, bus)
      const entry = await kb.add({
        type: 'lesson', title: 'Run tests',
        tags: ['testing'], contentRef: 'a', verified: false, sourceArtifact: 'DEFECT-1',
      })
      await kb.verify(entry.id, 'admin')
      for (let i = 0; i < 6; i++) await kb.markHelpful(entry.id, 's1')
      const rule = await proposer.proposeFromLesson(entry.id)
      expect(rule!.enforcement).toBe('hook')
      for (let i = 0; i < 10; i++) rule!.maturity = recordShadowHit(rule!.maturity)
      await proposer.approve(rule!.id, 'admin')

      const hooksDir = `${TMP}/hooks`
      const hook = gen.generate(rule!, hooksDir)
      expect(hook).not.toBeNull()
      expect(hook!.hookType).toBe('Stop') // 'testing' pattern → Stop hook
      expect(existsSync(hook!.scriptPath)).toBe(true)
      const script = readFileSync(hook!.scriptPath, 'utf-8')
      expect(script).toContain('#!/bin/bash')
      expect(script).toContain(rule!.id)
    })

    it('rejects unapproved rule', async () => {
      const gen = new HookGenerator(bus)
      const rule = {
        id: 'RULE-1', title: 'R', description: 'D', sourceLesson: 'L',
        pattern: 'test', enforcement: 'hook' as const,
        createdAt: Date.now(), approved: false,
      }
      const hook = gen.generate(rule, `${TMP}/hooks`)
      expect(hook).toBeNull()
    })

    it('rejects prompt-enforcement rule', async () => {
      const gen = new HookGenerator(bus)
      const rule = {
        id: 'RULE-2', title: 'R', description: 'D', sourceLesson: 'L',
        pattern: 'test', enforcement: 'prompt' as const,
        createdAt: Date.now(), approved: true, approvedBy: 'x',
      }
      const hook = gen.generate(rule, `${TMP}/hooks`)
      expect(hook).toBeNull()
    })

    it('rejects shadow rules even if they are configured for hook enforcement', async () => {
      const gen = new HookGenerator(bus)
      const rule = {
        id: 'RULE-3',
        title: 'R',
        description: 'D',
        sourceLesson: 'L',
        pattern: 'test',
        enforcement: 'hook' as const,
        createdAt: Date.now(),
        approved: false,
        maturity: {
          ruleId: 'RULE-3',
          stage: 'shadow' as const,
          shadowHits: 10,
          defectEvidenceIds: ['DEFECT-1'],
          falsePositiveCount: 0,
          rollback: 'Delete generated hook.',
          evidenceIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }

      const hook = gen.generate(rule, `${TMP}/hooks`)
      expect(hook).toBeNull()
    })
  })

  // ==========================================================================
  // EvolutionEngine (end-to-end)
  // ==========================================================================
  describe('EvolutionEngine', () => {
    it('full cycle: defect → lesson → rule → hook', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const proposer = new RuleProposer(kb, bus)
      const gen = new HookGenerator(bus)
      const engine = new EvolutionEngine(extractor, proposer, gen, bus, TMP)

      // 1. Create 3+ diagnosed defects with same root cause (similar titles)
      for (let i = 1; i <= 3; i++) {
        await createDiagnosedDefect('Missing test coverage in handler', 'missing_test')
      }

      // 2. Run extraction (deduped — same title + same root cause)
      const lessons = await extractor.scanForPatterns()
      expect(lessons.length).toBe(1)

      // 3. Verify lesson + boost access
      await kb.verify(lessons[0].id, 'admin')
      for (let i = 0; i < 6; i++) await kb.markHelpful(lessons[0].id, 's1')

      // 4. Propose rule
      const rules = await proposer.scanAndPropose()
      expect(rules.length).toBe(1)
      expect(rules[0].enforcement).toBe('hook')

      // 5. Human approves
      for (let i = 0; i < 10; i++) rules[0].maturity = recordShadowHit(rules[0].maturity)
      await proposer.approve(rules[0].id, 'lead')

      // 6. Generate hook
      const stats = await engine.runCycle()
      expect(stats.hooksGenerated).toBeGreaterThanOrEqual(1)
      expect(gen.getGeneratedHooks().length).toBeGreaterThanOrEqual(1)
    })

    it('getStats reflects current state', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const proposer = new RuleProposer(kb, bus)
      const gen = new HookGenerator(bus)
      const engine = new EvolutionEngine(extractor, proposer, gen, bus, TMP)

      const stats = engine.getStats()
      expect(stats.rulesProposed).toBe(0)
      expect(stats.hooksGenerated).toBe(0)
    })

    it('runCycle proposes shadow rules without generating blocking hooks', async () => {
      const extractor = new LessonExtractor(store, kb, bus)
      const proposer = new RuleProposer(kb, bus)
      const gen = new HookGenerator(bus)
      const engine = new EvolutionEngine(extractor, proposer, gen, bus, TMP)

      const entry = await kb.add({
        type: 'lesson',
        title: 'Repeated test failure needs a rule',
        tags: ['test_failure'],
        contentRef: 'a',
        verified: false,
        sourceArtifact: 'DEFECT-1',
      })
      await kb.verify(entry.id, 'admin')
      for (let i = 0; i < 6; i++) await kb.markHelpful(entry.id, 's1')

      const stats = await engine.runCycle()
      const [rule] = proposer.getProposedRules()

      expect(stats.rulesProposed).toBe(1)
      expect(stats.shadowRules).toBe(1)
      expect(rule.maturity.stage).toBe('shadow')
      expect(gen.getGeneratedHooks()).toHaveLength(0)
    })
  })

  // ==========================================================================
  // BehaviorTracker integration
  // ==========================================================================
  describe('BehaviorTracker', () => {
    it('tracks tool calls via events', async () => {
      const { BehaviorTracker } = await import('../../src/evolution/BehaviorTracker.js')
      const tracker = new BehaviorTracker(bus)
      tracker.start()

      bus.emit('tool.called', { tool: 'Bash' }, { sessionId: 'sess1' })
      bus.emit('tool.called', { tool: 'Read' }, { sessionId: 'sess1' })
      bus.emit('tool.failed', { tool: 'Bash' }, { sessionId: 'sess1' })
      bus.emit('behavior.brute_retry', { tool: 'Bash' }, { sessionId: 'sess1' })
      bus.emit('artifact.created', { type: 'Spec' }, { sessionId: 'sess1' })

      await new Promise((r) => setTimeout(r, 30))

      const m = await tracker.getSessionMetrics('sess1')
      expect(m.toolCalls).toBe(2)
      expect(m.toolFailures).toBe(1)
      expect(m.bruteRetryCount).toBe(1)
      expect(m.artifactsCreated).toBe(1)

      tracker.stop()
    })

    it('returns empty metrics for unknown session', async () => {
      const { BehaviorTracker } = await import('../../src/evolution/BehaviorTracker.js')
      const tracker = new BehaviorTracker(bus)
      const m = await tracker.getSessionMetrics('unknown')
      expect(m.toolCalls).toBe(0)
    })
  })
})


