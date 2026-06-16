// Autonomous Dev Loop — Unit Tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventBus } from '../../src/core/eventBus.js'
import { AutonomousDevLoop, createDefaultConfig } from '../../src/workflow/autonomous/AutonomousDevLoop.js'
import { WorklogManager } from '../../src/workflow/autonomous/WorklogManager.js'

let dirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-auto-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('AutonomousDevLoop', () => {
  let dir: string
  let bus: EventBus
  let worklogPath: string
  let batonPath: string
  let events: Array<{ type: string; payload: unknown }>

  beforeEach(() => {
    dir = makeTmpDir()
    bus = new EventBus({ eventsDir: join(dir, 'events') })
    worklogPath = join(dir, 'worklog.md')
    batonPath = join(dir, 'baton')
    events = []

    // Capture all events
    bus.on('*', (event) => {
      events.push({ type: event.type as string, payload: event.payload })
    })
  })

  // EventBus uses setImmediate for async dispatch — wait for events to arrive
  function waitForEvents(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve))
  }

  describe('createDefaultConfig', () => {
    it('returns defaults without overrides', () => {
      const config = createDefaultConfig()
      expect(config.scaleDir).toBe('.scale')
      expect(config.worklogPath).toBe('.scale/worklog.md')
      expect(config.maxDefectsPerRun).toBe(3)
      expect(config.maxFeaturesPerRun).toBe(1)
    })

    it('applies overrides', () => {
      const config = createDefaultConfig({
        maxDefectsPerRun: 5,
        qaCommand: 'npm test',
      })
      expect(config.maxDefectsPerRun).toBe(5)
      expect(config.qaCommand).toBe('npm test')
      expect(config.scaleDir).toBe('.scale') // default preserved
    })
  })

  describe('constructor', () => {
    it('creates with default config', () => {
      const loop = new AutonomousDevLoop(bus)
      expect(loop.getConfig().scaleDir).toBe('.scale')
    })

    it('creates with custom config', () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'echo "pass"',
      })
      expect(loop.getConfig().worklogPath).toBe(worklogPath)
    })
  })

  describe('worklog integration', () => {
    it('reads worklog with pending tasks', () => {
      writeFileSync(worklogPath, `# Worklog

## Pending
- [P0] fix: Critical bug
- [P1] feat: New feature
- [P2] refactor: Cleanup

## Done
- [x] feat: Previous feature
`, 'utf-8')

      const manager = new WorklogManager(worklogPath)
      const state = manager.read()

      expect(state.totalPending).toBe(3)
      expect(state.totalDone).toBe(1)
      expect(manager.getNextTask(state)!.description).toBe('Critical bug')
    })
  })

  describe('run', () => {
    it('runs with no worklog (empty state)', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  5 passed (5)\'); process.exit(0)"',
        cwd: dir,
      })

      const result = await loop.run()

      expect(result.runId).toMatch(/^AUTO-/)
      expect(result.success).toBe(true)
      expect(result.qaPassed).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('runs with worklog containing pending tasks', async () => {
      writeFileSync(worklogPath, `# Worklog

## Pending
- [P0] fix: Auth bug
- [P1] feat: User profile
`, 'utf-8')

      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  3 passed (3)\'); process.exit(0)"',
        cwd: dir,
      })

      const result = await loop.run()

      expect(result.success).toBe(true)
      expect(result.qaPassed).toBe(true)
      expect(result.phase).toBe('complete')
      // Feature should have been delegated since QA passed
      expect(result.featureProgressed).toBe(false) // delegated but not completed by framework
    })

    it('handles QA failure and records defects', async () => {
      writeFileSync(worklogPath, `# Worklog

## Pending
- [P0] fix: Some bug
`, 'utf-8')

      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'FAIL tests/auth.test.ts > login fails\'); console.log(\'Tests  2 failed | 3 passed (5)\'); process.exit(1)"',
        cwd: dir,
      })

      const result = await loop.run()

      expect(result.success).toBe(true) // loop itself succeeds
      expect(result.qaPassed).toBe(false)
      expect(result.phase).toBe('complete')
    })

    it('writes baton files after run', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  1 passed (1)\'); process.exit(0)"',
        cwd: dir,
      })

      await loop.run()

      const sessionFile = join(batonPath, 'current-session.md')
      const nextPromptFile = join(batonPath, 'next-prompt.md')

      expect(existsSync(sessionFile)).toBe(true)
      expect(existsSync(nextPromptFile)).toBe(true)

      const sessionContent = readFileSync(sessionFile, 'utf-8')
      expect(sessionContent).toContain('session_id: AUTO-')
      expect(sessionContent).toContain('qa_passed: true')

      const nextContent = readFileSync(nextPromptFile, 'utf-8')
      expect(nextContent).toContain('next_action:')
    })

    it('emits lifecycle events', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  1 passed (1)\'); process.exit(0)"',
        cwd: dir,
      })

      await loop.run()
      await waitForEvents()

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain('autonomous.loop.start')
      expect(eventTypes).toContain('autonomous.worklog.read')
      expect(eventTypes).toContain('autonomous.baton.written')
      expect(eventTypes).toContain('autonomous.loop.end')
    })

    it('emits defect events when QA fails', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'FAIL tests/broken.test.ts > it breaks\'); console.log(\'Tests  1 failed | 0 passed (1)\'); process.exit(1)"',
        cwd: dir,
      })

      await loop.run()
      await waitForEvents()

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain('autonomous.defect.detected')
      expect(eventTypes).toContain('autonomous.defect.fix_requested')
    })

    it('emits feature events when QA passes and tasks exist', async () => {
      writeFileSync(worklogPath, `## Pending
- [P1] feat: Build dashboard
`, 'utf-8')

      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  1 passed (1)\'); process.exit(0)"',
        cwd: dir,
      })

      await loop.run()
      await waitForEvents()

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain('autonomous.feature.start')
      expect(eventTypes).toContain('autonomous.feature.delegated')
    })

    it('handles QA command failure gracefully', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "process.exit(1)"',
        cwd: dir,
      })

      const result = await loop.run()

      // Should still complete — error is captured, not thrown
      expect(result.phase).toBe('complete')
      expect(result.runId).toMatch(/^AUTO-/)
    })

    it('writes baton even when errors occur', async () => {
      // Use a non-existent directory to trigger an error in readWorklog path
      const loop = new AutonomousDevLoop(bus, {
        worklogPath: join(dir, 'nonexistent', 'deep', 'worklog.md'),
        batonPath,
        qaCommand: 'node -e "process.exit(0)"',
        cwd: dir,
      })

      const result = await loop.run()

      // Baton should still be written for recovery
      expect(existsSync(join(batonPath, 'next-prompt.md'))).toBe(true)
    })
  })

  describe('baton output', () => {
    it('next-prompt recommends FIX_DEFECTS when QA fails', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'FAIL tests/x.test.ts > fails\'); console.log(\'Tests  1 failed | 0 passed (1)\'); process.exit(1)"',
        cwd: dir,
      })

      await loop.run()

      const nextContent = readFileSync(join(batonPath, 'next-prompt.md'), 'utf-8')
      expect(nextContent).toContain('next_action: FIX_DEFECTS')
      expect(nextContent).toContain('Failing Tests')
    })

    it('next-prompt recommends DEVELOP_FEATURE when QA passes and tasks pending', async () => {
      writeFileSync(worklogPath, `## Pending
- [P1] feat: My feature
`, 'utf-8')

      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  1 passed (1)\'); process.exit(0)"',
        cwd: dir,
      })

      await loop.run()

      const nextContent = readFileSync(join(batonPath, 'next-prompt.md'), 'utf-8')
      expect(nextContent).toContain('next_action: DEVELOP_FEATURE')
    })

    it('next-prompt recommends REVIEW_AND_EVOLVE when all tasks done', async () => {
      writeFileSync(worklogPath, `## Done
- [x] feat: Everything done
`, 'utf-8')

      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  1 passed (1)\'); process.exit(0)"',
        cwd: dir,
      })

      await loop.run()

      const nextContent = readFileSync(join(batonPath, 'next-prompt.md'), 'utf-8')
      expect(nextContent).toContain('next_action: REVIEW_AND_EVOLVE')
    })
  })

  describe('QA output parsing', () => {
    it('parses vitest summary format', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  2 failed | 44 passed (46)\'); process.exit(1)"',
        cwd: dir,
      })

      const result = await loop.run()

      expect(result.qaPassed).toBe(false)
    })

    it('detects passing QA with correct counts', async () => {
      const loop = new AutonomousDevLoop(bus, {
        worklogPath,
        batonPath,
        qaCommand: 'node -e "console.log(\'Tests  590 passed (590)\'); process.exit(0)"',
        cwd: dir,
      })

      const result = await loop.run()

      expect(result.qaPassed).toBe(true)
    })
  })
})
