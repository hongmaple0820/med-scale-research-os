import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scanTargets = [
  'src/skills/SkillRepository.ts',
  'src/skills/ExternalSkills.ts',
  'src/skills/SkillInstaller.ts',
  'src/skills/SkillDiscovery.ts',
  'src/skills/SkillDoctor.ts',
  'src/skills/SkillCatalog.ts',
  'src/tools/ToolCapabilityRegistry.ts',
  'src/adapters',
  'docs/TOOL_ORCHESTRATION.md',
  'docs/skill-installation-workflow.md',
  'docs/THIRD_PARTY_SKILLS.md',
  'README.md',
  'README.en.md',
]

const ignoredSlugs = new Set([
  'hongmaple0820/scale-engine',
  'xxx/skill',
])

function collectFiles(target: string): string[] {
  if (!existsSync(target)) return []

  const stats = statSync(target)
  if (!stats.isDirectory()) return [target]

  return readdirSync(target)
    .flatMap(child => collectFiles(join(target, child)))
}

function normalizeGithubSlug(urlTail: string): string | undefined {
  const cleaned = urlTail
    .replace(/[.;,:]+$/g, '')
    .replace(/\\.git$/i, '')
  const [owner, repo] = cleaned.split('/')

  if (!owner || !repo) return undefined
  return `${owner}/${repo}`.toLowerCase()
}

function referencedGithubSlugs(): string[] {
  const githubUrlPattern = /https:\/\/github\.com\/([^\s)\]}'"`<>]+)/g
  const slugs = new Set<string>()

  for (const file of scanTargets.flatMap(collectFiles)) {
    const content = readFileSync(file, 'utf-8')
    let match: RegExpExecArray | null

    while ((match = githubUrlPattern.exec(content)) !== null) {
      const slug = normalizeGithubSlug(match[1])
      if (slug && !ignoredSlugs.has(slug)) slugs.add(slug)
    }
  }

  return [...slugs].sort()
}

describe('external reference documentation', () => {
  it('documents every current GitHub upstream reference used by skills, tools, adapters, and current docs', () => {
    const inventory = readFileSync('docs/EXTERNAL_REFERENCES.md', 'utf-8').toLowerCase()
    const missing = referencedGithubSlugs().filter(slug => !inventory.includes(slug))

    expect(missing).toEqual([])
  })
})
