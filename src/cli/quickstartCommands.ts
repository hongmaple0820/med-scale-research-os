import { defineCommand } from 'citty'
import { quickStart, detectPlatform, classifyProject } from '../api/quickstart.js'
import { logger } from '../core/logger.js'

export const quickstartCommand = defineCommand({
  meta: {
    name: 'quickstart',
    description: 'One-command governance setup (30 seconds to your first gate)',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    pack: { type: 'string', required: false, description: 'Governance pack (auto-detected if omitted)' },
    profile: { type: 'string', default: 'standard', description: 'Profile (minimal|standard|critical)' },
  },
  async run({ args }) {
    const classification = classifyProject(args.dir as string)
    const pack = (args.pack as string | undefined) ?? classification.recommendedPack

    logger.info({ pack, profile: args.profile, language: classification.language }, 'Quickstart initiated')

    // Detect platform
    const platform = detectPlatform(args.dir as string)

    console.log('\n' + '⚡' + ' SCALE Engine Quickstart \n')
    console.log(`  Project type: ${classification.language}${classification.framework ? ` (${classification.framework})` : ''}${classification.isMonorepo ? ' [monorepo]' : ''}`)
    console.log(`  Platform:     ${platform.platform ?? 'not detected (governance-only mode)'}`)
    console.log(`  Governance:   ${pack}`)
    console.log(`  Profile:      ${args.profile}\n`)

    // Bootstrap .scale/ skeleton
    const result = await quickStart(args.dir as string, {
      governancePack: pack,
      profileId: args.profile as string,
    })

    if (result.success) {
      console.log(`  Created: ${result.created.length} files`)
      console.log(`  Capabilities: ${result.capabilitiesEnabled.join(', ')}`)
      console.log('\n  Next steps:')
      for (const step of result.nextSteps) {
        console.log(`    → ${step}`)
      }
      console.log(`\n  Run 'scale preflight' to verify your governance setup.`)
    } else {
      console.log('  Quickstart completed. Run scale init to configure manually.')
      for (const step of result.nextSteps) {
        console.log(`    → ${step}`)
      }
    }
  },
})
