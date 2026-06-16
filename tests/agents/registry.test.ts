// SCALE Engine — Agent Registry Tests

import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../src/agents/AgentRegistry.js'
import { PROFESSIONAL_AGENTS } from '../../src/agents/profiles.js'
import type { AgentProfile } from '../../src/agents/types.js'

describe('AgentRegistry', () => {
  it('should initialize with default profiles', () => {
    const registry = new AgentRegistry()
    expect(registry.list().length).toBe(12)
  })

  it('should get profile by ID', () => {
    const registry = new AgentRegistry()
    const profile = registry.get('frontend-agent')
    expect(profile).toBeDefined()
    expect(profile?.name).toBe('Frontend Developer')

    // 新增 Agent 测试
    const dbProfile = registry.get('database-agent')
    expect(dbProfile).toBeDefined()
    expect(dbProfile?.name).toBe('Database Specialist')
  })

  it('should return undefined for unknown profile', () => {
    const registry = new AgentRegistry()
    expect(registry.get('unknown-agent')).toBeUndefined()
  })

  it('should get profiles by domain', () => {
    const registry = new AgentRegistry()
    const frontend = registry.getByDomain('frontend')
    expect(frontend.length).toBe(1)

    const database = registry.getByDomain('database')
    expect(database.length).toBe(1)
  })

  it('should get profiles by role', () => {
    const registry = new AgentRegistry()
    const verifiers = registry.getByRole('Verifier')
    expect(verifiers.length).toBe(4) // test-agent, code-review-agent, security-agent, performance-agent

    const implementers = registry.getByRole('Implementer')
    expect(implementers.length).toBe(3) // frontend-agent, backend-agent, database-agent
  })

  it('should register new profile', () => {
    const registry = new AgentRegistry([])
    const newProfile: AgentProfile = {
      id: 'custom-agent',
      name: 'Custom Agent',
      domain: 'documentation',
      inheritsRole: 'SpecWriter',
      capabilities: ['docs', 'api-reference'],
      preferredModel: 'fast',
      outputFormat: { fileTypes: ['.md'], style: 'documentation' },
      collaboration: {},
    }
    registry.register(newProfile)
    expect(registry.get('custom-agent')).toBeDefined()
    expect(registry.list().length).toBe(1)
  })

  it('should throw on duplicate registration', () => {
    const registry = new AgentRegistry([])
    registry.register(PROFESSIONAL_AGENTS[0])
    expect(() => registry.register(PROFESSIONAL_AGENTS[0])).toThrow()
  })
})
