// SCALE Engine — Session State Tracker
// 轻量级状态文件追踪，用于认知工作流进度标记
// 设计参考：工作流配置优化方案 §3.1

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

// ============================================================================
// Types
// ============================================================================

export type PhaseStatus = '✓' | '⏳' | '' | 'pending'

export interface FlowState {
  SKILL_SCAN: PhaseStatus
  EXPLORE: PhaseStatus
  PLAN: PhaseStatus
  EXECUTE: PhaseStatus
  VERIFY: PhaseStatus
  SETTLE: PhaseStatus
  POLLUTION: PhaseStatus
  LAZY: PhaseStatus
}

export interface SessionMarkers {
  skillScanned: boolean
  skillList: string[]
  verified: boolean
  pollutionDetected: boolean
  pollutionCleared: boolean
  lazyDetected: string[]
  failCount: number
}

// ============================================================================
// Session State Tracker
// ============================================================================

export class SessionStateTracker {
  private sessionDir: string
  private sessionId: string

  constructor(sessionId: string, scaleDir: string = '.scale') {
    this.sessionId = sessionId
    this.sessionDir = join(scaleDir, 'session')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Flow State Management
  // ─────────────────────────────────────────────────────────────

  /** Get current flow state */
  getFlowState(): FlowState {
    const stateFile = join(this.sessionDir, '.flow-state')
    if (!existsSync(stateFile)) {
      return this.createDefaultFlowState()
    }

    const content = readFileSync(stateFile, 'utf-8')
    const state: FlowState = {
      SKILL_SCAN: '',
      EXPLORE: '',
      PLAN: '',
      EXECUTE: '',
      VERIFY: '',
      SETTLE: '',
      POLLUTION: '',
      LAZY: '',
    }

    // Parse state file
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+)=(✓|⏳|pending)?$/)
      if (match) {
        const [, phase, status] = match
        if (phase in state) {
          state[phase as keyof FlowState] = (status as PhaseStatus) || ''
        }
      }
    }

    return state
  }

  /** Update phase status */
  updatePhase(phase: keyof FlowState, status: PhaseStatus): void {
    const state = this.getFlowState()
    state[phase] = status
    this.writeFlowState(state)
    logger.info({ phase, status, sessionId: this.sessionId }, 'Flow state updated')
  }

  /** Mark phase as complete */
  markPhaseComplete(phase: keyof FlowState): void {
    this.updatePhase(phase, '✓')
  }

  /** Mark phase as in progress */
  markPhaseInProgress(phase: keyof FlowState): void {
    this.updatePhase(phase, '⏳')
  }

  /** Check if all phases complete */
  isAllComplete(): boolean {
    const state = this.getFlowState()
    const required: (keyof FlowState)[] = ['SKILL_SCAN', 'EXPLORE', 'PLAN', 'EXECUTE', 'VERIFY', 'SETTLE']
    return required.every(p => state[p] === '✓')
  }

  /** Get missing phases */
  getMissingPhases(): string[] {
    const state = this.getFlowState()
    const required: (keyof FlowState)[] = ['SKILL_SCAN', 'EXPLORE', 'PLAN', 'EXECUTE', 'VERIFY', 'SETTLE']
    return required.filter(p => state[p] !== '✓')
  }

  private createDefaultFlowState(): FlowState {
    return {
      SKILL_SCAN: '',
      EXPLORE: '',
      PLAN: '',
      EXECUTE: '',
      VERIFY: '',
      SETTLE: '',
      POLLUTION: '',
      LAZY: '',
    }
  }

  private writeFlowState(state: FlowState): void {
    const stateFile = join(this.sessionDir, '.flow-state')
    const content = Object.entries(state)
      .map(([phase, status]) => `${phase}=${status}`)
      .join('\n')
    writeFileSync(stateFile, content, 'utf-8')
  }

  // ─────────────────────────────────────────────────────────────
  // Markers Management
  // ─────────────────────────────────────────────────────────────

  /** Mark skill scan complete */
  markSkillScanned(skills: string[]): void {
    const markerFile = join(this.sessionDir, '.skill-scanned')
    writeFileSync(markerFile, skills.join('|'), 'utf-8')
    this.updatePhase('SKILL_SCAN', '✓')
    logger.info({ skills, sessionId: this.sessionId }, 'Skill scan marked')
  }

  /** Check if skill scanned */
  isSkillScanned(): boolean {
    const markerFile = join(this.sessionDir, '.skill-scanned')
    return existsSync(markerFile)
  }

  /** Get scanned skills */
  getScannedSkills(): string[] {
    const markerFile = join(this.sessionDir, '.skill-scanned')
    if (!existsSync(markerFile)) return []
    return readFileSync(markerFile, 'utf-8').split('|')
  }

  /** Mark verification complete */
  markVerified(): void {
    const markerFile = join(this.sessionDir, '.verified')
    writeFileSync(markerFile, '✓', 'utf-8')
    this.updatePhase('VERIFY', '✓')
    logger.info({ sessionId: this.sessionId }, 'Verification marked')
  }

  /** Check if verified */
  isVerified(): boolean {
    const markerFile = join(this.sessionDir, '.verified')
    return existsSync(markerFile)
  }

  /** Mark pollution detected */
  markPollutionDetected(): void {
    const markerFile = join(this.sessionDir, '.pollution-detected')
    writeFileSync(markerFile, 'POLLUTION=1', 'utf-8')
    this.updatePhase('POLLUTION', 'pending')
    logger.warn({ sessionId: this.sessionId }, 'Pollution detected')
  }

  /** Clear pollution */
  clearPollution(): void {
    const markerFile = join(this.sessionDir, '.pollution-detected')
    if (existsSync(markerFile)) {
      unlinkSync(markerFile)
    }
    this.updatePhase('POLLUTION', '✓')
    logger.info({ sessionId: this.sessionId }, 'Pollution cleared')
  }

  /** Check if pollution detected */
  isPollutionDetected(): boolean {
    const markerFile = join(this.sessionDir, '.pollution-detected')
    return existsSync(markerFile)
  }

  /** Mark lazy detected */
  markLazyDetected(type: string): void {
    const markerFile = join(this.sessionDir, '.lazy-detected')
    const existing = existsSync(markerFile) ? readFileSync(markerFile, 'utf-8') : ''
    const updated = existing ? `${existing}\n${type}=1` : `${type}=1`
    writeFileSync(markerFile, updated, 'utf-8')
    this.updatePhase('LAZY', 'pending')
    logger.warn({ type, sessionId: this.sessionId }, 'Lazy detected')
  }

  /** Clear lazy marker */
  clearLazyMarker(type: string): void {
    const markerFile = join(this.sessionDir, '.lazy-detected')
    if (!existsSync(markerFile)) return

    const content = readFileSync(markerFile, 'utf-8')
    const lines = content.split('\n').filter(l => !l.startsWith(`${type}=`))

    if (lines.length === 0) {
      unlinkSync(markerFile)
      this.updatePhase('LAZY', '')
    } else {
      writeFileSync(markerFile, lines.join('\n'), 'utf-8')
    }
  }

  /** Check if lazy detected */
  isLazyDetected(): boolean {
    const markerFile = join(this.sessionDir, '.lazy-detected')
    return existsSync(markerFile)
  }

  /** Get lazy types */
  getLazyTypes(): string[] {
    const markerFile = join(this.sessionDir, '.lazy-detected')
    if (!existsSync(markerFile)) return []
    return readFileSync(markerFile, 'utf-8')
      .split('\n')
      .filter(l => l.includes('=1'))
      .map(l => l.split('=')[0])
  }

  // ─────────────────────────────────────────────────────────────
  // Fail Count Management
  // ─────────────────────────────────────────────────────────────

  /** Increment fail count */
  incrementFailCount(): number {
    const countFile = join(this.sessionDir, '.fail-count')
    const current = existsSync(countFile) ? parseInt(readFileSync(countFile, 'utf-8'), 10) : 0
    const newCount = current + 1
    writeFileSync(countFile, String(newCount), 'utf-8')

    // 检测污染（>= 2次失败）
    if (newCount >= 2) {
      this.markPollutionDetected()
    }

    return newCount
  }

  /** Get fail count */
  getFailCount(): number {
    const countFile = join(this.sessionDir, '.fail-count')
    if (!existsSync(countFile)) return 0
    return parseInt(readFileSync(countFile, 'utf-8'), 10)
  }

  /** Reset fail count */
  resetFailCount(): void {
    const countFile = join(this.sessionDir, '.fail-count')
    if (existsSync(countFile)) {
      unlinkSync(countFile)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────

  /** Clear all session markers */
  clearAll(): void {
    const files = [
      '.flow-state',
      '.skill-scanned',
      '.verified',
      '.pollution-detected',
      '.lazy-detected',
      '.fail-count',
      '.tool-history',
    ]

    for (const file of files) {
      const filePath = join(this.sessionDir, file)
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
    }

    logger.info({ sessionId: this.sessionId }, 'Session markers cleared')
  }

  /** Generate summary report */
  generateSummary(): string {
    const state = this.getFlowState()
    const skills = this.getScannedSkills()
    const lazyTypes = this.getLazyTypes()
    const failCount = this.getFailCount()

    let report = '# Session State Summary\n\n'
    report += `Session ID: ${this.sessionId}\n\n`

    report += '## Flow State\n'
    for (const [phase, status] of Object.entries(state)) {
      report += `- ${phase}: ${status || 'pending'}\n`
    }

    if (skills.length > 0) {
      report += '\n## Scanned Skills\n'
      report += skills.map(s => `- ${s}`).join('\n')
    }

    if (lazyTypes.length > 0) {
      report += '\n## Lazy Detection\n'
      report += lazyTypes.map(t => `- ${t}`).join('\n')
    }

    if (failCount > 0) {
      report += `\n## Fail Count: ${failCount}\n`
    }

    return report
  }
}