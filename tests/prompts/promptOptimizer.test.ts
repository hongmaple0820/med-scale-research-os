import { describe, expect, it } from 'vitest'
import { optimizeCodingPrompt } from '../../src/prompts/PromptOptimizer.js'

describe('PromptOptimizer', () => {
  it('keeps Chinese user intent while adding executable structure', () => {
    const result = optimizeCodingPrompt({
      rawPrompt: '我想新增一个提示词优化功能，用户输入后自动整理成专业 coding prompt，必须保留真实意图，并输出验收标准。',
      title: 'Prompt Optimizer',
      successCriteria: ['保留用户原始意图', '输出结构化提示词'],
    })

    expect(result.language).toBe('zh')
    expect(result.intent.type).toBe('feature')
    expect(result.optimizedPrompt).toContain('Prompt Optimizer')
    expect(result.optimizedPrompt).toContain('## 输入与输出边界')
    expect(result.optimizedPrompt).toContain('必须保留真实意图')
    expect(result.sections.acceptanceCriteria).toEqual(expect.arrayContaining([
      '保留用户原始意图',
      '输出结构化提示词',
    ]))
  })

  it('renders English prompts when language is forced to en', () => {
    const result = optimizeCodingPrompt({
      rawPrompt: 'Build a CLI prompt optimizer that rewrites raw coding requests into structured execution prompts.',
      language: 'en',
      files: ['src/api/cli.ts'],
    })

    expect(result.language).toBe('en')
    expect(result.optimizedPrompt).toContain('## Objective')
    expect(result.optimizedPrompt).toContain('Relevant files: src/api/cli.ts')
    expect(result.sections.executionRules).toContain('Inspect the existing implementation and project constraints before changing files.')
  })

  it('surfaces missing information for vague requests without blocking output', () => {
    const result = optimizeCodingPrompt('优化一下')

    expect(result.optimizedPrompt).toContain('## 待澄清问题')
    expect(result.quality.missingInfo).toEqual(expect.arrayContaining(['验收标准', '影响范围', '约束边界']))
    expect(result.quality.score).toBeLessThan(70)
  })
})
