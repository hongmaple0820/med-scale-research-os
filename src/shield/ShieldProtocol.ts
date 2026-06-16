// SCALE Shield — Deterministic Hook Interception Protocol
// 对齐 agent-hooks-in-depth: exit 0=allow, exit 2=block
// stdin/stdout JSON 协议，跨 hook 状态共享 via .hook-state/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// --- Exit Code Protocol ---
// exit 0 = 允许操作继续
// exit 2 = 阻断操作（stderr 输出原因）
export const EXIT_ALLOW = 0
export const EXIT_BLOCK = 2

// --- Hook Event Types (aligned with Claude Code hook system) ---
export type HookEventType = 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart'

// --- stdin JSON Protocol ---
export interface ShieldInput {
  session_id: string
  cwd: string
  tool_name: string
  tool_input: Record<string, unknown>
  metadata?: {
    harness?: 'claude' | 'codex' | 'cursor' | 'gemini'
    gate_last_pass?: string // ISO timestamp of last gate-quality ALL PASS
    policy_hash?: string   // sha256 of current policy.yaml
  }
}

// --- stdout JSON Protocol ---
export interface ShieldDecision {
  decision: 'allow' | 'block'
  reason: string
  suggestion?: string
  evidence?: {
    policy_rule: string
    matched_pattern?: string
    gate_status?: string
    timestamp: string
  }
}

// --- Hook State Sharing (.hook-state/ directory) ---
export interface HookStateEntry {
  hook: HookEventType
  timestamp: string
  sessionId: string
  toolName?: string
  blocked: boolean
  reason?: string
}

const HOOK_STATE_DIR = '.hook-state'

export function getHookStateDir(cwd: string): string {
  return join(cwd, HOOK_STATE_DIR)
}

export function ensureHookStateDir(cwd: string): string {
  const dir = getHookStateDir(cwd)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function writeHookState(cwd: string, entry: HookStateEntry): void {
  const dir = ensureHookStateDir(cwd)
  const file = join(dir, `${entry.hook}.json`)
  writeFileSync(file, JSON.stringify(entry, null, 2))
}

export function readHookState(cwd: string, hook: HookEventType): HookStateEntry | null {
  const file = join(getHookStateDir(cwd), `${hook}.json`)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
}

export function readLastToolState(cwd: string): HookStateEntry | null {
  return readHookState(cwd, 'PreToolUse')
}

export function wasLastToolBlocked(cwd: string): boolean {
  const state = readHookState(cwd, 'PostToolUse')
  return state?.blocked ?? false
}

// --- Policy Compliance Check ---
export interface PolicyComplianceResult {
  compliant: boolean
  gatePassed: boolean
  scaleIntegrity: boolean
  violations: string[]
  lastGatePass?: string
}

export function checkPolicyCompliance(
  cwd: string,
  gateCheckFn?: () => boolean,
): PolicyComplianceResult {
  const violations: string[] = []

  // Check .scale/ directory integrity
  const scaleDir = join(cwd, '.scale')
  const scaleExists = existsSync(scaleDir)
  if (!scaleExists) {
    violations.push('.scale/ directory missing — governance infrastructure absent')
  }

  // Check last gate quality pass
  const lastGate = readHookState(cwd, 'Stop')
  const gatePassed = lastGate?.reason?.includes('gate-quality:PASS') ?? false
  if (!gatePassed && gateCheckFn) {
    const passed = gateCheckFn()
    if (!passed) violations.push('Gate quality check not passed — run scale gate-quality')
  }

  return {
    compliant: violations.length === 0,
    gatePassed,
    scaleIntegrity: scaleExists,
    violations,
    lastGatePass: lastGate?.timestamp,
  }
}

// --- Block / Allow helpers ---
export function allow(reason?: string): void {
  const msg: ShieldDecision = {
    decision: 'allow',
    reason: reason ?? 'OK',
    evidence: { policy_rule: 'default-allow', timestamp: new Date().toISOString() },
  }
  process.stdout.write(JSON.stringify(msg))
  process.exit(EXIT_ALLOW)
}

export function block(reason: string, suggestion?: string): void {
  const msg: ShieldDecision = {
    decision: 'block',
    reason,
    suggestion,
    evidence: { policy_rule: 'shield-block', timestamp: new Date().toISOString() },
  }
  process.stderr.write(reason)
  if (suggestion) process.stderr.write(`\n[Suggestion] ${suggestion}`)
  process.stdout.write(JSON.stringify(msg))
  process.exit(EXIT_BLOCK)
}

// --- stdin parser ---
export function parseShieldInput(): ShieldInput {
  try {
    const raw = process.argv[2] ?? (process.stdin as unknown as string | null)
    if (!raw) return { session_id: 'unknown', cwd: process.cwd(), tool_name: 'unknown', tool_input: {} }
    return JSON.parse(typeof raw === 'string' ? raw : String(raw)) as ShieldInput
  } catch {
    return { session_id: 'unknown', cwd: process.cwd(), tool_name: 'unknown', tool_input: {} }
  }
}
