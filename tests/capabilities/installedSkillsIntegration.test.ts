import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveInstalledSkillPath, runInstalledSkillCommand } from '../../src/capabilities/InstalledSkillsIntegration.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-skills-'))
  dirs.push(dir)
  return dir
}

describe('installed skills integration', () => {
  it('prefers the first skill root that contains the requested script', () => {
    const agentsRoot = makeDir()
    const claudeRoot = makeDir()
    const scriptDir = join(agentsRoot, 'ui-ux-pro-max', 'scripts')
    mkdirSync(scriptDir, { recursive: true })
    writeFileSync(join(scriptDir, 'search.py'), 'print("ok")\n', 'utf-8')

    expect(resolveInstalledSkillPath('ui-ux-pro-max', ['scripts', 'search.py'], [agentsRoot, claudeRoot]))
      .toBe(join(scriptDir, 'search.py'))
  })

  it('falls back to the first configured root for actionable missing-skill errors', () => {
    const agentsRoot = makeDir()
    const claudeRoot = makeDir()

    expect(resolveInstalledSkillPath('missing-skill', ['SKILL.md'], [agentsRoot, claudeRoot]))
      .toBe(join(agentsRoot, 'missing-skill', 'SKILL.md'))
  })

  it('runs installed skill commands through the host shell without requiring sh', async () => {
    const result = await runInstalledSkillCommand('node -e "process.stdout.write(\'ok\')"', 5000, 'test-skill')

    expect(result).toMatchObject({
      success: true,
      output: 'ok',
      skillId: 'test-skill',
    })
  })
})
