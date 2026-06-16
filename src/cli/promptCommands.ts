import { defineCommand } from 'citty'
import { optimizeCodingPrompt, type PromptOptimizationLanguageInput } from '../prompts/PromptOptimizer.js'

export const promptCommand = defineCommand({
  meta: { name: 'prompt', description: 'Prompt optimization and rewriting utilities' },
  subCommands: {
    optimize: defineCommand({
      meta: { name: 'optimize', description: 'Rewrite a raw coding instruction into a structured executable prompt' },
      args: {
        input: { type: 'string', alias: 'i', description: 'Raw prompt text' },
        title: { type: 'string', description: 'Optional task title' },
        language: { type: 'string', default: 'auto', description: 'Output language: auto, zh, or en' },
        level: { type: 'string', description: 'Task level hint: S, M, L, or CRITICAL' },
        files: { type: 'string', description: 'Comma-separated relevant files' },
        service: { type: 'string', description: 'Comma-separated relevant services' },
        'success-criteria': { type: 'string', alias: 'c', description: 'Comma-separated acceptance criteria' },
        json: { type: 'boolean', default: false, description: 'Print JSON output' },
      },
      run({ args }) {
        const rawPrompt = String(args.input ?? '').trim()
        const report = optimizeCodingPrompt({
          rawPrompt,
          title: args.title ? String(args.title) : undefined,
          language: normalizeLanguage(args.language),
          level: args.level ? String(args.level) : undefined,
          files: splitCsv(args.files),
          services: splitCsv(args.service),
          successCriteria: splitCsv(args['success-criteria']),
        })

        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }

        console.log(report.optimizedPrompt)
        console.log('')
        console.log(`Quality score: ${report.quality.score}/100`)
        if (report.quality.missingInfo.length > 0) {
          console.log(`Missing info: ${report.quality.missingInfo.join(', ')}`)
        }
      },
    }),
  },
})

function normalizeLanguage(value: unknown): PromptOptimizationLanguageInput {
  const normalized = String(value ?? 'auto').trim().toLowerCase()
  if (normalized === 'zh' || normalized === 'en' || normalized === 'auto') return normalized
  throw new Error(`Invalid language "${String(value)}"; expected auto, zh, or en.`)
}

function splitCsv(value: unknown): string[] {
  if (!value) return []
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
