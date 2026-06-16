// SCALE Engine — Security Audit Engine (v0.33.0)
// OWASP Top 10 + STRIDE security audit for code review.
// Inspired by gstack's /cso security audit skill.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================================
// Types
// ============================================================================

export type OwaspCategory =
  | 'injection'
  | 'auth'
  | 'exposure'
  | 'xxe'
  | 'access-control'
  | 'misconfig'
  | 'xss'
  | 'deserialization'
  | 'components'
  | 'logging'

export type StrideCategory =
  | 'spoofing'
  | 'tampering'
  | 'repudiation'
  | 'info-disclosure'
  | 'denial-of-service'
  | 'elevation-of-privilege'

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface SecurityFinding {
  id: string
  category: OwaspCategory | StrideCategory
  severity: FindingSeverity
  title: string
  description: string
  file?: string
  line?: number
  evidence: string
  recommendation: string
}

export interface SecurityAuditResult {
  findings: SecurityFinding[]
  owaspCoverage: Record<OwaspCategory, 'checked' | 'not-applicable' | 'unchecked'>
  strideCoverage: Record<StrideCategory, 'checked' | 'not-applicable' | 'unchecked'>
  riskScore: number // 0-100
  summary: string
}

export interface AuditOptions {
  projectDir?: string
  files?: string[]
}

// ============================================================================
// Pattern Definitions
// ============================================================================

interface SecurityPattern {
  id: string
  category: OwaspCategory | StrideCategory
  severity: FindingSeverity
  title: string
  pattern: RegExp
  description: string
  recommendation: string
  testFileExempt?: boolean
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // Injection
  {
    id: 'sql-concat',
    category: 'injection',
    severity: 'critical',
    title: 'SQL string concatenation detected',
    pattern: /(?:query|execute|raw)\s*\(\s*[`'"].*\$\{|(?:query|execute|raw)\s*\(\s*['"].*\+\s*(?:req\.|params\.|input|user)/i,
    description: 'SQL query built with string concatenation or template literals using user input.',
    recommendation: 'Use parameterized queries or an ORM with built-in escaping.',
  },
  {
    id: 'eval-usage',
    category: 'injection',
    severity: 'critical',
    title: 'Dynamic code execution detected',
    pattern: /\b(?:eval|Function|setTimeout|setInterval)\s*\(\s*(?:req\.|params\.|input|user|req\[)/i,
    description: 'Dynamic code execution with user-controlled input.',
    recommendation: 'Never pass user input to eval/Function. Use safe alternatives like JSON.parse or a sandboxed VM.',
  },

  // Auth
  {
    id: 'hardcoded-password',
    category: 'auth',
    severity: 'critical',
    title: 'Hardcoded password or secret',
    pattern: /(?:password|passwd|secret|api[_-]?key|token|auth[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    description: 'Hardcoded credential found in source code.',
    recommendation: 'Move secrets to environment variables or a secret manager.',
    testFileExempt: true,
  },
  {
    id: 'weak-crypto',
    category: 'auth',
    severity: 'high',
    title: 'Weak cryptographic algorithm',
    pattern: /\b(?:md5|sha1)\b.*(?:hash|digest|createHash)/i,
    description: 'Weak hash algorithm (MD5/SHA1) used for security-sensitive operation.',
    recommendation: 'Use SHA-256 or stronger. For passwords, use bcrypt, argon2, or scrypt.',
  },

  // XSS
  {
    id: 'innerhtml',
    category: 'xss',
    severity: 'high',
    title: 'innerHTML assignment detected',
    pattern: /\.innerHTML\s*=\s*(?!['"]\s*['"])/,
    description: 'Direct innerHTML assignment may allow XSS if input is not sanitized.',
    recommendation: 'Use textContent, or sanitize with DOMPurify before assigning to innerHTML.',
    testFileExempt: true,
  },
  {
    id: 'dangerously-set-html',
    category: 'xss',
    severity: 'high',
    title: 'dangerouslySetInnerHTML usage',
    pattern: /dangerouslySetInnerHTML\s*:/,
    description: 'React dangerouslySetInnerHTML bypasses XSS protection.',
    recommendation: 'Sanitize HTML with DOMPurify before passing to dangerouslySetInnerHTML.',
    testFileExempt: true,
  },

  // Exposure
  {
    id: 'stack-trace-exposure',
    category: 'exposure',
    severity: 'medium',
    title: 'Stack trace exposure in response',
    pattern: /(?:res\.|response\.)\s*(?:send|json|write)\s*\(\s*(?:err|error)\s*(?:\.stack)?\s*\)/i,
    description: 'Error stack trace sent to client, leaking internal implementation details.',
    recommendation: 'Return generic error messages to clients. Log detailed errors server-side only.',
  },

  // Access Control
  {
    id: 'path-traversal',
    category: 'access-control',
    severity: 'critical',
    title: 'Potential path traversal vulnerability',
    pattern: /(?:readFile|readFileSync|createReadStream|access)\s*\(\s*(?:req\.|params\.|query\.|input|user)/i,
    description: 'File system operation with user-controlled path.',
    recommendation: 'Validate and normalize paths. Use path.resolve with a base directory check.',
  },

  // Logging
  {
    id: 'sensitive-logging',
    category: 'logging',
    severity: 'medium',
    title: 'Sensitive data in log output',
    pattern: /console\.\w+\s*\(.*(?:password|secret|token|key|credential)/i,
    description: 'Sensitive data may be written to logs.',
    recommendation: 'Redact sensitive fields before logging.',
  },

  // Deserialization
  {
    id: 'unsafe-deserialize',
    category: 'deserialization',
    severity: 'high',
    title: 'Unsafe deserialization',
    pattern: /JSON\.parse\s*\(\s*(?:req\.|params\.|body|input|user)/i,
    description: 'JSON.parse with untrusted input without validation.',
    recommendation: 'Validate JSON schema after parsing. Consider using a schema validator like zod or ajv.',
    testFileExempt: true,
  },
]

// ============================================================================
// Core Audit
// ============================================================================

export async function runSecurityAudit(opts?: AuditOptions): Promise<SecurityAuditResult> {
  const projectDir = opts?.projectDir ?? process.cwd()
  const files = opts?.files ?? []

  const findings: SecurityFinding[] = []
  let findingCounter = 0

  // Scan each file
  for (const filePath of files) {
    const fullPath = join(projectDir, filePath)
    if (!existsSync(fullPath)) continue

    let content: string
    try {
      content = readFileSync(fullPath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    const isTestFile = isTestPath(filePath)

    for (const patternDef of SECURITY_PATTERNS) {
      if (patternDef.testFileExempt && isTestFile) continue

      for (let i = 0; i < lines.length; i++) {
        if (patternDef.pattern.test(lines[i])) {
          findingCounter++
          findings.push({
            id: `SEC-${String(findingCounter).padStart(3, '0')}`,
            category: patternDef.category,
            severity: patternDef.severity,
            title: patternDef.title,
            description: patternDef.description,
            file: filePath,
            line: i + 1,
            evidence: lines[i].trim().slice(0, 200),
            recommendation: patternDef.recommendation,
          })
          break // One finding per pattern per file
        }
      }
    }
  }

  // Build coverage maps
  const owaspCoverage = buildOwaspCoverage(findings)
  const strideCoverage = buildStrideCoverage(findings)
  const riskScore = calculateRiskScore(findings)

  const summary = buildSummary(findings, riskScore)

  return { findings, owaspCoverage, strideCoverage, riskScore, summary }
}

// ============================================================================
// Coverage
// ============================================================================

function buildOwaspCoverage(findings: SecurityFinding[]): Record<OwaspCategory, 'checked' | 'not-applicable' | 'unchecked'> {
  const categories: OwaspCategory[] = [
    'injection', 'auth', 'exposure', 'xxe', 'access-control',
    'misconfig', 'xss', 'deserialization', 'components', 'logging',
  ]

  const foundCategories = new Set(findings.map(f => f.category))
  const result: Record<string, 'checked' | 'not-applicable' | 'unchecked'> = {}

  for (const cat of categories) {
    if (foundCategories.has(cat)) {
      result[cat] = 'checked'
    } else {
      result[cat] = 'not-applicable'
    }
  }

  return result as Record<OwaspCategory, 'checked' | 'not-applicable' | 'unchecked'>
}

function buildStrideCoverage(findings: SecurityFinding[]): Record<StrideCategory, 'checked' | 'not-applicable' | 'unchecked'> {
  const categories: StrideCategory[] = [
    'spoofing', 'tampering', 'repudiation', 'info-disclosure', 'denial-of-service', 'elevation-of-privilege',
  ]

  // Map OWASP categories to STRIDE
  const owaspToStride: Record<string, StrideCategory> = {
    'auth': 'spoofing',
    'injection': 'tampering',
    'xss': 'tampering',
    'deserialization': 'tampering',
    'logging': 'repudiation',
    'exposure': 'info-disclosure',
    'xxe': 'info-disclosure',
    'access-control': 'elevation-of-privilege',
    'components': 'elevation-of-privilege',
    'misconfig': 'denial-of-service',
  }

  const foundStride = new Set<StrideCategory>()
  for (const f of findings) {
    const stride = owaspToStride[f.category]
    if (stride) foundStride.add(stride)
  }

  const result: Record<string, 'checked' | 'not-applicable' | 'unchecked'> = {}
  for (const cat of categories) {
    result[cat] = foundStride.has(cat) ? 'checked' : 'not-applicable'
  }

  return result as Record<StrideCategory, 'checked' | 'not-applicable' | 'unchecked'>
}

// ============================================================================
// Risk Score
// ============================================================================

function calculateRiskScore(findings: SecurityFinding[]): number {
  if (findings.length === 0) return 0

  const weights: Record<FindingSeverity, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
  }

  let score = 0
  for (const f of findings) {
    score += weights[f.severity]
  }

  return Math.min(100, score)
}

// ============================================================================
// Summary
// ============================================================================

function buildSummary(findings: SecurityFinding[], riskScore: number): string {
  if (findings.length === 0) {
    return 'No security findings detected.'
  }

  const critical = findings.filter(f => f.severity === 'critical').length
  const high = findings.filter(f => f.severity === 'high').length
  const medium = findings.filter(f => f.severity === 'medium').length
  const low = findings.filter(f => f.severity === 'low').length

  const lines: string[] = [
    `Security audit found ${findings.length} finding(s):`,
    `  Critical: ${critical}, High: ${high}, Medium: ${medium}, Low: ${low}`,
    `  Risk Score: ${riskScore}/100`,
  ]

  if (critical > 0) {
    lines.push('  ⚠️  CRITICAL findings require immediate remediation before merge.')
  }

  return lines.join('\n')
}

// ============================================================================
// Formatter
// ============================================================================

export function summarizeSecurityAudit(result: SecurityAuditResult): string {
  const lines: string[] = ['## Security Audit Result\n']

  if (result.findings.length === 0) {
    lines.push('No security findings detected.')
    return lines.join('\n')
  }

  lines.push(`**Risk Score:** ${result.riskScore}/100\n`)

  const bySeverity = {
    critical: result.findings.filter(f => f.severity === 'critical'),
    high: result.findings.filter(f => f.severity === 'high'),
    medium: result.findings.filter(f => f.severity === 'medium'),
    low: result.findings.filter(f => f.severity === 'low'),
  }

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue
    const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : severity === 'medium' ? '🟡' : '🔵'
    lines.push(`### ${icon} ${severity.toUpperCase()} (${items.length})\n`)

    for (const f of items) {
      lines.push(`**${f.id}: ${f.title}**`)
      if (f.file) lines.push(`  File: \`${f.file}${f.line ? `:${f.line}` : ''}\``)
      lines.push(`  ${f.description}`)
      lines.push(`  Recommendation: ${f.recommendation}`)
      lines.push('')
    }
  }

  // OWASP coverage
  lines.push('### OWASP Top 10 Coverage\n')
  for (const [cat, status] of Object.entries(result.owaspCoverage)) {
    const icon = status === 'checked' ? '✅' : '⬜'
    lines.push(`${icon} ${cat}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function isTestPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return /(^|\/)(tests?|__tests__)\//i.test(normalized) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)
}
