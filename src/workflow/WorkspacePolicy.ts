// SCALE Engine — Workspace Policy Runtime Enforcement (v0.34.0)
// Runtime workspace policy engine with file access rules, resource locks, agent boundaries

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { randomUUID } from 'node:crypto'

export type PolicyEnforcement = 'advisory' | 'warn' | 'block'
export type ResourceType = 'file' | 'directory' | 'tool' | 'branch'

export interface ResourcePolicy {
  resource: string           // glob pattern
  type: ResourceType
  owner?: string             // agentId
  allowedAgents?: string[]
  enforcement: PolicyEnforcement
  reason?: string
}

export interface WorkspacePolicyConfig {
  version: number
  defaultEnforcement: PolicyEnforcement
  resources: ResourcePolicy[]
  conflictResolution: 'first-wins' | 'owner-priority' | 'block-all'
}

export interface PolicyViolation {
  id: string
  ts: string
  agentId: string
  resource: string
  policy: ResourcePolicy
  action: 'read' | 'write' | 'delete'
  verdict: 'allowed' | 'warned' | 'blocked'
  message: string
}

export interface PolicyCheckResult {
  allowed: boolean
  violations: PolicyViolation[]
  message?: string
}

const DEFAULT_CONFIG: WorkspacePolicyConfig = {
  version: 1,
  defaultEnforcement: 'advisory',
  resources: [],
  conflictResolution: 'owner-priority',
}

export class WorkspacePolicyEngine {
  private config: WorkspacePolicyConfig
  private violations: PolicyViolation[] = []
  private now: () => Date

  constructor(config?: WorkspacePolicyConfig, now?: () => Date) {
    this.config = config ?? { ...DEFAULT_CONFIG }
    this.now = now ?? (() => new Date())
  }

  checkAccess(agentId: string, resource: string, action: 'read' | 'write' | 'delete'): PolicyCheckResult {
    const matchingPolicies = this.config.resources.filter(p => matchGlob(resource, p.resource))

    if (matchingPolicies.length === 0) {
      return { allowed: true, violations: [] }
    }

    const violations: PolicyViolation[] = []

    for (const policy of matchingPolicies) {
      const verdict = this.evaluatePolicy(agentId, resource, action, policy)
      if (verdict !== 'allowed') {
        const violation: PolicyViolation = {
          id: `PV-${Date.now()}-${randomUUID().slice(0, 8)}`,
          ts: this.now().toISOString(),
          agentId,
          resource,
          policy,
          action,
          verdict,
          message: this.buildMessage(agentId, resource, action, policy, verdict),
        }
        violations.push(violation)
        this.violations.push(violation)
      }
    }

    const blocked = violations.some(v => v.verdict === 'blocked')
    return {
      allowed: !blocked,
      violations,
      message: blocked
        ? `Access blocked: ${violations.filter(v => v.verdict === 'blocked').map(v => v.message).join('; ')}`
        : undefined,
    }
  }

  addPolicy(policy: ResourcePolicy): void {
    const existing = this.config.resources.findIndex(p => p.resource === policy.resource)
    if (existing >= 0) {
      this.config.resources[existing] = policy
    } else {
      this.config.resources.push(policy)
    }
  }

  removePolicy(resource: string): void {
    this.config.resources = this.config.resources.filter(p => p.resource !== resource)
  }

  listPolicies(): ResourcePolicy[] {
    return [...this.config.resources]
  }

  getViolations(agentId?: string): PolicyViolation[] {
    if (agentId) return this.violations.filter(v => v.agentId === agentId)
    return [...this.violations]
  }

  getConfig(): WorkspacePolicyConfig {
    return { ...this.config }
  }

  loadFromProject(projectDir?: string): void {
    const dir = resolve(projectDir ?? process.cwd())
    const policyPath = join(dir, '.scale', 'workspace-policy.yaml')
    if (!existsSync(policyPath)) return

    try {
      const content = readFileSync(policyPath, 'utf-8')
      const parsed = yaml.load(content) as Partial<WorkspacePolicyConfig>
      if (parsed.version) this.config.version = parsed.version
      if (parsed.defaultEnforcement) this.config.defaultEnforcement = parsed.defaultEnforcement
      if (parsed.conflictResolution) this.config.conflictResolution = parsed.conflictResolution
      if (Array.isArray(parsed.resources)) this.config.resources = parsed.resources
    } catch {
      // ignore parse errors, keep existing config
    }
  }

  private evaluatePolicy(
    agentId: string,
    _resource: string,
    _action: string,
    policy: ResourcePolicy,
  ): 'allowed' | 'warned' | 'blocked' {
    // Owner always gets full access
    if (policy.owner && policy.owner === agentId) {
      return 'allowed'
    }

    // Check allowedAgents list
    if (policy.allowedAgents && policy.allowedAgents.length > 0) {
      if (!policy.allowedAgents.includes(agentId)) {
        return policy.enforcement === 'block' ? 'blocked' : policy.enforcement === 'warn' ? 'warned' : 'allowed'
      }
      return 'allowed'
    }

    // Non-owner with owner-priority conflict resolution
    if (policy.owner && this.config.conflictResolution === 'owner-priority') {
      return policy.enforcement === 'block' ? 'blocked' : policy.enforcement === 'warn' ? 'warned' : 'allowed'
    }

    // Default enforcement for write/delete on directories
    if (policy.type === 'directory' && (_action === 'write' || _action === 'delete')) {
      if (policy.enforcement === 'block') return 'blocked'
      if (policy.enforcement === 'warn') return 'warned'
    }

    return 'allowed'
  }

  private buildMessage(
    agentId: string,
    resource: string,
    action: string,
    policy: ResourcePolicy,
    verdict: 'warned' | 'blocked',
  ): string {
    const parts = [
      `Agent "${agentId}" ${verdict} from ${action} "${resource}"`,
    ]
    if (policy.owner) parts.push(`(owner: ${policy.owner})`)
    if (policy.reason) parts.push(`— ${policy.reason}`)
    return parts.join(' ')
  }
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(filePath)
}
