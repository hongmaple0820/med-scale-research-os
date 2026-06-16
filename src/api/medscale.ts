#!/usr/bin/env node
// Native MedSCALE CLI entrypoint for the medical research workflow.

import { defineCommand, runMain } from 'citty'
import { SCALE_ENGINE_VERSION } from '../version.js'
import { targetCommand } from '../cli/targetCommands.js'

export const medscaleMain = defineCommand({
  meta: {
    name: 'medscale',
    version: SCALE_ENGINE_VERSION,
    description: 'MedSCALE Research OS CLI - native medical research workflow, dashboard, doctor, memory, and delivery commands',
  },
  subCommands: {
    ...targetCommand.subCommands,
    target: targetCommand,
  },
})

if (!process.env.MEDSCALE_CLI_NO_AUTORUN) {
  runMain(medscaleMain)
}
