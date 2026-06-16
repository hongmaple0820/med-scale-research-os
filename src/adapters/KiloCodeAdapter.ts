// SCALE Engine - Kilo Code Adapter

import { GenericProjectAgentAdapter } from './GenericProjectAgentAdapter.js'

export class KiloCodeAdapter extends GenericProjectAgentAdapter {
  constructor() {
    super({
      agentType: 'kilocode',
      displayName: 'Kilo Code',
      settingsPath: '.kilocode/settings.json',
      knowledgeDocPath: 'AGENTS.md',
      skillsDir: '.kilocode/skills',
      extraDirs: ['.kilocode/rules'],
      installedPaths: ['.kilocode/settings.json', 'AGENTS.md'],
      notes: [
        'Kilo Code can read AGENTS.md style project instructions; SCALE creates it only when absent.',
        'Platform-local metadata is kept under .kilocode/ to avoid overwriting unrelated agent configuration.',
      ],
    })
  }
}
