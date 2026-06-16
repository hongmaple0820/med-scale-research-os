import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

describe('phase prompt optimization', () => {
  it('runs prompt optimization before DEFINE stores the spec requirement', async () => {
    const scaleDir = makeDir('scale-phase-prompt-scale-')
    const projectDir = makeDir('scale-phase-prompt-project-')

    const result = await runScale([
      'define',
      'Prompt Optimizer',
      '--description',
      '把用户随便输入的 coding 需求优化成专业提示词，要求结构清晰、保留原始意图、方便 agent 执行。',
      '--success-criteria',
      '生成结构化提示词,保留用户原始意图,输出验收标准',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      spec: { payload: { what: string } }
      promptOptimization: {
        optimizedPrompt: string
        originalPrompt: string
        quality: { score: number }
      }
    }>(result.stdout)

    expect(report.promptOptimization.originalPrompt).toContain('coding 需求')
    expect(report.promptOptimization.optimizedPrompt).toBe(report.spec.payload.what)
    expect(report.spec.payload.what).toContain('## 任务目标')
    expect(report.spec.payload.what).toContain('## 验收标准')
    expect(report.spec.payload.what).toContain('保留原始意图')
    expect(report.promptOptimization.quality.score).toBeGreaterThanOrEqual(70)
  }, 120_000)
})
