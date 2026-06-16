// SCALE Engine Lite Mode Commands (v0.10.0)
import { defineCommand } from 'citty'
import { SkillDiscovery } from '../skills/SkillDiscovery.js'
import type { DevelopmentPhase } from '../artifact/types.js'

const PHASE_NAMES: DevelopmentPhase[] = ['DEFINE', 'PLAN', 'BUILD', 'VERIFY', 'REVIEW', 'SHIP']

const PHASE_DESC: Record<DevelopmentPhase, { desc: string; next: string }> = {
  DEFINE: { desc: 'Requirements capture, spec generation', next: 'PLAN' },
  PLAN: { desc: 'Architecture design, task breakdown', next: 'BUILD' },
  BUILD: { desc: 'TDD implementation, coding', next: 'VERIFY' },
  VERIFY: { desc: 'Testing, coverage analysis', next: 'REVIEW' },
  REVIEW: { desc: 'Code review, security audit', next: 'SHIP' },
  SHIP: { desc: 'Commit, release management', next: 'DEFINE' },
  'ANTI-PATTERNS': { desc: 'Common pitfalls to avoid', next: 'DEFINE' },
}

export const liteCommand = defineCommand({
  meta: { name: 'lite', description: 'SCALE Lite Mode - Interactive phase workflow' },
  args: {
    phase: { type: 'positional', required: false },
    interactive: { type: 'boolean', alias: 'i', default: false },
    list: { type: 'boolean', alias: 'l', default: false },
    skills: { type: 'boolean', alias: 's', default: false },
  },
  async run({ args }) {
    const discovery = new SkillDiscovery(process.cwd())
    if (args.list) {
      console.log('\n# SCALE Engine - Development Phases\n')
      for (const phase of PHASE_NAMES) {
        const info = PHASE_DESC[phase]
        console.log('## ' + phase)
        console.log(info.desc)
        console.log('Next: ' + info.next + '\n')
      }
      return
    }
    if (args.skills && args.phase) {
      const phase = args.phase.toUpperCase() as DevelopmentPhase
      const skills = discovery.getSkillsForPhase(phase)
      console.log('\n# Skills for ' + phase + '\n')
      if (skills.length === 0) console.log('No skills found.\n')
      else { for (const s of skills) console.log('- ' + s.name + ': ' + (s.description || 'See skill file')); console.log('') }
      return
    }
    if (args.interactive || !args.phase) {
      console.log('\n# SCALE Engine - Lite Mode\n')
      console.log('Select a development phase:\n')
      for (let i = 0; i < PHASE_NAMES.length; i++) {
        const phase = PHASE_NAMES[i]
        const info = PHASE_DESC[phase]
        console.log('  ' + (i+1) + ') ' + phase + ' - ' + info.desc)
      }
      console.log('\n  Usage: scale lite <phase>')
      console.log('  Example: scale lite DEFINE\n')
      return
    }
    const phase = args.phase.toUpperCase() as DevelopmentPhase
    if (!PHASE_NAMES.includes(phase)) {
      console.error('\nInvalid phase: ' + args.phase)
      console.log('Valid phases: DEFINE, PLAN, BUILD, VERIFY, REVIEW, SHIP\n')
      return
    }
    const info = PHASE_DESC[phase]
    const skills = discovery.getSkillsForPhase(phase)
    console.log('\n# ' + phase + ' Phase\n')
    console.log(info.desc)
    console.log('Next phase: ' + info.next + '\n')
    if (skills.length > 0) {
      console.log('Available skills:')
      for (const skill of skills) console.log('  - ' + skill.name)
      console.log('')
    }
    console.log('Quick commands:')
    console.log('  scale ' + phase.toLowerCase() + ' <args>')
    console.log('  scale lite ' + info.next + ' (proceed to next phase)\n')
  },
})

export const liteDefine = defineCommand({
  meta: { name: 'define', description: 'DEFINE phase shortcut' },
  args: { title: { type: 'positional', required: true }, description: { type: 'string', alias: 'd' }, json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nDEFINE Phase\n')
    console.log('Title: ' + args.title)
    console.log('Description: ' + (args.description ?? '(none)') + '\n')
    console.log('Next: scale plan <spec-id>\n')
    if (args.json) console.log(JSON.stringify({ phase: 'DEFINE', title: args.title }, null, 2))
  },
})

export const litePlan = defineCommand({
  meta: { name: 'plan', description: 'PLAN phase shortcut' },
  args: { 'spec-id': { type: 'positional', required: true }, json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nPLAN Phase\n')
    console.log('Spec: ' + args['spec-id'] + '\n')
    console.log('Next: scale build <plan-id>\n')
    if (args.json) console.log(JSON.stringify({ phase: 'PLAN', specId: args['spec-id'] }, null, 2))
  },
})

export const liteBuild = defineCommand({
  meta: { name: 'build', description: 'BUILD phase shortcut' },
  args: { 'plan-id': { type: 'positional', required: true }, json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nBUILD Phase\n')
    console.log('Plan: ' + args['plan-id'] + '\n')
    console.log('Next: scale verify <task-id>\n')
    if (args.json) console.log(JSON.stringify({ phase: 'BUILD', planId: args['plan-id'] }, null, 2))
  },
})

export const liteVerify = defineCommand({
  meta: { name: 'verify', description: 'VERIFY phase shortcut' },
  args: { 'task-id': { type: 'positional', required: true }, json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nVERIFY Phase\n')
    console.log('Task: ' + args['task-id'] + '\n')
    console.log('Next: scale review\n')
    if (args.json) console.log(JSON.stringify({ phase: 'VERIFY', taskId: args['task-id'] }, null, 2))
  },
})

export const liteReview = defineCommand({
  meta: { name: 'review', description: 'REVIEW phase shortcut' },
  args: { json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nREVIEW Phase\n')
    console.log('Reviewing code quality...\n')
    console.log('Next: scale ship <task-id>\n')
    if (args.json) console.log(JSON.stringify({ phase: 'REVIEW' }, null, 2))
  },
})

export const liteShip = defineCommand({
  meta: { name: 'ship', description: 'SHIP phase shortcut' },
  args: { 'task-id': { type: 'positional', required: true }, json: { type: 'boolean', default: false } },
  async run({ args }) {
    console.log('\nSHIP Phase\n')
    console.log('Task: ' + args['task-id'] + '\n')
    console.log('Complete!\n')
    if (args.json) console.log(JSON.stringify({ phase: 'SHIP', taskId: args['task-id'] }, null, 2))
  },
})
