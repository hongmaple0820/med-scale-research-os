import { createHash } from 'node:crypto'

export type CommandOutputCompressionStrategy =
  | 'bounded-raw'
  | 'vitest'
  | 'typescript'
  | 'eslint'
  | 'git-diff'
  | 'git-status'
  | 'failure-focused'
  | 'success-summary'

export interface CommandOutputCompressionInput {
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  maxChars?: number
  maxLines?: number
}

export interface CommandOutputCompressionResult {
  compressorId: string
  strategy: CommandOutputCompressionStrategy
  summary: string
  compressedOutput: string
  rawBytes: number
  rawEstimatedTokens: number
  compressedBytes: number
  compressedEstimatedTokens: number
  savedEstimatedTokens: number
  compressionRatio: number
  truncated: boolean
  preservedLineCount: number
  omittedLineCount: number
  rawSha256: string
  rawTail: string
}

interface Selection {
  strategy: CommandOutputCompressionStrategy
  summary: string
  lines: string[]
  truncated?: boolean
}

const COMPRESSOR_ID = 'scale-command-output-compressor/v1'
const DEFAULT_MAX_CHARS = 4000
const DEFAULT_MAX_LINES = 100
const RAW_TAIL_CHARS = 2000
const SHORT_OUTPUT_CHARS = 1200

export function compressCommandOutput(input: CommandOutputCompressionInput): CommandOutputCompressionResult {
  const command = input.command.trim()
  const raw = composeCommandOutput(input.stdout ?? '', input.stderr ?? '')
  const rawLines = toLines(raw)
  const maxChars = Math.max(500, input.maxChars ?? DEFAULT_MAX_CHARS)
  const maxLines = Math.max(20, input.maxLines ?? DEFAULT_MAX_LINES)
  const exitCode = input.exitCode ?? 0

  const selected = selectOutput({
    command,
    raw,
    rawLines,
    exitCode,
    maxLines,
    maxChars,
  })
  const bounded = boundSelectedOutput(selected.lines, rawLines.length, maxLines, maxChars)
  const compressedOutput = bounded.output || fallbackOutput(raw, exitCode, maxChars)
  const rawEstimatedTokens = estimateTokens(raw)
  const compressedEstimatedTokens = estimateTokens(compressedOutput)

  return {
    compressorId: COMPRESSOR_ID,
    strategy: selected.strategy,
    summary: selected.summary,
    compressedOutput,
    rawBytes: Buffer.byteLength(raw, 'utf8'),
    rawEstimatedTokens,
    compressedBytes: Buffer.byteLength(compressedOutput, 'utf8'),
    compressedEstimatedTokens,
    savedEstimatedTokens: Math.max(0, rawEstimatedTokens - compressedEstimatedTokens),
    compressionRatio: rawEstimatedTokens === 0
      ? 1
      : Number((compressedEstimatedTokens / rawEstimatedTokens).toFixed(3)),
    truncated: selected.truncated === true || bounded.truncated,
    preservedLineCount: bounded.preservedLineCount,
    omittedLineCount: Math.max(0, rawLines.length - bounded.preservedLineCount),
    rawSha256: sha256(raw),
    rawTail: tail(raw, RAW_TAIL_CHARS),
  }
}

export function estimateCommandOutputTokens(value: string): number {
  return estimateTokens(value)
}

function selectOutput(input: {
  command: string
  raw: string
  rawLines: string[]
  exitCode: number
  maxLines: number
  maxChars: number
}): Selection {
  const normalized = input.command.toLowerCase()
  const shortEnough = input.raw.length <= Math.min(SHORT_OUTPUT_CHARS, input.maxChars) &&
    input.rawLines.length <= Math.floor(input.maxLines / 2)
  if (shortEnough) {
    return {
      strategy: 'bounded-raw',
      summary: `Output kept raw: ${input.rawLines.length} lines, ${estimateTokens(input.raw)} estimated tokens`,
      lines: input.rawLines,
    }
  }

  if (/\b(vitest|jest|mocha|ava)\b/.test(normalized) || /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/.test(normalized)) {
    return selectTestOutput(input.rawLines, input.exitCode)
  }
  if (/\btsc\b/.test(normalized) || /\btypecheck\b/.test(normalized)) {
    return selectTypeScriptOutput(input.rawLines, input.exitCode)
  }
  if (/\beslint\b/.test(normalized) || /\blint\b/.test(normalized)) {
    return selectEslintOutput(input.rawLines, input.exitCode)
  }
  if (/\bgit\s+diff\b/.test(normalized)) {
    return selectGitDiffOutput(input.rawLines, input.exitCode)
  }
  if (/\bgit\s+status\b/.test(normalized)) {
    return {
      strategy: 'git-status',
      summary: `Git status output compressed: ${input.rawLines.length} lines`,
      lines: keepImportantLines(input.rawLines, line => line.trim().length > 0),
    }
  }
  if (input.exitCode !== 0) {
    return selectFailureOutput(input.rawLines, input.exitCode)
  }
  return selectSuccessOutput(input.rawLines, input.exitCode)
}

function selectTestOutput(lines: string[], exitCode: number): Selection {
  const important = preserveContext(lines, line =>
    /^\s*(RUN|PASS|FAIL|Test Files|Tests|Snapshots|Duration|Start at|Coverage|All files)\b/i.test(line) ||
    /^\s*[✓✕×]\s/.test(line) ||
    isErrorLine(line),
  )
  return {
    strategy: 'vitest',
    summary: `Test output compressed (${exitCode === 0 ? 'passed' : 'failed'}): ${important.length}/${lines.length} lines preserved`,
    lines: important.length > 0 ? important : tailLines(lines, 40),
  }
}

function selectTypeScriptOutput(lines: string[], exitCode: number): Selection {
  const important = preserveContext(lines, line =>
    /\berror\s+TS\d+:/i.test(line) ||
    /\bTS\d+:/i.test(line) ||
    isErrorLine(line),
  )
  return {
    strategy: 'typescript',
    summary: `TypeScript output compressed (${exitCode === 0 ? 'passed' : 'failed'}): ${important.length}/${lines.length} lines preserved`,
    lines: important.length > 0 ? important : tailLines(lines, 40),
  }
}

function selectEslintOutput(lines: string[], exitCode: number): Selection {
  const important = preserveContext(lines, line =>
    /\b(?:error|warning|problems?|warnings?|errors?)\b/i.test(line) ||
    /^\s*\d+:\d+\s+/.test(line) ||
    isErrorLine(line),
  )
  return {
    strategy: 'eslint',
    summary: `Lint output compressed (${exitCode === 0 ? 'passed' : 'failed'}): ${important.length}/${lines.length} lines preserved`,
    lines: important.length > 0 ? important : tailLines(lines, 40),
  }
}

function selectGitDiffOutput(lines: string[], exitCode: number): Selection {
  const important = keepImportantLines(lines, line =>
    /^diff --git /.test(line) ||
    /^index /.test(line) ||
    /^--- /.test(line) ||
    /^\+\+\+ /.test(line) ||
    /^@@ /.test(line) ||
    /^\s*\d+\s+files? changed/.test(line),
  )
  return {
    strategy: 'git-diff',
    summary: `Git diff output compressed: ${important.length}/${lines.length} structural lines preserved`,
    lines: important.length > 0 ? important : tailLines(lines, 60),
    truncated: important.length < lines.length,
  }
}

function selectFailureOutput(lines: string[], exitCode: number): Selection {
  const important = preserveContext(lines, isErrorLine)
  const selected = important.length > 0
    ? mergeLines(important, tailLines(lines, 30))
    : tailLines(lines, 60)
  return {
    strategy: 'failure-focused',
    summary: `Failure output compressed (exit ${exitCode}): ${selected.length}/${lines.length} lines preserved`,
    lines: selected,
  }
}

function selectSuccessOutput(lines: string[], exitCode: number): Selection {
  const summaryLines = keepImportantLines(lines, line =>
    /\b(?:done|success|passed|compiled|built|generated|duration|time|files?)\b/i.test(line),
  )
  const selected = summaryLines.length > 0 ? mergeLines(summaryLines, tailLines(lines, 25)) : tailLines(lines, 40)
  return {
    strategy: 'success-summary',
    summary: `Successful output compressed (exit ${exitCode}): ${selected.length}/${lines.length} lines preserved`,
    lines: selected,
  }
}

function boundSelectedOutput(lines: string[], originalLineCount: number, maxLines: number, maxChars: number): {
  output: string
  truncated: boolean
  preservedLineCount: number
} {
  const nonEmpty = lines.length > 0 ? lines : []
  let selected = nonEmpty
  let truncated = false
  if (selected.length > maxLines) {
    selected = [
      ...selected.slice(0, Math.floor(maxLines * 0.65)),
      `... ${selected.length - maxLines} selected lines omitted ...`,
      ...selected.slice(-(maxLines - Math.floor(maxLines * 0.65) - 1)),
    ]
    truncated = true
  }
  if (selected.length < originalLineCount) truncated = true

  let output = selected.join('\n').trim()
  if (output.length > maxChars) {
    const headLength = Math.floor(maxChars * 0.55)
    const tailLength = Math.floor(maxChars * 0.35)
    output = [
      output.slice(0, headLength).trimEnd(),
      `... ${output.length - headLength - tailLength} chars omitted ...`,
      output.slice(-tailLength).trimStart(),
    ].join('\n')
    truncated = true
  }

  return {
    output,
    truncated,
    preservedLineCount: selected.filter(line => !/omitted/.test(line)).length,
  }
}

function preserveContext(lines: string[], predicate: (line: string) => boolean, before = 1, after = 2): string[] {
  const indexes = new Set<number>()
  lines.forEach((line, index) => {
    if (!predicate(line)) return
    for (let offset = -before; offset <= after; offset += 1) {
      const selectedIndex = index + offset
      if (selectedIndex >= 0 && selectedIndex < lines.length) indexes.add(selectedIndex)
    }
  })
  return [...indexes].sort((a, b) => a - b).map(index => lines[index])
}

function keepImportantLines(lines: string[], predicate: (line: string) => boolean): string[] {
  return lines.filter(predicate)
}

function mergeLines(first: string[], second: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const line of [...first, ...second]) {
    const key = line
    if (seen.has(key)) continue
    seen.add(key)
    output.push(line)
  }
  return output
}

function isErrorLine(line: string): boolean {
  return /\b(?:error|failed|failure|exception|traceback|assertion|expected|received|cannot|unable|timeout|timed out)\b/i.test(line) ||
    /\b(?:ERR!|E\d{3,}|TS\d+)\b/.test(line)
}

function fallbackOutput(raw: string, exitCode: number, maxChars: number): string {
  if (!raw.trim()) return `Command produced no output (exit ${exitCode})`
  return tail(raw, maxChars).trim()
}

function composeCommandOutput(stdout: string, stderr: string): string {
  const stdoutTrimmed = stdout.replace(/\s+$/g, '')
  const stderrTrimmed = stderr.replace(/\s+$/g, '')
  if (stdoutTrimmed && stderrTrimmed) return `[stdout]\n${stdoutTrimmed}\n[stderr]\n${stderrTrimmed}`
  return stdoutTrimmed || stderrTrimmed
}

function toLines(value: string): string[] {
  if (!value) return []
  return value.split(/\r?\n/)
}

function tailLines(lines: string[], count: number): string[] {
  return lines.slice(-count)
}

function estimateTokens(value: string): number {
  if (!value) return 0
  return Math.ceil(value.length / 4)
}

function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(-maxLength) : value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
