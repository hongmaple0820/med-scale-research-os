// WorklogManager — Unit Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorklogManager } from '../../src/workflow/autonomous/WorklogManager.js'

let dirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-wl-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('WorklogManager', () => {
  let dir: string
  let manager: WorklogManager

  beforeEach(() => {
    dir = makeTmpDir()
    manager = new WorklogManager(join(dir, 'worklog.md'))
  })

  describe('read', () => {
    it('returns empty state when file does not exist', () => {
      const state = manager.read()
      expect(state.entries).toHaveLength(0)
      expect(state.totalPending).toBe(0)
      expect(state.totalDone).toBe(0)
    })
  })

  describe('parse', () => {
    it('parses pending entries with priority', () => {
      const md = `# Worklog

## Pending
- [P0] fix: Critical auth bug
- [P1] feat: Add user profile page
- [P2] refactor: Extract utils
`
      const state = manager.parse(md)

      expect(state.entries).toHaveLength(3)
      expect(state.entries[0]).toMatchObject({
        id: 'WL-001',
        type: 'fix',
        description: 'Critical auth bug',
        status: 'pending',
        priority: 'P0',
      })
      expect(state.entries[1]).toMatchObject({
        id: 'WL-002',
        type: 'feature',
        description: 'Add user profile page',
        priority: 'P1',
      })
      expect(state.entries[2]).toMatchObject({
        id: 'WL-003',
        type: 'refactor',
        description: 'Extract utils',
        priority: 'P2',
      })
    })

    it('parses done entries', () => {
      const md = `# Worklog

## Done
- [x] feat: PhaseMarkerTracker implementation
- [x] fix: SessionStateTracker type error
`
      const state = manager.parse(md)

      expect(state.entries).toHaveLength(2)
      expect(state.entries[0]).toMatchObject({
        type: 'feature',
        description: 'PhaseMarkerTracker implementation',
        status: 'done',
      })
      expect(state.entries[1]).toMatchObject({
        type: 'fix',
        description: 'SessionStateTracker type error',
        status: 'done',
      })
    })

    it('parses mixed pending and done entries', () => {
      const md = `# Worklog

## Pending
- [P0] fix: Urgent bug
- [P1] feat: New feature

## Done
- [x] refactor: Old refactor
`
      const state = manager.parse(md)

      expect(state.entries).toHaveLength(3)
      expect(state.totalPending).toBe(2)
      expect(state.totalDone).toBe(1)
    })

    it('parses in_progress entries with [~] marker', () => {
      const md = `# Worklog

- [~] [P1] feat: Currently working on this

## Pending
- [P0] fix: Another bug
`
      const state = manager.parse(md)

      expect(state.entries).toHaveLength(2)
      expect(state.entries[0]).toMatchObject({
        status: 'in_progress',
        description: 'Currently working on this',
        priority: 'P1',
      })
      expect(state.entries[1]).toMatchObject({
        status: 'pending',
        description: 'Another bug',
      })
    })

    it('handles empty sections gracefully', () => {
      const md = `# Worklog

## Pending

## Done

`
      const state = manager.parse(md)
      expect(state.entries).toHaveLength(0)
    })

    it('normalizes task types', () => {
      const md = `## Pending
- [P1] bug: Type bug
- [P1] feat: Type feat
- [P1] feature: Type feature
- [P1] chore: Type chore
- [P1] test: Type test
`
      const state = manager.parse(md)
      expect(state.entries.map(e => e.type)).toEqual([
        'bug', 'feature', 'feature', 'refactor', 'test',
      ])
    })
  })

  describe('getNextTask', () => {
    it('returns highest priority pending task', () => {
      const md = `## Pending
- [P2] feat: Low priority
- [P0] fix: Critical fix
- [P1] feat: Medium priority
`
      const state = manager.parse(md)
      const next = manager.getNextTask(state)

      expect(next).toBeDefined()
      expect(next!.description).toBe('Critical fix')
      expect(next!.priority).toBe('P0')
    })

    it('skips done and in_progress entries', () => {
      const md = `## Pending
- [P0] fix: Already done task
- [P1] feat: Next up

## Done
- [x] fix: Already done task
`
      const state = manager.parse(md)
      // Mark P0 as done explicitly in state
      state.entries[0].status = 'done'
      const next = manager.getNextTask(state)

      expect(next).toBeDefined()
      expect(next!.description).toBe('Next up')
    })

    it('returns undefined when no pending tasks', () => {
      const md = `## Done
- [x] feat: All done
`
      const state = manager.parse(md)
      const next = manager.getNextTask(state)
      expect(next).toBeUndefined()
    })
  })

  describe('updateEntryStatus', () => {
    it('updates entry status and recomputes counts', () => {
      const md = `## Pending
- [P0] fix: Bug to fix
`
      let state = manager.parse(md)
      expect(state.totalPending).toBe(1)
      expect(state.totalDone).toBe(0)

      state = manager.updateEntryStatus(state, 'WL-001', 'done', 'Fixed in commit abc')

      expect(state.entries[0].status).toBe('done')
      expect(state.entries[0].notes).toBe('Fixed in commit abc')
      expect(state.totalPending).toBe(0)
      expect(state.totalDone).toBe(1)
    })
  })

  describe('markInProgress', () => {
    it('marks entry as in_progress and resets others', () => {
      const md = `## Pending
- [P0] fix: Bug A
- [P1] feat: Feature B
`
      let state = manager.parse(md)

      // Mark first as in_progress
      state = manager.markInProgress(state, 'WL-001')
      expect(state.entries[0].status).toBe('in_progress')
      expect(state.entries[1].status).toBe('pending')

      // Mark second — should reset first
      state = manager.markInProgress(state, 'WL-002')
      expect(state.entries[0].status).toBe('pending')
      expect(state.entries[1].status).toBe('in_progress')
    })
  })

  describe('markDone', () => {
    it('marks entry as done with optional notes', () => {
      const md = `## Pending
- [P1] feat: My feature
`
      let state = manager.parse(md)
      state = manager.markDone(state, 'WL-001', 'Implemented with TDD')

      expect(state.entries[0].status).toBe('done')
      expect(state.entries[0].notes).toBe('Implemented with TDD')
    })
  })

  describe('markBlocked', () => {
    it('marks entry as blocked with reason', () => {
      const md = `## Pending
- [P0] feat: Blocked feature
`
      let state = manager.parse(md)
      state = manager.markBlocked(state, 'WL-001', 'Waiting for API schema')

      expect(state.entries[0].status).toBe('blocked')
      expect(state.entries[0].notes).toBe('Waiting for API schema')
    })
  })

  describe('addEntry', () => {
    it('adds new entry with auto-generated ID', () => {
      let state = manager.parse('## Pending\n')
      state = manager.addEntry(state, {
        type: 'feature',
        description: 'New feature',
        status: 'pending',
        priority: 'P1',
      })

      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].id).toBe('WL-001')
      expect(state.totalPending).toBe(1)
    })

    it('increments ID correctly', () => {
      const md = `## Pending
- [P1] feat: Existing
`
      let state = manager.parse(md)
      state = manager.addEntry(state, {
        type: 'bug',
        description: 'New bug',
        status: 'pending',
        priority: 'P0',
      })

      expect(state.entries).toHaveLength(2)
      expect(state.entries[1].id).toBe('WL-002')
    })
  })

  describe('write and roundtrip', () => {
    it('writes markdown and reads back identical state', () => {
      const md = `# Worklog

## In Progress

- [~] [P0] fix: Active bug fix
  > Investigating root cause

## Pending

- [P1] feat: Next feature
- [P2] refactor: Cleanup

## Done

- [x] feat: Previous feature
  > Completed with tests
`
      const state = manager.parse(md)
      manager.write(state)

      const written = readFileSync(join(dir, 'worklog.md'), 'utf-8')
      expect(written).toContain('fix: Active bug fix')
      expect(written).toContain('feature: Next feature') // feat normalizes to feature
      expect(written).toContain('refactor: Cleanup')
      expect(written).toContain('feature: Previous feature') // feat normalizes to feature
      expect(written).not.toContain('BLOCKED') // no blocked entries in this test

      // Read back
      const roundtrip = manager.read()
      expect(roundtrip.entries.length).toBe(state.entries.length)
    })

    it('creates directory if needed', () => {
      const nestedPath = join(dir, 'deep', 'nested', 'worklog.md')
      const nestedManager = new WorklogManager(nestedPath)

      const state = nestedManager.parse('## Pending\n- [P1] feat: Test\n')
      nestedManager.write(state)

      expect(existsSync(nestedPath)).toBe(true)
    })

    it('writes blocked entries with BLOCKED prefix in notes', () => {
      const md = `## Pending
- [P0] feat: Blocked task
`
      let state = manager.parse(md)
      state = manager.markBlocked(state, 'WL-001', 'Need external API')
      manager.write(state)

      const written = readFileSync(join(dir, 'worklog.md'), 'utf-8')
      expect(written).toContain('BLOCKED: Need external API')
    })
  })

  describe('getByStatus and getByType', () => {
    it('filters by status', () => {
      const md = `## Pending
- [P0] fix: Bug
- [P1] feat: Feature

## Done
- [x] test: Old test
`
      const state = manager.parse(md)

      expect(manager.getByStatus(state, 'pending')).toHaveLength(2)
      expect(manager.getByStatus(state, 'done')).toHaveLength(1)
      expect(manager.getByStatus(state, 'blocked')).toHaveLength(0)
    })

    it('filters by type', () => {
      const md = `## Pending
- [P0] fix: Bug A
- [P1] feat: Feature B
- [P0] fix: Bug C
`
      const state = manager.parse(md)

      expect(manager.getByType(state, 'fix')).toHaveLength(2)
      expect(manager.getByType(state, 'feature')).toHaveLength(1)
      expect(manager.getByType(state, 'test')).toHaveLength(0)
    })
  })
})
