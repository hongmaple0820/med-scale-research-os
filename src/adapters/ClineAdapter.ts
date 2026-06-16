// SCALE Engine - Cline Adapter

import { GenericProjectAgentAdapter } from './GenericProjectAgentAdapter.js'

export class ClineAdapter extends GenericProjectAgentAdapter {
  constructor() {
    super({
      agentType: 'cline',
      displayName: 'Cline',
      settingsPath: '.cline/settings.json',
      knowledgeDocPath: '.clinerules/SCALE.md',
      skillsDir: '.cline/skills',
      extraDirs: ['.clinerules'],
      installedPaths: ['.cline/settings.json', '.clinerules'],
      notes: [
        'Cline project guidance is kept in .clinerules so it can coexist with user-owned AGENTS.md files.',
        'Use SCALE verification evidence before accepting Cline-generated completion claims.',
      ],
    })
  }
}
