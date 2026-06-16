import type { ResolvedSkillRoutingPolicy, SkillDomainPolicy, TaskIntent, TaskIntentInput } from './SkillRoutingTypes.js'

export class TaskIntentClassifier {
  constructor(private policy: ResolvedSkillRoutingPolicy) {}

  classify(input: TaskIntentInput): TaskIntent[] {
    const text = normalizeText(input.description ?? '')
    const files = (input.files ?? []).map(normalizePath)
    const services = new Set((input.services ?? []).map(value => value.toLowerCase()))
    const intents: TaskIntent[] = []

    for (const [domain, domainPolicy] of Object.entries(this.policy.domains)) {
      if (domainPolicy.appliesToLevels?.length && input.level && !domainPolicy.appliesToLevels.includes(input.level)) {
        continue
      }
      const scored = scoreDomain(domainPolicy, { text, files, services })
      if (scored.score > 0) intents.push({ domain, score: scored.score, reasons: scored.reasons })
    }

    return intents
      .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))
      .slice(0, 6)
  }
}

function scoreDomain(
  policy: SkillDomainPolicy,
  input: { text: string; files: string[]; services: Set<string> },
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  for (const keyword of policy.detect?.keywords ?? []) {
    if (input.text.includes(keyword.toLowerCase())) {
      score += 3
      reasons.push(`keyword:${keyword}`)
    }
  }

  for (const file of input.files) {
    const matched = (policy.detect?.files ?? []).find(pattern => matchesGlob(file, pattern))
    if (matched) {
      score += 4
      reasons.push(`file:${matched}`)
    }
  }

  for (const service of policy.detect?.services ?? []) {
    if (input.services.has(service.toLowerCase())) {
      score += 2
      reasons.push(`service:${service}`)
    }
  }

  return { score, reasons: [...new Set(reasons)] }
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern)
  const regex = '^' + globToRegex(normalizedPattern) + '$'
  return new RegExp(regex).test(path)
}

function globToRegex(pattern: string): string {
  let output = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      output += '.*'
      i += 1
      continue
    }
    if (char === '*') {
      output += '[^/]*'
      continue
    }
    output += escapeRegexChar(char)
  }
  return output
}

function escapeRegexChar(value: string): string {
  return /[|\\{}()[\]^$+?.]/.test(value) ? `\\${value}` : value
}
