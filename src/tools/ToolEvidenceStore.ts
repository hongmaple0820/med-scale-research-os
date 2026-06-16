import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type ToolEvidenceAdapter = 'skill' | 'mcp' | 'cli' | 'browser' | 'desktop'
export type ToolEvidenceStatus = 'passed' | 'failed' | 'skipped'

export interface ToolRunEvidenceInput {
  taskId: string
  domain: string
  tool: string
  adapter: ToolEvidenceAdapter
  version?: string
  command?: string
  mcpToolName?: string
  status: ToolEvidenceStatus
  sanitizedInput: Record<string, unknown>
  outputSummary: string
  outputPaths: string[]
  safetyPolicy: string[]
}

export interface ToolRunEvidence extends ToolRunEvidenceInput {
  id: string
  startedAt: string
  completedAt: string
  exitCode?: number
  redactionApplied: boolean
  sequence: number
}

export interface ToolEvidenceStoreOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
}

export interface ToolEvidenceSummary {
  taskId: string
  total: number
  passed: number
  failed: number
  skipped: number
  ok: boolean
}

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|pwd|token|secret|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i
const REDACTED = '[REDACTED]'

export class ToolEvidenceStore {
  private rootDir: string
  private now: () => Date
  private sequence = 0

  constructor(options: ToolEvidenceStoreOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.rootDir = join(scaleRoot, 'evidence', 'tool-runs')
    this.now = options.now ?? (() => new Date())
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true })
  }

  save(input: ToolRunEvidenceInput & { exitCode?: number }): ToolRunEvidence {
    const startedAt = this.now().toISOString()
    const inputRedaction = redactUnknown(input.sanitizedInput)
    const commandRedaction = redactText(input.command ?? '')
    const summaryRedaction = redactText(input.outputSummary)
    const versionRedaction = redactText(input.version ?? '')
    const evidence: ToolRunEvidence = {
      ...input,
      id: `TOOL-${Date.now()}-${randomUUID().slice(0, 8)}`,
      startedAt,
      completedAt: this.now().toISOString(),
      sequence: ++this.sequence,
      sanitizedInput: inputRedaction.value as Record<string, unknown>,
      command: input.command ? commandRedaction.value : undefined,
      version: input.version ? versionRedaction.value : undefined,
      outputSummary: summaryRedaction.value,
      redactionApplied: inputRedaction.redacted || commandRedaction.redacted || summaryRedaction.redacted || versionRedaction.redacted,
    }

    const dir = this.taskDir(input.taskId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${evidence.id}.json`), JSON.stringify(evidence, null, 2), 'utf-8')
    return evidence
  }

  list(taskId: string): ToolRunEvidence[] {
    const dir = this.taskDir(taskId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readEvidenceFile(join(dir, file)))
      .filter((record): record is ToolRunEvidence => Boolean(record))
      .sort((a, b) => {
        const time = Date.parse(b.completedAt) - Date.parse(a.completedAt)
        if (time !== 0) return time
        return b.sequence - a.sequence
      })
  }

  get(taskId: string, id: string): ToolRunEvidence | null {
    return readEvidenceFile(join(this.taskDir(taskId), `${id}.json`))
  }

  summary(taskId: string): ToolEvidenceSummary {
    const records = this.list(taskId)
    const passed = records.filter(record => record.status === 'passed').length
    const failed = records.filter(record => record.status === 'failed').length
    const skipped = records.filter(record => record.status === 'skipped').length
    return {
      taskId,
      total: records.length,
      passed,
      failed,
      skipped,
      ok: failed === 0,
    }
  }

  private taskDir(taskId: string): string {
    return join(this.rootDir, safePathSegment(taskId))
  }
}

export function redactEvidenceValue(value: unknown): { value: unknown; redacted: boolean } {
  return redactUnknown(value)
}

export function redactEvidenceText(text: string): { value: string; redacted: boolean } {
  return redactText(text)
}

function readEvidenceFile(file: string): ToolRunEvidence | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ToolRunEvidence
  } catch {
    return null
  }
}

function redactUnknown(value: unknown, key = ''): { value: unknown; redacted: boolean } {
  if (SENSITIVE_KEY_PATTERN.test(key)) return { value: REDACTED, redacted: true }

  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) {
    let redacted = false
    const list = value.map(item => {
      const result = redactUnknown(item)
      redacted = redacted || result.redacted
      return result.value
    })
    return { value: list, redacted }
  }
  if (value && typeof value === 'object') {
    let redacted = false
    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      const result = redactUnknown(childValue, childKey)
      redacted = redacted || result.redacted
      output[childKey] = result.value
    }
    return { value: output, redacted }
  }
  return { value, redacted: false }
}

function redactText(text: string): { value: string; redacted: boolean } {
  let output = text
  output = output.replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
  output = output.replace(/(--(?:password|token|secret|authorization|cookie|credential|api-key|apikey|private-key)\s+)[^\s]+/gi, `$1${REDACTED}`)
  output = output.replace(/\b(password|passwd|pwd|token|secret|authorization|cookie|credential|api[_-]?key|private[_-]?key)\s*=\s*[^\s,;]+/gi, `$1=${REDACTED}`)
  output = output.replace(/("(?:password|passwd|pwd|token|secret|authorization|cookie|credential|api[_-]?key|private[_-]?key)"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
  return { value: output, redacted: output !== text }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown-task'
}
