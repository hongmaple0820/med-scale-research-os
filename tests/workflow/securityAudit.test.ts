// SCALE Engine — Security Audit Tests

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runSecurityAudit,
  summarizeSecurityAudit,
  type SecurityAuditResult,
  type SecurityFinding,
} from '../../src/workflow/SecurityAudit.js'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn((path: string) => path.endsWith('.ts') || path.endsWith('.js')),
    readFileSync: vi.fn((path: string) => {
      if (path.includes('auth.ts')) {
        return `
          const password = "supersecret123"
          db.query(\`SELECT * FROM users WHERE id = \${req.params.id}\`)
          el.innerHTML = userInput
        `
      }
      if (path.includes('safe.ts')) {
        return `
          const result = await db.query('SELECT * FROM users WHERE id = ?', [id])
          const el = document.createElement('div')
          el.textContent = userInput
        `
      }
      if (path.includes('test.spec.ts')) {
        return `
          const testPassword = "test123"
          describe('auth', () => {})
        `
      }
      return ''
    }),
  }
})

describe('runSecurityAudit', () => {
  it('returns no findings for safe code', async () => {
    const result = await runSecurityAudit({
      files: ['src/safe.ts'],
    })

    expect(result.findings.length).toBe(0)
    expect(result.riskScore).toBe(0)
    expect(result.summary).toContain('No security findings')
  })

  it('detects hardcoded credentials', async () => {
    const result = await runSecurityAudit({
      files: ['src/auth.ts'],
    })

    const credentialFindings = result.findings.filter(f => f.title.includes('password') || f.title.includes('Hardcoded'))
    expect(credentialFindings.length).toBeGreaterThan(0)
    expect(credentialFindings[0].severity).toBe('critical')
  })

  it('detects SQL injection risk', async () => {
    const result = await runSecurityAudit({
      files: ['src/auth.ts'],
    })

    const injectionFindings = result.findings.filter(f => f.category === 'injection')
    expect(injectionFindings.length).toBeGreaterThan(0)
    expect(injectionFindings[0].severity).toBe('critical')
  })

  it('skips hardcoded credential checks for test files', async () => {
    const result = await runSecurityAudit({
      files: ['tests/test.spec.ts'],
    })

    // Test files are exempt from hardcoded credential checks
    const credentialFindings = result.findings.filter(f => f.title.includes('Hardcoded'))
    expect(credentialFindings.length).toBe(0)
  })

  it('calculates risk score correctly', async () => {
    const result = await runSecurityAudit({
      files: ['src/auth.ts'],
    })

    expect(result.riskScore).toBeGreaterThan(0)
    expect(result.riskScore).toBeLessThanOrEqual(100)
  })

  it('builds OWASP coverage map', async () => {
    const result = await runSecurityAudit({
      files: ['src/auth.ts'],
    })

    expect(result.owaspCoverage).toBeDefined()
    expect(result.owaspCoverage['injection']).toBe('checked')
    expect(result.owaspCoverage['auth']).toBe('checked')
  })

  it('builds STRIDE coverage map', async () => {
    const result = await runSecurityAudit({
      files: ['src/auth.ts'],
    })

    expect(result.strideCoverage).toBeDefined()
    expect(result.strideCoverage['tampering']).toBe('checked')
  })

  it('handles non-existent files gracefully', async () => {
    const result = await runSecurityAudit({
      files: ['src/nonexistent.ts'],
    })

    expect(result.findings.length).toBe(0)
  })

  it('handles empty file list', async () => {
    const result = await runSecurityAudit({ files: [] })
    expect(result.findings.length).toBe(0)
    expect(result.riskScore).toBe(0)
  })
})

describe('summarizeSecurityAudit', () => {
  it('formats empty findings', () => {
    const result: SecurityAuditResult = {
      findings: [],
      owaspCoverage: {} as any,
      strideCoverage: {} as any,
      riskScore: 0,
      summary: 'No findings',
    }

    const summary = summarizeSecurityAudit(result)
    expect(summary).toContain('No security findings')
  })

  it('formats findings by severity', () => {
    const result: SecurityAuditResult = {
      findings: [
        {
          id: 'SEC-001',
          category: 'injection',
          severity: 'critical',
          title: 'SQL Injection',
          description: 'SQL concat detected',
          file: 'src/db.ts',
          line: 42,
          evidence: 'query(`SELECT * FROM users WHERE id = ${id}`)',
          recommendation: 'Use parameterized queries',
        },
        {
          id: 'SEC-002',
          category: 'xss',
          severity: 'high',
          title: 'innerHTML',
          description: 'XSS risk',
          file: 'src/ui.ts',
          line: 10,
          evidence: 'el.innerHTML = userInput',
          recommendation: 'Use textContent',
        },
      ],
      owaspCoverage: { injection: 'checked', xss: 'checked' } as any,
      strideCoverage: {} as any,
      riskScore: 40,
      summary: '2 findings',
    }

    const summary = summarizeSecurityAudit(result)
    expect(summary).toContain('🔴 CRITICAL')
    expect(summary).toContain('🟠 HIGH')
    expect(summary).toContain('SQL Injection')
    expect(summary).toContain('innerHTML')
    expect(summary).toContain('**Risk Score:** 40/100')
    expect(summary).toContain('src/db.ts:42')
  })

  it('includes OWASP coverage section', () => {
    const result: SecurityAuditResult = {
      findings: [
        {
          id: 'SEC-001',
          category: 'injection',
          severity: 'critical',
          title: 'SQL Injection',
          description: 'desc',
          evidence: 'ev',
          recommendation: 'rec',
        },
      ],
      owaspCoverage: { injection: 'checked', auth: 'not-applicable' } as any,
      strideCoverage: {} as any,
      riskScore: 25,
      summary: '1 finding',
    }

    const summary = summarizeSecurityAudit(result)
    expect(summary).toContain('OWASP Top 10 Coverage')
    expect(summary).toContain('✅ injection')
    expect(summary).toContain('⬜ auth')
  })
})
