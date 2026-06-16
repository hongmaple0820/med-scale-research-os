// SCALE Engine - JCode Adapter

import { GenericProjectAgentAdapter } from './GenericProjectAgentAdapter.js'

export class JCodeAdapter extends GenericProjectAgentAdapter {
  constructor() {
    super({
      agentType: 'jcode',
      displayName: 'JCode',
      settingsPath: '.jcode/settings.json',
      knowledgeDocPath: 'JCODE.md',
      skillsDir: '.jcode/skills',
      installedPaths: ['.jcode/settings.json', 'JCODE.md'],
      notes: [
        'JCode is treated as a project-local agent surface because no stable public hook contract is assumed.',
        'The adapter records SCALE rules and conservative command boundaries without claiming native hook execution.',
      ],
    })
  }
}
