// W8 Tests: Detector Enhanced — Statistics, Registry, AI-Slop, Hallucination, DuplicateEdit
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import {
  DetectorStatisticsTracker,
  DetectorRegistry,
  AISlopDetector,
  HallucinationDetector,
  DuplicateEditDetector,
  EnhancedGatewayContext,
  ALL_ENHANCED_DETECTORS,
} from '../../src/guardrails/DetectorEnhanced.js'
import { Gateway } from '../../src/guardrails/Gateway.js'
import type { ToolUseInput, ToolResultInput } from '../../src/artifact/types.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-detector-enhanced'
const me = { kind: 'human' as const, userId: 'tester' }

describe('Detector Enhanced', () => {
  let bus: EventBus
  let gw: Gateway

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    gw = new Gateway(bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  const mkInput = (tool: string, args: Record<string, unknown> = {}): ToolUseInput => ({
    sessionId: 'test-session', tool, args, timestamp: Date.now(),
  })

  const mkResult = (tool: string, output: string): ToolResultInput => ({
    sessionId: 'test-session', tool, output, args: {}, exitCode: 0, timestamp: Date.now(),
  })

  describe('DetectorStatisticsTracker', () => {
    it('records triggers and retrieves stats', () => {
      const tracker = new DetectorStatisticsTracker()
      tracker.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: 'test' })
      tracker.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Write', severity: 'warn', triggeredAt: Date.now(), reason: 'test' })
      tracker.record({ detectorName: 'ai-slop', sessionId: 's2', tool: 'Edit', severity: 'block', triggeredAt: Date.now(), reason: 'test' })

      const stats = tracker.getStats('ai-slop')
      expect(stats).not.toBeNull()
      expect(stats!.totalTriggers).toBe(3)
      expect(stats!.bySeverity['warn']).toBe(2)
      expect(stats!.bySeverity['block']).toBe(1)
      expect(stats!.byTool['Edit']).toBe(2)
    })

    it('returns null for unknown detector', () => {
      const tracker = new DetectorStatisticsTracker()
      expect(tracker.getStats('unknown')).toBeNull()
    })

    it('getAllStats returns all', () => {
      const tracker = new DetectorStatisticsTracker()
      tracker.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      tracker.record({ detectorName: 'hallucination', sessionId: 's1', tool: 'Bash', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      expect(tracker.getAllStats().length).toBe(2)
    })

    it('getRecentTriggers limits', () => {
      const tracker = new DetectorStatisticsTracker()
      for (let i = 0; i < 100; i++) tracker.record({ detectorName: 'ai-slop', sessionId: 's' + i, tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      expect(tracker.getRecentTriggers(10).length).toBe(10)
    })

    it('clear resets', () => {
      const tracker = new DetectorStatisticsTracker()
      tracker.record({ detectorName: 'ai-slop', sessionId: 's1', tool: 'Edit', severity: 'warn', triggeredAt: Date.now(), reason: '' })
      tracker.clear()
      expect(tracker.getRecentTriggers(100).length).toBe(0)
    })
  })

  describe('DetectorRegistry', () => {
    it('registers and retrieves', () => {
      const registry = new DetectorRegistry()
      const detector = new AISlopDetector()
      registry.register(detector, 'preTool', { enabled: true })
      expect(registry.getDetector(detector.name)).toBe(detector)
    })

    it('unregister removes', () => {
      const registry = new DetectorRegistry()
      const detector = new AISlopDetector()
      registry.register(detector, 'preTool')
      expect(registry.unregister(detector.name)).toBe(true)
      expect(registry.getDetector(detector.name)).toBeNull()
    })

    it('getConfig works', () => {
      const registry = new DetectorRegistry()
      registry.register(new AISlopDetector(), 'preTool', { enabled: true, threshold: 5 })
      expect(registry.getConfig('ai-slop')!.threshold).toBe(5)
    })

    it('enable/disable', () => {
      const registry = new DetectorRegistry()
      registry.register(new AISlopDetector(), 'preTool', { enabled: true })
      registry.disable('ai-slop')
      expect(registry.getConfig('ai-slop')!.enabled).toBe(false)
      registry.enable('ai-slop')
      expect(registry.getConfig('ai-slop')!.enabled).toBe(true)
    })
  })

  describe('AISlopDetector', () => {
    it('detects AI-slop patterns after threshold exceeded', async () => {
      const detector = new AISlopDetector({ threshold: 2 })
      const ctx = { eventBus: bus, cache: new Map() }
      // Content that matches at least 2 patterns:
      // 1. emoji pattern [🚀💡🎯✨🎉📊🏆⚡💡🔧]
      // 2. hero.*section.*center.*gradient (needs hero, section, center, gradient in sequence)
      const input = mkInput('Edit', { new_string: '🚀 hero section center gradient layout' })
      const r1 = await detector.check(input, ctx)
      const r2 = await detector.check(input, ctx)
      // After 2 calls with threshold=2, should trigger (2 pattern matches + 2 occurrences)
      expect(r2.triggered).toBe(true)
      expect(r2.severity).toBe('warn')
    })

    it('ignores non-edit tools', async () => {
      const detector = new AISlopDetector()
      const ctx = { eventBus: bus, cache: new Map() }
      expect(await detector.check(mkInput('Bash', { command: 'npm test' }), ctx)).toHaveProperty('triggered', false)
    })
  })

  describe('HallucinationDetector', () => {
    it('detects unverified test pass claim', async () => {
      const detector = new HallucinationDetector()
      const ctx = { eventBus: bus, cache: new Map() }
      const result = await detector.check(mkResult('Bash', '测试通过！'), ctx)
      expect(result.triggered).toBe(true)
      expect(result.reason).toContain('hallucination')
    })

    it('ignores output without claims', async () => {
      const detector = new HallucinationDetector()
      const ctx = { eventBus: bus, cache: new Map() }
      expect(await detector.check(mkResult('Bash', 'Running tests...'), ctx)).toHaveProperty('triggered', false)
    })
  })

  describe('DuplicateEditDetector', () => {
    it('detects repeated edits', async () => {
      const detector = new DuplicateEditDetector({ maxDuplicates: 2 })
      const ctx = { eventBus: bus, cache: new Map() }
      const input = mkInput('Edit', { old_string: 'const x = 1', file_path: 'src/a.ts' })
      await detector.check(input, ctx)
      await detector.check(input, ctx)
      const result = await detector.check(input, ctx)
      expect(result.triggered).toBe(true)
      expect(result.reason).toContain('duplicate edit')
    })

    it('ignores non-Edit tools', async () => {
      const detector = new DuplicateEditDetector()
      const ctx = { eventBus: bus, cache: new Map() }
      expect(await detector.check(mkInput('Write', { content: 'test' }), ctx)).toHaveProperty('triggered', false)
    })
  })

  describe('EnhancedGatewayContext', () => {
    it('provides registry and stats', () => {
      const enhanced = new EnhancedGatewayContext(bus)
      expect(enhanced.registry).toBeDefined()
      expect(enhanced.stats).toBeDefined()
    })
  })

  describe('ALL_ENHANCED_DETECTORS', () => {
    it('contains all expected', () => {
      expect(ALL_ENHANCED_DETECTORS.length).toBe(3)
      expect(ALL_ENHANCED_DETECTORS.find(d => d.detector.name === 'ai-slop')).toBeDefined()
      expect(ALL_ENHANCED_DETECTORS.find(d => d.detector.name === 'hallucination')).toBeDefined()
      expect(ALL_ENHANCED_DETECTORS.find(d => d.detector.name === 'duplicate-edit')).toBeDefined()
    })
  })
})
