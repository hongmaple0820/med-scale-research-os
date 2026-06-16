// SCALE Engine — Adaptive Workflow Templates (v0.35.0)
// Composable workflow template system with profile-based selection

import type { WorkflowProfile } from './AdaptiveWorkflowRouter.js'

export type TemplateStepType = 'explore' | 'plan' | 'build' | 'verify' | 'review' | 'ship'
export type TemplateRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface WorkflowStepTemplate {
  id: string
  type: TemplateStepType
  name: string
  description: string
  required: boolean
  riskLevel: TemplateRiskLevel
  estimatedDuration: string
  evidenceRequired: string[]
  tools: string[]
  skipConditions?: string[]
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  profile: WorkflowProfile
  riskLevel: TemplateRiskLevel
  steps: WorkflowStepTemplate[]
  exitCriteria: string[]
  tags: string[]
}

export interface WorkflowTemplateInput {
  profile: WorkflowProfile
  task: string
  level: string
  files?: string[]
  riskFactors?: string[]
}

// ============================================================================
// Built-in Templates
// ============================================================================

const LIGHT_DOCS: WorkflowTemplate = {
  id: 'light-docs',
  name: 'Light Documentation',
  description: 'Lightweight template for documentation and config changes',
  profile: 'light',
  riskLevel: 'low',
  steps: [
    {
      id: 'explore',
      type: 'explore',
      name: 'Explore',
      description: 'Understand existing documentation structure',
      required: true,
      riskLevel: 'low',
      estimatedDuration: '5min',
      evidenceRequired: [],
      tools: ['Read', 'Glob'],
    },
    {
      id: 'build',
      type: 'build',
      name: 'Build',
      description: 'Write or update documentation',
      required: true,
      riskLevel: 'low',
      estimatedDuration: '15min',
      evidenceRequired: [],
      tools: ['Edit', 'Write'],
    },
    {
      id: 'verify',
      type: 'verify',
      name: 'Verify',
      description: 'Check links, formatting, and accuracy',
      required: false,
      riskLevel: 'low',
      estimatedDuration: '5min',
      evidenceRequired: [],
      tools: ['Read'],
      skipConditions: ['No structural changes'],
    },
  ],
  exitCriteria: ['Documentation updated and readable'],
  tags: ['docs', 'config', 'lightweight'],
}

const STANDARD_CODE: WorkflowTemplate = {
  id: 'standard-code',
  name: 'Standard Code',
  description: 'Standard template for typical code changes',
  profile: 'standard',
  riskLevel: 'medium',
  steps: [
    {
      id: 'explore',
      type: 'explore',
      name: 'Explore',
      description: 'Understand codebase structure and dependencies',
      required: true,
      riskLevel: 'low',
      estimatedDuration: '10min',
      evidenceRequired: [],
      tools: ['Read', 'Glob', 'Grep'],
    },
    {
      id: 'plan',
      type: 'plan',
      name: 'Plan',
      description: 'Design implementation approach',
      required: true,
      riskLevel: 'low',
      estimatedDuration: '10min',
      evidenceRequired: [],
      tools: ['Read'],
    },
    {
      id: 'build',
      type: 'build',
      name: 'Build',
      description: 'Implement changes with tests',
      required: true,
      riskLevel: 'medium',
      estimatedDuration: '30min',
      evidenceRequired: [],
      tools: ['Edit', 'Write', 'Bash'],
    },
    {
      id: 'verify',
      type: 'verify',
      name: 'Verify',
      description: 'Run tests and type checks',
      required: true,
      riskLevel: 'medium',
      estimatedDuration: '10min',
      evidenceRequired: ['test-results', 'typecheck-results'],
      tools: ['Bash'],
    },
    {
      id: 'review',
      type: 'review',
      name: 'Review',
      description: 'Code review for quality and security',
      required: false,
      riskLevel: 'medium',
      estimatedDuration: '10min',
      evidenceRequired: [],
      tools: ['Read', 'Grep'],
      skipConditions: ['Trivial changes under 20 lines'],
    },
  ],
  exitCriteria: ['All tests pass', 'Type check clean', 'Code reviewed'],
  tags: ['code', 'standard', 'feature'],
}

const STRICT_FEATURE: WorkflowTemplate = {
  id: 'strict-feature',
  name: 'Strict Feature',
  description: 'Strict template for high-risk features with full gates',
  profile: 'strict',
  riskLevel: 'high',
  steps: [
    {
      id: 'explore',
      type: 'explore',
      name: 'Explore',
      description: 'Deep codebase analysis with dependency mapping',
      required: true,
      riskLevel: 'low',
      estimatedDuration: '15min',
      evidenceRequired: [],
      tools: ['Read', 'Glob', 'Grep'],
    },
    {
      id: 'plan',
      type: 'plan',
      name: 'Plan',
      description: 'Detailed implementation plan with risk assessment',
      required: true,
      riskLevel: 'medium',
      estimatedDuration: '15min',
      evidenceRequired: ['risk-assessment'],
      tools: ['Read'],
    },
    {
      id: 'build',
      type: 'build',
      name: 'Build',
      description: 'Implement with TDD and defensive coding',
      required: true,
      riskLevel: 'high',
      estimatedDuration: '60min',
      evidenceRequired: [],
      tools: ['Edit', 'Write', 'Bash'],
    },
    {
      id: 'verify',
      type: 'verify',
      name: 'Verify',
      description: 'Full test suite + coverage + type check',
      required: true,
      riskLevel: 'high',
      estimatedDuration: '15min',
      evidenceRequired: ['test-results', 'typecheck-results', 'coverage-report'],
      tools: ['Bash'],
    },
    {
      id: 'review',
      type: 'review',
      name: 'Review',
      description: 'Multi-role review (eng-manager + security-reviewer)',
      required: true,
      riskLevel: 'high',
      estimatedDuration: '15min',
      evidenceRequired: ['review-report'],
      tools: ['Read', 'Grep'],
    },
    {
      id: 'ship',
      type: 'ship',
      name: 'Ship',
      description: 'Ship pipeline with version bump and PR',
      required: false,
      riskLevel: 'high',
      estimatedDuration: '10min',
      evidenceRequired: ['ship-report'],
      tools: ['Bash'],
      skipConditions: ['Not ready for release'],
    },
  ],
  exitCriteria: ['All tests pass', 'Coverage >= 80%', 'Security review passed', 'Code reviewed by 2+ roles'],
  tags: ['feature', 'strict', 'high-risk'],
}

const CRITICAL_SECURITY: WorkflowTemplate = {
  id: 'critical-security',
  name: 'Critical Security',
  description: 'Maximum security template for auth, crypto, and sensitive changes',
  profile: 'critical',
  riskLevel: 'critical',
  steps: [
    {
      id: 'explore',
      type: 'explore',
      name: 'Explore',
      description: 'Full codebase audit with OWASP/STRIDE analysis',
      required: true,
      riskLevel: 'medium',
      estimatedDuration: '20min',
      evidenceRequired: [],
      tools: ['Read', 'Glob', 'Grep'],
    },
    {
      id: 'plan',
      type: 'plan',
      name: 'Plan',
      description: 'Security-focused plan with threat model',
      required: true,
      riskLevel: 'high',
      estimatedDuration: '20min',
      evidenceRequired: ['threat-model', 'risk-assessment'],
      tools: ['Read'],
    },
    {
      id: 'build',
      type: 'build',
      name: 'Build',
      description: 'Implement with security-first patterns',
      required: true,
      riskLevel: 'critical',
      estimatedDuration: '60min',
      evidenceRequired: [],
      tools: ['Edit', 'Write', 'Bash'],
    },
    {
      id: 'verify',
      type: 'verify',
      name: 'Verify',
      description: 'Full test suite + security audit + dependency audit',
      required: true,
      riskLevel: 'critical',
      estimatedDuration: '20min',
      evidenceRequired: ['test-results', 'typecheck-results', 'security-audit', 'dependency-audit'],
      tools: ['Bash'],
    },
    {
      id: 'review',
      type: 'review',
      name: 'Review',
      description: 'Security-reviewer + eng-manager mandatory review',
      required: true,
      riskLevel: 'critical',
      estimatedDuration: '20min',
      evidenceRequired: ['security-review-report', 'architecture-review-report'],
      tools: ['Read', 'Grep'],
    },
    {
      id: 'ship',
      type: 'ship',
      name: 'Ship',
      description: 'Controlled ship with rollback plan',
      required: true,
      riskLevel: 'critical',
      estimatedDuration: '15min',
      evidenceRequired: ['ship-report', 'rollback-plan'],
      tools: ['Bash'],
    },
  ],
  exitCriteria: [
    'All tests pass',
    'Security audit clean',
    'OWASP Top 10 checked',
    'STRIDE analysis done',
    'Dependency audit clean',
    'Reviewed by security-reviewer',
    'Rollback plan documented',
  ],
  tags: ['security', 'critical', 'auth', 'crypto'],
}

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  'light-docs': LIGHT_DOCS,
  'standard-code': STANDARD_CODE,
  'strict-feature': STRICT_FEATURE,
  'critical-security': CRITICAL_SECURITY,
}

const PROFILE_TEMPLATE_MAP: Record<WorkflowProfile, string> = {
  light: 'light-docs',
  standard: 'standard-code',
  strict: 'strict-feature',
  critical: 'critical-security',
}

// ============================================================================
// Public API
// ============================================================================

export function selectTemplate(input: WorkflowTemplateInput): WorkflowTemplate {
  const { profile, task, level, riskFactors } = input

  // Check for security keywords → force critical template
  const securityKeywords = ['auth', 'security', 'crypto', 'password', 'token', 'secret', 'credential', 'oauth', 'jwt']
  const taskLower = task.toLowerCase()
  if (securityKeywords.some(kw => taskLower.includes(kw))) {
    return WORKFLOW_TEMPLATES['critical-security']
  }

  // Check for doc keywords → prefer light template
  const docKeywords = ['readme', 'docs', 'documentation', 'changelog', 'comment']
  if (docKeywords.some(kw => taskLower.includes(kw)) && profile === 'light') {
    return WORKFLOW_TEMPLATES['light-docs']
  }

  // Risk factor escalation
  if (riskFactors && riskFactors.length >= 3 && profileRank(profile) < profileRank('strict')) {
    return WORKFLOW_TEMPLATES['strict-feature']
  }

  // Level-based escalation
  if ((level === 'CRITICAL' || level === 'L') && profileRank(profile) < profileRank('strict')) {
    return WORKFLOW_TEMPLATES['strict-feature']
  }

  // Default: use profile mapping
  const templateId = PROFILE_TEMPLATE_MAP[profile] ?? 'standard-code'
  return WORKFLOW_TEMPLATES[templateId]
}

export function customizeTemplate(template: WorkflowTemplate, overrides: Partial<WorkflowTemplate>): WorkflowTemplate {
  return {
    ...template,
    ...overrides,
    steps: overrides.steps ?? template.steps,
    exitCriteria: overrides.exitCriteria ?? template.exitCriteria,
    tags: overrides.tags ?? template.tags,
  }
}

export function listTemplates(): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES)
}

export function getTemplateSteps(templateId: string): WorkflowStepTemplate[] {
  return WORKFLOW_TEMPLATES[templateId]?.steps ?? []
}

export function formatTemplateForAgent(template: WorkflowTemplate): string {
  const lines: string[] = [
    `# Workflow Template: ${template.name}`,
    '',
    `**Profile:** ${template.profile} | **Risk:** ${template.riskLevel}`,
    `**Description:** ${template.description}`,
    '',
    '## Steps',
    '',
  ]

  for (const step of template.steps) {
    const required = step.required ? '*(required)*' : '*(optional)*'
    lines.push(`### ${step.name} ${required}`)
    lines.push(`- **Type:** ${step.type}`)
    lines.push(`- **Risk:** ${step.riskLevel}`)
    lines.push(`- **Duration:** ${step.estimatedDuration}`)
    lines.push(`- **Description:** ${step.description}`)
    if (step.evidenceRequired.length > 0) {
      lines.push(`- **Evidence:** ${step.evidenceRequired.join(', ')}`)
    }
    if (step.skipConditions && step.skipConditions.length > 0) {
      lines.push(`- **Skip when:** ${step.skipConditions.join('; ')}`)
    }
    lines.push('')
  }

  lines.push('## Exit Criteria')
  for (const criteria of template.exitCriteria) {
    lines.push(`- ${criteria}`)
  }

  return lines.join('\n')
}

function profileRank(profile: WorkflowProfile): number {
  const order: WorkflowProfile[] = ['light', 'standard', 'strict', 'critical']
  return order.indexOf(profile)
}
