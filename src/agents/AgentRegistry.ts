// SCALE Engine — Agent Registry
// Profile 注册与查询

import type { AgentProfile, AgentDomain } from './types.js'
import { PROFESSIONAL_AGENTS } from './profiles.js'
import { logger } from '../core/logger.js'

export interface IAgentRegistry {
  register(profile: AgentProfile): void
  get(id: string): AgentProfile | undefined
  getByDomain(domain: AgentDomain): AgentProfile[]
  getByRole(role: string): AgentProfile[]
  list(): string[]
  getAll(): AgentProfile[]
}

export class AgentRegistry implements IAgentRegistry {
  private profiles = new Map<string, AgentProfile>()

  constructor(initialProfiles: AgentProfile[] = PROFESSIONAL_AGENTS) {
    for (const profile of initialProfiles) {
      this.register(profile)
    }
  }

  register(profile: AgentProfile): void {
    if (this.profiles.has(profile.id)) {
      throw new Error(`Agent profile already registered: ${profile.id}`)
    }
    this.profiles.set(profile.id, profile)
    logger.debug({ profileId: profile.id, domain: profile.domain }, 'Agent profile registered')
  }

  get(id: string): AgentProfile | undefined {
    return this.profiles.get(id)
  }

  getByDomain(domain: AgentDomain): AgentProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.domain === domain)
  }

  getByRole(role: string): AgentProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.inheritsRole === role)
  }

  list(): string[] {
    return Array.from(this.profiles.keys())
  }

  getAll(): AgentProfile[] {
    return Array.from(this.profiles.values())
  }
}

export const DEFAULT_REGISTRY = new AgentRegistry()
