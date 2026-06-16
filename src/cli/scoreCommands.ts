import { defineCommand } from 'citty'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createTaskScoreReport } from '../workflow/TaskScoreEngine.js'

type ScoreTaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'

const DEFAULT_PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DEFAULT_SCALE_DIR = process.env.SCALE_DIR ?? '.scale'

export const scoreCommand = defineCommand({
  meta: { name: 'score', description: 'Algorithmic task quality and efficiency scoring' },
  subCommands: {
    task: defineCommand({
      meta: { name: 'task', description: 'Compute deterministic task completion, quality, and efficiency score' },
      args: {
        dir: { type: 'string', default: DEFAULT_PROJECT_DIR, description: 'Project directory' },
        'scale-dir': { type: 'string', default: DEFAULT_SCALE_DIR, description: 'Scale governance directory' },
        'task-id': { type: 'string', description: 'Task id for reporting' },
        level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
        changed: { type: 'boolean', default: false, description: 'Score engineering standards against changed Git files only' },
        'changed-files': { type: 'string', description: 'Comma or newline separated changed files to score' },
        'warn-only': { type: 'boolean', default: false, description: 'Return zero even when score is below threshold' },
        json: { type: 'boolean', default: false, description: 'Print JSON output' },
      },
      run({ args }) {
        const projectDir = resolve(String(args.dir ?? process.cwd()))
        const explicitChangedFiles = splitChangedFiles(typeof args['changed-files'] === 'string' ? args['changed-files'] : undefined)
        const changedFiles = explicitChangedFiles.length > 0
          ? explicitChangedFiles
          : isTruthyFlag(args.changed)
            ? readGitChangedFilesForStandards(projectDir) ?? []
            : []
        const report = createTaskScoreReport({
          projectDir,
          scaleDir: String(args['scale-dir'] ?? '.scale'),
          taskId: args['task-id'] ? String(args['task-id']) : undefined,
          level: normalizeTaskLevel(args.level),
          changedFiles,
        })
        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
        } else {
          console.log('\nSCALE Task Score')
          console.log(`  Score: ${report.totalScore}/100 (${report.grade})`)
          console.log(`  Level: ${report.level}`)
          console.log(`  Passed: ${report.passed ? 'yes' : 'no'}`)
          for (const dimension of report.dimensions) {
            console.log(`  [${dimension.status.toUpperCase()}] ${dimension.name}: ${dimension.score}/${dimension.maxScore}`)
            for (const item of dimension.evidence) console.log(`    evidence: ${item}`)
          }
          if (report.blockers.length > 0) {
            console.log('\nBlockers:')
            for (const blocker of report.blockers) console.log(`  - ${blocker}`)
          }
          if (report.recommendations.length > 0) {
            console.log('\nRecommendations:')
            for (const recommendation of report.recommendations) console.log(`  - ${recommendation}`)
          }
        }
        if (!report.passed && !isTruthyFlag(args['warn-only'])) process.exitCode = 1
      },
    }),
  },
})

function normalizeTaskLevel(value: unknown): ScoreTaskLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') return normalized
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}

function splitChangedFiles(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === '' || value === 'true' || value === '1'
}

function readGitChangedFilesForStandards(projectDir: string): string[] | undefined {
  try {
    execFileSync('git', ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
  const tracked = readGitPathList(projectDir, ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--'])
  const untracked = readGitPathList(projectDir, ['ls-files', '--others', '--exclude-standard'])
  return Array.from(new Set([...tracked, ...untracked]))
}

function readGitPathList(projectDir: string, args: string[]): string[] {
  try {
    return execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
