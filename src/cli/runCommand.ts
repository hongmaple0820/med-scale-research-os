// SCALE Engine — Run Command
// One-click end-to-end workflow: define → plan → build → verify → review → ship

import { defineCommand } from 'citty'
import { WorkflowOrchestrator, type PhaseName, type RunResult } from '../workflow/WorkflowOrchestrator.js'
import type { TaskLevel } from '../workflow/TaskLevelDetector.js'

const SCALE_DIR = process.env.SCALE_DIR ?? '.scale'
const PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function printPhaseStatus(result: RunResult): void {
  console.log('\n' + '='.repeat(50))
  console.log('  SCALE Engine — End-to-End Workflow')
  console.log('='.repeat(50))

  for (const phase of result.phases) {
    const icon = phase.success ? '✅' : '❌'
    const duration = formatDuration(phase.duration)
    const artifactId = phase.artifactId ? ` (${phase.artifactId})` : ''
    console.log(`  ${icon} ${phase.phase}: ${phase.success ? 'OK' : phase.error}${artifactId} (${duration})`)
  }

  console.log('-'.repeat(50))
  const status = result.success ? 'ALL PASSED' : 'FAILED'
  console.log(`  Status: ${status}`)
  console.log(`  Duration: ${formatDuration(result.duration)}`)

  if (result.artifacts.needId) console.log(`  Need:  ${result.artifacts.needId}`)
  if (result.artifacts.specId) console.log(`  Spec:  ${result.artifacts.specId}`)
  if (result.artifacts.planId) console.log(`  Plan:  ${result.artifacts.planId}`)
  if (result.artifacts.taskId) console.log(`  Task:  ${result.artifacts.taskId}`)
  console.log('')
}

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'RUN: End-to-end workflow (define → plan → build → verify → review → ship)',
  },
  args: {
    title: { type: 'positional', required: true, description: 'Task title' },
    description: { type: 'string', alias: 'd', description: 'Task description' },
    level: {
      type: 'string',
      description: 'Task level (S/M/L/CRITICAL). Auto-detected if omitted.',
    },
    'success-criteria': {
      type: 'string',
      alias: 'c',
      description: 'Comma-separated success criteria',
    },
    'skip-phases': {
      type: 'string',
      description: 'Comma-separated phases to skip (define,plan,build,verify,review,ship)',
    },
    'no-stop': {
      type: 'boolean',
      default: false,
      description: 'Continue on phase failure instead of stopping',
    },
    'no-commit': {
      type: 'boolean',
      default: false,
      description: 'Skip git commit in ship phase',
    },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const skipPhases = args['skip-phases']
      ? args['skip-phases'].split(',').map(s => s.trim()).filter(Boolean) as PhaseName[]
      : []

    const level = args.level
      ? args.level.toUpperCase() as TaskLevel
      : undefined

    const successCriteria = args['success-criteria']
      ? args['success-criteria'].split(',').map(s => s.trim()).filter(Boolean)
      : undefined

    if (!args.json) {
      console.log(`\nStarting workflow: "${args.title}"`)
      if (level) console.log(`  Level: ${level}`)
      else console.log(`  Level: auto-detect`)
      if (skipPhases.length > 0) console.log(`  Skipping: ${skipPhases.join(', ')}`)
    }

    const orchestrator = new WorkflowOrchestrator({
      scaleDir: SCALE_DIR,
      projectDir: PROJECT_DIR,
    })

    const result = await orchestrator.run({
      title: args.title,
      description: args.description,
      successCriteria,
      level,
      skipPhases,
      stopOnFailure: !args['no-stop'],
      autoCommit: !args['no-commit'],
      scaleDir: SCALE_DIR,
      projectDir: PROJECT_DIR,
    })

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printPhaseStatus(result)
    }

    if (!result.success) process.exit(1)
  },
})
