// Tests for TaskDependencyGraph — dependency declaration, topological sort, cycle detection

import { describe, it, expect } from 'vitest'
import { TaskDependencyGraph } from '../../src/workflow/TaskDependencyGraph.js'
import type { TaskNode } from '../../src/workflow/TaskDependencyGraph.js'

function makeTask(id: string, overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    taskId: id,
    sessionId: `session-${id}`,
    files: [],
    status: 'planned',
    ...overrides,
  }
}

describe('TaskDependencyGraph', () => {
  describe('addTask / removeTask', () => {
    it('adds and retrieves a task', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      expect(graph.getTask('t1')?.taskId).toBe('t1')
    })

    it('removes task and its edges', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: 'test' })

      graph.removeTask('t1')
      expect(graph.getTask('t1')).toBeUndefined()
      expect(graph.listEdges()).toHaveLength(0)
    })

    it('throws when maxTasks exceeded', () => {
      const graph = new TaskDependencyGraph({ maxTasks: 2 })
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      expect(() => graph.addTask(makeTask('t3'))).toThrow('capacity')
    })
  })

  describe('addDependency', () => {
    it('adds valid dependency', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      const result = graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: 'test' })
      expect(result.ok).toBe(true)
    })

    it('rejects self-dependency', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      const result = graph.addDependency({ from: 't1', to: 't1', type: 'blocks', reason: 'test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Self-dependency')
    })

    it('rejects dependency on missing task', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      const result = graph.addDependency({ from: 't1', to: 'missing', type: 'blocks', reason: 'test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('rejects cyclic dependency', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: 'test' })

      const result = graph.addDependency({ from: 't2', to: 't1', type: 'blocks', reason: 'cycle' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('cycle')
    })
  })

  describe('topologicalSort', () => {
    it('sorts linear chain', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addTask(makeTask('t3'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: '' })
      graph.addDependency({ from: 't2', to: 't3', type: 'blocks', reason: '' })

      const topo = graph.topologicalSort()
      expect(topo.hasCycle).toBe(false)
      expect(topo.order).toEqual(['t1', 't2', 't3'])
      expect(topo.levels).toEqual([['t1'], ['t2'], ['t3']])
    })

    it('identifies parallel tasks', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addTask(makeTask('t3'))
      graph.addDependency({ from: 't1', to: 't3', type: 'blocks', reason: '' })
      graph.addDependency({ from: 't2', to: 't3', type: 'blocks', reason: '' })

      const topo = graph.topologicalSort()
      expect(topo.levels[0]).toContain('t1')
      expect(topo.levels[0]).toContain('t2')
      expect(topo.levels[1]).toEqual(['t3'])
    })

    it('detects cycle', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addTask(makeTask('t3'))
      // Manually push edges to create a cycle (bypassing cycle check)
      graph['edges'].push(
        { from: 't1', to: 't2', type: 'blocks', reason: '' },
        { from: 't2', to: 't3', type: 'blocks', reason: '' },
        { from: 't3', to: 't1', type: 'blocks', reason: '' },
      )

      const topo = graph.topologicalSort()
      expect(topo.hasCycle).toBe(true)
      expect(topo.cyclePath).toBeDefined()
    })
  })

  describe('getBlockedTasks / getReadyTasks', () => {
    it('identifies blocked tasks', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: 'needs t1' })

      const blocked = graph.getBlockedTasks()
      expect(blocked).toHaveLength(1)
      expect(blocked[0].taskId).toBe('t2')
      expect(blocked[0].waitingFor).toContain('t1')
    })

    it('identifies ready tasks', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addTask(makeTask('t3'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: '' })
      graph.addDependency({ from: 't2', to: 't3', type: 'blocks', reason: '' })

      expect(graph.getReadyTasks()).toEqual(['t1'])
    })

    it('ready tasks update when deps complete', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: '' })

      expect(graph.getReadyTasks()).toEqual(['t1'])
      graph.updateTaskStatus('t1', 'done')
      expect(graph.getReadyTasks()).toEqual(['t2'])
    })
  })

  describe('summarize', () => {
    it('returns correct summary', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1', { status: 'done' }))
      graph.addTask(makeTask('t2', { status: 'active' }))
      graph.addTask(makeTask('t3'))
      graph.addDependency({ from: 't1', to: 't3', type: 'blocks', reason: '' })
      graph.addDependency({ from: 't2', to: 't3', type: 'blocks', reason: '' })

      const summary = graph.summarize()
      expect(summary.totalTasks).toBe(3)
      expect(summary.totalEdges).toBe(2)
      expect(summary.completedTasks).toBe(1)
      expect(summary.activeTasks).toBe(1)
      expect(summary.blockedTasks).toBe(1)
    })
  })

  describe('serialization', () => {
    it('roundtrips through JSON', () => {
      const graph = new TaskDependencyGraph()
      graph.addTask(makeTask('t1'))
      graph.addTask(makeTask('t2'))
      graph.addDependency({ from: 't1', to: 't2', type: 'blocks', reason: 'test' })

      const json = graph.toJSON()
      const restored = TaskDependencyGraph.fromJSON(json)
      expect(restored.getTask('t1')?.taskId).toBe('t1')
      expect(restored.listEdges()).toHaveLength(1)
    })
  })
})
