export type GovernanceMode = 'minimal' | 'standard' | 'expanded' | 'critical'

export interface GovernanceRiskSignal {
  id: string
  mode: GovernanceMode
  reason: string
  evidence: string[]
}

export interface ProgressiveGovernanceInput {
  task?: string
  changedFiles?: string[]
  requestedMode?: GovernanceMode
}

export interface ProgressiveGovernanceReport {
  requestedMode?: GovernanceMode
  recommendedMode: GovernanceMode
  effectiveMode: GovernanceMode
  escalated: boolean
  signals: GovernanceRiskSignal[]
  requiredBehaviors: string[]
}

const MODE_ORDER: GovernanceMode[] = ['minimal', 'standard', 'expanded', 'critical']

export function normalizeGovernanceMode(value: unknown): GovernanceMode | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'minimal' || normalized === 'standard' || normalized === 'expanded' || normalized === 'critical') return normalized
  throw new Error(`Invalid governance mode "${String(value)}"; expected minimal, standard, expanded, or critical.`)
}

export function evaluateProgressiveGovernance(input: ProgressiveGovernanceInput = {}): ProgressiveGovernanceReport {
  const task = input.task ?? ''
  const changedFiles = (input.changedFiles ?? []).map(normalizePath).filter(Boolean)
  const signals = detectSignals(task, changedFiles)
  const recommendedMode = highestMode(signals.map(signal => signal.mode), changedFiles.length > 0 || task ? 'standard' : 'minimal')
  const requestedMode = input.requestedMode
  const effectiveMode = highestMode([recommendedMode, requestedMode].filter(Boolean) as GovernanceMode[], recommendedMode)
  return {
    requestedMode,
    recommendedMode,
    effectiveMode,
    escalated: Boolean(requestedMode && modeRank(recommendedMode) > modeRank(requestedMode)),
    signals,
    requiredBehaviors: requiredBehaviors(effectiveMode, signals),
  }
}

function detectSignals(task: string, changedFiles: string[]): GovernanceRiskSignal[] {
  const haystack = `${task} ${changedFiles.join(' ')}`.toLowerCase()
  const signals: GovernanceRiskSignal[] = []

  if (changedFiles.length === 0 && !task.trim()) {
    signals.push({
      id: 'no-task-context',
      mode: 'minimal',
      reason: 'No task text or changed files were provided.',
      evidence: [],
    })
    return signals
  }

  const lowRiskDocsOnly = isDocsOnly(changedFiles) && !/api|auth|security|release|deploy|database|migration|permission/.test(haystack)
  if (lowRiskDocsOnly) {
    signals.push({
      id: 'docs-only-low-risk',
      mode: 'minimal',
      reason: 'Only low-risk documentation files were provided.',
      evidence: changedFiles,
    })
  }

  if (!lowRiskDocsOnly && (changedFiles.length > 0 || task.trim())) {
    signals.push({
      id: 'normal-engineering-work',
      mode: 'standard',
      reason: 'Task has implementation or verification context.',
      evidence: changedFiles.slice(0, 8),
    })
  }

  if (changedFiles.length >= 6 || topLevelCount(changedFiles) >= 3) {
    signals.push({
      id: 'cross-module-scope',
      mode: 'expanded',
      reason: 'Changed files span enough paths to require broader impact analysis.',
      evidence: changedFiles.slice(0, 12),
    })
  }

  if (/ui|ux|frontend|browser|e2e|playwright|desktop|cua|screenshot|visual/.test(haystack)) {
    signals.push({
      id: 'interactive-or-visual-flow',
      mode: 'expanded',
      reason: 'Task touches UI, browser, E2E, desktop, or visual verification.',
      evidence: matchingEvidence(changedFiles, /ui|frontend|browser|e2e|playwright|desktop|visual/i),
    })
  }

  if (/public api|new api|contract|schema|sdk|breaking/.test(haystack)) {
    signals.push({
      id: 'public-interface-change',
      mode: 'expanded',
      reason: 'Task mentions public API, contract, schema, SDK, or breaking behavior.',
      evidence: matchingEvidence(changedFiles, /api|contract|schema|sdk/i),
    })
  }

  if (/auth|permission|secret|token|password|private key|database|migration|production|deploy|release|destructive|delete|drop table|truncate/.test(haystack)) {
    signals.push({
      id: 'critical-risk-domain',
      mode: 'critical',
      reason: 'Task touches auth, permissions, secrets, database, production, release, or destructive operations.',
      evidence: matchingEvidence(changedFiles, /auth|permission|secret|token|database|migration|config|deploy|release|delete/i),
    })
  }

  if (changedFiles.some(file => /\.(env|pem|key|crt)$/i.test(file) || /(^|\/)(migration|migrations|schema|auth|permission|config|deploy|release)(\/|\.|-|_)/i.test(file))) {
    signals.push({
      id: 'critical-file-path',
      mode: 'critical',
      reason: 'Changed file paths include critical config, auth, schema, migration, or secret-like files.',
      evidence: matchingEvidence(changedFiles, /\.(env|pem|key|crt)$/i),
    })
  }

  if (changedFiles.some(file => /\.(html|png|jpg|jpeg|gif|mp4|mov|zip|tar|gz)$/i.test(file) || /docs\/worklog|tmp|report|screenshot|artifact/i.test(file))) {
    signals.push({
      id: 'resource-lifecycle',
      mode: 'standard',
      reason: 'Generated reports, media, temporary files, or task artifacts require resource governance.',
      evidence: matchingEvidence(changedFiles, /\.(html|png|jpg|jpeg|gif|mp4|mov|zip|tar|gz)$/i),
    })
  }

  return dedupeSignals(signals)
}

function requiredBehaviors(mode: GovernanceMode, signals: GovernanceRiskSignal[]): string[] {
  const behaviors = new Set<string>()
  if (mode === 'minimal') {
    behaviors.add('run relevant validation only')
    return Array.from(behaviors)
  }
  behaviors.add('record verification evidence')
  behaviors.add('summarize context budget')
  if (mode === 'expanded' || mode === 'critical') {
    behaviors.add('attempt code intelligence or explain fallback')
    behaviors.add('run skill radar when tool, browser, UI, or external CLI signals apply')
  }
  if (mode === 'critical') {
    behaviors.add('run security review')
    behaviors.add('record rollback or disable strategy')
    behaviors.add('require human review for destructive, data, auth, or production changes')
  }
  if (signals.some(signal => signal.id === 'resource-lifecycle')) {
    behaviors.add('settle resource lifecycle')
  }
  if (signals.some(signal => signal.id === 'interactive-or-visual-flow')) {
    behaviors.add('collect browser, screenshot, or visual evidence')
  }
  return Array.from(behaviors)
}

function highestMode(modes: GovernanceMode[], fallback: GovernanceMode): GovernanceMode {
  if (modes.length === 0) return fallback
  return modes.reduce((current, next) => modeRank(next) > modeRank(current) ? next : current, modes[0])
}

function modeRank(mode?: GovernanceMode): number {
  return mode ? MODE_ORDER.indexOf(mode) : -1
}

function isDocsOnly(files: string[]): boolean {
  return files.length > 0 && files.every(file => /\.(md|mdx|txt)$/i.test(file) && /^(readme|docs\/|changelog|license)/i.test(file))
}

function topLevelCount(files: string[]): number {
  return new Set(files.map(file => file.split('/')[0]).filter(Boolean)).size
}

function matchingEvidence(files: string[], pattern: RegExp): string[] {
  return files.filter(file => pattern.test(file)).slice(0, 12)
}

function dedupeSignals(signals: GovernanceRiskSignal[]): GovernanceRiskSignal[] {
  const seen = new Set<string>()
  return signals.filter(signal => {
    if (seen.has(signal.id)) return false
    seen.add(signal.id)
    return true
  })
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').trim()
}
