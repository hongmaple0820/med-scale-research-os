export interface DiagnosticLoopInput {
  taskId: string
  symptom: string
  reproductionCommand?: string
  expectedFailure?: string
  changedFiles?: string[]
  verificationCommands?: string[]
}

export interface DiagnosticHypothesis {
  id: string
  statement: string
  evidenceToCollect: string
  falsification: string
}

export interface DiagnosticInstrumentationStep {
  description: string
  target: string
  cleanupRequired: boolean
}

export interface DiagnosticLoop {
  taskId: string
  symptom: string
  reproduction: {
    command?: string
    expectedFailure?: string
  }
  changedFiles: string[]
  hypotheses: DiagnosticHypothesis[]
  instrumentationPlan: DiagnosticInstrumentationStep[]
  verificationCommands: string[]
  cleanupChecklist: string[]
}

export interface DiagnosticValidation {
  ready: boolean
  blockers: string[]
  warnings: string[]
}

export function createDiagnosticLoop(input: DiagnosticLoopInput): DiagnosticLoop {
  const changedFiles = input.changedFiles ?? []
  return {
    taskId: input.taskId,
    symptom: input.symptom,
    reproduction: {
      command: input.reproductionCommand,
      expectedFailure: input.expectedFailure,
    },
    changedFiles,
    hypotheses: createHypotheses(input.symptom, changedFiles),
    instrumentationPlan: createInstrumentationPlan(changedFiles),
    verificationCommands: input.verificationCommands ?? compact([input.reproductionCommand]),
    cleanupChecklist: [
      'Remove debug logs, temporary traces, and noisy console output before review.',
      'Delete temporary scripts, fixtures, screenshots, and local-only data after evidence is captured.',
      'Keep only durable verification evidence referenced by the task artifact.',
    ],
  }
}

export function validateDiagnosticLoop(loop: DiagnosticLoop): DiagnosticValidation {
  const blockers: string[] = []
  const warnings: string[] = []
  if (!loop.reproduction.command) blockers.push('Missing reproduction command; debugging cannot start from a verified failure.')
  if (!loop.reproduction.expectedFailure) blockers.push('Missing expected failure; the reproduction must identify the wrong behavior.')
  if (loop.hypotheses.length < 3) blockers.push('At least three falsifiable hypotheses are required.')
  if (loop.verificationCommands.length === 0) blockers.push('Missing verification commands for the final fix.')
  if (!loop.instrumentationPlan.some(step => step.cleanupRequired)) warnings.push('No cleanup-required instrumentation step was recorded.')
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
  }
}

export function renderDiagnosticLoopMarkdown(loop: DiagnosticLoop): string {
  const lines: string[] = []
  lines.push(`# Diagnostic Loop: ${loop.taskId}`)
  lines.push('')
  lines.push(`Symptom: ${loop.symptom}`)
  lines.push('')
  lines.push('## Reproduction')
  lines.push(`- Command: ${loop.reproduction.command ?? 'MISSING'}`)
  lines.push(`- Expected failure: ${loop.reproduction.expectedFailure ?? 'MISSING'}`)
  lines.push('')
  lines.push('## Hypotheses')
  for (const hypothesis of loop.hypotheses) {
    lines.push(`- ${hypothesis.id}: ${hypothesis.statement}`)
    lines.push(`  Evidence: ${hypothesis.evidenceToCollect}`)
    lines.push(`  Falsify by: ${hypothesis.falsification}`)
  }
  lines.push('')
  lines.push('## Instrumentation')
  for (const step of loop.instrumentationPlan) {
    lines.push(`- ${step.description} (${step.target}) cleanup=${step.cleanupRequired}`)
  }
  lines.push('')
  lines.push('## Cleanup')
  for (const item of loop.cleanupChecklist) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## Verification')
  for (const command of loop.verificationCommands) lines.push(`- ${command}`)
  return lines.join('\n')
}

function createHypotheses(symptom: string, changedFiles: string[]): DiagnosticHypothesis[] {
  const scope = changedFiles.length > 0 ? changedFiles.join(', ') : 'the touched module'
  return [
    {
      id: 'H1',
      statement: `The failing behavior is caused by an incorrect contract or route boundary in ${scope}.`,
      evidenceToCollect: 'Compare the failing request, public interface, and registered handler or exported API.',
      falsification: 'A direct contract check shows the request and handler agree.',
    },
    {
      id: 'H2',
      statement: `The state transition or persistence path behind "${symptom}" is incomplete.`,
      evidenceToCollect: 'Trace the minimal state read/write path and capture before/after values with redacted data.',
      falsification: 'State changes are correct and durable across the reproduction.',
    },
    {
      id: 'H3',
      statement: 'The issue is caused by configuration, dependency, environment, or fixture drift.',
      evidenceToCollect: 'Record active config, dependency version, feature flag, and fixture setup used by the reproduction.',
      falsification: 'The failure reproduces with a clean, documented configuration.',
    },
  ]
}

function createInstrumentationPlan(changedFiles: string[]): DiagnosticInstrumentationStep[] {
  const targets = changedFiles.length > 0 ? changedFiles : ['affected module']
  return targets.slice(0, 3).map(target => ({
    description: 'Add the smallest temporary trace needed to prove or disprove one hypothesis.',
    target,
    cleanupRequired: true,
  }))
}

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined)
}
