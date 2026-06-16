// SCALE Engine — Workspace Policy Tests

import { describe, expect, it } from 'vitest'
import { WorkspacePolicyEngine, type ResourcePolicy } from '../../src/workflow/WorkspacePolicy.js'

const FIXED_DATE = new Date('2026-05-22T00:00:00.000Z')

describe('WorkspacePolicyEngine', () => {
  it('allows all access with default config', () => {
    const engine = new WorkspacePolicyEngine()
    const result = engine.checkAccess('implementer', 'src/index.ts', 'write')
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('blocks non-owner when enforcement is block', () => {
    const policy: ResourcePolicy = {
      resource: 'src/auth/**',
      type: 'directory',
      owner: 'security-reviewer',
      enforcement: 'block',
      reason: 'Auth code requires security review',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    const result = engine.checkAccess('implementer', 'src/auth/login.ts', 'write')
    expect(result.allowed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].verdict).toBe('blocked')
    expect(result.message).toContain('blocked')
  })

  it('allows owner access when enforcement is block', () => {
    const policy: ResourcePolicy = {
      resource: 'src/auth/**',
      type: 'directory',
      owner: 'security-reviewer',
      enforcement: 'block',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    const result = engine.checkAccess('security-reviewer', 'src/auth/login.ts', 'write')
    expect(result.allowed).toBe(true)
  })

  it('warns but allows with warn enforcement', () => {
    const policy: ResourcePolicy = {
      resource: '*.test.ts',
      type: 'file',
      allowedAgents: ['qa-lead', 'tester'],
      enforcement: 'warn',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    const result = engine.checkAccess('implementer', 'auth.test.ts', 'write')
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].verdict).toBe('warned')
  })

  it('allows listed agents', () => {
    const policy: ResourcePolicy = {
      resource: '*.test.ts',
      type: 'file',
      allowedAgents: ['qa-lead', 'tester'],
      enforcement: 'block',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    const result = engine.checkAccess('qa-lead', 'auth.test.ts', 'write')
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('tracks violations', () => {
    const policy: ResourcePolicy = {
      resource: 'src/auth/**',
      type: 'directory',
      owner: 'security-reviewer',
      enforcement: 'block',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    }, () => FIXED_DATE)

    engine.checkAccess('implementer', 'src/auth/login.ts', 'write')
    engine.checkAccess('other-agent', 'src/auth/config.ts', 'delete')

    const violations = engine.getViolations()
    expect(violations).toHaveLength(2)
    expect(violations[0].ts).toBe('2026-05-22T00:00:00.000Z')
  })

  it('filters violations by agentId', () => {
    const policy: ResourcePolicy = {
      resource: 'src/auth/**',
      type: 'directory',
      owner: 'security-reviewer',
      enforcement: 'block',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    engine.checkAccess('implementer', 'src/auth/login.ts', 'write')
    engine.checkAccess('other-agent', 'src/auth/config.ts', 'write')

    expect(engine.getViolations('implementer')).toHaveLength(1)
    expect(engine.getViolations('other-agent')).toHaveLength(1)
    expect(engine.getViolations('unknown')).toHaveLength(0)
  })

  it('adds and removes policies', () => {
    const engine = new WorkspacePolicyEngine()

    engine.addPolicy({ resource: 'src/**', type: 'directory', enforcement: 'warn' })
    expect(engine.listPolicies()).toHaveLength(1)

    engine.addPolicy({ resource: 'src/**', type: 'directory', enforcement: 'block' })
    expect(engine.listPolicies()).toHaveLength(1) // replaced

    engine.removePolicy('src/**')
    expect(engine.listPolicies()).toHaveLength(0)
  })

  it('loads config from project', () => {
    // This test verifies loadFromProject doesn't throw when file doesn't exist
    const engine = new WorkspacePolicyEngine({ version: 1, defaultEnforcement: 'advisory', resources: [], conflictResolution: 'owner-priority' })
    engine.loadFromProject('/nonexistent-path')
    expect(engine.listPolicies()).toHaveLength(0)
  })

  it('advisory enforcement allows access even for non-owner', () => {
    const policy: ResourcePolicy = {
      resource: 'docs/**',
      type: 'directory',
      owner: 'doc-writer',
      enforcement: 'advisory',
    }
    const engine = new WorkspacePolicyEngine({
      version: 1,
      defaultEnforcement: 'advisory',
      resources: [policy],
      conflictResolution: 'owner-priority',
    })

    const result = engine.checkAccess('implementer', 'docs/README.md', 'write')
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('returns config via getConfig', () => {
    const config = {
      version: 1,
      defaultEnforcement: 'advisory' as const,
      resources: [{ resource: 'src/**', type: 'directory' as const, enforcement: 'warn' as const }],
      conflictResolution: 'owner-priority' as const,
    }
    const engine = new WorkspacePolicyEngine(config)
    const returned = engine.getConfig()
    expect(returned.version).toBe(1)
    expect(returned.resources).toHaveLength(1)
  })
})
