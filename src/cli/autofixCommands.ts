import { defineCommand } from 'citty'
import { AutoFixEngine } from '../workflow/autofix/AutoFixEngine.js'
import { EventBus } from '../core/eventBus.js'

export const autofixCommand = defineCommand({
  meta: {
    name: 'auto-fix',
    description: 'Auto-detect and fix lint, test, and security failures — then re-verify',
  },
  args: {
    scope: { type: 'string', default: 'all', description: 'Scope: lint|test|security|all' },
    'max-attempts': { type: 'string', default: '3', description: 'Max fix attempts per failure' },
    'escalate': { type: 'boolean', default: true, description: 'Escalate model tier on retry' },
    'dry-run': { type: 'boolean', default: false, description: 'Report what would be done without applying fixes' },
  },
  async run({ args }) {
    const eventBus = new EventBus()
    const engine = new AutoFixEngine(eventBus)

    const report = await engine.run({
      scope: (args.scope as string) as 'lint' | 'test' | 'security' | 'all',
      maxAttempts: parseInt(args['max-attempts'] as string, 10) || 3,
      escalateModel: args.escalate as boolean,
      dryRun: args['dry-run'] as boolean,
    })

    console.log('\n--- AutoFix Report ---')
    console.log(`  Summary: ${report.summary}`)
    console.log(`  Fixed: ${report.fixed}`)
    console.log(`  Unfixed: ${report.unfixed}`)
    console.log(`  Attempts: ${report.attempts.length}`)
    console.log(`  Recommendation: ${report.recommendation}`)
  },
})
