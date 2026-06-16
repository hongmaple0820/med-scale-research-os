/** Hephaestus mode: build with quality gates at every step */
export const HEPHAESTUS_MODE = true

export interface TddCommandEvidence {
  command: string
  exitCode: number
  outputSummary: string
}

export interface TddSliceInput {
  taskId: string
  behavior: string
  publicInterface: string
  failingTestCommand: string
  testFile: string
  implementationFiles: string[]
  redEvidence?: TddCommandEvidence
  greenEvidence?: TddCommandEvidence
  refactorEvidence?: TddCommandEvidence
}

export interface TddSlice {
  taskId: string
  behavior: string
  publicInterface: string
  testFile: string
  implementationFiles: string[]
  red: {
    command: string
    expected: 'non-zero-before-implementation'
  }
  green: {
    command: string
    expected: 'zero-after-minimal-implementation'
  }
  refactor: {
    command: string
    expected: 'zero-after-cleanup'
  }
  redEvidence?: TddCommandEvidence
  greenEvidence?: TddCommandEvidence
  refactorEvidence?: TddCommandEvidence
}

export interface TddSliceEvaluation {
  readyForImplementation: boolean
  readyForCompletion: boolean
  blockers: string[]
  warnings: string[]
}

export function createTddSlice(input: TddSliceInput): TddSlice {
  return {
    taskId: input.taskId,
    behavior: input.behavior,
    publicInterface: input.publicInterface,
    testFile: input.testFile,
    implementationFiles: input.implementationFiles,
    red: {
      command: input.failingTestCommand,
      expected: 'non-zero-before-implementation',
    },
    green: {
      command: input.failingTestCommand,
      expected: 'zero-after-minimal-implementation',
    },
    refactor: {
      command: input.failingTestCommand,
      expected: 'zero-after-cleanup',
    },
    redEvidence: input.redEvidence,
    greenEvidence: input.greenEvidence,
    refactorEvidence: input.refactorEvidence,
  }
}

export function evaluateTddSlice(slice: TddSlice): TddSliceEvaluation {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!slice.publicInterface.trim()) blockers.push('Missing public interface; a vertical slice must name the user-visible or callable contract.')
  if (!slice.testFile.trim()) blockers.push('Missing test file; TDD requires a durable failing test location.')
  if (slice.implementationFiles.length === 0) blockers.push('Missing implementation files; scope must be explicit before editing.')
  if (!slice.redEvidence) {
    blockers.push('Missing RED evidence; run the failing test before implementation.')
  } else if (slice.redEvidence.exitCode === 0) {
    blockers.push('RED evidence already passed; the test cannot prove the behavior changed.')
  }

  const readyForImplementation = blockers.length === 0
  const completionBlockers = [...blockers]
  if (!slice.greenEvidence || slice.greenEvidence.exitCode !== 0) {
    completionBlockers.push('Missing GREEN evidence with exit code 0.')
  }
  if (!slice.refactorEvidence || slice.refactorEvidence.exitCode !== 0) {
    completionBlockers.push('Missing REFACTOR evidence with exit code 0 after cleanup.')
  }
  if (slice.implementationFiles.length > 5) {
    warnings.push('The vertical slice touches more than five implementation files; consider splitting it.')
  }

  return {
    readyForImplementation,
    readyForCompletion: completionBlockers.length === 0,
    blockers,
    warnings,
  }
}

export function renderTddSliceMarkdown(slice: TddSlice): string {
  const lines: string[] = []
  lines.push(`# TDD Vertical Slice: ${slice.taskId}`)
  lines.push('')
  lines.push(`Behavior: ${slice.behavior}`)
  lines.push(`Public interface: ${slice.publicInterface}`)
  lines.push(`Test file: ${slice.testFile}`)
  lines.push('')
  lines.push('## Vertical Slice')
  lines.push(`- RED: ${slice.red.command} -> ${slice.red.expected}`)
  lines.push(`- GREEN: ${slice.green.command} -> ${slice.green.expected}`)
  lines.push(`- REFACTOR: ${slice.refactor.command} -> ${slice.refactor.expected}`)
  lines.push('')
  lines.push('## Scope')
  for (const file of slice.implementationFiles) lines.push(`- ${file}`)
  return lines.join('\n')
}
