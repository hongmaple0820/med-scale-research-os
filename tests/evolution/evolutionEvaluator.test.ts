// W8 Tests: EvolutionEvaluator — Evolution Metrics Evaluation
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { EvolutionEvaluator } from '../../src/evolution/EvolutionEvaluator.js'
import { DetectorStatisticsTracker } from '../../src/guardrails/DetectorEnhanced.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-evolution-evaluator'

describe('EvolutionEvaluator', () => {
  let bus: EventBus
  let kb: KnowledgeBase
  let stats: DetectorStatisticsTracker
  let evaluator: EvolutionEvaluator

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    kb = new KnowledgeBase(bus)
    stats = new DetectorStatisticsTracker()
    evaluator = new EvolutionEvaluator(bus, kb, stats)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  describe('evaluate', () => {
    it('returns metrics with zero counts initially', async () => {
      const metrics = await evaluator.evaluate()
      expect(metrics.lessonsProposed).toBe(0)
      expect(metrics.lessonsValidated).toBe(0)
      expect(metrics.rulesProposed).toBe(0)
      expect(metrics.hooksGenerated).toBe(0)
      expect(metrics.detectorTriggers).toBe(0)
      expect(metrics.overallScore).toBe(0)
      expect(metrics.trend).toBe('stable')
    })

    it('counts lesson events', async () => {
      bus.emit('lesson.proposed', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.proposed', { title: 'L2' }, { sessionId: 's1' })
      bus.emit('lesson.validated', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.approved', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.rejected', { title: 'L2' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const metrics = await evaluator.evaluate()
      expect(metrics.lessonsProposed).toBe(2)
      expect(metrics.lessonsValidated).toBe(1)
      expect(metrics.lessonsApproved).toBe(1)
      expect(metrics.lessonsRejected).toBe(1)
    })

    it('counts rule events', async () => {
      bus.emit('rule.proposed', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('rule.approved', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('rule.enforced', { id: 'R1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const metrics = await evaluator.evaluate()
      expect(metrics.rulesProposed).toBe(1)
      expect(metrics.rulesApproved).toBe(1)
      expect(metrics.rulesEnforced).toBe(1)
    })

    it('counts hook events', async () => {
      bus.emit('hook.generated', { id: 'H1' }, { sessionId: 's1' })
      bus.emit('hook.deployed', { id: 'H1' }, { sessionId: 's1' })
      bus.emit('tool.blocked', { hook: 'H1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const metrics = await evaluator.evaluate()
      expect(metrics.hooksGenerated).toBe(1)
      expect(metrics.hooksDeployed).toBe(1)
      expect(metrics.hooksTriggered).toBe(1)
    })

    it('calculates detector metrics from stats', async () => {
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'block', triggeredAt: Date.now(), reason: '' })
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })

      const metrics = await evaluator.evaluate()
      expect(metrics.detectorTriggers).toBe(2)
      expect(metrics.detectorBlocks).toBe(1)
      expect(metrics.detectorWarnings).toBe(1)
    })

    it('records history snapshot', async () => {
      await evaluator.evaluate()
      await evaluator.evaluate()
      const history = evaluator.getHistory()
      expect(history.length).toBe(2)
      expect(history[0].metrics).toBeDefined()
      expect(history[1].timestamp).toBeGreaterThan(history[0].timestamp)
    })

    it('limits history to maxHistory', async () => {
      const smallEvaluator = new EvolutionEvaluator(bus, kb, stats, { maxHistory: 5 })
      for (let i = 0; i < 10; i++) await smallEvaluator.evaluate()
      expect(smallEvaluator.getHistory().length).toBe(5)
    })
  })

  describe('compareWithBaseline', () => {
    it('detects improvement', async () => {
      const baseline = await evaluator.evaluate()

      // Add positive events
      bus.emit('lesson.proposed', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.validated', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.approved', { title: 'L1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const result = await evaluator.compareWithBaseline(baseline)
      expect(result.improved).toBe(true)
      expect(result.delta.overallScore).toBeGreaterThan(0)
    })

    it('detects decline', async () => {
      const baseline = await evaluator.evaluate()

      // No positive events, just run evaluate again (should be same or lower)
      const result = await evaluator.compareWithBaseline(baseline)
      expect(result.improved).toBe(false)
    })
  })

  describe('getRecommendations', () => {
    it('returns empty when metrics are good', async () => {
      // Ensure no events that trigger recommendations
      bus.emit('lesson.proposed', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.validated', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.approved', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('rule.proposed', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('rule.approved', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('hook.generated', { id: 'H1' }, { sessionId: 's1' })
      bus.emit('hook.deployed', { id: 'H1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const recommendations = await evaluator.getRecommendations()
      expect(recommendations.length).toBe(0)
    })

    it('recommends context-specific lessons when quality low', async () => {
      bus.emit('lesson.proposed', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.rejected', { title: 'L1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const recommendations = await evaluator.getRecommendations()
      expect(recommendations.some(r => r.includes('rejection rate'))).toBe(true)
    })

    it('recommends deployment when hooks not deployed', async () => {
      bus.emit('hook.generated', { id: 'H1' }, { sessionId: 's1' })
      await new Promise(r => setTimeout(r, 30))

      const recommendations = await evaluator.getRecommendations()
      expect(recommendations.some(r => r.includes('not deployed'))).toBe(true)
    })

    it('recommends stricter enforcement when too many warnings', async () => {
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      stats.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })

      const recommendations = await evaluator.getRecommendations()
      expect(recommendations.some(r => r.includes('Too many warnings'))).toBe(true)
    })
  })

  describe('trend calculation', () => {
    it('shows improving trend after multiple evaluations', async () => {
      // First two evaluations establish baseline (history.length must be >= 2)
      await evaluator.evaluate() // history.length = 1, trend = stable (history < 2)
      await evaluator.evaluate() // history.length = 2, trend = stable (comparing to first)

      // Add significant positive events to achieve >0.05 improvement
      bus.emit('lesson.proposed', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.validated', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('lesson.approved', { title: 'L1' }, { sessionId: 's1' })
      bus.emit('rule.proposed', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('rule.approved', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('rule.enforced', { id: 'R1' }, { sessionId: 's1' })
      bus.emit('hook.generated', { id: 'H1' }, { sessionId: 's1' })
      bus.emit('hook.deployed', { id: 'H1' }, { sessionId: 's1' })
      bus.emit('tool.blocked', { hook: 'H1' }, { sessionId: 's1' })

      stats.record({ detectorName: 'test', sessionId: 's1', tool: 'Edit', severity: 'block', triggeredAt: Date.now(), reason: '' })

      await new Promise(r => setTimeout(r, 30))

      // Third evaluation: history.length = 3, compares to history[1] (previous score = 0)
      const metrics = await evaluator.evaluate()
      expect(metrics.overallScore).toBeGreaterThan(0.05)
      expect(metrics.trend).toBe('improving')
    })

    it('shows stable trend with small changes', async () => {
      await evaluator.evaluate()
      await evaluator.evaluate()
      const metrics = await evaluator.evaluate()
      expect(metrics.trend).toBe('stable')
    })
  })

  describe('event emission', () => {
    it('emits evolution.evaluated event', async () => {
      let emitted = false
      bus.on('evolution.evaluated', () => { emitted = true })
      await evaluator.evaluate()
      await new Promise(r => setTimeout(r, 20))
      expect(emitted).toBe(true)
    })
  })
})
