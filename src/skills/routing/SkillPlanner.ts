import type {
  ResolvedSkillRoutingPolicy,
  SkillPlanExecutionPlan,
  SkillPlanExecutionStep,
  SkillPlan,
  SkillTaskLevel,
  TaskIntent,
  TaskIntentInput,
} from './SkillRoutingTypes.js'
import { TaskIntentClassifier } from './TaskIntentClassifier.js'

export interface CreateSkillPlanOptions extends TaskIntentInput {
  taskId: string
  taskName: string
  policy: ResolvedSkillRoutingPolicy
}

export function createSkillPlan(options: CreateSkillPlanOptions): SkillPlan {
  const level = options.level ?? 'M'
  const intents = new TaskIntentClassifier(options.policy).classify(options)
  const domainPolicies = intents.map(intent => options.policy.domains[intent.domain]).filter(Boolean)
  const required = options.policy.policy.requireSkillPlan && options.policy.policy.enforceLevels.includes(level)

  const requiredArtifacts = unique([
    ...(required ? ['skill-plan.md'] : []),
    ...domainPolicies.flatMap(policy => policy.requiredArtifacts ?? []),
  ])
  const recommendedArtifacts = unique(domainPolicies.flatMap(policy => policy.recommendedArtifacts ?? []))
  const requiredSkills = unique(domainPolicies.flatMap(policy => policy.requiredSkills ?? []))
  const recommendedSkills = unique(domainPolicies.flatMap(policy => policy.recommendedSkills ?? []))
    .filter(skill => !requiredSkills.includes(skill))
  const requiredVerification = unique(domainPolicies.flatMap(policy => policy.requiredVerification ?? []))

  return {
    taskId: options.taskId,
    taskName: options.taskName,
    level,
    intents,
    requiredSkills,
    recommendedSkills,
    requiredArtifacts,
    recommendedArtifacts,
    requiredVerification,
    mode: resolvePlanMode(level, intents, options.policy),
    required,
    executionPlan: createExecutionPlan({
      intents,
      requiredSkills,
      recommendedSkills,
      requiredArtifacts,
      recommendedArtifacts,
      requiredVerification,
    }),
    generatedAt: new Date().toISOString(),
  }
}

export function skillPlanMarkdown(plan: SkillPlan): string {
  const intentRows = plan.intents.length
    ? plan.intents.map(intent => `| ${intent.domain} | ${intent.score} | ${intent.reasons.join(', ')} |`).join('\n')
    : '| none | 0 | no domain-specific intent detected |'

  return `# Skill Plan

**Task ID**: ${plan.taskId}
**Task**: ${plan.taskName}
**Level**: ${plan.level}
**Mode**: ${plan.mode}
**Required**: ${plan.required ? 'yes' : 'no'}
**Generated**: ${plan.generatedAt}

## Detected Intents

| Domain | Score | Evidence |
| --- | ---: | --- |
${intentRows}

## Required Skills

${list(plan.requiredSkills)}

## Recommended Skills

${list(plan.recommendedSkills)}

## Required Artifacts

${list(plan.requiredArtifacts)}

## Recommended Artifacts

${list(plan.recommendedArtifacts)}

## Required Verification Evidence

${list(plan.requiredVerification)}

## Execution Plan

| Kind | ID | Required | Priority | Reason | Evidence | Fallback |
| --- | --- | --- | ---: | --- | --- | --- |
${executionRows(plan.executionPlan.steps)}

## Skipped Skills

No skipped skills recorded at plan time. Record runtime skips and fallback evidence in \`skill-evidence.md\`.
`
}

function createExecutionPlan(options: {
  intents: TaskIntent[]
  requiredSkills: string[]
  recommendedSkills: string[]
  requiredArtifacts: string[]
  recommendedArtifacts: string[]
  requiredVerification: string[]
}): SkillPlanExecutionPlan {
  const intentReason = options.intents.length
    ? `Detected intents: ${options.intents.map(intent => `${intent.domain}(${intent.score})`).join(', ')}.`
    : 'No domain-specific intent detected; keep evidence lightweight.'
  const steps: SkillPlanExecutionStep[] = []
  let priority = 100

  for (const skill of options.requiredSkills) {
    steps.push({
      kind: 'skill',
      id: skill,
      required: true,
      priority: priority--,
      reason: intentReason,
      evidenceRequired: 'Record used/executed status and concrete output path in skill-evidence.md.',
      fallback: 'If unavailable, record skipped/fallback status with manual evidence; block when routing mode is block.',
    })
  }
  for (const skill of options.recommendedSkills) {
    steps.push({
      kind: 'skill',
      id: skill,
      required: false,
      priority: priority--,
      reason: intentReason,
      evidenceRequired: 'Record used or skipped status when it materially affects delivery quality.',
      fallback: 'Use the nearest built-in verification or explain why the recommendation was not needed.',
    })
  }
  for (const artifact of options.requiredArtifacts) {
    steps.push({
      kind: 'artifact',
      id: artifact,
      required: true,
      priority: priority--,
      reason: 'Required artifact for task evidence and gate review.',
      evidenceRequired: `Write substantive ${artifact} content before verification or ship.`,
      fallback: 'No silent fallback; document accepted non-goal only when the gate policy allows it.',
    })
  }
  for (const artifact of options.recommendedArtifacts) {
    steps.push({
      kind: 'artifact',
      id: artifact,
      required: false,
      priority: priority--,
      reason: 'Recommended artifact for clearer review and future recall.',
      evidenceRequired: `Write ${artifact} when it reduces ambiguity or review risk.`,
      fallback: 'Mention omission in summary when the artifact is not useful for this task.',
    })
  }
  for (const verification of options.requiredVerification) {
    steps.push({
      kind: 'verification',
      id: verification,
      required: true,
      priority: priority--,
      reason: 'Required verification evidence for detected task intent.',
      evidenceRequired: `Attach command, screenshot, report, or reviewer evidence for ${verification}.`,
      fallback: 'If the verification cannot run, record the blocker and a lower-fidelity fallback.',
    })
  }

  return {
    strategy: 'intent-evidence-graph-v1',
    steps,
    fallbackPolicy: 'Required steps need concrete evidence or an explicit skipped/fallback record; recommended steps may be skipped with a reason.',
    evidenceSummary: unique(steps.map(step => step.evidenceRequired)),
  }
}

function executionRows(steps: SkillPlanExecutionStep[]): string {
  return steps.length
    ? steps.map(step => `| ${step.kind} | ${step.id} | ${step.required ? 'yes' : 'no'} | ${step.priority} | ${escapeMarkdownCell(step.reason)} | ${escapeMarkdownCell(step.evidenceRequired)} | ${escapeMarkdownCell(step.fallback)} |`).join('\n')
    : '| none | none | no | 0 | no routing step required | no extra evidence | continue with standard verification |'
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function resolvePlanMode(level: SkillTaskLevel, intents: TaskIntent[], policy: ResolvedSkillRoutingPolicy): 'off' | 'warn' | 'block' {
  if (policy.policy.mode === 'off') return 'off'
  if (policy.policy.mode === 'block') return 'block'
  const hasBlockingIntent = intents.some(intent => policy.domains[intent.domain]?.blockLevels?.includes(level))
  return hasBlockingIntent ? 'block' : 'warn'
}

function list(items: string[]): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : '- none'
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
