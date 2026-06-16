import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { CommandOutputCompressionResult } from './CommandOutputCompressor.js'
import { compressCommandOutput } from './CommandOutputCompressor.js'
import { redactEvidenceText } from './ToolEvidenceStore.js'

export type CommandRunStatus = 'passed' | 'failed'

export interface CommandRunEvidenceOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  sessionId?: string
  profile?: string
  gate?: string
  source?: string
}

export interface CommandRunRecordInput extends CommandRunEvidenceOptions {
  command: string
  cwd: string
  exitCode: number
  durationMs: number
  startedAt: number
  endedAt: number
  stdout: string
  stderr: string
  compression?: CommandOutputCompressionResult
}

export interface CommandRunEvidence {
  id: string
  taskId: string
  sessionId?: string
  profile?: string
  gate?: string
  source?: string
  command: string
  cwd: string
  status: CommandRunStatus
  exitCode: number
  durationMs: number
  startedAt: string
  endedAt: string
  compressorId: string
  compressionStrategy: string
  summary: string
  compressedOutput: string
  rawTail: string
  rawSha256: string
  rawBytes: number
  compressedBytes: number
  rawEstimatedTokens: number
  compressedEstimatedTokens: number
  savedEstimatedTokens: number
  compressionRatio: number
  truncated: boolean
  redactionApplied: boolean
  sequence: number
}

export interface CommandRunLedgerOptions {
  projectDir?: string
  scaleDir?: string
  now?: () => Date
}

export interface CommandRunSummary {
  taskId: string
  total: number
  passed: number
  failed: number
  rawEstimatedTokens: number
  compressedEstimatedTokens: number
  savedEstimatedTokens: number
  ok: boolean
}

export class CommandRunLedger {
  private rootDir: string
  private now: () => Date
  private sequence = 0

  constructor(options: CommandRunLedgerOptions = {}) {
    const projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(projectDir, options.scaleDir ?? '.scale')
    this.rootDir = join(scaleRoot, 'evidence', 'command-runs')
    this.now = options.now ?? (() => new Date())
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true })
  }

  record(input: CommandRunRecordInput): CommandRunEvidence {
    const compression = input.compression ?? compressCommandOutput({
      command: input.command,
      stdout: input.stdout,
      stderr: input.stderr,
      exitCode: input.exitCode,
    })
    const command = redactEvidenceText(input.command)
    const summary = redactEvidenceText(compression.summary)
    const compressedOutput = redactEvidenceText(compression.compressedOutput)
    const rawTail = redactEvidenceText(compression.rawTail)
    const taskId = input.taskId?.trim() || 'general'
    const evidence: CommandRunEvidence = {
      id: `CMD-${this.now().getTime()}-${randomUUID().slice(0, 8)}`,
      taskId,
      sessionId: input.sessionId,
      profile: input.profile,
      gate: input.gate,
      source: input.source,
      command: command.value,
      cwd: input.cwd,
      status: input.exitCode === 0 ? 'passed' : 'failed',
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      startedAt: new Date(input.startedAt).toISOString(),
      endedAt: new Date(input.endedAt).toISOString(),
      compressorId: compression.compressorId,
      compressionStrategy: compression.strategy,
      summary: summary.value,
      compressedOutput: compressedOutput.value,
      rawTail: rawTail.value,
      rawSha256: compression.rawSha256,
      rawBytes: compression.rawBytes,
      compressedBytes: compression.compressedBytes,
      rawEstimatedTokens: compression.rawEstimatedTokens,
      compressedEstimatedTokens: compression.compressedEstimatedTokens,
      savedEstimatedTokens: compression.savedEstimatedTokens,
      compressionRatio: compression.compressionRatio,
      truncated: compression.truncated,
      redactionApplied: command.redacted || summary.redacted || compressedOutput.redacted || rawTail.redacted,
      sequence: ++this.sequence,
    }

    const dir = this.taskDir(taskId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${evidence.id}.json`), JSON.stringify(evidence, null, 2), 'utf-8')
    return evidence
  }

  list(taskId = 'general'): CommandRunEvidence[] {
    const dir = this.taskDir(taskId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readEvidenceFile(join(dir, file)))
      .filter((record): record is CommandRunEvidence => Boolean(record))
      .sort((a, b) => {
        const time = Date.parse(b.endedAt) - Date.parse(a.endedAt)
        if (time !== 0) return time
        return b.sequence - a.sequence
      })
  }

  summary(taskId = 'general'): CommandRunSummary {
    const records = this.list(taskId)
    const passed = records.filter(record => record.status === 'passed').length
    const failed = records.filter(record => record.status === 'failed').length
    return {
      taskId,
      total: records.length,
      passed,
      failed,
      rawEstimatedTokens: records.reduce((sum, record) => sum + record.rawEstimatedTokens, 0),
      compressedEstimatedTokens: records.reduce((sum, record) => sum + record.compressedEstimatedTokens, 0),
      savedEstimatedTokens: records.reduce((sum, record) => sum + record.savedEstimatedTokens, 0),
      ok: failed === 0,
    }
  }

  private taskDir(taskId: string): string {
    return join(this.rootDir, safePathSegment(taskId))
  }
}

function readEvidenceFile(file: string): CommandRunEvidence | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as CommandRunEvidence
  } catch {
    return null
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'general'
}
