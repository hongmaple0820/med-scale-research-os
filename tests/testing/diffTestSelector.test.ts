// SCALE Engine — Diff-Based Test Selector Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerTestDependency,
  clearDependencies,
  getDependencies,
  selectTestsByDiff,
  formatTestSelection,
  type TestDependency,
} from '../../src/testing/DiffTestSelector.js'

vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('git diff --name-only')) {
      return 'src/runtime/AiOsRuntime.ts\nsrc/workflow/ShipPipeline.ts\n'
    }
    return ''
  }),
}))

describe('Test Dependency Registry', () => {
  beforeEach(() => {
    clearDependencies()
  })

  it('registers and retrieves dependencies', () => {
    registerTestDependency({
      testFile: 'tests/runtime/aiOsRuntime.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'gate',
    })

    const deps = getDependencies()
    expect(deps.length).toBe(1)
    expect(deps[0].testFile).toBe('tests/runtime/aiOsRuntime.test.ts')
  })

  it('clears all dependencies', () => {
    registerTestDependency({
      testFile: 'tests/a.test.ts',
      touchfiles: ['src/a.ts'],
      tier: 'gate',
    })
    registerTestDependency({
      testFile: 'tests/b.test.ts',
      touchfiles: ['src/b.ts'],
      tier: 'periodic',
    })

    clearDependencies()
    expect(getDependencies().length).toBe(0)
  })

  it('overwrites duplicate test file entries', () => {
    registerTestDependency({
      testFile: 'tests/a.test.ts',
      touchfiles: ['src/old.ts'],
      tier: 'gate',
    })
    registerTestDependency({
      testFile: 'tests/a.test.ts',
      touchfiles: ['src/new.ts'],
      tier: 'periodic',
    })

    const deps = getDependencies()
    expect(deps.length).toBe(1)
    expect(deps[0].touchfiles).toEqual(['src/new.ts'])
  })
})

describe('selectTestsByDiff', () => {
  beforeEach(() => {
    clearDependencies()
  })

  it('selects tests matching changed files', () => {
    registerTestDependency({
      testFile: 'tests/runtime/aiOsRuntime.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'gate',
    })
    registerTestDependency({
      testFile: 'tests/workflow/shipPipeline.test.ts',
      touchfiles: ['src/workflow/**'],
      tier: 'gate',
    })

    const result = selectTestsByDiff()
    expect(result.selected).toContain('tests/runtime/aiOsRuntime.test.ts')
    expect(result.selected).toContain('tests/workflow/shipPipeline.test.ts')
    expect(result.skipped.length).toBe(0)
  })

  it('skips tests with no matching changed files', () => {
    registerTestDependency({
      testFile: 'tests/runtime/aiOsRuntime.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'gate',
    })
    registerTestDependency({
      testFile: 'tests/cli/cli.test.ts',
      touchfiles: ['src/cli/**'],
      tier: 'gate',
    })

    const result = selectTestsByDiff()
    expect(result.selected).toContain('tests/runtime/aiOsRuntime.test.ts')
    expect(result.skipped).toContain('tests/cli/cli.test.ts')
  })

  it('filters by tier', () => {
    registerTestDependency({
      testFile: 'tests/fast.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'gate',
    })
    registerTestDependency({
      testFile: 'tests/slow.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'periodic',
    })

    const gateResult = selectTestsByDiff({ tier: 'gate' })
    expect(gateResult.selected).toContain('tests/fast.test.ts')
    expect(gateResult.selected).not.toContain('tests/slow.test.ts')

    const periodicResult = selectTestsByDiff({ tier: 'periodic' })
    expect(periodicResult.selected).toContain('tests/slow.test.ts')
    expect(periodicResult.selected).not.toContain('tests/fast.test.ts')
  })

  it('records reason for selection', () => {
    registerTestDependency({
      testFile: 'tests/runtime.test.ts',
      touchfiles: ['src/runtime/**'],
      tier: 'gate',
    })

    const result = selectTestsByDiff()
    expect(result.reason['tests/runtime.test.ts']).toBeDefined()
    expect(result.reason['tests/runtime.test.ts']).toContain('src/runtime/AiOsRuntime.ts')
  })

  it('handles no matching dependencies gracefully', () => {
    registerTestDependency({
      testFile: 'tests/unrelated.test.ts',
      touchfiles: ['src/unrelated/**'],
      tier: 'gate',
    })

    const result = selectTestsByDiff()
    // The mock returns src/runtime/** and src/workflow/** changes,
    // so tests with src/unrelated/** should be skipped
    expect(result.selected.length).toBe(0)
    expect(result.skipped.length).toBe(1)
  })

  it('returns empty when no dependencies registered', () => {
    const result = selectTestsByDiff()
    expect(result.selected.length).toBe(0)
    expect(result.skipped.length).toBe(0)
  })
})

describe('formatTestSelection', () => {
  it('formats selected and skipped tests', () => {
    const result = {
      selected: ['tests/a.test.ts'],
      skipped: ['tests/b.test.ts'],
      reason: { 'tests/a.test.ts': ['src/a.ts'] },
      globalChangeTriggeredAll: false,
    }

    const formatted = formatTestSelection(result)
    expect(formatted).toContain('**Selected:** 1')
    expect(formatted).toContain('**Skipped:** 1')
    expect(formatted).toContain('✅ tests/a.test.ts')
    expect(formatted).toContain('⏭️ tests/b.test.ts')
    expect(formatted).toContain('src/a.ts')
  })

  it('indicates global change trigger', () => {
    const result = {
      selected: ['tests/a.test.ts'],
      skipped: [],
      reason: { 'tests/a.test.ts': ['[global change]'] },
      globalChangeTriggeredAll: true,
    }

    const formatted = formatTestSelection(result)
    expect(formatted).toContain('Global config change')
  })
})
