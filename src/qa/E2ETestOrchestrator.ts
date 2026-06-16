import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DomainSkill {
  domain: string
  selectors: Record<string, string>
  flows: Array<{ name: string; steps: unknown[] }>
  savedAt: string
}

export function saveDomainSkill(domain: string, selectors: Record<string, string>, flows: Array<{ name: string; steps: unknown[] }>): void {
  const dir = join(process.cwd(), '.scale', 'qa', 'site-skills')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const hash = Buffer.from(domain).toString('hex').slice(0, 16)
  const skill: DomainSkill = { domain, selectors, flows, savedAt: new Date().toISOString() }
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(skill, null, 2))
}

export function loadDomainSkill(domain: string): DomainSkill | null {
  const dir = join(process.cwd(), '.scale', 'qa', 'site-skills')
  const hash = Buffer.from(domain).toString('hex').slice(0, 16)
  const path = join(dir, `${hash}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}
