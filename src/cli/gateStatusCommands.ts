import { defineCommand } from 'citty'
import { resolve } from 'node:path'
import { createGateStatusReport } from '../workflow/GateCatalog.js'

const DEFAULT_PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DEFAULT_SCALE_DIR = process.env.SCALE_DIR ?? '.scale'

export const gatesCommand = defineCommand({
  meta: { name: 'gates', description: 'Quality gate catalog and status commands' },
  subCommands: {
    status: defineCommand({
      meta: { name: 'status', description: 'Show active gate catalog, profiles, and policy-backed extension gates' },
      args: {
        dir: { type: 'string', default: DEFAULT_PROJECT_DIR, description: 'Project directory' },
        'scale-dir': { type: 'string', default: DEFAULT_SCALE_DIR, description: 'Scale governance directory' },
        profile: { type: 'string', description: 'Verification profile from .scale/verification.json' },
        service: { type: 'string', description: 'Service name from .scale/verification.json' },
        json: { type: 'boolean', default: false, description: 'Print JSON output' },
      },
      run({ args }) {
        const projectDir = resolve(String(args.dir ?? process.cwd()))
        const report = createGateStatusReport({
          projectDir,
          scaleDir: String(args['scale-dir'] ?? '.scale'),
          profile: typeof args.profile === 'string' ? args.profile : undefined,
          service: typeof args.service === 'string' ? args.service : undefined,
        })
        if (args.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        console.log('\nSCALE Gate Status')
        console.log(`  Project: ${report.projectDir}`)
        console.log(`  Verification profile: ${report.verificationProfile}`)
        console.log(`  Catalog: ${report.summary.coreStages} core + ${report.summary.metaStages} meta + ${report.summary.extensionGates} extension gates`)
        console.log('\nProfiles:')
        for (const profile of report.profiles) {
          console.log(`  ${profile.id}: ${profile.stages.join(', ')}`)
        }
        console.log('\nPolicy extension gates:')
        for (const extension of report.extensions) {
          const state = extension.active ? extension.blocking ? 'blocking' : 'advisory' : 'off'
          console.log(`  ${extension.id}: ${state} (${extension.mode})`)
        }
        if (report.warnings.length > 0) {
          console.log('\nWarnings:')
          for (const warning of report.warnings) console.log(`  - ${warning}`)
        }
      },
    }),
  },
})
