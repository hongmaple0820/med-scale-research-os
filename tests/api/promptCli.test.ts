import { describe, expect, it } from 'vitest'
import { execa } from 'execa'

async function runScale(args: string[]) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

describe('prompt CLI', () => {
  it('optimizes a raw coding instruction into a structured executable prompt', async () => {
    const result = await runScale([
      'prompt',
      'optimize',
      '--input',
      '想做一个提示词优化能力，用户输入后自动整理成专业规范的 coding prompt，要保留真实意图，还要有验收标准和执行要求。',
      '--json',
    ])

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      originalPrompt: string
      optimizedPrompt: string
      language: string
      intent: { type: string; summary: string }
      sections: { acceptanceCriteria: string[]; executionRules: string[] }
      quality: { score: number; missingInfo: string[] }
    }>(result.stdout)

    expect(report.language).toBe('zh')
    expect(report.intent.type).toBe('feature')
    expect(report.optimizedPrompt).toContain('## 任务目标')
    expect(report.optimizedPrompt).toContain('## 验收标准')
    expect(report.optimizedPrompt).toContain('## 执行要求')
    expect(report.optimizedPrompt).toContain('提示词优化')
    expect(report.sections.acceptanceCriteria.length).toBeGreaterThanOrEqual(3)
    expect(report.sections.executionRules).toContain('先检查现有实现和项目约束，再制定改动方案。')
    expect(report.quality.score).toBeGreaterThanOrEqual(70)
  }, 120_000)
})
