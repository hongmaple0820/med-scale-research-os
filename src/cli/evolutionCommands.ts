// SCALE Engine — Evolution Commands
// L6 Evolution CLI 命令：Lesson 提取、自改进、规则管理
// 设计参考：docs/03-CORE-MODULES.md §3.6

import { defineCommand } from 'citty'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'
import { FSM } from '../artifact/fsm.js'
import { registerAllFSMs } from '../artifact/fsmDefinitions.js'
import { WorkflowEngine } from '../workflow/WorkflowEngine.js'
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../skills/SkillRegistry.js'
import { LessonExtractor } from '../workflow/evolution/LessonExtractor.js'
import { SelfImproveEngine } from '../workflow/evolution/SelfImproveEngine.js'

const SCALE_DIR = process.env.SCALE_DIR ?? '.scale'

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Engine singleton (reuse pattern from phaseCommands.ts)
function getEngine() {
  ensureDir(SCALE_DIR)
  const eventBus = new EventBus({ eventsDir: join(SCALE_DIR, 'events') })
  const store = new SQLiteArtifactStore(eventBus, {
    dbPath: join(SCALE_DIR, 'scale.db'),
    artifactsDir: join(SCALE_DIR, 'artifacts'),
  })
  const fsm = new FSM(store, eventBus)
  registerAllFSMs(fsm)
  const capabilityRegistry = new CapabilityRegistry(eventBus)
  const skillRegistry = new SkillRegistry(eventBus)
  const workflowEngine = new WorkflowEngine({ eventBus, capabilityRegistry, skillRegistry })
  return { eventBus, store, fsm, workflowEngine, skillRegistry }
}

// Evolution extract 命令 - 从会话提取 Lessons
export const evolutionExtract = defineCommand({
  meta: { name: 'extract', description: 'Extract lessons from session defects' },
  args: {
    'session-id': { type: 'positional', required: true, description: 'Session ID to analyze' },
    'output': { type: 'string', alias: 'o', description: 'Output file for lessons (JSON)' },
    'verbose': { type: 'boolean', alias: 'v', default: false, description: 'Show detailed extraction process' },
    'min': { type: 'string', default: '2', description: 'Minimum occurrences to become lesson' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    const sessionId = args['session-id'] as string
    const minOccurrences = parseInt(args.min as string, 10) || 2
    const extractor = new LessonExtractor(eventBus, minOccurrences)

    if (!args.verbose && !args.json) {
      console.log(`Analyzing session ${sessionId} for lessons...`)
    }

    const candidates = await extractor.extractFromSession(sessionId)

    if (candidates.length === 0) {
      if (!args.json) {
        console.log('\nNo lessons extracted from this session.')
        console.log('This may mean:')
        console.log('  - No defects were recorded in this session')
        console.log('  - Patterns did not meet minimum occurrence threshold')
      }
      return
    }

    if (args.json) {
      const lessons = extractor.toLessonArtifacts(candidates)
      console.log(JSON.stringify(lessons, null, 2))
    } else {
      console.log(`\n=== Extracted Lessons (${candidates.length}) ===\n`)
      for (const candidate of candidates) {
        console.log(`[${candidate.priority}] ${candidate.pattern}`)
        console.log(`  Solution: ${candidate.solution}`)
        console.log(`  Occurrences: ${candidate.frequency}`)
        console.log(`  Verified: ${candidate.verified ? 'Yes' : 'No (pending)'}`)
        console.log('')
      }
    }

    if (args.output && !args.json) {
      const lessons = extractor.toLessonArtifacts(candidates)
      console.log(`\nTo save lessons, output to: ${args.output}`)
    }
  },
})

// Evolution improve 命令 - 运行自改进闭环
export const evolutionImprove = defineCommand({
  meta: { name: 'improve', description: 'Run self-improve cycle: Defect → Lesson → Rule → Hook' },
  args: {
    'session-id': { type: 'positional', required: true, description: 'Session ID to process' },
    'verbose': { type: 'boolean', alias: 'v', default: false, description: 'Show detailed improvement process' },
    'verify-threshold': { type: 'string', default: '3', description: 'Lesson verification threshold' },
    'rule-threshold': { type: 'string', default: '10', description: 'Rule activation threshold' },
    'hook-threshold': { type: 'string', default: '20', description: 'Hook generation threshold' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    const sessionId = args['session-id'] as string
    const thresholds = {
      lessonVerificationThreshold: parseInt(args['verify-threshold'] as string, 10) || 3,
      ruleActivationThreshold: parseInt(args['rule-threshold'] as string, 10) || 10,
      hookGenerationThreshold: parseInt(args['hook-threshold'] as string, 10) || 20,
      maxHooks: 10
    }

    const engine = new SelfImproveEngine(eventBus, thresholds)

    if (args.verbose && !args.json) {
      console.log('Self-improve thresholds:')
      console.log(`  Lesson → Rule: ${thresholds.lessonVerificationThreshold} verifications`)
      console.log(`  Rule → Active: ${thresholds.ruleActivationThreshold} hits`)
      console.log(`  Rule → Hook: ${thresholds.hookGenerationThreshold} hits`)
      console.log('')
    }

    const state = await engine.run(sessionId)

    if (args.json) {
      console.log(JSON.stringify(state, null, 2))
    } else {
      console.log('\n=== Self-Improve Result ===\n')
      console.log(`Lessons Extracted: ${state.lessonsExtracted}`)
      console.log(`Lessons Verified:  ${state.lessonsVerified}`)
      console.log(`Rules Created:     ${state.rulesCreated}`)
      console.log(`Rules Active:      ${state.rulesActive}`)
      console.log(`Hooks Generated:   ${state.hooksGenerated}`)

      if (state.hooksGenerated > 0) {
        console.log('\n[GENERATED HOOKS]')
        const hooks = engine.getGeneratedHooks()
        for (const hook of hooks) {
          console.log(`  ${hook.hookType}: ${hook.matcher}`)
        }
        console.log('\nTo register these hooks, add to .claude/settings.json:')
        const hooksConfig = engine.getGeneratedHooksConfig()
        console.log(JSON.stringify({ hooks: hooksConfig }, null, 2))
      }
    }
  },
})

// Evolution report 命令 - 显示自改进报告
export const evolutionReport = defineCommand({
  meta: { name: 'report', description: 'Show self-improve engine report' },
  args: {
    'session-id': { type: 'positional', required: false, description: 'Session ID to analyze' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    const sessionId = args['session-id'] as string | undefined

    if (sessionId) {
      const engine = new SelfImproveEngine(eventBus)
      await engine.run(sessionId)
      if (args.json) {
        console.log(JSON.stringify({ report: engine.generateReport() }, null, 2))
      } else {
        console.log(engine.generateReport())
      }
    } else {
      console.log('No session provided. Run `scale evolution improve <session-id>` first.')
    }
  },
})

// Evolution rules 命令 - 管理规则
export const evolutionRules = defineCommand({
  meta: { name: 'rules', description: 'List or manage rules' },
  args: {
    'list': { type: 'boolean', alias: 'l', default: false, description: 'List all rules' },
    'active': { type: 'boolean', alias: 'a', default: false, description: 'List only active rules' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    if (!args.json) {
      console.log('\n=== Rules ===\n')
      console.log('Rules are auto-generated from verified lessons.')
      console.log('')
      console.log('To view rules:')
      console.log('  ls knowledge/rules/')
      console.log('')
      console.log('To create a rule:')
      console.log('  scale evolution extract <session> --output knowledge/rules/new-rule.json')
      console.log('')
      console.log('To activate a rule:')
      console.log('  scale evolution improve <session> --rule-threshold 5')
    }
  },
})

// Evolution verify 命令 - 手动验证 Lesson
export const evolutionVerify = defineCommand({
  meta: { name: 'verify', description: 'Manually verify a lesson' },
  args: {
    'pattern': { type: 'positional', required: true, description: 'Lesson pattern to verify' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const pattern = args['pattern'] as string
    if (!args.json) {
      console.log(`\nVerifying lesson: "${pattern}"`)
      console.log('')
      console.log('Manual verification steps:')
      console.log('  1. Review the pattern and solution')
      console.log('  2. Apply the solution in a real scenario')
      console.log('  3. Confirm the solution resolves the pattern')
      console.log('')
      console.log('After verification, run:')
      console.log(`  scale evolution improve <session-id> --verify-threshold 1`)
    }
  },
})

// Evolution hooks 命令 - 显示生成的 Hooks
export const evolutionHooks = defineCommand({
  meta: { name: 'hooks', description: 'Show generated hooks configuration' },
  args: {
    'session-id': { type: 'positional', required: false, description: 'Session ID to process' },
    'json': { type: 'boolean', alias: 'j', default: false, description: 'Output as JSON' },
  },
  async run({ args }) {
    const { eventBus } = getEngine()
    const sessionId = args['session-id'] as string | undefined

    if (sessionId) {
      const engine = new SelfImproveEngine(eventBus)
      await engine.run(sessionId)

      if (args.json) {
        const hooksConfig = engine.getGeneratedHooksConfig()
        console.log(JSON.stringify({ hooks: hooksConfig }, null, 2))
      } else {
        const hooks = engine.getGeneratedHooks()
        if (hooks.length === 0) {
          console.log('No hooks generated.')
          console.log('Run with a session that has enough rule hits.')
        } else {
          console.log('\n=== Generated Hooks ===\n')
          for (const hook of hooks) {
            console.log(`[${hook.hookType}] Matcher: ${hook.matcher}`)
            console.log(`  Description: ${hook.description}`)
            console.log('')
          }
        }
      }
    } else {
      console.log('Usage: scale evolution hooks <session-id>')
      console.log('  --json, -j  Output as JSON for .claude/settings.json')
    }
  },
})