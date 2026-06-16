// SCALE Engine — WorkflowOrchestrator Tests

import { describe, it, expect } from 'vitest'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTestDir(): string {
  const dir = join(tmpdir(), `scale-test-orchestrator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch { /* Windows may lock DB files */ }
}

describe('WorkflowOrchestrator', () => {
  it('can be instantiated', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })
      expect(orchestrator).toBeDefined()
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('run returns result structure with all phases', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      // Skip heavy phases that run actual commands
      const result = await orchestrator.run({
        title: 'Test task',
        description: 'A test task for orchestrator',
        skipPhases: ['verify', 'review', 'ship'],
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('phases')
      expect(result).toHaveProperty('artifacts')
      expect(result).toHaveProperty('duration')
      expect(result.phases.length).toBe(6)
      expect(result.phases.map(p => p.phase)).toEqual([
        'define', 'plan', 'build', 'verify', 'review', 'ship',
      ])
      // define, plan, build should succeed; verify/review/ship are skipped
      const activePhases = result.phases.filter(p => !['verify', 'review', 'ship'].includes(p.phase))
      for (const phase of activePhases) {
        expect(phase.success).toBe(true)
      }
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('chains artifact IDs between phases', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const result = await orchestrator.run({
        title: 'Test chaining',
        description: 'Test artifact chaining',
        skipPhases: ['verify', 'review', 'ship'],
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      // Define should produce needId and specId
      expect(result.artifacts.needId).toBeDefined()
      expect(result.artifacts.specId).toBeDefined()

      // Plan should produce planId
      expect(result.artifacts.planId).toBeDefined()

      // Build should produce taskId
      expect(result.artifacts.taskId).toBeDefined()
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('respects skipPhases option', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const result = await orchestrator.run({
        title: 'Skip test',
        skipPhases: ['verify', 'review', 'ship'],
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const skippedPhases = result.phases.filter(p =>
        ['verify', 'review', 'ship'].includes(p.phase),
      )
      for (const phase of skippedPhases) {
        expect(phase.success).toBe(true)
        expect(phase.duration).toBe(0)
      }
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('respects level option', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const result = await orchestrator.run({
        title: 'Level test',
        level: 'S',
        skipPhases: ['verify', 'review', 'ship'],
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const buildPhase = result.phases.find(p => p.phase === 'build')
      expect(buildPhase?.success).toBe(true)
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('handles phase failure with stopOnFailure', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      // Skip define to force plan failure (no specId)
      const result = await orchestrator.run({
        title: 'Failure test',
        skipPhases: ['define'],
        stopOnFailure: true,
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      expect(result.success).toBe(false)
      const failedPhase = result.phases.find(p => !p.success)
      expect(failedPhase).toBeDefined()
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })

  it('records phase durations', async () => {
    const { WorkflowOrchestrator } = await import('../../src/workflow/WorkflowOrchestrator.js')
    const testDir = makeTestDir()
    try {
      const orchestrator = new WorkflowOrchestrator({
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      const result = await orchestrator.run({
        title: 'Duration test',
        skipPhases: ['verify', 'review', 'ship'],
        scaleDir: testDir,
        projectDir: process.cwd(),
      })

      for (const phase of result.phases) {
        expect(phase.duration).toBeGreaterThanOrEqual(0)
      }
      expect(result.duration).toBeGreaterThanOrEqual(0)
      orchestrator.close()
    } finally {
      cleanupDir(testDir)
    }
  })
})
