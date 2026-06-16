// SCALE Engine - Qoder Adapter

import { GenericProjectAgentAdapter } from './GenericProjectAgentAdapter.js'

export class QoderAdapter extends GenericProjectAgentAdapter {
  constructor() {
    super({
      agentType: 'qoder',
      displayName: 'Qoder',
      settingsPath: '.qoder/settings.json',
      knowledgeDocPath: '.qoder/rules/SCALE.md',
      skillsDir: '.qoder/skills',
      extraDirs: ['.qoder/rules'],
      installedPaths: ['.qoder/settings.json', '.qoder/rules'],
      settingsShape: 'qoder-hooks',
      notes: [
        'Qoder rules are kept under .qoder/rules for project-scoped guidance.',
        'Qoder hook entries use PreToolUse, PostToolUse, and Stop style sections.',
      ],
    })
  }
}
