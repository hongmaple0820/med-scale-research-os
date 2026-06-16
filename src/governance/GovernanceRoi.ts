import type { ContextBudgetReport, ContextPack } from '../context/ContextBudget.js'
import type { CodeGraphQueryReport } from '../codegraph/CodeIntelligence.js'
import type { MemoryProviderRecallReport } from '../memory/MemoryProviders.js'
import type { SkillPlan } from '../skills/routing/index.js'
import type { ProgressiveGovernanceReport } from './ProgressiveGovernance.js'

export interface GovernanceRoiModule {
  module: string
  evidenceLevel: 'measured' | 'estimated' | 'missing'
  benefit: string
  overhead: string
  recommendation: 'keep-default' | 'keep-optional' | 'demote' | 'needs-evidence'
}

export interface GovernanceRoiReport {
  taskId?: string
  generatedAt: string
  summary: {
    evidenceLevel: 'measured' | 'estimated' | 'missing'
    recommendation: 'keep-default' | 'keep-optional' | 'demote' | 'needs-evidence'
  }
  modules: GovernanceRoiModule[]
}

export function createGovernanceRoiReport(options: {
  taskId?: string
  contextBudget?: ContextBudgetReport
  contextPack?: ContextPack
  codeIntelligence?: CodeGraphQueryReport
  governance?: ProgressiveGovernanceReport
  memoryRecall?: MemoryProviderRecallReport
  skillPlan?: SkillPlan
}): GovernanceRoiReport {
  const modules: GovernanceRoiModule[] = []

  if (options.contextBudget) {
    const budget = options.contextBudget
    modules.push({
      module: 'context-budget',
      evidenceLevel: 'estimated',
      benefit: `Visible context cost: ${budget.summary.totalTokens} estimated tokens across ${budget.summary.totalFiles} files; Always-loaded cost ${budget.summary.alwaysTokens}.`,
      overhead: 'One filesystem scan over governance and documentation artifacts.',
      recommendation: budget.summary.alwaysTokens <= budget.thresholds.maxAlwaysTokens ? 'keep-default' : 'needs-evidence',
    })
  } else {
    modules.push({
      module: 'context-budget',
      evidenceLevel: 'missing',
      benefit: 'No context budget evidence available.',
      overhead: 'Unknown.',
      recommendation: 'needs-evidence',
    })
  }

  if (options.contextPack?.compiler) {
    const compiler = options.contextPack.compiler
    modules.push({
      module: 'context-compiler',
      evidenceLevel: 'estimated',
      benefit: `Selected ${options.contextPack.sections.filter(section => section.included).length}/${options.contextPack.sections.length} context section(s); estimated savings ${compiler.estimatedTokenSavings} tokens from ${compiler.totalCandidateTokens} candidates.`,
      overhead: `One relevance ranking pass with ${compiler.ranking.length} candidate section(s).`,
      recommendation: compiler.estimatedTokenSavings > 0 ? 'keep-default' : 'keep-optional',
    })
  }

  if (options.governance) {
    const governance = options.governance
    modules.push({
      module: 'progressive-governance',
      evidenceLevel: 'estimated',
      benefit: `Recommended ${governance.recommendedMode} mode from ${governance.signals.length} risk signal(s); effective mode ${governance.effectiveMode}.`,
      overhead: `${governance.requiredBehaviors.length} required behavior(s) activated.`,
      recommendation: governance.effectiveMode === 'minimal' ? 'keep-default' : 'keep-optional',
    })
  } else {
    modules.push({
      module: 'progressive-governance',
      evidenceLevel: 'missing',
      benefit: 'No risk-signal evaluation available.',
      overhead: 'Unknown.',
      recommendation: 'needs-evidence',
    })
  }

  if (options.memoryRecall) {
    const memory = options.memoryRecall
    modules.push({
      module: 'memory-provider-runtime',
      evidenceLevel: memory.items.length > 0 ? 'estimated' : 'missing',
      benefit: memory.items.length > 0
        ? `Recalled ${memory.items.length} memory item(s) from ${memory.selectedProviders.join(', ') || 'no provider'}; fallback used: ${memory.fallbackUsed}.`
        : `No memory item recalled; provider order was ${memory.providerOrder.join(' -> ')}.`,
      overhead: `${memory.providerOrder.length} provider route(s), ${memory.warnings.length} warning(s).`,
      recommendation: memory.items.length > 0 ? 'keep-default' : 'keep-optional',
    })
  }

  if (options.skillPlan) {
    const plan = options.skillPlan
    modules.push({
      module: 'skill-routing-engine',
      evidenceLevel: plan.executionPlan.steps.length > 0 ? 'estimated' : 'missing',
      benefit: `Detected ${plan.intents.length} intent(s), ${plan.requiredSkills.length} required skill(s), and ${plan.executionPlan.steps.length} executable evidence step(s).`,
      overhead: `${plan.requiredArtifacts.length} required artifact(s), ${plan.requiredVerification.length} verification evidence item(s).`,
      recommendation: plan.requiredSkills.length > 0 || plan.requiredArtifacts.length > 0 ? 'keep-default' : 'keep-optional',
    })
  }

  if (options.codeIntelligence) {
    const code = options.codeIntelligence
    modules.push({
      module: 'code-intelligence',
      evidenceLevel: code.fallbackUsed ? 'estimated' : 'measured',
      benefit: code.fallbackUsed
        ? `No graph provider answered "${code.query}"; fallback found ${code.files.length} file(s) with ${code.roi.fileReadsSaved} estimated reads saved by scoping.`
        : `Graph provider ${code.provider} returned ${code.hits.length} hit(s), ${code.files.length} file(s), and ${code.roi.fileReadsSaved} estimated file reads saved.`,
      overhead: code.fallbackUsed ? 'One scoped source scan fallback.' : 'One code intelligence provider query.',
      recommendation: code.fallbackUsed ? 'needs-evidence' : 'keep-optional',
    })
  }

  const summary = summarize(modules)
  return {
    taskId: options.taskId,
    generatedAt: new Date().toISOString(),
    summary,
    modules,
  }
}

function summarize(modules: GovernanceRoiModule[]): GovernanceRoiReport['summary'] {
  if (modules.some(module => module.recommendation === 'needs-evidence')) {
    return { evidenceLevel: 'estimated', recommendation: 'needs-evidence' }
  }
  if (modules.some(module => module.recommendation === 'keep-optional')) {
    return { evidenceLevel: 'estimated', recommendation: 'keep-optional' }
  }
  return { evidenceLevel: 'estimated', recommendation: 'keep-default' }
}
