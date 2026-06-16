import type { WorkflowTaskLevel } from './WorkflowArtifactWriter.js'
import type { SkillRole } from '../skills/RoleSkills.js'

export type WorkflowGuidancePhase = 'explore' | 'plan' | 'build' | 'verify' | 'review' | 'ship'

export interface WorkflowGuidanceItem {
  id: string
  phase: WorkflowGuidancePhase
  required: boolean
  reason: string
  command: string
  role?: SkillRole
}

export interface WorkflowGuidance {
  taskId: string
  level: WorkflowTaskLevel
  items: WorkflowGuidanceItem[]
  requiredCommandCount: number
}

export interface WorkflowGuidanceInput {
  taskId: string
  description: string
  level: WorkflowTaskLevel
  artifactDir?: string
  files?: string[]
  skillIntents?: string[]
  requiredSkillVerification?: string[]
}

const BUG_TERMS = [
  'bug',
  'fix',
  'error',
  'fail',
  'failure',
  '404',
  '500',
  'crash',
  'regression',
  'exception',
  '修复',
  '报错',
  '失败',
  '异常',
  '回归',
]

const TOOL_EVIDENCE_DOMAINS = new Set([
  'ui-ux',
  'frontend',
  'browser-automation',
  'e2e',
  'visual-qa',
  'design',
])

export function createWorkflowGuidance(input: WorkflowGuidanceInput): WorkflowGuidance {
  const items: WorkflowGuidanceItem[] = []
  const normalizedLevel = input.level

  if (normalizedLevel !== 'S') {
    items.push({
      id: 'context-grill',
      phase: 'explore',
      required: true,
      reason: 'M/L/CRITICAL work needs current-context alignment before editing.',
      command: joinCommand([
        'scale',
        'context',
        'grill',
        '--task-id',
        input.taskId,
        '--task',
        input.description,
        ...artifactArgs(input.artifactDir),
        ...filesArgs(input.files),
        '--write',
      ]),
    })

    if (isBugLike(input.description)) {
      items.push({
        id: 'diagnostic-loop',
        phase: 'plan',
        required: true,
        reason: 'Bug work needs a reproducible failure, competing hypotheses, and cleanup/verification commands.',
        command: joinCommand([
          'scale',
          'diagnose',
          'plan',
          '--task-id',
          input.taskId,
          '--symptom',
          input.description,
          '--repro',
          '<reproduction command>',
          '--expected-failure',
          '<expected failure>',
          ...artifactArgs(input.artifactDir),
          ...filesArgs(input.files),
          '--write',
        ]),
      })
    }

    items.push({
      id: 'tdd-slice',
      phase: 'build',
      required: true,
      reason: 'Behavior-changing work needs RED/GREEN/REFACTOR evidence or an explicit non-applicability reason.',
      command: joinCommand([
        'scale',
        'tdd',
        'slice',
        '--task-id',
        input.taskId,
        '--behavior',
        input.description,
        '--public-interface',
        '<public interface>',
        '--failing-test',
        '<failing test command>',
        '--test-file',
        '<test file>',
        '--impl-files',
        implFilesValue(input.files),
        ...artifactArgs(input.artifactDir),
        '--write',
      ]),
    })

    if (needsToolEvidence(input)) {
      items.push({
        id: 'tool-evidence',
        phase: 'verify',
        required: Boolean(input.requiredSkillVerification?.length),
        reason: 'Selected skill domains require executable tool evidence instead of prose-only claims.',
        command: joinCommand([
          'scale',
          'tool',
          'run',
          '--task-id',
          input.taskId,
          '--task',
          input.description,
          '--level',
          input.level,
          ...filesArgs(input.files),
        ]),
      })
    }
  }

  items.push({
    id: 'verification',
    phase: 'verify',
    required: true,
    reason: 'Completion claims require real verification output.',
    command: `scale verify ${input.taskId}`,
  })

  return {
    taskId: input.taskId,
    level: normalizedLevel,
    items,
    requiredCommandCount: items.filter(item => item.required).length,
  }
}

export function renderWorkflowGuidance(guidance: WorkflowGuidance): string {
  if (!guidance.items.length) return ''

  const lines = ['Next workflow commands:']
  for (const item of guidance.items) {
    const marker = item.required ? 'required' : 'recommended'
    lines.push(`   - [${marker}] ${item.command}`)
    lines.push(`     reason: ${item.reason}`)
  }
  return lines.join('\n')
}

function isBugLike(description: string): boolean {
  const lower = description.toLowerCase()
  return BUG_TERMS.some(term => lower.includes(term.toLowerCase()))
}

function needsToolEvidence(input: WorkflowGuidanceInput): boolean {
  if (input.requiredSkillVerification?.length) return true
  return (input.skillIntents ?? []).some(intent => TOOL_EVIDENCE_DOMAINS.has(intent))
}

function artifactArgs(artifactDir?: string): string[] {
  return artifactDir ? ['--artifact-dir', artifactDir] : []
}

function filesArgs(files?: string[]): string[] {
  const normalized = (files ?? []).filter(Boolean)
  return normalized.length ? ['--files', normalized.join(',')] : []
}

function implFilesValue(files?: string[]): string {
  const normalized = (files ?? []).filter(Boolean)
  return normalized.length ? normalized.join(',') : '<impl files>'
}

function joinCommand(parts: string[]): string {
  return parts.map(quoteArg).join(' ')
}

function quoteArg(value: string): string {
  if (!value) return '""'
  if (/^[A-Za-z0-9_./:@=,+-]+$/.test(value)) return value
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

// ============================================================================
// Role-Based Guidance
// ============================================================================

export function getRoleGuidanceForPhase(phase: WorkflowGuidancePhase): SkillRole[] {
  switch (phase) {
    case 'explore':
      return ['eng-manager']
    case 'plan':
      return ['ceo-reviewer', 'eng-manager']
    case 'build':
      return []
    case 'verify':
      return ['qa-lead', 'security-reviewer']
    case 'review':
      return ['eng-manager', 'security-reviewer']
    case 'ship':
      return ['release-engineer']
    default:
      return []
  }
}

export function createRoleGuidanceItem(
  role: SkillRole,
  phase: WorkflowGuidancePhase,
  taskId: string,
  description: string,
): WorkflowGuidanceItem {
  return {
    id: `role-${role}`,
    phase,
    required: phase === 'review' || phase === 'verify',
    reason: `${role} perspective ensures multi-angle review coverage.`,
    command: `scale review --role ${role} --task-id ${taskId}`,
    role,
  }
}
