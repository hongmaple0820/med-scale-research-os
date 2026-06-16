// SCALE Engine — Python Bridge Core Engine (v1.0.0)
// Python-TS 桥接核心引擎：子进程管理 + JSON 协议通信 + 超时/重试

import { spawn, type ChildProcess } from 'child_process'
import { resolve, join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { logger } from '../core/logger.js'
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_BRIDGE_CONFIG,
  STAGE_CLI_MAP,
  type PythonBridgeConfig,
  type AnalysisStage,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeHealthStatus,
  type BridgeExecutionRecord,
  type BridgeExecutionStatus,
  type StageInput,
  type StageCheckpoint,
  type ProvenanceInfo,
  BridgeRequestSchema,
  BridgeResponseSchema,
  getStageInputSchema,
} from './types.js'

// ============================================================================
// PythonBridge — 核心桥接引擎
// ============================================================================

export class PythonBridge {
  private config: PythonBridgeConfig
  private executionRecords = new Map<string, BridgeExecutionRecord>()
  private checkpoints = new Map<string, StageCheckpoint>()

  constructor(config?: Partial<PythonBridgeConfig>) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config }
  }

  // ==========================================================================
  // Core: Execute a single analysis stage
  // ==========================================================================

  /**
   * 执行单个分析阶段
   *
   * 流程:
   *  1. 校验输入 (Zod)
   *  2. 构建 BridgeRequest
   *  3. Spawn Python 子进程
   *  4. 通过 stdin 传递 JSON 请求
   *  5. 从 stdout 读取 JSON 响应
   *  6. 校验响应 (Zod)
   *  7. 失败时重试
   *
   * @param stage 分析阶段
   * @param input 阶段输入参数
   * @param timeoutMs 超时毫秒（覆盖默认值）
   * @returns BridgeResponse
   */
  async executeStage(
    stage: AnalysisStage,
    input: StageInput,
    timeoutMs?: number,
  ): Promise<BridgeResponse> {
    const requestId = `bridge-${randomUUID().slice(0, 8)}`
    const effectiveTimeout = timeoutMs ?? this.config.defaultTimeoutMs

    // 1. 校验输入
    const inputSchema = getStageInputSchema(stage)
    const inputResult = inputSchema.safeParse(input)
    if (!inputResult.success) {
      const errorMsg = inputResult.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      return this._makeErrorResponse(requestId, stage, `Input validation failed: ${errorMsg}`)
    }

    // 2. 构建 BridgeRequest
    const request: BridgeRequest = {
      protocol: BRIDGE_PROTOCOL_VERSION,
      stage,
      input,
      timeout_ms: effectiveTimeout,
      output_schema: `${stage}_result_v1`,
      request_id: requestId,
    }

    // 3. 创建执行记录
    const record: BridgeExecutionRecord = {
      requestId,
      stage,
      status: 'pending',
      startedAt: Date.now(),
      retryCount: 0,
    }
    this.executionRecords.set(requestId, record)

    // 4. 执行（含重试）
    let lastError: string | undefined
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      record.retryCount = attempt
      record.status = 'running'

      try {
        const response = await this._spawnAndExecute(request, effectiveTimeout)

        // 校验响应
        const parseResult = BridgeResponseSchema.safeParse(response)
        if (!parseResult.success) {
          logger.warn(
            { requestId, stage, zodErrors: parseResult.error.issues },
            'Bridge response schema validation failed, accepting raw response',
          )
        }

        // 成功
        record.status = 'completed'
        record.completedAt = Date.now()
        record.durationMs = response.duration_ms

        return response
      } catch (err) {
        lastError = String(err)
        logger.warn(
          { requestId, stage, attempt, error: lastError },
          `Bridge execution attempt ${attempt + 1} failed`,
        )

        // 超时不重试
        if (lastError.includes('TIMEOUT')) {
          record.status = 'timeout'
          break
        }
      }
    }

    // 所有重试耗尽
    record.status = 'failed'
    record.completedAt = Date.now()
    record.error = lastError

    return this._makeErrorResponse(requestId, stage, lastError ?? 'Unknown error')
  }

  // ==========================================================================
  // Full Pipeline — 4-Stage 顺序执行
  // ==========================================================================

  /**
   * 执行完整 4-Stage Pipeline
   *
   * Stage 间自动传递数据:
   *  - expression → screening: normal_tissue_expression
   *  - expression → deep_research: ensg_id
   *  - expression + screening + deep_research → business: 各阶段输出
   *
   * 支持检查点恢复：如果指定 checkpoint，从上次中断的阶段继续
   */
  async executeFullPipeline(
    target: string,
    disease: string,
    cancerTypes: string[],
    options?: {
      ensgId?: string
      modality?: 'small_molecule' | 'antibody' | 'cell_therapy' | 'gene_therapy'
      riskLevel?: 'low' | 'medium' | 'high'
      checkpoint?: StageCheckpoint
    },
  ): Promise<{
    success: boolean
    stages: Partial<Record<AnalysisStage, BridgeResponse>>
    summary: { stages_completed: AnalysisStage[]; stages_failed: AnalysisStage[] }
    duration_ms: number
  }> {
    const startTime = Date.now()
    const stages: Partial<Record<AnalysisStage, BridgeResponse>> = {}
    const stageOrder: AnalysisStage[] = ['expression', 'screening', 'deep_research', 'business']

    // 确定从哪个阶段开始（检查点恢复）
    const completedStages = options?.checkpoint?.completedStages ?? []
    const startIndex = stageOrder.findIndex(s => !completedStages.includes(s))

    let ensgId = options?.ensgId

    for (let i = startIndex; i < stageOrder.length; i++) {
      const stage = stageOrder[i]

      // 根据阶段构建输入
      const input = this._buildStageInput(stage, target, disease, cancerTypes, ensgId, options, stages)

      const response = await this.executeStage(stage, input)
      stages[stage] = response

      if (!response.success) {
        // 阶段失败，记录检查点并终止
        this._saveCheckpoint('pipeline', {
          completedStages: stageOrder.slice(0, i).filter(s => stages[s]?.success) as AnalysisStage[],
          stageOutputPaths: {},
          createdAt: Date.now(),
        })
        break
      }

      // 提取 ensg_id 供后续阶段使用
      if (stage === 'expression' && response.data && typeof response.data === 'object') {
        const data = response.data as Record<string, unknown>
        if (data.ensg_id && typeof data.ensg_id === 'string') {
          ensgId = data.ensg_id
        }
      }
    }

    const completed = stageOrder.filter(s => stages[s]?.success) as AnalysisStage[]
    const failed = stageOrder.filter(s => stages[s] && !stages[s]!.success) as AnalysisStage[]

    return {
      success: failed.length === 0 && completed.length === stageOrder.length,
      stages,
      summary: { stages_completed: completed, stages_failed: failed },
      duration_ms: Date.now() - startTime,
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * 健康检查：验证 Python 环境和平台目录
   */
  async healthCheck(): Promise<BridgeHealthStatus> {
    const status: BridgeHealthStatus = {
      pythonAvailable: false,
      platformExists: false,
      apiHealth: {},
      lastChecked: new Date().toISOString(),
    }

    // 检查 Python 可用性
    try {
      const version = await this._getPythonVersion()
      status.pythonAvailable = true
      status.pythonVersion = version
    } catch {
      status.pythonAvailable = false
    }

    // 检查平台目录
    const platformPath = resolve(this.config.platformDir)
    status.platformExists = existsSync(join(platformPath, 'main.py'))

    return status
  }

  // ==========================================================================
  // Execution Records & Checkpoints
  // ==========================================================================

  /** 获取执行记录 */
  getExecutionRecord(requestId: string): BridgeExecutionRecord | undefined {
    return this.executionRecords.get(requestId)
  }

  /** 获取所有执行记录 */
  getAllExecutionRecords(): BridgeExecutionRecord[] {
    return Array.from(this.executionRecords.values())
  }

  /** 获取检查点 */
  getCheckpoint(projectId: string): StageCheckpoint | undefined {
    return this.checkpoints.get(projectId)
  }

  // ==========================================================================
  // Internal: Spawn Python Process
  // ==========================================================================

  /**
   * Spawn Python 子进程并执行请求
   *
   * 通信协议:
   *  TS → Python: 通过 stdin 传入 JSON 编码的 BridgeRequest + 换行符
   *  Python → TS: 通过 stdout 输出 JSON 编码的 BridgeResponse + 换行符
   *  日志/调试: Python stderr 直接透传
   */
  private _spawnAndExecute(
    request: BridgeRequest,
    timeoutMs: number,
  ): Promise<BridgeResponse> {
    return new Promise<BridgeResponse>((resolvePromise, reject) => {
      const platformPath = resolve(this.config.platformDir)
      const cliStage = STAGE_CLI_MAP[request.stage]

      // 构建 Python 命令参数
      // 使用 main.py --json 模式，通过 stdin 传入桥接请求
      const args = [
        join(platformPath, 'main.py'),
        cliStage,
        '--json',
      ]

      // 根据阶段添加参数
      const input = request.input as unknown as Record<string, unknown>
      if (request.stage === 'expression') {
        args.push('--gene', String(input.gene_symbol))
        args.push('--cancers', ...((input.cancer_types as string[]) || []))
        if (input.ensg_id) args.push('--ensg', String(input.ensg_id))
      } else if (request.stage === 'screening') {
        args.push('--disease', String(input.disease))
        if (input.exclude_targets) args.push('--exclude-targets', (input.exclude_targets as string[]).join(','))
        if (input.top_n) args.push('--top-n', String(input.top_n))
      } else if (request.stage === 'deep_research') {
        args.push('--target', String(input.target_name))
        if (input.ensg_id) args.push('--ensg', String(input.ensg_id))
        if (input.disease) args.push('--disease', String(input.disease))
      } else if (request.stage === 'business') {
        args.push('--target', String(input.target_name))
        if (input.disease) args.push('--disease', String(input.disease))
        if (input.modality) args.push('--modality', String(input.modality))
        if (input.risk_level) args.push('--risk-level', String(input.risk_level))
      }

      // 添加输出和缓存目录
      args.push('--output', resolve(this.config.outputDir, cliStage))
      args.push('--cache', resolve(this.config.cacheDir))

      logger.info({ requestId: request.request_id, stage: request.stage, args }, 'Spawning Python bridge process')

      const child: ChildProcess = spawn(this.config.pythonPath, args, {
        cwd: platformPath,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      // 超时计时器
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          child.kill('SIGTERM')
          reject(new Error(`TIMEOUT: Python bridge execution exceeded ${timeoutMs}ms`))
        }
      }, timeoutMs)

      // 收集 stdout
      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      // 收集 stderr（日志输出）
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        // 透传 Python 日志到 SCALE logger
        const lines = chunk.toString().split('\n').filter(l => l.trim())
        for (const line of lines) {
          logger.debug({ requestId: request.request_id, pyStderr: line }, '[python-bridge]')
        }
      })

      // 进程结束
      child.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        settled = true

        if (code !== 0 && !stdout.trim()) {
          // Python 进程异常退出且无 stdout 输出
          reject(new Error(
            `Python process exited with code ${code}. stderr: ${stderr.slice(-500)}`,
          ))
          return
        }

        // 解析 stdout JSON
        try {
          // 取 stdout 中最后一个完整的 JSON 对象
          // Python main.py --json 会将最终结果输出到 stdout
          const jsonStr = this._extractLastJson(stdout)
          if (!jsonStr) {
            reject(new Error(`No JSON output from Python process. stdout: ${stdout.slice(-200)}, stderr: ${stderr.slice(-200)}`))
            return
          }

          const raw = JSON.parse(jsonStr)
          const response: BridgeResponse = {
            protocol: BRIDGE_PROTOCOL_VERSION,
            request_id: request.request_id,
            success: raw.success ?? false,
            stage: request.stage,
            data: raw,
            error: raw.error,
            duration_ms: raw.duration_ms ?? (Date.now() - (this.executionRecords.get(request.request_id)?.startedAt ?? Date.now())),
          }

          resolvePromise(response)
        } catch (parseErr) {
          reject(new Error(
            `Failed to parse Python stdout: ${String(parseErr)}. stdout: ${stdout.slice(-200)}`,
          ))
        }
      })

      // 进程错误
      child.on('error', (err) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(new Error(`Failed to spawn Python process: ${err.message}`))
        }
      })

      // 通过 stdin 传入桥接请求（供 bridge_runner.py 使用）
      try {
        child.stdin!.write(JSON.stringify(request) + '\n')
        child.stdin!.end()
      } catch {
        // stdin 写入失败（如使用 main.py --json 模式时不依赖 stdin）
      }
    })
  }

  // ==========================================================================
  // Internal: Helpers
  // ==========================================================================

  /** 构建 Stage 输入参数 */
  private _buildStageInput(
    stage: AnalysisStage,
    target: string,
    disease: string,
    cancerTypes: string[],
    ensgId: string | undefined,
    options: {
      ensgId?: string
      modality?: 'small_molecule' | 'antibody' | 'cell_therapy' | 'gene_therapy'
      riskLevel?: 'low' | 'medium' | 'high'
    } | undefined,
    previousStages: Partial<Record<AnalysisStage, BridgeResponse>>,
  ): StageInput {
    switch (stage) {
      case 'expression':
        return {
          gene_symbol: target,
          cancer_types: cancerTypes,
          ensg_id: ensgId,
        }
      case 'screening':
        return {
          disease,
          exclude_targets: [target],
          top_n: 20,
        }
      case 'deep_research':
        return {
          target_name: target,
          ensg_id: ensgId,
          disease,
        }
      case 'business':
        return {
          target_name: target,
          disease,
          modality: options?.modality,
          risk_level: options?.riskLevel,
          stage1_data: previousStages.expression?.data,
          stage2_data: previousStages.screening?.data,
          stage3_data: previousStages.deep_research?.data,
        }
    }
  }

  /** 从 stdout 中提取最后一个完整的 JSON 对象 */
  private _extractLastJson(stdout: string): string | null {
    const trimmed = stdout.trim()
    if (!trimmed) return null

    // 如果整个 stdout 就是一个 JSON 对象
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
    }

    // 尝试从最后一行开始找 JSON
    const lines = trimmed.split('\n').filter(l => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith('{') && line.endsWith('}')) {
        return line
      }
    }

    // 最后手段：找最后一个 { 到最后一个 }
    const lastBrace = trimmed.lastIndexOf('}')
    const firstBrace = trimmed.indexOf('{')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1)
    }

    return null
  }

  /** 获取 Python 版本号 */
  private async _getPythonVersion(): Promise<string> {
    return new Promise<string>((resolveVersion, reject) => {
      const child = spawn(this.config.pythonPath, ['--version'], { stdio: 'pipe' })
      let output = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.on('close', (code) => {
        if (code === 0 && output.trim()) {
          resolveVersion(output.trim())
        } else {
          reject(new Error(`Python --version failed: ${output}`))
        }
      })
      child.on('error', reject)
    })
  }

  /** 构建错误响应 */
  private _makeErrorResponse(
    requestId: string,
    stage: AnalysisStage,
    error: string,
  ): BridgeResponse {
    return {
      protocol: BRIDGE_PROTOCOL_VERSION,
      request_id: requestId,
      success: false,
      stage,
      error,
      duration_ms: 0,
    }
  }

  /** 保存检查点 */
  private _saveCheckpoint(projectId: string, checkpoint: StageCheckpoint): void {
    this.checkpoints.set(projectId, checkpoint)
    logger.info({ projectId, completedStages: checkpoint.completedStages }, 'Checkpoint saved')
  }
}

/** 创建 PythonBridge 实例 */
export function createPythonBridge(config?: Partial<PythonBridgeConfig>): PythonBridge {
  return new PythonBridge(config)
}
