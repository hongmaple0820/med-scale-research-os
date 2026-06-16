import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { CapabilityRegistry } from '../../src/capabilities/CapabilityRegistry.js'
import { SkillRegistry } from '../../src/skills/SkillRegistry.js'
import { SkillExecutor } from '../../src/skills/SkillExecutor.js'
import { skillsInvoker } from '../../src/capabilities/InstalledSkillsIntegration.js'

describe('Exa capability integration', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = 'test-exa-key'
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.EXA_API_KEY
    } else {
      process.env.EXA_API_KEY = originalKey
    }
  })

  it('registers exa capability in the capability registry', async () => {
    const bus = new EventBus()
    const registry = new CapabilityRegistry(bus)

    const exa = registry.getExa()
    expect(exa).toBeDefined()
    expect(registry.getAll().some(cap => cap.category === 'exa')).toBe(true)

    const result = await exa!.webSearch('scale engine', { numResults: 2 })
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('routes web_search_exa through SkillExecutor', async () => {
    const bus = new EventBus()
    const skillRegistry = new SkillRegistry(bus)
    const capabilityRegistry = new CapabilityRegistry(bus)
    const executor = new SkillExecutor(skillRegistry, bus, capabilityRegistry)

    const result = await executor.executeMCPTool('web_search_exa', { query: 'scale engine', numResults: 3 })

    expect(result.success).toBe(true)
    expect(Array.isArray((result.output as { data?: unknown[] }).data)).toBe(true)
  })

  it('registers installed-skill builtin wrappers', async () => {
    const bus = new EventBus()
    const skillRegistry = new SkillRegistry(bus)
    const executor = new SkillExecutor(skillRegistry, bus)
    const originalWhoami = skillsInvoker.vercelWhoami
    skillsInvoker.vercelWhoami = async () => ({
      success: true,
      output: 'test-user',
      durationMs: 1,
      skillId: 'deploy-to-vercel'
    })

    try {
      const result = await executor.executeBuiltinFunction('vercel_whoami', {})
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ output: 'test-user' })
    } finally {
      skillsInvoker.vercelWhoami = originalWhoami
    }
  })
})
