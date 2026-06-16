export type SkillTaskLevel = 'S' | 'M' | 'L' | 'CRITICAL'
export type SkillRoutingMode = 'off' | 'warn' | 'block'

export interface SkillDomainDetectionPolicy {
  files?: string[]
  keywords?: string[]
  services?: string[]
}

export interface SkillDomainPolicy {
  detect?: SkillDomainDetectionPolicy
  appliesToLevels?: SkillTaskLevel[]
  blockLevels?: SkillTaskLevel[]
  requiredSkills?: string[]
  recommendedSkills?: string[]
  requiredArtifacts?: string[]
  recommendedArtifacts?: string[]
  requiredVerification?: string[]
}

export interface SkillRoutingPolicySettings {
  mode?: SkillRoutingMode
  enforceLevels?: SkillTaskLevel[]
  requireSkillPlan?: boolean
}

export interface SkillRoutingPolicyFile {
  version?: number
  policy?: SkillRoutingPolicySettings
  domains?: Record<string, SkillDomainPolicy>
}

export interface ResolvedSkillRoutingPolicy {
  version: number
  policy: Required<SkillRoutingPolicySettings>
  domains: Record<string, SkillDomainPolicy>
  warnings: string[]
}

export interface TaskIntentInput {
  description?: string
  files?: string[]
  services?: string[]
  level?: SkillTaskLevel
}

export interface TaskIntent {
  domain: string
  score: number
  reasons: string[]
}

export type SkillPlanExecutionStepKind = 'skill' | 'artifact' | 'verification'

export interface SkillPlanExecutionStep {
  kind: SkillPlanExecutionStepKind
  id: string
  required: boolean
  priority: number
  reason: string
  evidenceRequired: string
  fallback: string
}

export interface SkillPlanExecutionPlan {
  strategy: 'intent-evidence-graph-v1'
  steps: SkillPlanExecutionStep[]
  fallbackPolicy: string
  evidenceSummary: string[]
}

export interface SkillPlan {
  taskId: string
  taskName: string
  level: SkillTaskLevel
  intents: TaskIntent[]
  requiredSkills: string[]
  recommendedSkills: string[]
  requiredArtifacts: string[]
  recommendedArtifacts: string[]
  requiredVerification: string[]
  mode: SkillRoutingMode
  required: boolean
  executionPlan: SkillPlanExecutionPlan
  generatedAt: string
}

export interface SkillGateResult {
  mode: SkillRoutingMode
  applies: boolean
  checked: boolean
  complete: boolean
  blocked: boolean
  required: string[]
  missing: string[]
  incomplete: Array<{ file: string; reason: string }>
  warnings: string[]
}
