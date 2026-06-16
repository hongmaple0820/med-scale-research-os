// SCALE Engine — Python-TS Bridge Protocol Types (v1.0.0)
// Python-TS 桥接协议类型定义
// 协议版本: scale-analysis-v1

import { z } from 'zod'

// ============================================================================
// 1. Bridge Protocol Constants
// ============================================================================

/** 桥接协议版本 */
export const BRIDGE_PROTOCOL_VERSION = 'scale-analysis-v1' as const

/** 默认超时 (5 分钟) */
export const DEFAULT_STAGE_TIMEOUT_MS = 300_000

/** 最大重试次数 */
export const MAX_RETRIES = 2

/** 心跳间隔 (秒) */
export const HEARTBEAT_INTERVAL_S = 30

// ============================================================================
// 2. Stage Types — 对应 4-Stage Pipeline
// ============================================================================

/** 分析阶段标识 */
export type AnalysisStage = 'expression' | 'screening' | 'deep_research' | 'business'

/** 所有支持的分析阶段 */
export const ANALYSIS_STAGES = ['expression', 'screening', 'deep_research', 'business'] as const

/** 阶段中文标签 */
export const STAGE_LABELS: Record<AnalysisStage, string> = {
  expression: '靶点表达全景与预后挖掘',
  screening: '多维靶点筛选与优先级排序',
  deep_research: '靶点深度调研与赛道格局分析',
  business: '商业计划书与里程碑规划',
}

/** 阶段 CLI 子命令映射 (→ Python main.py 子命令) */
export const STAGE_CLI_MAP: Record<AnalysisStage, string> = {
  expression: 'stage1',
  screening: 'stage2',
  deep_research: 'stage3',
  business: 'stage4',
}

// ============================================================================
// 3. Bridge Request / Response DTOs
// ============================================================================

/**
 * 桥接请求 — TS → Python
 * 
 * 通过 stdin JSON 传递给 Python 进程
 */
export interface BridgeRequest {
  /** 协议版本 */
  protocol: typeof BRIDGE_PROTOCOL_VERSION
  /** 分析阶段 */
  stage: AnalysisStage
  /** 阶段输入参数 */
  input: StageInput
  /** 超时毫秒 */
  timeout_ms: number
  /** 期望的输出 schema 标识 */
  output_schema: string
  /** 请求 ID (用于追踪) */
  request_id: string
}

/**
 * 桥接响应 — Python → TS
 * 
 * Python 进程通过 stdout 输出
 */
export interface BridgeResponse {
  /** 协议版本 */
  protocol: typeof BRIDGE_PROTOCOL_VERSION
  /** 对应的请求 ID */
  request_id: string
  /** 是否成功 */
  success: boolean
  /** 阶段标识 */
  stage: AnalysisStage
  /** 分析结果（成功时） */
  data?: unknown
  /** 错误信息（失败时） */
  error?: string
  /** 错误详情 */
  error_details?: {
    type: string
    message: string
    traceback?: string
  }
  /** 执行耗时 (ms) */
  duration_ms: number
  /** 数据溯源信息 */
  provenance?: ProvenanceInfo[]
}

// ============================================================================
// 4. Stage Input Types — 每个 Stage 的输入参数
// ============================================================================

/** Stage 1: 表达分析输入 */
export interface ExpressionStageInput {
  gene_symbol: string
  cancer_types: string[]
  ensg_id?: string
}

/** Stage 2: 靶点筛选输入 */
export interface ScreeningStageInput {
  disease: string
  exclude_targets?: string[]
  top_n?: number
  normal_tissue_expression?: Record<string, number>
}

/** Stage 3: 深度调研输入 */
export interface DeepResearchStageInput {
  target_name: string
  ensg_id?: string
  disease?: string
}

/** Stage 4: 商业规划输入 */
export interface BusinessStageInput {
  target_name: string
  disease?: string
  modality?: 'small_molecule' | 'antibody' | 'cell_therapy' | 'gene_therapy'
  risk_level?: 'low' | 'medium' | 'high'
  /** 前序阶段输出（可选传入） */
  stage1_data?: unknown
  stage2_data?: unknown
  stage3_data?: unknown
}

/** 联合类型 — 任意 Stage 输入 */
export type StageInput =
  | ExpressionStageInput
  | ScreeningStageInput
  | DeepResearchStageInput
  | BusinessStageInput

// ============================================================================
// 5. Bridge Configuration
// ============================================================================

/** Python 桥接配置 */
export interface PythonBridgeConfig {
  /** Python 可执行文件路径 */
  pythonPath: string
  /** target-research-platform 目录（含 main.py） */
  platformDir: string
  /** 缓存目录 */
  cacheDir: string
  /** 输出目录 */
  outputDir: string
  /** 默认超时 (ms) */
  defaultTimeoutMs: number
  /** 最大重试次数 */
  maxRetries: number
  /** 环境变量 */
  env?: Record<string, string>
}

/** 默认桥接配置 */
export const DEFAULT_BRIDGE_CONFIG: PythonBridgeConfig = {
  pythonPath: 'python',
  platformDir: './target-research-platform',
  cacheDir: './cache',
  outputDir: './output',
  defaultTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
}

// ============================================================================
// 6. Health & Status Types
// ============================================================================

/** 桥接健康状态 */
export interface BridgeHealthStatus {
  /** Python 进程是否可用 */
  pythonAvailable: boolean
  /** Python 版本 */
  pythonVersion?: string
  /** target-research-platform 是否存在 */
  platformExists: boolean
  /** 各 API 数据源健康状态 */
  apiHealth: Record<string, boolean>
  /** 上次检查时间 */
  lastChecked: string
}

/** 桥接执行状态 */
export type BridgeExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'

/** 单次桥接执行记录 */
export interface BridgeExecutionRecord {
  /** 请求 ID */
  requestId: string
  /** 分析阶段 */
  stage: AnalysisStage
  /** 执行状态 */
  status: BridgeExecutionStatus
  /** 开始时间 */
  startedAt: number
  /** 结束时间 */
  completedAt?: number
  /** 耗时 (ms) */
  durationMs?: number
  /** 重试次数 */
  retryCount: number
  /** 错误信息 */
  error?: string
  /** 检查点数据（用于断点恢复） */
  checkpoint?: StageCheckpoint
}

// ============================================================================
// 7. Checkpoint Types — 检查点恢复
// ============================================================================

/** 阶段检查点 */
export interface StageCheckpoint {
  /** 已完成的阶段 */
  completedStages: AnalysisStage[]
  /** 各阶段输出快照路径 */
  stageOutputPaths: Partial<Record<AnalysisStage, string>>
  /** 检查点创建时间 */
  createdAt: number
  /** 关联的研究项目 ID */
  projectId?: string
}

// ============================================================================
// 8. Provenance Types — 数据溯源
// ============================================================================

/** 溯源信息 */
export interface ProvenanceInfo {
  /** 数据源名称 */
  source: string
  /** API 端点 */
  endpoint: string
  /** 请求参数 */
  params: Record<string, unknown>
  /** 查询时间戳 */
  timestamp: string
  /** 请求哈希 */
  request_hash: string
}

// ============================================================================
// 9. Zod Schemas — 运行时校验
// ============================================================================

/** BridgeRequest Zod Schema */
export const BridgeRequestSchema = z.object({
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  stage: z.enum(ANALYSIS_STAGES),
  input: z.record(z.unknown()),
  timeout_ms: z.number().positive(),
  output_schema: z.string().min(1),
  request_id: z.string().min(1),
})

/** BridgeResponse Zod Schema */
export const BridgeResponseSchema = z.object({
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  request_id: z.string(),
  success: z.boolean(),
  stage: z.enum(ANALYSIS_STAGES),
  data: z.unknown().optional(),
  error: z.string().optional(),
  error_details: z.object({
    type: z.string(),
    message: z.string(),
    traceback: z.string().optional(),
  }).optional(),
  duration_ms: z.number().nonnegative(),
  provenance: z.array(z.object({
    source: z.string(),
    endpoint: z.string(),
    params: z.record(z.unknown()),
    timestamp: z.string(),
    request_hash: z.string(),
  })).optional(),
})

/** ExpressionStageInput Zod Schema */
export const ExpressionStageInputSchema = z.object({
  gene_symbol: z.string().min(1),
  cancer_types: z.array(z.string()).min(1),
  ensg_id: z.string().optional(),
})

/** ScreeningStageInput Zod Schema */
export const ScreeningStageInputSchema = z.object({
  disease: z.string().min(1),
  exclude_targets: z.array(z.string()).optional(),
  top_n: z.number().int().positive().optional(),
  normal_tissue_expression: z.record(z.number()).optional(),
})

/** DeepResearchStageInput Zod Schema */
export const DeepResearchStageInputSchema = z.object({
  target_name: z.string().min(1),
  ensg_id: z.string().optional(),
  disease: z.string().optional(),
})

/** BusinessStageInput Zod Schema */
export const BusinessStageInputSchema = z.object({
  target_name: z.string().min(1),
  disease: z.string().optional(),
  modality: z.enum(['small_molecule', 'antibody', 'cell_therapy', 'gene_therapy']).optional(),
  risk_level: z.enum(['low', 'medium', 'high']).optional(),
  stage1_data: z.unknown().optional(),
  stage2_data: z.unknown().optional(),
  stage3_data: z.unknown().optional(),
})

/** 根据 stage 类型获取对应的 Zod Schema */
export function getStageInputSchema(stage: AnalysisStage): z.ZodSchema {
  switch (stage) {
    case 'expression': return ExpressionStageInputSchema
    case 'screening': return ScreeningStageInputSchema
    case 'deep_research': return DeepResearchStageInputSchema
    case 'business': return BusinessStageInputSchema
  }
}

// ============================================================================
// 10. Full Pipeline Types — 完整管线编排
// ============================================================================

/** 完整管线请求 */
export interface FullPipelineRequest {
  /** 靶点基因名 */
  target: string
  /** 疾病名 */
  disease: string
  /** 癌种代码列表 */
  cancer_types: string[]
  /** Ensembl Gene ID (可选) */
  ensg_id?: string
  /** 药物形式 */
  modality?: 'small_molecule' | 'antibody' | 'cell_therapy' | 'gene_therapy'
  /** 风险等级 */
  risk_level?: 'low' | 'medium' | 'high'
}

/** 完整管线响应 */
export interface FullPipelineResponse {
  success: boolean
  target: string
  disease: string
  stages: Partial<Record<AnalysisStage, BridgeResponse>>
  summary: {
    stages_completed: AnalysisStage[]
    stages_failed: AnalysisStage[]
  }
  duration_ms: number
}
