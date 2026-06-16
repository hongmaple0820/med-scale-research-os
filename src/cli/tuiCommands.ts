import { defineCommand } from 'citty'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { EventBus } from '../core/eventBus.js'
import { SQLiteArtifactStore } from '../artifact/sqliteStore.js'

export const tuiCommand = defineCommand({
  meta: {
    name: 'tui',
    description: 'Interactive terminal UI dashboard for governance status',
  },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
  },
  async run({ args }) {
    const { runTuiDashboard } = await import('../tui/TuiDashboard.js')

    const scaleDir = join(args.dir as string, '.scale')
    const dbPath = join(scaleDir, 'scale.db')
    const eventsDir = join(scaleDir, 'events')

    // Ensure the .scale directories exist
    for (const d of [scaleDir, eventsDir, join(scaleDir, 'artifacts')]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true })
    }

    const eventBus = new EventBus({ eventsDir })
    const artifactStore = new SQLiteArtifactStore(eventBus, {
      dbPath,
      artifactsDir: join(scaleDir, 'artifacts'),
    })

    await runTuiDashboard(artifactStore, eventBus)
    console.log('TUI session ended.')
  },
})
