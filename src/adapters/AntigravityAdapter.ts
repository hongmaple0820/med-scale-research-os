// SCALE Engine - Antigravity Adapter

import { GenericProjectAgentAdapter } from './GenericProjectAgentAdapter.js'

export class AntigravityAdapter extends GenericProjectAgentAdapter {
  constructor() {
    super({
      agentType: 'antigravity',
      displayName: 'Antigravity',
      settingsPath: '.agents/hooks.json',
      knowledgeDocPath: '.agents/rules/SCALE.md',
      skillsDir: '.agents/skills',
      extraDirs: ['.agents/rules'],
      installedPaths: ['.agents/hooks.json', '.agents/rules'],
      settingsShape: 'qoder-hooks',
      notes: [
        'Antigravity workspace hooks are configured through .agents/hooks.json.',
        'Antigravity guidance is kept in .agents/rules and leaves shared AGENTS.md untouched.',
      ],
    })
  }
}
