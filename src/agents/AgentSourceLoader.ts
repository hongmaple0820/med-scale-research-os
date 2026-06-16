// SCALE Engine — Agent Source Loader (v0.10.0)
// 从外部 YAML 文件加载 Agent Profile 定义

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import * as yaml from 'js-yaml'
import type { AgentProfile, AgentDomain, ModelTier } from './types.js'
import { AgentProfileRegistry, defaultProfileRegistry } from './profiles.js'
import { logger } from '../core/logger.js'

export interface YAMLAgentDefinition {
  id: string
  name: string
  description?: string
  domain: string
  emoji?: string
  color?: string
  identity?: { role: string; personality: string; memory: string; experience: string }
  missions?: Array<{ name: string; description: string; priority: 'critical' | 'high' | 'normal' }>
  rules?: Array<{ name: string; description: string; enforcement: 'block' | 'warn' | 'suggest' }>
  inheritsRole: string
  capabilities: string[]
  preferredModel: string
  deliverables?: Array<{ name: string; template: string; format: 'markdown' | 'code' | 'json' | 'yaml' }>
  workflow?: Array<{ stepId: string; name: string; description: string; outputs?: string[] }>
  successMetrics?: Array<{ name: string; target: string; measurement: string }>
  outputFormat?: { fileTypes: string[]; style: string }
  collaboration?: { reportsTo?: string; sharesWith: string[] }
}

export interface IAgentSourceLoader {
  loadFromDirectory(dir: string): AgentProfile[]
  loadFromFile(filePath: string): AgentProfile | null
  loadFromYAML(content: string): AgentProfile | null
  validateDefinition(def: YAMLAgentDefinition): boolean
}

export class AgentSourceLoader implements IAgentSourceLoader {
  private registry: AgentProfileRegistry
  constructor(registry: AgentProfileRegistry = defaultProfileRegistry) { this.registry = registry }
  
  loadFromDirectory(dir: string): AgentProfile[] {
    if (!existsSync(dir)) { logger.warn({ dir }, 'Agent source directory not found'); return [] }
    const profiles: AgentProfile[] = []
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) { profiles.push(...this.loadFromDirectory(join(dir, entry.name))) }
      else if (entry.isFile() && (extname(entry.name) === '.yaml' || extname(entry.name) === '.yml')) {
        const profile = this.loadFromFile(join(dir, entry.name))
        if (profile) { profiles.push(profile); try { this.registry.register(profile) } catch {} }
      }
    }
    return profiles
  }
  
  loadFromFile(filePath: string): AgentProfile | null {
    if (!existsSync(filePath)) return null
    try { return this.loadFromYAML(readFileSync(filePath, 'utf-8')) } catch (error) { logger.error({ error }, "Failed to parse YAML agent definition"); return null }
  }
  
  loadFromYAML(content: string): AgentProfile | null {
    try {
      const def = yaml.load(content) as YAMLAgentDefinition
      if (!this.validateDefinition(def)) return null
      return this.convertDefinition(def)
    } catch (error) { logger.error({ error }, "Failed to parse YAML agent definition"); return null }
  }
  
  validateDefinition(def: YAMLAgentDefinition): boolean {
    const required = ['id', 'name', 'domain', 'inheritsRole', 'capabilities']
    for (const f of required) if (!def[f as keyof YAMLAgentDefinition]) return false
    const validDomains = ['frontend', 'backend', 'testing', 'ui-design', 'operations', 'product', 'code-review', 'security', 'documentation', 'planning', 'exploration', 'database', 'performance', 'architecture']
    if (!validDomains.includes(def.domain)) return false
    return true
  }
  
  private convertDefinition(def: YAMLAgentDefinition): AgentProfile {
    const profile: AgentProfile = {
      id: def.id, name: def.name, description: def.description ?? '',
      domain: def.domain as AgentDomain, inheritsRole: def.inheritsRole,
      capabilities: def.capabilities, preferredModel: (def.preferredModel as ModelTier) || 'balanced'
    }
    if (def.emoji) profile.emoji = def.emoji
    if (def.color) profile.color = def.color
    if (def.identity) profile.identity = def.identity
    if (def.missions) profile.missions = def.missions
    if (def.rules) profile.rules = def.rules
    if (def.outputFormat) profile.outputFormat = def.outputFormat
    if (def.deliverables) profile.deliverables = def.deliverables
    if (def.workflow) profile.workflow = def.workflow
    if (def.successMetrics) profile.successMetrics = def.successMetrics
    if (def.collaboration) profile.collaboration = def.collaboration
    return profile
  }
  
  exportToYAML(profile: AgentProfile): string {
    return yaml.dump(profile)
  }
}

export const defaultAgentSourceLoader = new AgentSourceLoader()
export function loadAgentsFromDirectory(dir: string): AgentProfile[] { return defaultAgentSourceLoader.loadFromDirectory(dir) }
export function loadAgentFromFile(filePath: string): AgentProfile | null { return defaultAgentSourceLoader.loadFromFile(filePath) }
export function exportProfileToYAML(profile: AgentProfile): string { return defaultAgentSourceLoader.exportToYAML(profile) }
