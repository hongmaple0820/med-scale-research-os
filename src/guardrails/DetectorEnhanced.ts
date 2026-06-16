// SCALE Engine — Detector Enhanced (v0.7.0)
// 增强 Detector 管理：统计、配置、AI-Slop检测、Hallucination检测

import type { IDetector, DetectorContext } from './Gateway.js'
import type { ToolUseInput, ToolResultInput, DetectorResult } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface DetectorTriggerRecord {
  detectorName: string
  sessionId: string
  tool: string
  severity: string
  triggeredAt: number
  reason: string
}

export interface DetectorStatistics {
  detectorName: string
  totalTriggers: number
  bySeverity: Record<string, number>
  byTool: Record<string, number>
  recentTriggers: DetectorTriggerRecord[]
}

export interface IDetectorStatisticsTracker {
  record(trigger: DetectorTriggerRecord): void
  getStats(detectorName: string): DetectorStatistics | null
  getAllStats(): DetectorStatistics[]
  getRecentTriggers(limit?: number): DetectorTriggerRecord[]
  clear(): void
}

export class DetectorStatisticsTracker implements IDetectorStatisticsTracker {
  private triggers: DetectorTriggerRecord[] = []
  private maxRecords: number

  constructor(maxRecords: number = 1000) { this.maxRecords = maxRecords }

  record(trigger: DetectorTriggerRecord): void {
    this.triggers.push(trigger)
    if (this.triggers.length > this.maxRecords) this.triggers.shift()
  }

  getStats(detectorName: string): DetectorStatistics | null {
    const matches = this.triggers.filter(t => t.detectorName === detectorName)
    if (matches.length === 0) return null
    return {
      detectorName,
      totalTriggers: matches.length,
      bySeverity: this.groupBy(matches, 'severity'),
      byTool: this.groupBy(matches, 'tool'),
      recentTriggers: matches.slice(-10),
    }
  }

  getAllStats(): DetectorStatistics[] {
    const names = new Set(this.triggers.map(t => t.detectorName))
    return Array.from(names).map(n => this.getStats(n)!).filter(Boolean)
  }

  getRecentTriggers(limit: number = 50): DetectorTriggerRecord[] { return this.triggers.slice(-limit) }
  clear(): void { this.triggers = [] }

  private groupBy(arr: DetectorTriggerRecord[], key: keyof DetectorTriggerRecord): Record<string, number> {
    const result: Record<string, number> = {}
    for (const item of arr) {
      const val = String(item[key])
      result[val] = (result[val] ?? 0) + 1
    }
    return result
  }
}

export interface DetectorConfig {
  enabled: boolean
  threshold?: number
  windowMs?: number
  customPatterns?: Array<{ pattern: RegExp; description: string }>
}

export interface IDetectorRegistry {
  register(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop', config?: DetectorConfig): void
  unregister(detectorName: string): boolean
  getDetector(detectorName: string): IDetector | null
  getConfig(detectorName: string): DetectorConfig | null
  setConfig(detectorName: string, config: Partial<DetectorConfig>): void
  listDetectors(): Array<{ name: string; hook: string; enabled: boolean }>
  enable(detectorName: string): void
  disable(detectorName: string): void
}

export class DetectorRegistry implements IDetectorRegistry {
  private detectors = new Map<string, { detector: IDetector; hook: 'preTool' | 'postTool' | 'beforeStop'; config: DetectorConfig }>()

  register(detector: IDetector, hook: 'preTool' | 'postTool' | 'beforeStop', config?: DetectorConfig): void {
    this.detectors.set(detector.name, { detector, hook, config: config ?? { enabled: true } })
    logger.info({ name: detector.name, hook }, 'Detector registered in registry')
  }

  unregister(detectorName: string): boolean { return this.detectors.delete(detectorName) }
  getDetector(detectorName: string): IDetector | null { return this.detectors.get(detectorName)?.detector ?? null }
  getConfig(detectorName: string): DetectorConfig | null { return this.detectors.get(detectorName)?.config ?? null }

  setConfig(detectorName: string, config: Partial<DetectorConfig>): void {
    const existing = this.detectors.get(detectorName)
    if (existing) existing.config = { ...existing.config, ...config }
  }

  listDetectors(): Array<{ name: string; hook: string; enabled: boolean }> {
    return Array.from(this.detectors.entries()).map(([name, { hook, config }]) => ({ name, hook, enabled: config.enabled }))
  }

  enable(detectorName: string): void { this.setConfig(detectorName, { enabled: true }) }
  disable(detectorName: string): void { this.setConfig(detectorName, { enabled: false }) }
}

export class AISlopDetector implements IDetector {
  name = 'ai-slop'

  private patterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /gradient.*purple.*blue/i, description: 'purple-blue gradient overuse' },
    { pattern: /gradient.*linear.*135deg/i, description: 'generic 135deg gradient' },
    { pattern: /borderRadius:s*(8|12|16)(px|rem)/i, description: 'uniform rounded corners' },
    { pattern: /rounded-[(8|12|16)px]/i, description: 'uniform rounded corners (Tailwind)' },
    { pattern: /hero.*section.*center.*gradient/i, description: 'generic hero section' },
    { pattern: /grid-cols-3.*gap-4/i, description: 'generic 3-column grid' },
    { pattern: /flex.*justify-between.*items-center/i, description: 'generic flex center layout' },
    { pattern: /[🚀💡🎯✨🎉📊🏆⚡💡🔧]/u, description: 'emoji overuse' },
    { pattern: /background.*blur.*opacity.*0.[1-5]/i, description: 'decorative blur overlay' },
  ]

  private threshold: number
  private windowMs: number

  constructor(opts: { threshold?: number; windowMs?: number } = {}) {
    this.threshold = opts.threshold ?? 3
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000
  }

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }

    const content = JSON.stringify(input.args)
    const matches: string[] = []

    for (const { pattern, description } of this.patterns) {
      if (pattern.test(content)) matches.push(description)
    }

    if (matches.length < 2) return { triggered: false }

    const key = 'ai-slop:' + input.sessionId
    const history = (ctx.cache.get(key) as number[] | undefined) ?? []
    const recent = history.filter(t => Date.now() - t < this.windowMs)
    recent.push(Date.now())
    ctx.cache.set(key, recent)

    if (recent.length >= this.threshold) {
      ctx.eventBus.emit('behavior.ai_slop', { sessionId: input.sessionId, patterns: matches, count: recent.length }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: 'Detected AI-Slop patterns: ' + matches.slice(0, 3).join(', ') + '. Make code look human-written.',
        suggestion: 'Avoid: gradient abuse, uniform rounded corners, emoji, template hero, 3-column grid.',
      }
    }
    return { triggered: false }
  }
}

export class HallucinationDetector implements IDetector {
  name = 'hallucination'

  private patterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /测试.*通过|passed.*test/i, description: 'unverified test pass claim' },
    { pattern: /已.*验证|verified.*success/i, description: 'unverified verification claim' },
    { pattern: /构建.*成功|build.*succeeded/i, description: 'unverified build success claim' },
    { pattern: /lint.*通过|lint.*passed/i, description: 'unverified lint pass claim' },
  ]

  async check(input: ToolResultInput, ctx: DetectorContext): Promise<DetectorResult> {
    const text = input.output ?? ''
    const matches: string[] = []

    for (const { pattern, description } of this.patterns) {
      if (pattern.test(text)) matches.push(description)
    }

    if (matches.length === 0) return { triggered: false }

    const recentCommands = await ctx.eventBus.query({
      sessionId: input.sessionId,
      types: ['tool.completed'],
      filter: (e) => {
        const p = e.payload as { tool: string; args?: { command?: string } }
        return p.tool === 'Bash' && /test|lint|build|verify/i.test(p.args?.command ?? '')
      },
      limit: 10,
    })

    const hasSuccessClaim = matches.some(m => m.includes('unverified'))
    if (hasSuccessClaim && recentCommands.length === 0) {
      ctx.eventBus.emit('behavior.hallucination', { sessionId: input.sessionId, patterns: matches, type: 'unverified_claim' }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: 'Detected hallucination: claiming "' + matches[0] + '" without running verification.',
        suggestion: 'Run actual verification commands: bun test, pnpm lint, pnpm build',
      }
    }
    return { triggered: false }
  }
}

export class DuplicateEditDetector implements IDetector {
  name = 'duplicate-edit'
  private maxDuplicates: number

  constructor(opts: { maxDuplicates?: number } = {}) { this.maxDuplicates = opts.maxDuplicates ?? 2 }

  async check(input: ToolUseInput, ctx: DetectorContext): Promise<DetectorResult> {
    if (input.tool !== 'Edit') return { triggered: false }

    const args = input.args as { old_string?: string; file_path?: string }
    if (!args.old_string || !args.file_path) return { triggered: false }

    const key = 'duplicate-edit:' + input.sessionId + ':' + args.file_path
    const edits = (ctx.cache.get(key) as string[] | undefined) ?? []

    const duplicateCount = edits.filter(s => s === args.old_string).length
    edits.push(args.old_string)
    ctx.cache.set(key, edits)

    if (duplicateCount >= this.maxDuplicates) {
      ctx.eventBus.emit('behavior.duplicate_edit', { sessionId: input.sessionId, file: args.file_path, count: duplicateCount + 1 }, { sessionId: input.sessionId })
      return {
        triggered: true,
        severity: 'warn',
        reason: 'Detected duplicate edit: same content edited ' + (duplicateCount + 1) + ' times in ' + args.file_path,
        suggestion: 'Check if previous edits applied correctly, try different strategy.',
      }
    }
    return { triggered: false }
  }
}

export interface IEnhancedGateway {
  registry: IDetectorRegistry
  stats: IDetectorStatisticsTracker
}

export class EnhancedGatewayContext implements IEnhancedGateway {
  registry: IDetectorRegistry
  stats: IDetectorStatisticsTracker

  constructor(eventBus: IEventBus) {
    this.registry = new DetectorRegistry()
    this.stats = new DetectorStatisticsTracker()

    // Listen to all events and filter behavior events
    eventBus.on('*', (e) => {
      if (!e.type.startsWith('behavior.')) return
      const payload = e.payload as Record<string, unknown>
      this.stats.record({
        detectorName: String(e.type.replace('behavior.', '')),
        sessionId: String(payload.sessionId ?? 'unknown'),
        tool: String(payload.tool ?? 'unknown'),
        severity: 'warn',
        triggeredAt: Date.now(),
        reason: String(payload.reason ?? ''),
      })
    })
  }
}

export const ALL_ENHANCED_DETECTORS: Array<{ detector: IDetector; hook: 'preTool' | 'postTool' | 'beforeStop' }> = [
  { detector: new AISlopDetector(), hook: 'preTool' },
  { detector: new HallucinationDetector(), hook: 'postTool' },
  { detector: new DuplicateEditDetector(), hook: 'preTool' },
]
