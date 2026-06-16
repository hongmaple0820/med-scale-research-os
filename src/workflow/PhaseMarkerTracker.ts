// SCALE Engine — Phase Marker Tracker
// 解析 Output Markers 并追踪 Phase 完成状态
// 用于 Stop Hook 检查所有 Phase 是否完成

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

// ============================================================================
// Types
// ============================================================================

export type ScalePhase = 'DEFINE' | 'PLAN' | 'EXECUTE' | 'VERIFY' | 'REVIEW' | 'SHIP'

export interface PhaseStatus {
  completed: boolean
  marker?: string // 原始 marker 文本
  details?: Record<string, string> // 解析出的键值对
  timestamp?: number
}

export interface PhaseState {
  DEFINE: PhaseStatus
  PLAN: PhaseStatus
  EXECUTE: PhaseStatus
  VERIFY: PhaseStatus
  REVIEW: PhaseStatus
  SHIP: PhaseStatus
}

// ============================================================================
// Output Marker Patterns
// ============================================================================

// [DEFINE] ✓ ambiguity <score>% ✓ | spec <id> ✓
const DEFINE_PATTERN = /\[DEFINE\]\s*✓\s*ambiguity\s+([\d.]+)%\s*✓\s*\|\s*spec\s+(\S+)\s*✓/

// [PLAN] ✓ impact ✓ | contract ✓ | rollback ✓ | plan <id> ✓
const PLAN_PATTERN = /\[PLAN\]\s*✓\s*impact\s+✓\s*\|\s*contract\s+✓\s*\|\s*rollback\s+✓\s*\|\s*plan\s+(\S+)\s*✓/

// [EXECUTE] ✓ TDD RED ✓ | GREEN ✓ | REFACTOR ✓ | task <id> ✓
const EXECUTE_PATTERN = /\[EXECUTE\]\s*✓\s*TDD\s+RED\s+✓\s*\|\s*GREEN\s+✓\s*\|\s*REFACTOR\s+✓\s*\|\s*task\s+(\S+)\s*✓/

// [VERIFY] ✓ <gate1> ✓ | <gate2> ✓ | ... (flexible)
const VERIFY_PATTERN = /\[VERIFY\]\s*(.*?)(?:\s*$)/

// [REVIEW] ✓ files <count> ✓ | findings <total> ✓ | CRITICAL <n> ✓ | HIGH <n> ✓ | principles <n>/8 ✓
const REVIEW_PATTERN = /\[REVIEW\]\s*✓\s*files\s+(\d+)\s*✓\s*\|\s*findings\s+(\d+)\s*✓\s*\|\s*CRITICAL\s+(\d+)\s*✓\s*\|\s*HIGH\s+(\d+)\s*✓\s*\|\s*principles\s+(\d+)\/8\s*✓/

// [SHIP] ✓ evidence ✓ | staged <count> ✓ | commit <hash> ✓ | push ✓ | report ✓
const SHIP_PATTERN = /\[SHIP\]\s*✓\s*evidence\s+✓\s*\|\s*staged\s+(\d+)\s*✓\s*\|\s*commit\s+(\S+)\s*✓\s*\|\s*(push|skip)\s+✓\s*\|\s*report\s+✓/

// ============================================================================
// Phase Marker Tracker
// ============================================================================

export class PhaseMarkerTracker {
  private stateDir: string
  private stateFile: string

  constructor(scaleDir: string = '.scale') {
    this.stateDir = join(scaleDir, 'phases')
    this.stateFile = join(this.stateDir, '.phase-state')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Marker Parsing
  // ─────────────────────────────────────────────────────────────

  /**
   * 解析文本中的所有 Output Markers 并更新状态
   * @param text 包含 markers 的文本（对话输出）
   * @returns 本次解析出的 markers 数量
   */
  parseAndUpdate(text: string): number {
    const markers = this.parseMarkers(text)
    const keys = Object.keys(markers)
    if (keys.length === 0) return 0

    const state = this.getState()
    for (const [phase, status] of Object.entries(markers)) {
      if (status.completed) {
        state[phase as ScalePhase] = status
      }
    }
    this.writeState(state)
    logger.info({ phases: keys, count: keys.length }, 'Phase markers parsed and updated')
    return keys.length
  }

  /**
   * 解析文本中的所有 Output Markers
   * @returns 解析结果 Map<Phase, PhaseStatus>
   */
  parseMarkers(text: string): Partial<Record<ScalePhase, PhaseStatus>> {
    const results: Partial<Record<ScalePhase, PhaseStatus>> = {}

    // DEFINE
    const defineMatch = text.match(DEFINE_PATTERN)
    if (defineMatch) {
      results.DEFINE = {
        completed: true,
        marker: defineMatch[0],
        details: {
          ambiguity: defineMatch[1],
          specId: defineMatch[2],
        },
        timestamp: Date.now(),
      }
    }

    // PLAN
    const planMatch = text.match(PLAN_PATTERN)
    if (planMatch) {
      results.PLAN = {
        completed: true,
        marker: planMatch[0],
        details: {
          planId: planMatch[1],
        },
        timestamp: Date.now(),
      }
    }

    // EXECUTE
    const executeMatch = text.match(EXECUTE_PATTERN)
    if (executeMatch) {
      results.EXECUTE = {
        completed: true,
        marker: executeMatch[0],
        details: {
          taskId: executeMatch[1],
        },
        timestamp: Date.now(),
      }
    }

    // VERIFY
    const verifyMatch = text.match(VERIFY_PATTERN)
    if (verifyMatch) {
      results.VERIFY = {
        completed: true,
        marker: verifyMatch[0],
        details: {
          gates: verifyMatch[1].trim(),
        },
        timestamp: Date.now(),
      }
    }

    // REVIEW
    const reviewMatch = text.match(REVIEW_PATTERN)
    if (reviewMatch) {
      results.REVIEW = {
        completed: true,
        marker: reviewMatch[0],
        details: {
          files: reviewMatch[1],
          findings: reviewMatch[2],
          critical: reviewMatch[3],
          high: reviewMatch[4],
          principles: reviewMatch[5],
        },
        timestamp: Date.now(),
      }
    }

    // SHIP
    const shipMatch = text.match(SHIP_PATTERN)
    if (shipMatch) {
      results.SHIP = {
        completed: true,
        marker: shipMatch[0],
        details: {
          staged: shipMatch[1],
          commit: shipMatch[2],
          push: shipMatch[3],
        },
        timestamp: Date.now(),
      }
    }

    return results
  }

  // ─────────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────────

  /** 获取当前 Phase 状态 */
  getState(): PhaseState {
    if (!existsSync(this.stateFile)) {
      return this.createDefaultState()
    }

    try {
      const content = readFileSync(this.stateFile, 'utf-8')
      return JSON.parse(content) as PhaseState
    } catch {
      return this.createDefaultState()
    }
  }

  /** 手动标记 Phase 完成 */
  markComplete(phase: ScalePhase, details?: Record<string, string>): void {
    const state = this.getState()
    state[phase] = {
      completed: true,
      details,
      timestamp: Date.now(),
    }
    this.writeState(state)
    logger.info({ phase, details }, 'Phase marked complete')
  }

  /** 重置 Phase 状态 */
  resetPhase(phase: ScalePhase): void {
    const state = this.getState()
    state[phase] = { completed: false }
    this.writeState(state)
    logger.info({ phase }, 'Phase state reset')
  }

  /** 重置所有状态 */
  resetAll(): void {
    if (existsSync(this.stateFile)) {
      unlinkSync(this.stateFile)
    }
    logger.info('All phase states reset')
  }

  /** 检查单个 Phase 是否完成 */
  isPhaseComplete(phase: ScalePhase): boolean {
    return this.getState()[phase]?.completed === true
  }

  /** 检查所有必需 Phase 是否完成 */
  isAllComplete(): boolean {
    const state = this.getState()
    const required: ScalePhase[] = ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP']
    return required.every(p => state[p]?.completed === true)
  }

  /** 获取缺失的 Phase 列表 */
  getMissingPhases(): ScalePhase[] {
    const state = this.getState()
    const required: ScalePhase[] = ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP']
    return required.filter(p => state[p]?.completed !== true)
  }

  /** 获取已完成的 Phase 列表 */
  getCompletedPhases(): ScalePhase[] {
    const state = this.getState()
    const all: ScalePhase[] = ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP']
    return all.filter(p => state[p]?.completed === true)
  }

  // ─────────────────────────────────────────────────────────────
  // Report Generation
  // ─────────────────────────────────────────────────────────────

  /** 生成状态报告 */
  generateReport(): string {
    const state = this.getState()
    const phaseOrder: ScalePhase[] = ['DEFINE', 'PLAN', 'EXECUTE', 'VERIFY', 'REVIEW', 'SHIP']

    const lines: string[] = [
      '# SCALE Engine Phase Status',
      '',
    ]

    for (const phase of phaseOrder) {
      const status = state[phase]
      if (status?.completed) {
        lines.push(`✅ ${phase}: completed`)
        if (status.details) {
          for (const [key, value] of Object.entries(status.details)) {
            lines.push(`   - ${key}: ${value}`)
          }
        }
      } else {
        lines.push(`⬜ ${phase}: pending`)
      }
    }

    const completed = phaseOrder.filter(p => state[p]?.completed).length
    lines.push('')
    lines.push(`Progress: ${completed}/${phaseOrder.length} phases`)

    if (this.isAllComplete()) {
      lines.push('')
      lines.push('🎉 All phases complete — ready to ship!')
    }

    return lines.join('\n')
  }

  /** 生成 Stop Hook 检查结果 */
  generateStopHookResult(): { pass: boolean; message: string; missing: string[] } {
    const missing = this.getMissingPhases()
    const pass = missing.length === 0

    if (pass) {
      return {
        pass: true,
        message: 'All SCALE Engine phases complete',
        missing: [],
      }
    }

    return {
      pass: false,
      message: `Incomplete phases: ${missing.join(', ')}`,
      missing,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  private createDefaultState(): PhaseState {
    return {
      DEFINE: { completed: false },
      PLAN: { completed: false },
      EXECUTE: { completed: false },
      VERIFY: { completed: false },
      REVIEW: { completed: false },
      SHIP: { completed: false },
    }
  }

  private writeState(state: PhaseState): void {
    this.ensureDir()
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8')
  }
}

// ============================================================================
// Standalone CLI Helper
// ============================================================================

/** 快速解析单个 marker 行（供 CLI 和 Hook 使用） */
export function parsePhaseMarker(line: string): { phase: ScalePhase; details: Record<string, string> } | null {
  const tracker = new PhaseMarkerTracker()
  const results = tracker.parseMarkers(line)
  const entries = Object.entries(results)
  if (entries.length === 0) return null
  const [phase, status] = entries[0]
  return { phase: phase as ScalePhase, details: status.details ?? {} }
}
