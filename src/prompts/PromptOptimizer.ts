export type PromptOptimizationLanguage = 'zh' | 'en'
export type PromptOptimizationLanguageInput = PromptOptimizationLanguage | 'auto'
export type PromptIntentType = 'feature' | 'bugfix' | 'refactor' | 'review' | 'docs' | 'research' | 'optimization' | 'unknown'

export interface PromptOptimizationInput {
  rawPrompt: string
  title?: string
  language?: PromptOptimizationLanguageInput
  level?: string
  files?: string[]
  services?: string[]
  successCriteria?: string[]
}

export interface PromptOptimizationSections {
  objective: string
  context: string[]
  constraints: string[]
  acceptanceCriteria: string[]
  executionRules: string[]
  deliverables: string[]
  risks: string[]
  missingInfoQuestions: string[]
}

export interface PromptOptimizationResult {
  originalPrompt: string
  optimizedPrompt: string
  language: PromptOptimizationLanguage
  intent: {
    type: PromptIntentType
    summary: string
  }
  sections: PromptOptimizationSections
  quality: {
    score: number
    missingInfo: string[]
    improvements: string[]
  }
  stats: {
    originalChars: number
    optimizedChars: number
  }
}

const ZH_EXECUTION_RULES = [
  '先检查现有实现和项目约束，再制定改动方案。',
  '保持最小必要改动，不扩大用户未要求的范围。',
  '涉及代码变更时先补可失败的测试，再实现并验证通过。',
  '保留用户已有未提交改动，不覆盖无关文件。',
  '最终说明实际改动、验证命令、未验证项和剩余风险。',
]

const EN_EXECUTION_RULES = [
  'Inspect the existing implementation and project constraints before changing files.',
  'Keep the smallest necessary scope and do not expand beyond the user request.',
  'For code changes, add a failing test first, then implement and verify it passes.',
  'Preserve existing uncommitted user changes and avoid unrelated files.',
  'Report the actual changes, validation commands, unverified items, and residual risks.',
]

export function optimizeCodingPrompt(input: PromptOptimizationInput | string): PromptOptimizationResult {
  const normalizedInput = normalizeInput(input)
  const rawPrompt = normalizedInput.rawPrompt.trim()
  if (!rawPrompt) throw new Error('Prompt input is required.')

  const language = resolveLanguage(rawPrompt, normalizedInput.language)
  const clauses = splitClauses(rawPrompt)
  const intentType = detectIntentType(rawPrompt)
  const objective = buildObjective({ rawPrompt, title: normalizedInput.title, clauses, language, intentType })
  const context = buildContext(normalizedInput, clauses, language)
  const constraints = uniqueLines([
    ...extractByKeywords(clauses, constraintKeywords(language)),
    ...defaultConstraints(language),
  ])
  const acceptanceCriteria = uniqueLines([
    ...normalizeList(normalizedInput.successCriteria),
    ...extractByKeywords(clauses, acceptanceKeywords(language)),
    ...defaultAcceptanceCriteria(language),
  ]).slice(0, 8)
  const executionRules = language === 'zh' ? ZH_EXECUTION_RULES : EN_EXECUTION_RULES
  const deliverables = buildDeliverables(language, intentType)
  const risks = buildRisks(language)
  const missingInfo = detectMissingInfo(rawPrompt, normalizedInput, language)
  const missingInfoQuestions = missingInfo.map(item => missingInfoQuestion(item, language))
  const improvements = buildImprovements(language)
  const summary = summarizeIntent(objective, intentType, language)
  const sections: PromptOptimizationSections = {
    objective,
    context,
    constraints,
    acceptanceCriteria,
    executionRules,
    deliverables,
    risks,
    missingInfoQuestions,
  }
  const optimizedPrompt = renderOptimizedPrompt({
    language,
    originalPrompt: rawPrompt,
    intentType,
    sections,
    level: normalizedInput.level,
  })
  const score = scorePrompt({ rawPrompt, clauses, acceptanceCriteria, constraints, missingInfo })

  return {
    originalPrompt: rawPrompt,
    optimizedPrompt,
    language,
    intent: { type: intentType, summary },
    sections,
    quality: { score, missingInfo, improvements },
    stats: {
      originalChars: rawPrompt.length,
      optimizedChars: optimizedPrompt.length,
    },
  }
}

function normalizeInput(input: PromptOptimizationInput | string): PromptOptimizationInput {
  if (typeof input === 'string') return { rawPrompt: input }
  return input
}

function resolveLanguage(rawPrompt: string, language?: PromptOptimizationLanguageInput): PromptOptimizationLanguage {
  if (language === 'zh' || language === 'en') return language
  return /[\u3400-\u9fff]/u.test(rawPrompt) ? 'zh' : 'en'
}

function splitClauses(rawPrompt: string): string[] {
  return rawPrompt
    .split(/[\r\n。；;，,、.!?？]+/u)
    .map(item => item.trim())
    .filter(Boolean)
}

function detectIntentType(rawPrompt: string): PromptIntentType {
  const lower = rawPrompt.toLowerCase()
  if (hasAny(lower, ['bug', 'fix', 'error', 'crash', '修复', '错误', '异常', '失败'])) return 'bugfix'
  if (hasAny(lower, ['refactor', 'restructure', '重构', '改造'])) return 'refactor'
  if (hasAny(lower, ['review', 'audit', '检查', '评审', '审查'])) return 'review'
  if (hasAny(lower, ['doc', 'readme', '文档', '教程'])) return 'docs'
  if (hasAny(lower, ['research', '调研', '研究'])) return 'research'
  if (hasAny(lower, ['implement', 'build', 'create', 'add', 'support', 'capability', 'feature', '实现', '构建', '新增', '支持', '做一个', '功能', '能力', '自动'])) return 'feature'
  if (hasAny(lower, ['optimize', 'optimization', '性能', '优化'])) return 'optimization'
  return 'unknown'
}

function buildObjective(options: {
  rawPrompt: string
  title?: string
  clauses: string[]
  language: PromptOptimizationLanguage
  intentType: PromptIntentType
}): string {
  const base = options.clauses[0] ?? options.rawPrompt
  const titlePrefix = options.title ? `${options.title}: ` : ''
  if (options.language === 'zh') {
    return `${titlePrefix}实现并交付：${base}。`
  }
  return `${titlePrefix}Implement and deliver: ${base}.`
}

function buildContext(input: PromptOptimizationInput, clauses: string[], language: PromptOptimizationLanguage): string[] {
  const context = extractByKeywords(clauses, contextKeywords(language))
  if (input.files?.length) context.push(`${language === 'zh' ? '相关文件' : 'Relevant files'}: ${input.files.join(', ')}`)
  if (input.services?.length) context.push(`${language === 'zh' ? '相关服务' : 'Relevant services'}: ${input.services.join(', ')}`)
  if (input.level) context.push(`${language === 'zh' ? '任务等级' : 'Task level'}: ${input.level}`)
  if (context.length > 0) return uniqueLines(context)
  return [language === 'zh'
    ? '上下文不足时，先从仓库现状、现有文档、测试和配置中补齐，不自行假设业务事实。'
    : 'When context is incomplete, derive it from the repository, docs, tests, and config instead of inventing business facts.']
}

function defaultConstraints(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? [
        '保留用户真实意图，不改写成新的需求。',
        '不引入与当前任务无关的功能或架构改造。',
        '如果信息不足，明确列出待澄清问题和合理默认假设。',
      ]
    : [
        'Preserve the user intent and do not rewrite it into a different request.',
        'Do not introduce unrelated features or architecture changes.',
        'When information is missing, list clarification questions and explicit assumptions.',
      ]
}

function defaultAcceptanceCriteria(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? [
        '输出结构化提示词，包含任务目标、上下文、约束、验收标准、执行要求和风险。',
        '优化后的提示词完整覆盖原始需求中的关键对象、动作和边界。',
        '提供可执行验证方式，并说明验证结果或未验证原因。',
        '不产生与用户需求冲突的新增范围。',
      ]
    : [
        'Produce a structured prompt with objective, context, constraints, acceptance criteria, execution rules, and risks.',
        'Cover the key objects, actions, and boundaries from the original request.',
        'Provide executable validation steps and state results or reasons for unverified items.',
        'Do not create new scope that conflicts with the user request.',
      ]
}

function buildDeliverables(language: PromptOptimizationLanguage, intentType: PromptIntentType): string[] {
  if (language === 'zh') {
    const deliverables = ['完成可落地的实现或配置改动。', '补充或更新必要测试。', '同步必要文档或使用说明。']
    if (intentType === 'review') return ['输出按严重程度排序的问题清单。', '给出文件/行号证据和可执行修复建议。']
    if (intentType === 'docs') return ['更新目标文档。', '确保示例、命令和入口说明一致。']
    return deliverables
  }
  const deliverables = ['Deliver the implementation or configuration change.', 'Add or update required tests.', 'Update required documentation or usage notes.']
  if (intentType === 'review') return ['Return findings ordered by severity.', 'Include file/line evidence and actionable fixes.']
  if (intentType === 'docs') return ['Update the target documentation.', 'Keep examples, commands, and entry points consistent.']
  return deliverables
}

function buildRisks(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? [
        '需求边界不清可能导致实现范围扩大。',
        '只做文本优化但未接入执行链路，会导致能力不可用。',
        '未验证就声称完成会破坏工作流可信度。',
      ]
    : [
        'Unclear boundaries can expand implementation scope.',
        'Text-only optimization without workflow integration leaves the capability unused.',
        'Claiming completion without validation weakens workflow trust.',
      ]
}

function detectMissingInfo(rawPrompt: string, input: PromptOptimizationInput, language: PromptOptimizationLanguage): string[] {
  const lower = rawPrompt.toLowerCase()
  const missing: string[] = []
  if (!hasAny(lower, language === 'zh' ? ['验收', '成功', '测试', '验证', '标准'] : ['acceptance', 'success', 'test', 'verify', 'standard'])) {
    missing.push(language === 'zh' ? '验收标准' : 'acceptance criteria')
  }
  if (!input.files?.length && !hasAny(lower, language === 'zh' ? ['文件', '模块', '仓库', '项目'] : ['file', 'module', 'repo', 'project'])) {
    missing.push(language === 'zh' ? '影响范围' : 'affected scope')
  }
  if (!hasAny(lower, language === 'zh' ? ['不要', '不能', '边界', '约束', '保留'] : ['do not', 'boundary', 'constraint', 'preserve'])) {
    missing.push(language === 'zh' ? '约束边界' : 'constraints')
  }
  return missing
}

function missingInfoQuestion(item: string, language: PromptOptimizationLanguage): string {
  if (language === 'zh') return `请补充：${item}是什么？`
  return `Clarify the ${item}.`
}

function buildImprovements(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? ['补齐结构层次', '显式化验收标准', '加入执行边界和验证要求', '降低模型理解歧义']
    : ['Add structure', 'Make acceptance criteria explicit', 'Add boundaries and validation rules', 'Reduce model ambiguity']
}

function summarizeIntent(objective: string, intentType: PromptIntentType, language: PromptOptimizationLanguage): string {
  if (language === 'zh') return `${intentType}：${objective}`
  return `${intentType}: ${objective}`
}

function scorePrompt(options: {
  rawPrompt: string
  clauses: string[]
  acceptanceCriteria: string[]
  constraints: string[]
  missingInfo: string[]
}): number {
  let score = 55
  if (options.rawPrompt.length >= 30) score += 10
  if (options.clauses.length >= 2) score += 8
  if (options.acceptanceCriteria.length >= 3) score += 12
  if (options.constraints.length >= 3) score += 10
  score -= options.missingInfo.length * 5
  return Math.max(30, Math.min(95, score))
}

function renderOptimizedPrompt(options: {
  language: PromptOptimizationLanguage
  originalPrompt: string
  intentType: PromptIntentType
  sections: PromptOptimizationSections
  level?: string
}): string {
  if (options.language === 'zh') {
    return [
      '# 优化后的 Coding Prompt',
      '',
      '## 原始需求',
      options.originalPrompt,
      '',
      '## 任务目标',
      options.sections.objective,
      '',
      '## 意图分类',
      options.intentType,
      '',
      '## 输入与输出边界',
      '- 输入：用户原始需求、仓库现状、相关文件、现有测试和项目规范。',
      '- 输出：可执行改动、验证证据、风险说明和必要文档更新。',
      '',
      renderList('## 背景与上下文', options.sections.context),
      renderList('## 约束与边界', options.sections.constraints),
      renderList('## 验收标准', options.sections.acceptanceCriteria),
      renderList('## 执行要求', options.sections.executionRules),
      renderList('## 交付物', options.sections.deliverables),
      renderList('## 风险与防错', options.sections.risks),
      renderList('## 待澄清问题', options.sections.missingInfoQuestions.length ? options.sections.missingInfoQuestions : ['暂无阻塞性问题；若发现新不确定性，先显式记录再继续。']),
    ].filter(Boolean).join('\n')
  }

  return [
    '# Optimized Coding Prompt',
    '',
    '## Original Request',
    options.originalPrompt,
    '',
    '## Objective',
    options.sections.objective,
    '',
    '## Intent Type',
    options.intentType,
    '',
    '## Input and Output Boundaries',
    '- Input: user request, repository state, relevant files, existing tests, and project rules.',
    '- Output: executable changes, validation evidence, risks, and required documentation updates.',
    '',
    renderList('## Context', options.sections.context),
    renderList('## Constraints', options.sections.constraints),
    renderList('## Acceptance Criteria', options.sections.acceptanceCriteria),
    renderList('## Execution Rules', options.sections.executionRules),
    renderList('## Deliverables', options.sections.deliverables),
    renderList('## Risks', options.sections.risks),
    renderList('## Clarification Questions', options.sections.missingInfoQuestions.length ? options.sections.missingInfoQuestions : ['No blocking questions; if new uncertainty appears, record it explicitly before continuing.']),
  ].filter(Boolean).join('\n')
}

function renderList(title: string, items: string[]): string {
  return [title, ...items.map(item => `- ${item}`)].join('\n')
}

function normalizeList(items?: string[]): string[] {
  return (items ?? []).map(item => item.trim()).filter(Boolean)
}

function extractByKeywords(clauses: string[], keywords: string[]): string[] {
  return clauses.filter(clause => hasAny(clause.toLowerCase(), keywords))
}

function hasAny(value: string, keywords: string[]): boolean {
  return keywords.some(keyword => value.includes(keyword.toLowerCase()))
}

function uniqueLines(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)))
}

function constraintKeywords(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? ['要求', '必须', '不要', '不能', '保留', '边界', '约束', '默认', '兼容']
    : ['must', 'require', 'do not', 'cannot', 'preserve', 'boundary', 'constraint', 'default', 'compatible']
}

function acceptanceKeywords(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? ['验收', '成功', '测试', '验证', '标准', '确保']
    : ['acceptance', 'success', 'test', 'verify', 'standard', 'ensure']
}

function contextKeywords(language: PromptOptimizationLanguage): string[] {
  return language === 'zh'
    ? ['项目', '仓库', '文件', '模块', '系统', '用户', 'agent', '模型']
    : ['project', 'repo', 'file', 'module', 'system', 'user', 'agent', 'model']
}
