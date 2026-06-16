// SCALE Engine - Workflow Hooks Preset (v0.10.0)
// Presets for deploying workflow-related hooks.
import type { IEventBus } from '../core/eventBus.js'
import type { EnhancedHook } from './HookGeneratorEnhanced.js'
import { HookGeneratorEnhanced } from './HookGeneratorEnhanced.js'
import { HookDeployer } from './HookDeployer.js'

export interface WorkflowHookPreset {
  name: string
  description: string
  templates: string[]
  enabled: boolean
}

const WORKFLOW_PRESETS: WorkflowHookPreset[] = [
  {
    name: 'karpathy',
    description: 'Karpathy coding principle checks (K1-THINK, K2-SIMPLE)',
    templates: ['tmpl-karpathy-k1-think', 'tmpl-karpathy-k2-simple'],
    enabled: true
  },
  {
    name: 'security',
    description: 'Security guards (G7: hardcoded secrets, empty catch blocks)',
    templates: ['tmpl-hardcoded-secret-guard', 'tmpl-empty-catch-guard'],
    enabled: true
  },
  {
    name: 'quality',
    description: 'Code quality checks (mutation guard, AI slop)',
    templates: ['tmpl-mutation-guard', 'tmpl-ai-slop-detector'],
    enabled: false
  },
  {
    name: 'honest-delivery',
    description: 'Honest delivery checks for unverified claims',
    templates: ['tmpl-unverified-check'],
    enabled: true
  },
  {
    name: 'phase-completion',
    description: 'Phase completion gate — blocks Stop if SCALE Engine phases incomplete',
    templates: ['tmpl-phase-completion-check'],
    enabled: true
  },
  {
    name: 'explore-guard',
    description: 'PreToolUse guard — warns when writing before exploration is recorded',
    templates: ['tmpl-explore-check'],
    enabled: true
  },
  {
    name: 'next-step-reminder',
    description: 'Stop reminder — shows remaining SCALE phases and next command',
    templates: ['tmpl-next-step-reminder'],
    enabled: true
  },
  {
    name: 'doc-standards',
    description: 'Document standards check (G8) — validates markdown files on write',
    templates: ['tmpl-doc-standards-check'],
    enabled: true
  },
  {
    name: 'anatomy',
    description: 'Project file map — shows file descriptions before reads, auto-updates on writes',
    templates: ['tmpl-anatomy-pre-read', 'tmpl-anatomy-post-write', 'tmpl-anatomy-session-start'],
    enabled: true
  },
  {
    name: 'cerebrum',
    description: 'Learning memory — Do-Not-Repeat rules checked before writes, preferences loaded at session start',
    templates: ['tmpl-cerebrum-pre-write', 'tmpl-cerebrum-session-start'],
    enabled: true
  },
  {
    name: 'bug-capture',
    description: 'Auto-detect bug fix patterns from edits, recall past bugs before editing same file',
    templates: ['tmpl-bug-capture', 'tmpl-bug-recall'],
    enabled: true
  }
]

export class WorkflowHooksManager {
  private generator: HookGeneratorEnhanced
  private deployer: HookDeployer

  constructor(eventBus: IEventBus) {
    this.generator = new HookGeneratorEnhanced(eventBus)
    this.deployer = new HookDeployer(eventBus)
  }

  deployPreset(
    presetName: string,
    hooksDir: string,
    settingsPath: string
  ): EnhancedHook[] {
    const presets = presetName === 'all'
      ? WORKFLOW_PRESETS.filter(p => p.enabled)
      : WORKFLOW_PRESETS.filter(p => p.name === presetName && p.enabled)

    const hooks: EnhancedHook[] = []
    for (const preset of presets) {
      for (const templateId of preset.templates) {
        const template = this.generator.getTemplates().find(t => t.id === templateId)
        if (!template) continue
        const hook = this.generator.generateFromTemplate(template, {}, hooksDir)
        this.deployer.deploy(hook, settingsPath)
        hooks.push(hook)
      }
    }
    return hooks
  }

  listPresets(): WorkflowHookPreset[] {
    return WORKFLOW_PRESETS
  }

  togglePreset(name: string, enabled: boolean): void {
    const preset = WORKFLOW_PRESETS.find(p => p.name === name)
    if (preset) preset.enabled = enabled
  }

  getPresetStatus(): { preset: string; hooks: number; active: boolean }[] {
    return WORKFLOW_PRESETS.map(p => ({
      preset: p.name,
      hooks: p.templates.length,
      active: p.enabled
    }))
  }

  deployDefaultWorkflowHooks(
    hooksDir: string,
    settingsPath: string
  ): { deployed: number; hooks: EnhancedHook[] } {
    const hooks = this.deployPreset('all', hooksDir, settingsPath)
    return { deployed: hooks.length, hooks }
  }

  getGenerator(): HookGeneratorEnhanced { return this.generator }
  getDeployer(): HookDeployer { return this.deployer }
}

export function generateRecommendedHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write',
          hooks: [
            { type: 'command', command: 'node ~/.claude/hooks/karpathy-k1.mjs', timeout: 3000 },
            { type: 'command', command: 'node ~/.claude/hooks/hardcoded-secret.mjs', timeout: 5000 }
          ]
        },
        {
          matcher: 'Edit',
          hooks: [
            { type: 'command', command: 'node ~/.claude/hooks/karpathy-k2.mjs', timeout: 3000 }
          ]
        },
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'node ~/.claude/hooks/dangerous-cmd.mjs', timeout: 5000 }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            { type: 'command', command: 'node ~/.claude/hooks/empty-catch.mjs', timeout: 3000 },
            { type: 'command', command: 'node ~/.claude/hooks/ai-slop.mjs', timeout: 5000 }
          ]
        }
      ],
      Stop: [
        {
          matcher: '',
          hooks: [
            { type: 'command', command: 'node ~/.claude/hooks/unverified.mjs', timeout: 10000 },
            { type: 'command', command: 'node ~/.claude/hooks/phase-completion.mjs', timeout: 5000 }
          ]
        }
      ]
    }
  }
}
