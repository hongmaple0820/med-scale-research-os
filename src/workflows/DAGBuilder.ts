// SCALE Engine — DAG Builder (v0.10.0)
// DAG 工作流构建器：解析依赖关系、检测并行执行机会

import type { WorkflowStepDef, DAGNode, DAGExecutionGraph } from '../agents/types.js'

/**
 * DAGBuilder — 构建 DAG 执行图
 * 
 * 核心功能：
 * - 解析 depends_on 依赖关系
 * - Topological 排序确定执行层级
 * - 检测循环依赖（抛出错误）
 * - 分组并行执行步骤
 */
export class DAGBuilder {
  /**
   * 构建 DAG 执行图
   * @param steps Workflow 步骤定义列表
   * @returns DAG 执行图（含层级分组）
   */
  buildGraph(steps: WorkflowStepDef[]): DAGExecutionGraph {
    // 1. 创建节点映射
    const nodes = new Map<string, DAGNode>()
    
    for (const step of steps) {
      nodes.set(step.id, {
        stepId: step.id,
        step,
        dependencies: step.depends_on || [],
        dependents: [], // 后续填充
        level: 0 // 后续计算
      })
    }
    
    // 2. 填充 dependents（反向依赖）
    for (const [id, node] of nodes) {
      for (const depId of node.dependencies) {
        const depNode = nodes.get(depId)
        if (depNode) {
          depNode.dependents.push(id)
        }
      }
    }
    
    // 3. 检测循环依赖
    for (const [id] of nodes) {
      if (this.hasCycle(nodes, id)) {
        throw new Error(`Circular dependency detected: ${id}`)
      }
    }
    
    // 4. 计算执行层级（Topological 排序）
    this.calculateLevels(nodes)
    
    // 5. 按层级分组
    const levels = this.groupByLevel(nodes)
    const maxLevel = levels.length - 1
    
    return { nodes, levels, maxLevel }
  }
  
  /**
   * 计算节点执行层级
   * Level 0 = 无依赖，可立即执行
   * Level N = 依赖 Level N-1 的节点
   */
  private calculateLevels(nodes: Map<string, DAGNode>): void {
    const visited = new Set<string>()
    
    // BFS 计算层级
    const queue: string[] = []
    
    // 找到所有 Level 0 节点（无依赖）
    for (const [id, node] of nodes) {
      if (node.dependencies.length === 0) {
        node.level = 0
        queue.push(id)
        visited.add(id)
      }
    }
    
    // 逐层计算
    while (queue.length > 0) {
      const currentId = queue.shift()!
      const currentNode = nodes.get(currentId)!
      
      // 更新依赖此节点的层级
      for (const depId of currentNode.dependents) {
        const depNode = nodes.get(depId)!
        if (!visited.has(depId)) {
          // 层级 = max(前置层级) + 1
          const maxDepLevel = Math.max(
            ...depNode.dependencies.map(d => nodes.get(d)?.level ?? 0)
          )
          depNode.level = maxDepLevel + 1
          visited.add(depId)
          queue.push(depId)
        }
      }
    }
  }
  
  /**
   * 检测循环依赖
   * DFS 检查是否存在回到起点路径
   */
  hasCycle(nodes: Map<string, DAGNode>, startId: string): boolean {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    
    const dfs = (id: string): boolean => {
      visited.add(id)
      recursionStack.add(id)
      
      const node = nodes.get(id)
      if (!node) return false
      
      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true
        } else if (recursionStack.has(depId)) {
          return true // 找到循环
        }
      }
      
      recursionStack.delete(id)
      return false
    }
    
    return dfs(startId)
  }
  
  /**
   * 按层级分组节点
   * 同层级节点可并行执行
   */
  groupByLevel(nodes: Map<string, DAGNode>): DAGNode[][] {
    const levelMap = new Map<number, DAGNode[]>()
    
    for (const [, node] of nodes) {
      const level = node.level
      if (!levelMap.has(level)) {
        levelMap.set(level, [])
      }
      levelMap.get(level)!.push(node)
    }
    
    // 转换为数组（按层级排序）
    const levels: DAGNode[][] = []
    for (let i = 0; i <= Math.max(...levelMap.keys()); i++) {
      levels.push(levelMap.get(i) || [])
    }
    
    return levels
  }
  
  /**
   * 获取并行执行分组
   * @param graph DAG 执行图
   * @returns 可并行执行的步骤 ID 数组（按层级）
   */
  getParallelGroups(graph: DAGExecutionGraph): string[][] {
    return graph.levels.map(level => level.map(n => n.stepId))
  }
  
  /**
   * 获取可立即执行的步骤（Level 0）
   */
  getReadySteps(graph: DAGExecutionGraph): WorkflowStepDef[] {
    const level0 = graph.levels[0]
    return level0?.map(n => n.step) || []
  }
  
  /**
   * 获取下一步可执行的步骤（当前层级完成后）
   * @param graph DAG 执行图
   * @param completedIds 已完成的步骤 IDs
   */
  getNextReadySteps(
    graph: DAGExecutionGraph,
    completedIds: Set<string>
  ): WorkflowStepDef[] {
    const ready: WorkflowStepDef[] = []
    
    for (const [id, node] of graph.nodes) {
      if (completedIds.has(id)) continue // 已完成
      
      // 检查是否所有依赖都已完成
      const allDepsCompleted = node.dependencies.every(depId => completedIds.has(depId))
      
      if (allDepsCompleted) {
        ready.push(node.step)
      }
    }
    
    return ready
  }
}

/** 默认 DAGBuilder 实例 */
export const defaultDAGBuilder = new DAGBuilder()
