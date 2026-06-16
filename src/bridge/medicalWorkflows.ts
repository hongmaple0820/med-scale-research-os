// SCALE Engine — Medical Research Workflow Presets (v1.0.0)
// 医学研究 4-Stage Pipeline 工作流预设
// 对应架构文档中的 4-Stage Pipeline DAG

import type { WorkflowDefinition, WorkflowStepDef, WorkflowLLMConfig } from '../agents/types.js'
import type { AnalysisStage, FullPipelineRequest } from '../bridge/types.js'

// ============================================================================
// LLM Config — 医学研究工作流 LLM 配置
// ============================================================================

const MEDICAL_RESEARCH_LLM: WorkflowLLMConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
}

// ============================================================================
// 4-Stage Pipeline Steps
// ============================================================================

/**
 * Stage 1: 表达分析 (Expression Analysis)
 *
 * 并行子步骤: GTEx + TCGA + HPA → 汇总 → 生存分析 + 免疫分析
 * 这些子步骤由 Python Stage1Pipeline 内部编排，
 * TS 侧只看到一个 "expression" 步骤
 */
const EXPRESSION_STEP: WorkflowStepDef = {
  id: 'expression',
  role: 'medical/expression-analyzer',
  task: '执行靶点表达全景与预后挖掘：GTEx组织表达、TCGA肿瘤差异、HPA蛋白验证、生存分析、免疫浸润',
  output: 'expression_result',
  retry: 2,
  timeout: 300,
}

/**
 * Stage 2: 靶点筛选 (Target Screening)
 *
 * 依赖 Stage 1 输出
 */
const SCREENING_STEP: WorkflowStepDef = {
  id: 'screening',
  role: 'medical/screening-analyzer',
  task: '执行多维靶点筛选与优先级排序：GEO差异表达、OpenTargets成药性、综合评分排序',
  output: 'screening_result',
  depends_on: ['expression'],
  retry: 2,
  timeout: 300,
}

/**
 * Stage 3: 深度调研 (Deep Research)
 *
 * 依赖 Stage 1 输出 (ensg_id)
 */
const DEEP_RESEARCH_STEP: WorkflowStepDef = {
  id: 'deep_research',
  role: 'medical/deep-researcher',
  task: '执行靶点深度调研与赛道格局分析：UniProt功能百科、PubMed文献综述、竞品分析',
  output: 'deep_research_result',
  depends_on: ['expression'],
  retry: 2,
  timeout: 300,
}

/**
 * Stage 4: 商业规划 (Business Planning)
 *
 * 依赖前三个阶段输出
 */
const BUSINESS_STEP: WorkflowStepDef = {
  id: 'business',
  role: 'medical/business-planner',
  task: '生成商业计划书与里程碑规划：整合前序分析数据、里程碑规划、竞品格局、商业计划书',
  output: 'business_result',
  depends_on: ['screening', 'deep_research'],
  retry: 1,
  timeout: 300,
}

// ============================================================================
// Workflow Definitions
// ============================================================================

/**
 * 完整医学研究管线 (4-Stage Sequential Pipeline)
 *
 * DAG:
 *   expression ─────────┬──→ screening ──┬──→ business
 *                       │                │
 *                       └──→ deep_research┘
 *
 * 注意: screening 和 deep_research 可以并行
 */
export const MEDICAL_RESEARCH_PIPELINE: WorkflowDefinition = {
  name: 'medical-research-pipeline',
  description: '药物靶点智能研究 4-Stage Pipeline: 表达分析→靶点筛选→深度调研→商业规划',
  version: '1.0.0',
  llm: MEDICAL_RESEARCH_LLM,
  concurrency: 2,
  inputs: [
    { name: 'target', required: true, description: '靶点基因符号 (如 CDK4)' },
    { name: 'disease', required: true, description: '疾病名称 (如 breast cancer)' },
    { name: 'cancer_types', required: true, description: '癌种代码列表 (如 BRCA LUAD)' },
    { name: 'ensg_id', required: false, description: 'Ensembl Gene ID' },
    { name: 'modality', required: false, default: 'small_molecule', description: '药物形式' },
    { name: 'risk_level', required: false, default: 'medium', description: '风险等级' },
  ],
  steps: [EXPRESSION_STEP, SCREENING_STEP, DEEP_RESEARCH_STEP, BUSINESS_STEP],
  output_dir: './output',
}

/**
 * 仅表达分析 (Stage 1)
 */
export const EXPRESSION_ONLY: WorkflowDefinition = {
  name: 'expression-analysis',
  description: '靶点表达全景与预后挖掘 (Stage 1 only)',
  version: '1.0.0',
  llm: MEDICAL_RESEARCH_LLM,
  concurrency: 1,
  inputs: [
    { name: 'gene_symbol', required: true, description: '基因符号' },
    { name: 'cancer_types', required: true, description: '癌种代码列表' },
    { name: 'ensg_id', required: false, description: 'Ensembl Gene ID' },
  ],
  steps: [EXPRESSION_STEP],
  output_dir: './output/stage1',
}

/**
 * 表达 + 筛选 (Stage 1+2)
 */
export const EXPRESSION_AND_SCREENING: WorkflowDefinition = {
  name: 'expression-and-screening',
  description: '表达分析 + 靶点筛选 (Stage 1+2)',
  version: '1.0.0',
  llm: MEDICAL_RESEARCH_LLM,
  concurrency: 1,
  inputs: [
    { name: 'target', required: true, description: '靶点基因符号' },
    { name: 'disease', required: true, description: '疾病名称' },
    { name: 'cancer_types', required: true, description: '癌种代码列表' },
  ],
  steps: [EXPRESSION_STEP, SCREENING_STEP],
  output_dir: './output',
}

// ============================================================================
// Workflow Registry
// ============================================================================

export const MEDICAL_WORKFLOWS: Record<string, WorkflowDefinition> = {
  [MEDICAL_RESEARCH_PIPELINE.name]: MEDICAL_RESEARCH_PIPELINE,
  [EXPRESSION_ONLY.name]: EXPRESSION_ONLY,
  [EXPRESSION_AND_SCREENING.name]: EXPRESSION_AND_SCREENING,
}

/**
 * 获取医学研究工作流定义
 */
export function getMedicalWorkflow(name: string): WorkflowDefinition | undefined {
  return MEDICAL_WORKFLOWS[name]
}

/**
 * 列出所有医学研究工作流
 */
export function listMedicalWorkflows(): WorkflowDefinition[] {
  return Object.values(MEDICAL_WORKFLOWS)
}
