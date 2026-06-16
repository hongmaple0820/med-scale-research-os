// Tests for SessionCoordinator — multi-session coordination, file overlaps, task dependencies

import { describe, it, expect, beforeEach } from 'vitest'
import { SessionCoordinator, summarizeCoordinationStatus } from '../../src/workflow/SessionCoordinator.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'session-coord-'))
}

describe('SessionCoordinator', () => {
  let dir: string
  let coord: SessionCoordinator

  beforeEach(() => {
    dir = makeTempDir()
    coord = new SessionCoordinator({ projectDir: dir, scaleDir: join(dir, '.scale') })
  })

  // afterEach cleanup handled by OS temp

  describe('registerSession', () => {
    it('registers a new session task', () => {
      const task = coord.registerSession({
        sessionId: 's1',
        taskId: 'task-1',
        files: ['src/auth.ts'],
        dependencies: [],
      })
      expect(task.taskId).toBe('task-1')
      expect(task.status).toBe('planned')
      expect(task.files).toEqual(['src/auth.ts'])
    })

    it('returns existing task if already registered and active', () => {
      coord.registerSession({ sessionId: 's1', taskId: 'task-1', files: [], dependencies: [] })
      const again = coord.registerSession({ sessionId: 's1', taskId: 'task-1', files: ['new.ts'], dependencies: [] })
      expect(again.taskId).toBe('task-1')
    })
  })

  describe('activateTask', () => {
    it('activates task with no blockers', () => {
      coord.registerSession({ sessionId: 's1', taskId: 'task-1', files: [], dependencies: [] })
      const result = coord.activateTask('task-1')
      expect(result.allowed).toBe(true)
      expect(coord.getTask('task-1')?.status).toBe('active')
    })

    it('blocks activation when dependencies are not done', () => {
      coord.registerSession({ sessionId: 's1', taskId: 'task-dep', files: [], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 'task-main', files: [], dependencies: ['task-dep'] })
      coord.blockTask('task-dep')

      const coord2 = new SessionCoordinator({ projectDir: dir, scaleDir: join(dir, '.scale'), config: { enforcement: 'block' } })
      const result = coord2.activateTask('task-main')
      expect(result.allowed).toBe(false)
      expect(result.blockers.length).toBeGreaterThan(0)
    })
  })

  describe('completeTask / cancelTask', () => {
    it('marks task as done', () => {
      coord.registerSession({ sessionId: 's1', taskId: 'task-1', files: [], dependencies: [] })
      coord.completeTask('task-1')
      expect(coord.getTask('task-1')?.status).toBe('done')
      expect(coord.getTask('task-1')?.completedAt).toBeDefined()
    })

    it('marks task as cancelled', () => {
      coord.registerSession({ sessionId: 's1', taskId: 'task-1', files: [], dependencies: [] })
      coord.cancelTask('task-1')
      expect(coord.getTask('task-1')?.status).toBe('cancelled')
    })
  })

  describe('detectOverlaps', () => {
    it('returns empty for non-overlapping tasks', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['src/a.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['src/b.ts'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')

      const overlaps = coord.detectOverlaps()
      expect(overlaps).toEqual([])
    })

    it('detects file overlap between active tasks', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['src/auth.ts', 'src/util.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['src/auth.ts'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')

      const overlaps = coord.detectOverlaps()
      expect(overlaps).toHaveLength(1)
      expect(overlaps[0].file).toBe('src/auth.ts')
      expect(overlaps[0].risk).toBe('medium')
      expect(overlaps[0].sessions).toHaveLength(2)
    })

    it('rates package.json overlap as high risk', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['package.json'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['package.json'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')

      const overlaps = coord.detectOverlaps()
      expect(overlaps[0].risk).toBe('high')
    })

    it('rates 3+ session overlap as high risk', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['shared.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['shared.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's3', taskId: 't3', files: ['shared.ts'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')
      coord.activateTask('t3')

      const overlaps = coord.detectOverlaps()
      expect(overlaps[0].risk).toBe('high')
    })

    it('normalizes path separators', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['src\\auth.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['src/auth.ts'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')

      const overlaps = coord.detectOverlaps()
      expect(overlaps).toHaveLength(1)
    })
  })

  describe('task dependency graph', () => {
    it('computes topological order', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: [], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: [], dependencies: ['t1'] })
      coord.registerSession({ sessionId: 's3', taskId: 't3', files: [], dependencies: ['t2'] })

      const topo = coord.getTopologicalOrder()
      expect(topo.order).toEqual(['t1', 't2', 't3'])
      expect(topo.blocked).toEqual([])
    })

    it('detects circular dependencies', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: [], dependencies: ['t3'] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: [], dependencies: ['t1'] })
      coord.registerSession({ sessionId: 's3', taskId: 't3', files: [], dependencies: ['t2'] })

      const topo = coord.getTopologicalOrder()
      expect(topo.blocked.length).toBeGreaterThan(0)
      expect(topo.cycles.length).toBeGreaterThan(0)
    })

    it('getDependencies returns upstream and downstream', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: [], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: [], dependencies: ['t1'] })
      coord.registerSession({ sessionId: 's3', taskId: 't3', files: [], dependencies: ['t2'] })

      const deps = coord.getDependencies('t2')
      expect(deps.upstream).toContain('t1')
      expect(deps.downstream).toContain('t3')
    })
  })

  describe('recordConflict', () => {
    it('records and persists conflict', () => {
      const conflict = coord.recordConflict({
        file: 'shared.ts',
        sessions: ['s1', 's2'],
        resolution: 'split-files',
        notes: 'Split into separate modules',
      })
      expect(conflict.id).toContain('CONFLICT-')
      expect(conflict.resolution).toBe('split-files')

      // Reload from disk
      const coord2 = new SessionCoordinator({ projectDir: dir, scaleDir: join(dir, '.scale') })
      const status = coord2.getCoordinationStatus()
      expect(status.conflicts).toHaveLength(1)
    })
  })

  describe('getCoordinationStatus', () => {
    it('returns comprehensive status', () => {
      coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['a.ts'], dependencies: [] })
      coord.registerSession({ sessionId: 's2', taskId: 't2', files: ['a.ts'], dependencies: [] })
      coord.activateTask('t1')
      coord.activateTask('t2')

      const status = coord.getCoordinationStatus()
      expect(status.activeSessions).toBe(2)
      expect(status.activeTasks).toHaveLength(2)
      expect(status.fileOverlaps).toHaveLength(1)
      expect(status.recommendations.length).toBeGreaterThan(0)
    })
  })
})

describe('summarizeCoordinationStatus', () => {
  it('produces readable report', () => {
    const dir = makeTempDir()
    const coord = new SessionCoordinator({ projectDir: dir, scaleDir: join(dir, '.scale') })
    coord.registerSession({ sessionId: 's1', taskId: 't1', files: ['a.ts'], dependencies: [] })
    coord.activateTask('t1')

    const text = summarizeCoordinationStatus(coord.getCoordinationStatus())
    expect(text).toContain('Session Coordination Status')
    expect(text).toContain('Active Sessions')
    expect(text).toContain('Active Tasks')
  })
})
