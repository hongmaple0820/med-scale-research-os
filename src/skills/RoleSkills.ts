// SCALE Engine — Role Skills (v0.33.0)
// Role-based skill perspectives for multi-angle review.
// Inspired by gstack's 23 expert roles (CEO reviewer, eng manager, QA lead, etc.)

// ============================================================================
// Types
// ============================================================================

export type SkillRole =
  | 'eng-manager'
  | 'security-reviewer'
  | 'qa-lead'
  | 'release-engineer'
  | 'design-reviewer'
  | 'ceo-reviewer'

export interface RolePerspective {
  role: SkillRole
  name: string
  description: string
  checklist: string[]
  riskFocus: string[]
  outputFormat: 'structured' | 'narrative' | 'checklist'
}

export interface RoleContext {
  task: string
  files?: string[]
  diff?: string
}

// ============================================================================
// Role Definitions
// ============================================================================

export const ROLE_PERSPECTIVES: Record<SkillRole, RolePerspective> = {
  'eng-manager': {
    role: 'eng-manager',
    name: 'Engineering Manager',
    description: 'Architecture consistency, dependency direction, test coverage, and team velocity impact.',
    checklist: [
      'Does the change follow existing architectural patterns?',
      'Are new dependencies justified and well-maintained?',
      'Is test coverage adequate for the change scope?',
      'Does the change affect shared modules or contracts?',
      'Are there any coupling risks between modules?',
    ],
    riskFocus: ['architecture-drift', 'dependency-risk', 'test-coverage-gap', 'coupling'],
    outputFormat: 'structured',
  },

  'security-reviewer': {
    role: 'security-reviewer',
    name: 'Security Reviewer',
    description: 'OWASP Top 10, STRIDE threat model, secret management, and input validation.',
    checklist: [
      'Are all user inputs validated and sanitized?',
      'Is authentication/authorization correctly enforced?',
      'Are secrets stored securely (no hardcoded credentials)?',
      'Is SQL/NoSQL injection prevented (parameterized queries)?',
      'Is XSS prevented (output encoding, CSP)?',
      'Is CSRF protection enabled where needed?',
      'Are error messages free of sensitive data leakage?',
      'Is rate limiting applied to public endpoints?',
      'Are file uploads validated and sandboxed?',
      'Is the principle of least privilege followed?',
    ],
    riskFocus: ['injection', 'auth-bypass', 'secret-exposure', 'xss', 'csrf', 'path-traversal'],
    outputFormat: 'checklist',
  },

  'qa-lead': {
    role: 'qa-lead',
    name: 'QA Lead',
    description: 'Boundary conditions, error paths, regression risk, and test quality.',
    checklist: [
      'Are boundary conditions tested (empty, null, max, min)?',
      'Are error paths covered (network failure, timeout, invalid input)?',
      'Is there regression risk from this change?',
      'Do tests cover both happy path and edge cases?',
      'Are async operations properly tested (race conditions, timeouts)?',
      'Is the change covered by integration or E2E tests if needed?',
    ],
    riskFocus: ['boundary-missing', 'error-path-gap', 'regression', 'async-risk'],
    outputFormat: 'checklist',
  },

  'release-engineer': {
    role: 'release-engineer',
    name: 'Release Engineer',
    description: 'Version bumping, changelog accuracy, CI/CD compatibility, and deployment safety.',
    checklist: [
      'Is the version bump appropriate for the change type (patch/minor/major)?',
      'Does the changelog accurately describe the changes?',
      'Are CI/CD pipelines compatible with the changes?',
      'Is the change safe for rolling deployment?',
      'Are database migrations backward-compatible?',
      'Are feature flags used for risky rollouts?',
    ],
    riskFocus: ['version-mismatch', 'ci-breakage', 'migration-risk', 'rollback-difficulty'],
    outputFormat: 'structured',
  },

  'design-reviewer': {
    role: 'design-reviewer',
    name: 'Design Reviewer',
    description: 'UX consistency, accessibility, visual regression, and user-facing quality.',
    checklist: [
      'Does the change maintain visual consistency with the design system?',
      'Are accessibility requirements met (ARIA, keyboard navigation, contrast)?',
      'Is the user flow intuitive and unbroken?',
      'Are loading states, error states, and empty states handled?',
      'Is the change responsive across breakpoints?',
    ],
    riskFocus: ['a11y-gap', 'visual-regression', 'ux-broken-flow', 'responsive-issue'],
    outputFormat: 'narrative',
  },

  'ceo-reviewer': {
    role: 'ceo-reviewer',
    name: 'CEO Reviewer',
    description: 'Strategic alignment, user value, competitive advantage, and business impact.',
    checklist: [
      'Does this change deliver measurable user value?',
      'Is the effort proportional to the impact?',
      'Does this align with product strategy and roadmap?',
      'Are there competitive advantages or risks?',
      'Is technical debt being managed or accumulated?',
    ],
    riskFocus: ['low-impact', 'strategy-misalignment', 'tech-debt-accumulation'],
    outputFormat: 'narrative',
  },
}

// ============================================================================
// Core Functions
// ============================================================================

export function getRolePerspective(role: SkillRole): RolePerspective {
  return ROLE_PERSPECTIVES[role]
}

export function getRoleChecklist(role: SkillRole): string[] {
  return ROLE_PERSPECTIVES[role].checklist
}

export function getAllRoles(): SkillRole[] {
  return Object.keys(ROLE_PERSPECTIVES) as SkillRole[]
}

export function applyRolePerspective(role: SkillRole, context: RoleContext): string {
  const perspective = ROLE_PERSPECTIVES[role]
  const lines: string[] = []

  lines.push(`## ${perspective.name} Review\n`)
  lines.push(`**Task:** ${context.task}\n`)

  if (context.files?.length) {
    lines.push(`**Files:** ${context.files.join(', ')}\n`)
  }

  lines.push('### Checklist\n')
  for (const item of perspective.checklist) {
    lines.push(`- [ ] ${item}`)
  }

  lines.push('\n### Risk Focus Areas\n')
  for (const risk of perspective.riskFocus) {
    lines.push(`- ${risk}`)
  }

  if (context.diff) {
    lines.push('\n### Diff Under Review\n')
    lines.push('```diff')
    lines.push(context.diff.slice(0, 2000))
    lines.push('```')
  }

  return lines.join('\n')
}

export function getRolesForPhase(phase: string): SkillRole[] {
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
