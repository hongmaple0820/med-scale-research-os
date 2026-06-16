import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

export type ContextFindingSeverity = 'error' | 'warn' | 'info'
export type ContextQuestionTopic = 'domain-language' | 'module-boundary' | 'acceptance-evidence' | 'risk-and-rollback'

export interface ContextFinding {
  code: string
  severity: ContextFindingSeverity
  message: string
  path?: string
}

export interface ContextGrillQuestion {
  id: string
  topic: ContextQuestionTopic
  question: string
  reason: string
  blocking: boolean
}

export interface ModuleDocStatus {
  moduleName: string
  productDocPath: string
  architectureDocPath: string
  productDocExists: boolean
  architectureDocExists: boolean
}

export interface ContextGovernanceReport {
  ok: boolean
  projectDir: string
  request: string
  contextPath?: string
  contextMapPath?: string
  terms: string[]
  moduleDocs: ModuleDocStatus[]
  findings: ContextFinding[]
  questions: ContextGrillQuestion[]
  requiredArtifacts: string[]
}

export interface AnalyzeContextGovernanceInput {
  projectDir: string
  request: string
  changedFiles?: string[]
}

export interface WriteContextGovernanceTemplatesInput {
  projectDir: string
  projectName?: string
  force?: boolean
}

export interface WriteContextGovernanceTemplatesResult {
  created: string[]
  skipped: string[]
}

const CONTEXT_CANDIDATES = ['CONTEXT.md', 'docs/CONTEXT.md']
const CONTEXT_MAP_CANDIDATES = ['CONTEXT-MAP.md', 'docs/CONTEXT-MAP.md']

export function analyzeContextGovernance(input: AnalyzeContextGovernanceInput): ContextGovernanceReport {
  const projectDir = input.projectDir
  const contextPath = firstExisting(projectDir, CONTEXT_CANDIDATES)
  const contextMapPath = firstExisting(projectDir, CONTEXT_MAP_CANDIDATES)
  const findings: ContextFinding[] = []
  const terms = contextPath ? parseContextTerms(readFileSync(contextPath, 'utf-8')) : []
  const contextMap = contextMapPath ? parseContextMap(readFileSync(contextMapPath, 'utf-8')) : new Map<string, Partial<ModuleDocStatus>>()
  const moduleDocs = resolveModuleDocs(projectDir, input.changedFiles ?? [], contextMap)

  if (!contextPath) {
    findings.push({
      code: 'missing-context-doc',
      severity: 'error',
      message: 'Missing CONTEXT.md. Domain language, aliases, and rejected meanings are not durable.',
    })
  }
  if (!contextMapPath) {
    findings.push({
      code: 'missing-context-map',
      severity: 'error',
      message: 'Missing CONTEXT-MAP.md. Module ownership and product/architecture document links are not durable.',
    })
  }
  for (const doc of moduleDocs) {
    if (!doc.productDocExists || !doc.architectureDocExists) {
      findings.push({
        code: 'missing-module-doc',
        severity: 'error',
        path: doc.moduleName,
        message: `Module ${doc.moduleName} is touched but product or architecture docs are missing.`,
      })
    }
  }

  const questions = buildContextQuestions(input.request, findings, moduleDocs)
  const requiredArtifacts = unique([
    !contextPath ? 'CONTEXT.md' : undefined,
    !contextMapPath ? 'CONTEXT-MAP.md' : undefined,
    ...moduleDocs.flatMap(doc => [
      doc.productDocExists ? undefined : doc.productDocPath,
      doc.architectureDocExists ? undefined : doc.architectureDocPath,
    ]),
  ].filter(Boolean) as string[])

  return {
    ok: !findings.some(finding => finding.severity === 'error'),
    projectDir,
    request: input.request,
    contextPath,
    contextMapPath,
    terms,
    moduleDocs,
    findings,
    questions,
    requiredArtifacts,
  }
}

export function renderContextGrillPrompt(report: ContextGovernanceReport): string {
  const lines: string[] = []
  lines.push('# Context Grill')
  lines.push('')
  lines.push(`Request: ${report.request}`)
  lines.push(`Status: ${report.ok ? 'ready' : 'blocked'}`)
  lines.push('')
  lines.push('## Evidence')
  lines.push(`- CONTEXT.md: ${report.contextPath ?? 'missing'}`)
  lines.push(`- CONTEXT-MAP.md: ${report.contextMapPath ?? 'missing'}`)
  if (report.terms.length > 0) lines.push(`- Terms: ${report.terms.join(', ')}`)
  for (const finding of report.findings) {
    lines.push(`- [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`)
  }
  lines.push('')
  lines.push('## Questions')
  for (const question of report.questions) {
    const marker = question.blocking ? 'BLOCKING' : 'CHECK'
    lines.push(`- [${marker}] ${question.question}`)
    lines.push(`  Reason: ${question.reason}`)
  }
  return lines.join('\n')
}

export function writeContextGovernanceTemplates(input: WriteContextGovernanceTemplatesInput): WriteContextGovernanceTemplatesResult {
  const projectName = input.projectName ?? 'Project'
  const files = new Map<string, string>([
    ['CONTEXT.md', contextTemplate(projectName)],
    ['docs/CONTEXT-MAP.md', contextMapTemplate(projectName)],
  ])
  const created: string[] = []
  const skipped: string[] = []

  for (const [relativePath, content] of files) {
    const filePath = join(input.projectDir, relativePath)
    if (existsSync(filePath) && !input.force) {
      skipped.push(filePath)
      continue
    }
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    created.push(filePath)
  }

  return { created, skipped }
}

function firstExisting(projectDir: string, candidates: string[]): string | undefined {
  return candidates.map(candidate => join(projectDir, candidate)).find(path => existsSync(path))
}

function parseContextTerms(content: string): string[] {
  const terms: string[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    if (/\|\s*Term\s*\|/i.test(line) || /^\|\s*-+/.test(line.trim())) continue
    const parts = line.split('|').map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2 && parts[0] !== '---') terms.push(parts[0])
  }
  return unique(terms)
}

function parseContextMap(content: string): Map<string, Partial<ModuleDocStatus>> {
  const map = new Map<string, Partial<ModuleDocStatus>>()
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    if (/\|\s*Module\s*\|/i.test(line) || /^\|\s*-+/.test(line.trim())) continue
    const parts = line.split('|').map(part => part.trim()).filter(Boolean)
    if (parts.length < 4 || parts[0] === '---') continue
    map.set(parts[0], {
      moduleName: parts[0],
      productDocPath: parts[2],
      architectureDocPath: parts[3],
    })
  }
  return map
}

function resolveModuleDocs(projectDir: string, changedFiles: string[], contextMap: Map<string, Partial<ModuleDocStatus>>): ModuleDocStatus[] {
  const modules = unique(changedFiles.map(inferModuleName).filter(Boolean) as string[])
  return modules.map(moduleName => {
    const mapped = contextMap.get(moduleName)
    const productDocPath = mapped?.productDocPath ?? `docs/modules/${moduleName}/product.md`
    const architectureDocPath = mapped?.architectureDocPath ?? `docs/modules/${moduleName}/architecture.md`
    return {
      moduleName,
      productDocPath,
      architectureDocPath,
      productDocExists: existsSync(join(projectDir, productDocPath)),
      architectureDocExists: existsSync(join(projectDir, architectureDocPath)),
    }
  })
}

function inferModuleName(filePath: string): string | undefined {
  const normalized = normalize(filePath).replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const roots = new Set(['src', 'app', 'lib', 'services', 'packages', 'modules'])
  if (parts.length >= 2 && roots.has(parts[0])) return parts[1]
  return parts[0]
}

function buildContextQuestions(request: string, findings: ContextFinding[], moduleDocs: ModuleDocStatus[]): ContextGrillQuestion[] {
  const questions: ContextGrillQuestion[] = []
  if (findings.some(finding => finding.code === 'missing-context-doc')) {
    questions.push({
      id: 'context-domain-language',
      topic: 'domain-language',
      question: 'Which domain terms, aliases, and forbidden meanings must be captured before implementation?',
      reason: 'Without a project glossary, agents can invent inconsistent product language.',
      blocking: true,
    })
  }
  if (findings.some(finding => finding.code === 'missing-context-map' || finding.code === 'missing-module-doc')) {
    questions.push({
      id: 'context-module-boundary',
      topic: 'module-boundary',
      question: `Which module owns ${moduleDocs.map(doc => doc.moduleName).join(', ') || 'this change'}, and which product/architecture docs must be updated?`,
      reason: 'Module ownership and document links prevent stale specs and cross-module conflicts.',
      blocking: true,
    })
  }
  if (/\btenant|auth|permission|security|token|quota|delete|payment|migration\b/i.test(request)) {
    questions.push({
      id: 'context-risk-boundary',
      topic: 'risk-and-rollback',
      question: 'What tenant/user isolation, authorization, rollback, and audit evidence is required?',
      reason: 'The request touches a security or data-boundary concern.',
      blocking: true,
    })
  }
  questions.push({
    id: 'context-acceptance-evidence',
    topic: 'acceptance-evidence',
    question: 'Which command output, test report, screenshot, or product artifact will prove this is done?',
    reason: 'Completion claims must be tied to durable evidence.',
    blocking: false,
  })
  return questions
}

function contextTemplate(projectName: string): string {
  return [
    '# CONTEXT.md',
    '',
    `Project: ${projectName}`,
    '',
    '| Term | Definition | Examples | Aliases | Source |',
    '|------|------------|----------|---------|--------|',
    '| User | Person or service account using the product | login user | account | product |',
    '',
    '## Rejected Meanings',
    '',
    '- Record terms that agents must not reinterpret.',
    '',
  ].join('\n')
}

function contextMapTemplate(projectName: string): string {
  return [
    '# CONTEXT-MAP.md',
    '',
    `Project: ${projectName}`,
    '',
    '| Module | Owner | Product Doc | Architecture Doc |',
    '| --- | --- | --- | --- |',
    '| example | team | docs/modules/example/product.md | docs/modules/example/architecture.md |',
    '',
    '## Cross-Module Rules',
    '',
    '- Record ownership, upstream/downstream dependencies, and document update triggers here.',
    '',
  ].join('\n')
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
