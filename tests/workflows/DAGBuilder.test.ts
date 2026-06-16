// DAGBuilder 测试

import { describe, it, expect } from 'vitest'
import { DAGBuilder } from '../../src/workflows/DAGBuilder.js'
import type { WorkflowStepDef } from '../../src/agents/types.js'

describe('DAGBuilder', () => {
  const builder = new DAGBuilder()

  describe('buildGraph', () => {
    it('构建单步骤 DAG', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'step-1', role: 'frontend-agent', task: 'Create UI' }
      ]

      const graph = builder.buildGraph(steps)

      expect(graph.nodes.size).toBe(1)
      expect(graph.maxLevel).toBe(0)
      expect(graph.levels).toHaveLength(1)
      expect(graph.levels[0]).toHaveLength(1)
      expect(graph.levels[0][0].stepId).toBe('step-1')
    })

    it('构建并行步骤 DAG（无依赖）', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'step-1', role: 'frontend-agent', task: 'Create UI' },
        { id: 'step-2', role: 'backend-agent', task: 'Create API' },
        { id: 'step-3', role: 'test-agent', task: 'Write tests' }
      ]

      const graph = builder.buildGraph(steps)

      expect(graph.nodes.size).toBe(3)
      expect(graph.maxLevel).toBe(0) // 所有步骤 Level 0（可并行）
      expect(graph.levels).toHaveLength(1)
      expect(graph.levels[0]).toHaveLength(3) // 3 个并行步骤
    })

    it('构建串行步骤 DAG（有依赖）', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'step-1', role: 'frontend-agent', task: 'Create UI' },
        { id: 'step-2', role: 'backend-agent', task: 'Create API', depends_on: ['step-1'] },
        { id: 'step-3', role: 'test-agent', task: 'Write tests', depends_on: ['step-2'] }
      ]

      const graph = builder.buildGraph(steps)

      expect(graph.nodes.size).toBe(3)
      expect(graph.maxLevel).toBe(2) // step-1(0) -> step-2(1) -> step-3(2)
      expect(graph.levels).toHaveLength(3)
      expect(graph.levels[0]).toHaveLength(1) // step-1
      expect(graph.levels[1]).toHaveLength(1) // step-2
      expect(graph.levels[2]).toHaveLength(1) // step-3
    })

    it('构建混合 DAG（部分并行）', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'frontend', role: 'frontend-agent', task: 'UI' },
        { id: 'backend', role: 'backend-agent', task: 'API' },
        { id: 'test-ui', role: 'test-agent', task: 'Test UI', depends_on: ['frontend'] },
        { id: 'test-api', role: 'test-agent', task: 'Test API', depends_on: ['backend'] },
        { id: 'review', role: 'code-review-agent', task: 'Review', depends_on: ['test-ui', 'test-api'] }
      ]

      const graph = builder.buildGraph(steps)

      expect(graph.nodes.size).toBe(5)
      expect(graph.maxLevel).toBe(2) // Level 0: frontend/backend | Level 1: test-ui/test-api | Level 2: review
      expect(graph.levels).toHaveLength(3)
      
      // Level 0: 2 个并行
      expect(graph.levels[0]).toHaveLength(2)
      const level0Ids = graph.levels[0].map(n => n.stepId)
      expect(level0Ids).toContain('frontend')
      expect(level0Ids).toContain('backend')
      
      // Level 1: 2 个并行
      expect(graph.levels[1]).toHaveLength(2)
      const level1Ids = graph.levels[1].map(n => n.stepId)
      expect(level1Ids).toContain('test-ui')
      expect(level1Ids).toContain('test-api')
      
      // Level 2: 1 个依赖两个
      expect(graph.levels[2]).toHaveLength(1)
      expect(graph.levels[2][0].stepId).toBe('review')
    })
  })

  describe('hasCycle', () => {
    it('检测无循环', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A', depends_on: ['b'] },
        { id: 'b', role: 'frontend-agent', task: 'B', depends_on: ['c'] },
        { id: 'c', role: 'frontend-agent', task: 'C' }
      ]

      const graph = builder.buildGraph(steps)
      expect(graph.maxLevel).toBe(2) // c(0) -> b(1) -> a(2)
    })

    it('检测循环依赖并抛出错误', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A', depends_on: ['b'] },
        { id: 'b', role: 'frontend-agent', task: 'B', depends_on: ['c'] },
        { id: 'c', role: 'frontend-agent', task: 'C', depends_on: ['a'] } // 循环!
      ]

      expect(() => builder.buildGraph(steps)).toThrow('Circular dependency detected')
    })

    it('检测自循环', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A', depends_on: ['a'] } // 自循环!
      ]

      expect(() => builder.buildGraph(steps)).toThrow('Circular dependency detected')
    })
  })

  describe('getParallelGroups', () => {
    it('返回并行分组', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A' },
        { id: 'b', role: 'backend-agent', task: 'B' },
        { id: 'c', role: 'test-agent', task: 'C', depends_on: ['a', 'b'] }
      ]

      const graph = builder.buildGraph(steps)
      const groups = builder.getParallelGroups(graph)

      expect(groups).toHaveLength(2)
      expect(groups[0]).toEqual(['a', 'b']) // Level 0: a 和 b 可并行
      expect(groups[1]).toEqual(['c'])      // Level 1: c 依赖 a 和 b
    })
  })

  describe('getReadySteps', () => {
    it('返回 Level 0 步骤', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A' },
        { id: 'b', role: 'backend-agent', task: 'B', depends_on: ['a'] }
      ]

      const graph = builder.buildGraph(steps)
      const ready = builder.getReadySteps(graph)

      expect(ready).toHaveLength(1)
      expect(ready[0].id).toBe('a')
    })
  })

  describe('getNextReadySteps', () => {
    it('返回依赖完成后的下一步', () => {
      const steps: WorkflowStepDef[] = [
        { id: 'a', role: 'frontend-agent', task: 'A' },
        { id: 'b', role: 'backend-agent', task: 'B', depends_on: ['a'] },
        { id: 'c', role: 'test-agent', task: 'C', depends_on: ['b'] }
      ]

      const graph = builder.buildGraph(steps)
      
      // 完成 a 后，b 可执行
      const completedA = new Set(['a'])
      const nextAfterA = builder.getNextReadySteps(graph, completedA)
      expect(nextAfterA).toHaveLength(1)
      expect(nextAfterA[0].id).toBe('b')
      
      // 完成 a 和 b 后，c 可执行
      const completedAB = new Set(['a', 'b'])
      const nextAfterAB = builder.getNextReadySteps(graph, completedAB)
      expect(nextAfterAB).toHaveLength(1)
      expect(nextAfterAB[0].id).toBe('c')
    })
  })
})
