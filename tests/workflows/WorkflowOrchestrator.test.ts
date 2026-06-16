// WorkflowOrchestrator 测试

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkflowOrchestrator } from '../../src/workflows/WorkflowOrchestrator.js'
import { DAGBuilder } from '../../src/workflows/DAGBuilder.js'
import { AgentPool } from '../../src/agents/AgentPool.js'
import { AgentDispatcher } from '../../src/agents/AgentDispatcher.js'
import type { WorkflowDefinition, WorkflowLLMConfig } from '../../src/agents/types.js'

describe('WorkflowOrchestrator', () => {
  let orchestrator: WorkflowOrchestrator
  let mockAgentPool: AgentPool
  let mockDispatcher: AgentDispatcher

  beforeEach(() => {
    // 创建模拟 AgentPool
    mockAgentPool = {
      spawn: vi.fn((profileId) => ({
        id: `AGENT-${profileId}-1`,
        profile: { id: profileId },
        status: 'running'
      })),
      getIdleAgents: vi.fn(() => []),
      complete: vi.fn(),
      assignTask: vi.fn()
    } as any

    // 创建模拟 Dispatcher
    mockDispatcher = {
      dispatch: vi.fn(),
      resolveProfiles: vi.fn((task) => ['frontend-agent'])
    } as any

    orchestrator = new WorkflowOrchestrator(mockAgentPool, mockDispatcher)
  })

  describe('execute', () => {
    const llmConfig: WorkflowLLMConfig = {
      provider: 'claude-code',
      model: 'claude-sonnet-4'
    }

    it('执行单步骤工作流', async () => {
      const workflow: WorkflowDefinition = {
        name: 'simple-workflow',
        llm: llmConfig,
        steps: [
          { id: 'step-1', role: 'frontend-agent', task: 'Create UI' }
        ]
      }

      const result = await orchestrator.execute(workflow)

      expect(result.workflowName).toBe('simple-workflow')
      expect(result.success).toBe(true)
      expect(result.totalSteps).toBe(1)
      expect(result.completedSteps).toBe(1)
      expect(result.failedSteps).toBe(0)
    })

    it('执行并行步骤工作流', async () => {
      const workflow: WorkflowDefinition = {
        name: 'parallel-workflow',
        llm: llmConfig,
        concurrency: 3,
        steps: [
          { id: 'step-1', role: 'frontend-agent', task: 'UI' },
          { id: 'step-2', role: 'backend-agent', task: 'API' },
          { id: 'step-3', role: 'test-agent', task: 'Tests' }
        ]
      }

      const result = await orchestrator.execute(workflow)

      expect(result.success).toBe(true)
      expect(result.completedSteps).toBe(3)
      // 验证执行日志包含层级信息
      expect(result.executionLog.some(log => log.includes('Level 0:'))).toBe(true)
    })

    it('执行串行步骤工作流（有依赖）', async () => {
      const workflow: WorkflowDefinition = {
        name: 'serial-workflow',
        llm: llmConfig,
        steps: [
          { id: 'a', role: 'frontend-agent', task: 'A' },
          { id: 'b', role: 'backend-agent', task: 'B', depends_on: ['a'] },
          { id: 'c', role: 'test-agent', task: 'C', depends_on: ['b'] }
        ]
      }

      const result = await orchestrator.execute(workflow)

      expect(result.success).toBe(true)
      expect(result.completedSteps).toBe(3)
      // 验证执行日志包含层级信息
      expect(result.executionLog.some(log => log.includes('Level 0'))).toBe(true)
      expect(result.executionLog.some(log => log.includes('Level 1'))).toBe(true)
      expect(result.executionLog.some(log => log.includes('Level 2'))).toBe(true)
    })

    it('解析输出变量', async () => {
      const workflow: WorkflowDefinition = {
        name: 'output-workflow',
        llm: llmConfig,
        steps: [
          { id: 'analyze', role: 'frontend-agent', task: '分析代码', output: 'analysis_result' },
          { id: 'report', role: 'docs-agent', task: '基于 {{analysis_result}} 生成报告', depends_on: ['analyze'] }
        ]
      }

      const result = await orchestrator.execute(workflow)

      expect(result.success).toBe(true)
      expect(result.outputs['analysis_result']).toBeDefined()
    })
  })

  describe('resolveVariables', () => {
    it('解析 {{output}} 变量', async () => {
      // 先设置输出
      const workflow: WorkflowDefinition = {
        name: 'test',
        llm: { provider: 'claude-code' },
        steps: [
          { id: 'a', role: 'frontend-agent', task: 'Task A', output: 'var_a' },
          { id: 'b', role: 'frontend-agent', task: 'Use {{var_a}}', depends_on: ['a'] }
        ]
      }

      await orchestrator.execute(workflow)

      // 验证输出变量已设置
      expect(orchestrator.getOutput('var_a')).toBeDefined()
    })
  })

  describe('getOutput', () => {
    it('返回已设置的输出变量', async () => {
      const workflow: WorkflowDefinition = {
        name: 'output-test',
        llm: { provider: 'claude-code' },
        steps: [
          { id: 'step-1', role: 'frontend-agent', task: 'Task', output: 'output_1' }
        ]
      }

      await orchestrator.execute(workflow)

      expect(orchestrator.getOutput('output_1')).toBeDefined()
    })

    it('返回 undefined 对于未设置的变量', () => {
      expect(orchestrator.getOutput('nonexistent')).toBeUndefined()
    })
  })

  describe('clearOutputs', () => {
    it('清除所有输出变量', async () => {
      const workflow: WorkflowDefinition = {
        name: 'clear-test',
        llm: { provider: 'claude-code' },
        steps: [
          { id: 'step-1', role: 'frontend-agent', task: 'Task', output: 'output_1' }
        ]
      }

      await orchestrator.execute(workflow)
      orchestrator.clearOutputs()

      expect(orchestrator.getOutput('output_1')).toBeUndefined()
    })
  })
})
