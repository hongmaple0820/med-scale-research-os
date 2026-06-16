// SCALE Engine — Role 定义
// 设计参考：docs/03-CORE-MODULES.md §3.5 "Role 权限网关"

import type { RoleDefinition } from '../artifact/types.js'

export const ROLES: Record<string, RoleDefinition> = {
  Explorer: {
    name: 'Explorer',
    canCreateArtifacts: ['Insight'],
    canReadArtifacts: ['Need', 'Spec', 'Insight'],
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    deniedTools: ['Edit', 'Write', 'Bash'],
    requiresUpstream: [],
  },
  SpecWriter: {
    name: 'SpecWriter',
    canCreateArtifacts: ['Spec'],
    canModifyArtifacts: [{ type: 'Spec', statuses: ['DRAFT', 'REVIEWING'] }],
    allowedTools: ['Read', 'Write', 'WebSearch'],
    requiresUpstream: [{ type: 'Need' }],
  },
  Planner: {
    name: 'Planner',
    canCreateArtifacts: ['Plan', 'TestPlan', 'Task'],
    allowedTools: ['Read', 'Grep', 'WebSearch', 'Write'],
    requiresUpstream: [{ type: 'Spec', status: 'FROZEN' }],
  },
  Implementer: {
    name: 'Implementer',
    canCreateArtifacts: ['Change'],
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'MultiEdit'],
    requiresUpstream: [{ type: 'Task', status: 'READY' }],
    mustRunAfterEdit: ['lint', 'typecheck'],
  },
  Verifier: {
    name: 'Verifier',
    canCreateArtifacts: ['Evidence', 'Defect'],
    allowedTools: ['Read', 'Bash', 'Grep'],
    deniedTools: ['Edit', 'Write'],
  },
  Releaser: {
    name: 'Releaser',
    canCreateArtifacts: ['Release'],
    allowedTools: ['Read', 'Bash'],
    requiresUpstream: [
      { type: 'Defect', allMatch: 'CLOSED' },
      { type: 'Evidence', allMatch: 'PASS' },
    ],
  },
}

export function getRole(name: string): RoleDefinition | undefined {
  return ROLES[name]
}

export function listRoles(): string[] {
  return Object.keys(ROLES)
}
