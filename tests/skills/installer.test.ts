// SCALE Engine - Skill Installer Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../../src/skills/SkillRegistry.js'
import { SkillInstaller } from '../../src/skills/SkillInstaller.js'
import { registerExternalSkills } from '../../src/skills/ExternalSkills.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('SkillInstaller', () => {
  let registry: SkillRegistry
  let installer: SkillInstaller
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    registry = new SkillRegistry(eventBus)
    registerExternalSkills(registry, eventBus)
    installer = new SkillInstaller(registry, eventBus)
  })

  it('should detect uninstalled optional skills', async () => {
    const pending = await installer.checkAndPrompt()
    expect(pending).toHaveLength(11)
    expect(pending.map(c => c.skillId)).toEqual(expect.arrayContaining([
      'agent-browser',
      'mcp-chrome-devtools',
      'codex-cli',
      'gemini-cli',
      'opencode-cli',
      'cua',
      'fireworks-tech-graph',
    ]))
  })

  it('should have correct install method for cua', async () => {
    const pending = await installer.checkAndPrompt()
    const cuaConfig = pending.find(c => c.skillId === 'cua')
    expect(cuaConfig).toBeDefined()
    expect(cuaConfig?.method).toBe('pip-install')
    expect(cuaConfig?.command).toBe('pip install cua')
  })

  it('should have git-clone for fireworks-tech-graph', async () => {
    const pending = await installer.checkAndPrompt()
    const config = pending.find(c => c.skillId === 'fireworks-tech-graph')
    expect(config).toBeDefined()
    expect(config?.method).toBe('git-clone')
    expect(config?.sourceUrl).toContain('github.com')
  })

  it('should keep tool adapters as manual installs', async () => {
    const pending = await installer.checkAndPrompt()
    for (const skillId of ['agent-browser', 'mcp-chrome-devtools', 'codex-cli', 'gemini-cli', 'opencode-cli']) {
      const config = pending.find(c => c.skillId === skillId)
      expect(config).toBeDefined()
      expect(config?.method).toBe('manual')
      expect(config?.sourceUrl).toContain('github.com')
    }
  })

  it('should emit install-prompt event', async () => {
    let eventEmitted = false
    eventBus.on('skills.install-prompt', () => { eventEmitted = true })
    await installer.checkAndPrompt()
    await new Promise(r => setTimeout(r, 50)) // Wait for async dispatch
    expect(eventEmitted).toBe(true)
  })

  it('should return install configs with sourceUrl', async () => {
    const pending = await installer.checkAndPrompt()
    for (const config of pending) {
      expect(config.sourceUrl).toBeDefined()
      expect(config.sourceUrl.length).toBeGreaterThan(0)
    }
  })

  it('should have verification for cua', async () => {
    const pending = await installer.checkAndPrompt()
    const cuaConfig = pending.find(c => c.skillId === 'cua')
    expect(cuaConfig?.verification).toBeDefined()
    expect(cuaConfig?.verification).toContain('python')
  })
})
