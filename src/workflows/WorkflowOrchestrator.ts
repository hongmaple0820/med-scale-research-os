// SCALE Engine — Workflow Orchestrator (v0.11.0)
// DAG 工作流编排器：解析 YAML 工作流、并行执行步骤、管理状态
// v0.11.0: 集成 PythonBridge，替换 simulateExecution 空壳

import type {
  WorkflowDefinition,
  WorkflowStepDef,
  WorkflowStepResult,
  WorkflowExecutionResult,
  DAGExecutionGraph,
  WorkflowLLMConfig
} from '../agents/types.js'
import { DAGBuilder } from './DAGBuilder.js'
import { AgentPool } from '../agents/AgentPool.js'
import { AgentDispatcher } from '../agents/AgentDispatcher.js'
import { PythonBridge } from '../bridge/PythonBridge.js'
import type { PythonBridgeConfig, AnalysisStage, BridgeResponse, StageInput } from '../bridge/types.js'
import { logger } from '../core/logger.js'

/** 医学研究步骤 role 前缀 — 匹配此前缀的步骤走 PythonBridge */
const MEDICAL_ROLE_PREFIX = 'medical/'

/**
 * WorkflowOrchestrator — 工作流编排器
 * 
 * 核心功能：
 * - 解析 YAML WorkflowDefinition
 * - 构建 DAG 执行图
 * - 并行执行无依赖步骤
 * - 管理步骤状态和输出变量
 * - 医学研究步骤通过 PythonBridge 调用 Python 分析引擎
 */
export class WorkflowOrchestrator {
  private dagBuilder = new DAGBuilder()
  private agentPool: AgentPool
  private dispatcher: AgentDispatcher
  private pythonBridge: PythonBridge | null = null
  private outputs = new Map<string, string>() // 输出变量存储
  private bridgeResponses = new Map<string, BridgeResponse>() // Python 桥接响应缓存
  
  constructor(agentPool: AgentPool, dispatcher: AgentDispatcher) {
    this.agentPool = agentPool
    this.dispatcher = dispatcher
  }

  /**
   * 启用 PythonBridge — 医学研究工作流必需
   * 
   * @param config 桥接配置（部分即可，缺省值自动补全）
   */
  enablePythonBridge(config?: Partial<PythonBridgeConfig>): void {
    this.pythonBridge = new PythonBridge(config)
    logger.info('PythonBridge enabled for medical research workflows')
  }

  /**
   * 获取 PythonBridge 实例（如已启用）
   */
  getPythonBridge(): PythonBridge | null {
    return this.pythonBridge
  }
  
  /**
   * 执行工作流
   * @param workflow Workflow 定义
   * @returns 执行结果
   */
  async execute(workflow: WorkflowDefinition): Promise<WorkflowExecutionResult> {
    const startTime = Date.now()
    const stepResults = new Map<string, WorkflowStepResult>()
    const executionLog: string[] = []
    
    executionLog.push(`[${new Date().toISOString()}] Workflow started: ${workflow.name}`)
    
    try {
      // 1. 构建 DAG 执行图
      const graph = this.dagBuilder.buildGraph(workflow.steps)
      executionLog.push(`[${new Date().toISOString()}] DAG built: ${graph.maxLevel + 1} levels, ${graph.nodes.size} nodes`)
      
      // 1.5 检测医学研究步骤，确保 PythonBridge 已启用
      const hasMedicalSteps = workflow.steps.some(s => s.role.startsWith(MEDICAL_ROLE_PREFIX))
      if (hasMedicalSteps && !this.pythonBridge) {
        // 自动启用 PythonBridge（使用默认配置）
        this.enablePythonBridge()
        executionLog.push(`[${new Date().toISOString()}] Auto-enabled PythonBridge for medical research steps`)
      }
      
      // 2. 初始化所有步骤状态为 pending
      for (const [id] of graph.nodes) {
        stepResults.set(id, {
          stepId: id,
          status: 'pending'
        })
      }
      
      // 3. 按层级并行执行
      const completedIds = new Set<string>()
      const concurrency = workflow.concurrency || 3
      
      for (const level of graph.levels) {
        // 同层级步骤可并行执行
        const parallelSteps = level.map(n => n.step)
        const batchSize = Math.min(parallelSteps.length, concurrency)
        
        executionLog.push(`[${new Date().toISOString()}] Level ${level[0]?.level}: Executing ${parallelSteps.length} steps (batch: ${batchSize})`)
        
        // 分批并行执行
        for (let i = 0; i < parallelSteps.length; i += batchSize) {
          const batch = parallelSteps.slice(i, i + batchSize)
          const batchResults = await Promise.all(
            batch.map(step => this.executeStep(step, workflow.llm, stepResults, executionLog))
          )
          
          // 收集输出变量
          for (const result of batchResults) {
            if (result.output) {
              const step = workflow.steps.find(s => s.id === result.stepId)
              if (step?.output) {
                this.outputs.set(step.output, result.output)
                executionLog.push(`[${new Date().toISOString()}] Output: ${step.output} = ${result.output.slice(0, 50)}...`)
              }
            }
            completedIds.add(result.stepId)
          }
        }
      }
      
      // 4. 统计结果
      const duration = Date.now() - startTime
      const completedSteps = Array.from(stepResults.values()).filter(r => r.status === 'completed').length
      const failedSteps = Array.from(stepResults.values()).filter(r => r.status === 'failed').length
      
      executionLog.push(`[${new Date().toISOString()}] Workflow completed: ${completedSteps}/${workflow.steps.length} steps, ${duration}ms`)
      
      return {
        workflowName: workflow.name,
        success: failedSteps === 0,
        totalSteps: workflow.steps.length,
        completedSteps,
        failedSteps,
        duration,
        stepResults,
        outputs: Object.fromEntries(this.outputs),
        executionLog
      }
      
    } catch (error) {
      const duration = Date.now() - startTime
      executionLog.push(`[${new Date().toISOString()}] Workflow failed: ${error}`)
      
      return {
        workflowName: workflow.name,
        success: false,
        totalSteps: workflow.steps.length,
        completedSteps: 0,
        failedSteps: workflow.steps.length,
        duration,
        stepResults,
        outputs: Object.fromEntries(this.outputs),
        executionLog
      }
    }
  }
  
  /**
   * 执行单个步骤
   * 
   * v0.11.0: 医学研究步骤 (role 以 "medical/" 开头) 通过 PythonBridge 执行
   */
  private async executeStep(
    step: WorkflowStepDef,
    llmConfig: WorkflowLLMConfig,
    stepResults: Map<string, WorkflowStepResult>,
    executionLog: string[]
  ): Promise<WorkflowStepResult> {
    const startTime = Date.now()
    const result: WorkflowStepResult = {
      stepId: step.id,
      status: 'running',
      retryCount: 0
    }
    
    stepResults.set(step.id, result)
    executionLog.push(`[${new Date().toISOString()}] Step ${step.id} started: role=${step.role}`)
    
    // ---- 医学研究步骤：走 PythonBridge ----
    if (step.role.startsWith(MEDICAL_ROLE_PREFIX) && this.pythonBridge) {
      return this._executeMedicalStep(step, result, startTime, stepResults, executionLog)
    }
    
    // ---- 通用步骤：走 Agent Pool ----
    try {
      // 1. 解析任务描述中的变量
      const resolvedTask = this.resolveVariables(step.task)
      
      // 2. 选择 Agent Profile
      const profileId = step.role.replace('engineering/', '').replace('roles/', '')
      
      // 3. Spawn Agent（如果池中没有空闲的）
      const idleAgents = this.agentPool.getIdleAgents(profileId)
      const agent = idleAgents.length > 0 
        ? idleAgents[0]
        : this.agentPool.spawn(profileId)
      
      result.agentId = agent.id
      
      // 4. 执行任务（模拟 - 实际应调用 LLM）
      const output = await this.simulateExecution(agent, resolvedTask, llmConfig)
      
      // 5. 完成
      result.status = 'completed'
      result.output = output
      result.duration = Date.now() - startTime
      
      this.agentPool.complete(agent.id, [])
      
      executionLog.push(`[${new Date().toISOString()}] Step ${step.id} completed: ${result.duration}ms`)
      
    } catch (error) {
      result.status = 'failed'
      result.error = String(error)
      result.duration = Date.now() - startTime
      
      executionLog.push(`[${new Date().toISOString()}] Step ${step.id} failed: ${error}`)
      
      // 重试逻辑
      const currentRetryCount = result.retryCount ?? 0
      if (step.retry && currentRetryCount < step.retry) {
        result.retryCount = currentRetryCount + 1
        executionLog.push(`[${new Date().toISOString()}] Step ${step.id} retrying (${result.retryCount}/${step.retry})`)
        return this.executeStep(step, llmConfig, stepResults, executionLog)
      }
    }
    
    return result
  }

  /**
   * 执行医学研究步骤 — 通过 PythonBridge 调用 Python 分析引擎
   * 
   * step.id 映射到 AnalysisStage:
   *   'expression'     → Stage 1: 表达分析
   *   'screening'      → Stage 2: 靶点筛选
   *   'deep_research'  → Stage 3: 深度调研
   *   'business'       → Stage 4: 商业规划
   */
  private async _executeMedicalStep(
    step: WorkflowStepDef,
    result: WorkflowStepResult,
    startTime: number,
    stepResults: Map<string, WorkflowStepResult>,
    executionLog: string[]
  ): Promise<WorkflowStepResult> {
    // step.id → AnalysisStage 映射
    const stageMap: Record<string, AnalysisStage> = {
      'expression': 'expression',
      'screening': 'screening',
      'deep_research': 'deep_research',
      'business': 'business',
    }
    const stage = stageMap[step.id]
    if (!stage) {
      result.status = 'failed'
      result.error = `Unknown medical step: ${step.id}`
      result.duration = Date.now() - startTime
      return result
    }

    try {
      // 构建阶段输入参数（从 outputs 变量中提取前序阶段输出）
      const input = this._buildMedicalStageInput(stage, step)

      const timeoutMs = (step.timeout ?? 300) * 1000
      const bridgeResponse = await this.pythonBridge!.executeStage(stage, input, timeoutMs)

      // 缓存桥接响应
      this.bridgeResponses.set(step.id, bridgeResponse)

      if (bridgeResponse.success) {
        result.status = 'completed'
        result.output = JSON.stringify(bridgeResponse.data)
        result.duration = bridgeResponse.duration_ms

        // 将结果存入输出变量
        if (step.output) {
          this.outputs.set(step.output, result.output!)
        }

        executionLog.push(
          `[${new Date().toISOString()}] Medical step ${step.id} completed via PythonBridge: ${result.duration}ms`,
        )
      } else {
        result.status = 'failed'
        result.error = bridgeResponse.error ?? 'Python bridge execution failed'
        result.duration = bridgeResponse.duration_ms

        executionLog.push(
          `[${new Date().toISOString()}] Medical step ${step.id} failed via PythonBridge: ${result.error}`,
        )

        // 重试逻辑
        const currentRetryCount = result.retryCount ?? 0
        if (step.retry && currentRetryCount < step.retry) {
          result.retryCount = currentRetryCount + 1
          executionLog.push(
            `[${new Date().toISOString()}] Medical step ${step.id} retrying (${result.retryCount}/${step.retry})`,
          )
          return this._executeMedicalStep(step, result, startTime, stepResults, executionLog)
        }
      }
    } catch (error) {
      result.status = 'failed'
      result.error = String(error)
      result.duration = Date.now() - startTime
      executionLog.push(`[${new Date().toISOString()}] Medical step ${step.id} error: ${error}`)
    }

    return result
  }

  /**
   * 构建医学研究阶段输入参数
   * 
   * 从 workflow context 和前序阶段的输出变量中提取参数
   */
  private _buildMedicalStageInput(
    stage: AnalysisStage,
    step: WorkflowStepDef,
  ): StageInput {
    // 从 task 模板中提取参数（如 {{target}}）
    const resolvedTask = this.resolveVariables(step.task)

    // 从输出变量中提取前序数据
    const expressionData = this.outputs.get('expression_result')
    const screeningData = this.outputs.get('screening_result')
    const deepResearchData = this.outputs.get('deep_research_result')

    const input: Record<string, unknown> = {}

    switch (stage) {
      case 'expression':
        // 表达分析需要 gene_symbol 和 cancer_types
        // 这些参数需要从 workflow context 或步骤参数中获取
        input.gene_symbol = resolvedTask  // 默认用任务描述，实际从 context 获取
        input.cancer_types = ['BRCA']     // 默认值，实际从 context 获取
        break
      case 'screening':
        input.disease = resolvedTask
        if (expressionData) {
          try {
            const expr = JSON.parse(expressionData)
            // 从 Stage1 结果中提取 normal_tissue_expression
            if (expr?.stages?.tissue_expression?.gtex?.data?.tissues) {
              input.normal_tissue_expression = expr.stages.tissue_expression.gtex.data.tissues
            }
          } catch { /* ignore parse errors */ }
        }
        break
      case 'deep_research':
        input.target_name = resolvedTask
        if (expressionData) {
          try {
            const expr = JSON.parse(expressionData)
            if (expr?.ensg_id) input.ensg_id = expr.ensg_id
          } catch { /* ignore */ }
        }
        break
      case 'business':
        input.target_name = resolvedTask
        if (expressionData) input.stage1_data = expressionData
        if (screeningData) input.stage2_data = screeningData
        if (deepResearchData) input.stage3_data = deepResearchData
        break
    }

    return input as unknown as StageInput
  }
  
  /**
   * 解析变量（{{output_name}} → 实际值）
   */
  private resolveVariables(template: string): string {
    let resolved = template
    for (const [name, value] of this.outputs) {
      resolved = resolved.replace(new RegExp(`\{\{${name}\}\}`, 'g'), value)
    }
    return resolved
  }
  
  /**
   * 模拟执行（实际应调用 LLM）
   * TODO: 集成真实 LLM 调用
   */
  private async simulateExecution(
    agent: { id: string; profile: { id: string } },
    task: string,
    llmConfig: WorkflowLLMConfig
  ): Promise<string> {
    // 模拟输出
    return `Simulated output from ${agent.profile.id} for task: ${task.slice(0, 30)}...`
  }
  
  /**
   * 获取输出变量
   */
  getOutput(name: string): string | undefined {
    return this.outputs.get(name)
  }
  
  /**
   * 清除输出变量
   */
  clearOutputs(): void {
    this.outputs.clear()
  }
}

/** 创建 WorkflowOrchestrator 实例 */
export function createWorkflowOrchestrator(
  agentPool: AgentPool,
  dispatcher: AgentDispatcher
): WorkflowOrchestrator {
  return new WorkflowOrchestrator(agentPool, dispatcher)
}
