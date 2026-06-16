// SCALE Engine — OWASP Top 10 Detector
// 安全漏洞检测器，覆盖 OWASP Top 10 主要类别
// 设计参考：docs/03-CORE-MODULES.md §3.5 + OWASP 2021

import type { IDetector, DetectorContext } from './Gateway.js'
import type { ToolUseInput, ToolResultInput, StopInput, DetectorResult } from '../artifact/types.js'

interface OWASPCheck {
  id: string
  name: string
  patterns: RegExp[]
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  category: string
  description: string
  remediation: string
}

/**
 * OWASP Top 10 (2021) Security Detector
 *
 * 检测代码中常见的安全漏洞模式：
 * A01: Broken Access Control - Auth bypass, missing auth checks
 * A02: Cryptographic Failures - Weak crypto, hardcoded secrets
 * A03: Injection - SQL, NoSQL, Command injection
 * A04: Insecure Design - Missing security patterns
 * A05: Security Misconfiguration - CORS, CSP issues
 * A06: Vulnerable Components - Known vulnerable patterns
 * A07: Auth Failures - Weak auth, session issues
 * A08: Software/Data Integrity - Unsafe deserialization
 * A09: Logging/Monitoring Failures - Missing logs
 * A10: SSRF - Server-side request forgery
 */
export class OWASPDetector implements IDetector {
  name = 'owasp-security'

  private checks: OWASPCheck[] = [
    // A01: Broken Access Control
    {
      id: 'auth-bypass',
      name: 'Authentication Bypass',
      patterns: [
        /skipAuth\s*[=:]\s*true/i,
        /bypassAuth\s*[=:]\s*true/i,
        /auth\s*[=:]\s*false/i,
        /\.skipAuth\(\)/i,
        /public\s+route/i,
        / unprotected\s+endpoint/i,
      ],
      severity: 'CRITICAL',
      category: 'A01-BrokenAccessControl',
      description: 'Authentication bypass detected - allows unauthorized access',
      remediation: 'Remove auth bypass logic. Ensure all sensitive endpoints require authentication.',
    },
    {
      id: 'missing-auth-check',
      name: 'Missing Authorization Check',
      patterns: [
        /isAdmin\s*\(\)\s*\{\s*return\s+true/i,
        /checkPermission\s*\(\)\s*\{\s*return\s+true/i,
        /hasAccess\s*\(\)\s*;\s*\/\/.*TODO/i,
      ],
      severity: 'HIGH',
      category: 'A01-BrokenAccessControl',
      description: 'Missing or placeholder authorization check',
      remediation: 'Implement proper authorization checks before sensitive operations.',
    },

    // A02: Cryptographic Failures
    {
      id: 'weak-crypto-md5',
      name: 'Weak Cryptography (MD5)',
      patterns: [
        /md5\s*\(/i,
        /createHash\s*\(\s*['"]md5['"]\s*\)/i,
        /MD5\s*=\s*require/i,
      ],
      severity: 'HIGH',
      category: 'A02-CryptographicFailures',
      description: 'MD5 is cryptographically broken and unsuitable for security purposes',
      remediation: 'Use SHA-256 or stronger algorithms for hashing. For passwords, use bcrypt/scrypt/argon2.',
    },
    {
      id: 'weak-crypto-sha1',
      name: 'Weak Cryptography (SHA1)',
      patterns: [
        /sha1\s*\(/i,
        /createHash\s*\(\s*['"]sha1['"]\s*\)/i,
      ],
      severity: 'HIGH',
      category: 'A02-CryptographicFailures',
      description: 'SHA1 is deprecated and vulnerable to collision attacks',
      remediation: 'Use SHA-256 or SHA-3 for cryptographic operations.',
    },
    {
      id: 'hardcoded-secret',
      name: 'Hardcoded Secret/Credential',
      patterns: [
        /password\s*[=:]\s*['"][^'"]{8,}['"]/i,
        /secret\s*[=:]\s*['"][^'"]{8,}['"]/i,
        /api_key\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/i,
        /apiKey\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/i,
        /token\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/i,
        /private_key\s*[=:]\s*['"]/i,
        /aws_access_key\s*[=:]\s*['"]/i,
        /AKIA[A-Z0-9]{16}/, // AWS Access Key ID pattern
      ],
      severity: 'CRITICAL',
      category: 'A02-CryptographicFailures',
      description: 'Hardcoded secrets can be leaked through source code exposure',
      remediation: 'Use environment variables or secure secret management (Vault, AWS Secrets Manager).',
    },
    {
      id: 'weak-random',
      name: 'Weak Random Number Generator',
      patterns: [
        /Math\.random\s*\(\)\s*[=:]*\s*token/i,
        /Math\.random\s*\(\)\s*[=:]*\s*key/i,
        /Math\.random\s*\(\)\s*[=:]*\s*secret/i,
        /new\s+Random\s*\(\)\s*[=:]*\s*token/i,
      ],
      severity: 'HIGH',
      category: 'A02-CryptographicFailures',
      description: 'Math.random() is not cryptographically secure',
      remediation: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive randomness.',
    },

    // A03: Injection
    {
      id: 'sql-injection',
      name: 'SQL Injection',
      patterns: [
        /executeQuery\s*\(\s*[`'"]\s*SELECT.*\+/i,
        /query\s*\(\s*[`'"]\s*.*\$\{/i,
        /\.query\s*\(\s*[`'"]\s*INSERT.*\+/i,
        /\.exec\s*\(\s*[`'"]\s*DELETE.*\+/i,
        /sql\s*[=:]\s*[`'"]\s*.*\+.*req\./i,
        /\$\{.*req\..*\}.*FROM/i,
        /WHERE.*=.*req\.body/i,
        /WHERE.*=.*req\.query/i,
        /WHERE.*=.*req\.params/i,
        /["'`]\s*SELECT\s+.*\s*WHERE.*\+/i, // String concatenation in WHERE
        /["'`]\s*.*SELECT.*\+\s*\w+/i, // SELECT with + variable
      ],
      severity: 'CRITICAL',
      category: 'A03-Injection',
      description: 'SQL injection vulnerability - user input directly in SQL query',
      remediation: 'Use parameterized queries or prepared statements. Never concatenate user input into SQL.',
    },
    {
      id: 'nosql-injection',
      name: 'NoSQL Injection',
      patterns: [
        /\.find\s*\(\s*req\.body/i,
        /\.find\s*\(\s*req\.query/i,
        /\.where\s*\(\s*req\.body/i,
        /\$where\s*:\s*req\./i,
      ],
      severity: 'CRITICAL',
      category: 'A03-Injection',
      description: 'NoSQL injection vulnerability - user input in query object',
      remediation: 'Sanitize and validate user input before using in NoSQL queries.',
    },
    {
      id: 'command-injection',
      name: 'Command Injection',
      patterns: [
        /exec\s*\(\s*[`'"]\s*.*\+/i,
        /spawn\s*\(\s*[`'"]\s*.*\+/i,
        /eval\s*\(\s*req\./i,
        /system\s*\(\s*[`'"]\s*.*\+/i,
        /\$\{.*req\..*\}/, // Shell command with template literal
      ],
      severity: 'CRITICAL',
      category: 'A03-Injection',
      description: 'Command injection vulnerability - user input in system command',
      remediation: 'Avoid shell commands with user input. Use safe APIs with proper escaping.',
    },
    {
      id: 'ldap-injection',
      name: 'LDAP Injection',
      patterns: [
        /ldap\.search\s*\(\s*[`'"]\s*.*\+/i,
        /\$\{.*req\..*\}.*LDAP/i,
      ],
      severity: 'CRITICAL',
      category: 'A03-Injection',
      description: 'LDAP injection vulnerability',
      remediation: 'Use parameterized LDAP queries or proper escaping.',
    },

    // A04: Insecure Design (missing security patterns)
    {
      id: 'missing-rate-limit',
      name: 'Missing Rate Limiting',
      patterns: [
        /\.post\s*\(\s*['"]\/login['"]/i,
        /\.post\s*\(\s*['"]\/auth['"]/i,
        /\.post\s*\(\s*['"]\/api\/['"]/i,
      ],
      severity: 'MEDIUM',
      category: 'A04-InsecureDesign',
      description: 'API endpoint without rate limiting',
      remediation: 'Add rate limiting to prevent brute force and abuse.',
    },
    {
      id: 'missing-input-validation',
      name: 'Missing Input Validation',
      patterns: [
        /req\.body\.\w+\s*[=:]\s*[^;]/i,
        /const\s+\w+\s*[=:]\s*req\.body\.\w+/i,
        /\.save\s*\(\s*req\.body\s*\)/i,
      ],
      severity: 'HIGH',
      category: 'A04-InsecureDesign',
      description: 'Direct use of request body without validation',
      remediation: 'Validate and sanitize all user input before processing.',
    },

    // A05: Security Misconfiguration
    {
      id: 'cors-misconfig',
      name: 'CORS Misconfiguration',
      patterns: [
        /cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/i,
        /Access-Control-Allow-Origin\s*:\s*['"]\*['"]/i,
        /origin\s*:\s*true/i,
      ],
      severity: 'HIGH',
      category: 'A05-SecurityMisconfiguration',
      description: 'Overly permissive CORS configuration',
      remediation: 'Restrict CORS to specific domains. Never use wildcard (*) for sensitive APIs.',
    },
    {
      id: 'cors-credentials',
      name: 'CORS with Credentials Wildcard',
      patterns: [
        /credentials\s*:\s*true/i,
        /origin\s*:\s*['"]\*['"]/i,
      ],
      severity: 'CRITICAL',
      category: 'A05-SecurityMisconfiguration',
      description: 'CORS credentials with wildcard origin - security violation',
      remediation: 'Cannot use credentials: true with origin: *. Specify allowed origins explicitly.',
    },
    {
      id: 'csp-missing',
      name: 'Missing Content Security Policy',
      patterns: [
        /Content-Security-Policy\s*:\s*['"]/i,
      ],
      severity: 'MEDIUM',
      category: 'A05-SecurityMisconfiguration',
      description: 'Missing or weak CSP header',
      remediation: 'Implement strong Content-Security-Policy header.',
    },
    {
      id: 'debug-enabled',
      name: 'Debug Mode Enabled',
      patterns: [
        /debug\s*[=:]\s*true/i,
        /DEBUG\s*[=:]\s*true/i,
        /NODE_ENV\s*[=:]\s*['"]development['"]/i,
        /\.env\s*\(\s*['"]development['"]/i,
      ],
      severity: 'MEDIUM',
      category: 'A05-SecurityMisconfiguration',
      description: 'Debug mode enabled in production-like code',
      remediation: 'Ensure debug mode is disabled in production.',
    },

    // A07: Auth Failures
    {
      id: 'weak-password',
      name: 'Weak Password Policy',
      patterns: [
        /password\.length\s*[<=>]\s*[1-5]/i,
        /minLength\s*:\s*[1-5]/i,
        /\.validate\s*\(\s*\{\s*minLength\s*:\s*[1-5]/i,
      ],
      severity: 'HIGH',
      category: 'A07-IdentificationAuthFailures',
      description: 'Weak password length requirement',
      remediation: 'Require minimum 8 characters for passwords. Use password strength validators.',
    },
    {
      id: 'session-fixation',
      name: 'Session Fixation Risk',
      patterns: [
        /session\s*\(\s*\{\s*secret\s*:\s*['"][^'"]{8,}['"]/i,
        /\.session\s*\(\s*req\.body/i,
      ],
      severity: 'HIGH',
      category: 'A07-IdentificationAuthFailures',
      description: 'Potential session fixation vulnerability',
      remediation: 'Regenerate session ID after authentication. Use strong session secrets.',
    },

    // A08: Software/Data Integrity
    {
      id: 'unsafe-deserialize',
      name: 'Unsafe Deserialization',
      patterns: [
        /JSON\.parse\s*\(\s*req\.body/i,
        /eval\s*\(\s*req\.body/i,
        /Function\s*\(\s*req\.body/i,
        /\.deserialize\s*\(\s*req\.body/i,
      ],
      severity: 'CRITICAL',
      category: 'A08-SoftwareDataIntegrity',
      description: 'Unsafe deserialization of user input',
      remediation: 'Validate and sanitize input before parsing. Avoid eval/Function with user data.',
    },

    // A09: Logging/Monitoring Failures
    {
      id: 'missing-error-log',
      name: 'Missing Error Logging',
      patterns: [
        /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/i, // Empty catch block
        /catch\s*\(\s*\)\s*\{/i,
        /\.catch\s*\(\s*\(\s*\)\s*[=>]\s*\{\s*\}/i,
      ],
      severity: 'MEDIUM',
      category: 'A09-LoggingMonitoringFailures',
      description: 'Error silently swallowed without logging',
      remediation: 'Log all errors for debugging and security monitoring.',
    },
    {
      id: 'sensitive-log',
      name: 'Sensitive Data in Log',
      patterns: [
        /console\.log\s*\(\s*.*password/i,
        /console\.log\s*\(\s*.*token/i,
        /console\.log\s*\(\s*.*secret/i,
        /logger\.info\s*\(\s*.*password/i,
        /log\s*\(\s*.*apiKey/i,
      ],
      severity: 'HIGH',
      category: 'A09-LoggingMonitoringFailures',
      description: 'Sensitive data being logged',
      remediation: 'Never log passwords, tokens, or secrets. Mask sensitive data in logs.',
    },

    // A10: SSRF
    {
      id: 'ssrf',
      name: 'Server-Side Request Forgery',
      patterns: [
        /fetch\s*\(\s*req\.body\.url/i,
        /fetch\s*\(\s*req\.query\.url/i,
        /axios\s*\(\s*req\.body\.url/i,
        /request\s*\(\s*req\.params\.url/i,
        /\.get\s*\(\s*req\.body/i,
      ],
      severity: 'CRITICAL',
      category: 'A10-SSRF',
      description: 'SSRF vulnerability - user-controlled URL in server request',
      remediation: 'Validate and whitelist allowed URLs. Never accept arbitrary URLs from users.',
    },

    // Additional: XSS (cross-cutting)
    {
      id: 'xss-innerHTML',
      name: 'XSS via innerHTML',
      patterns: [
        /\.innerHTML\s*[=:]\s*[^'"][^`]/i,
        /\.innerHTML\s*[=:]\s*req\./i,
        /dangerouslySetInnerHTML\s*[=:]\s*\{\{?\s*__html\s*:\s*[^'"]/i, // React syntax: {{ }} or { }
        /document\.write\s*\(/i,
      ],
      severity: 'CRITICAL',
      category: 'XSS',
      description: 'Potential XSS vulnerability via innerHTML',
      remediation: 'Use textContent or sanitize HTML before insertion.',
    },
    {
      id: 'xss-template',
      name: 'XSS via Template',
      patterns: [
        /\$\{.*req\..*\}/,
        /v-html\s*[=:]\s*[^'"]/i,
      ],
      severity: 'HIGH',
      category: 'XSS',
      description: 'User input in HTML template without sanitization',
      remediation: 'Sanitize user input before rendering in HTML.',
    },

    // Additional: Path Traversal
    {
      id: 'path-traversal',
      name: 'Path Traversal',
      patterns: [
        /readFileSync\s*\(\s*.*req\./i,
        /writeFile\s*\(\s*.*req\./i,
        /fs\.read\s*\(\s*.*req\.body/i,
        /\.sendFile\s*\(\s*req\.params/i,
        /path\.join\s*\(\s*.*req\./i,
        /\.open\s*\(\s*.*req\.body\.path/i,
      ],
      severity: 'CRITICAL',
      category: 'PathTraversal',
      description: 'Path traversal vulnerability - user input in file path',
      remediation: 'Validate and sanitize file paths. Use path.resolve and check against allowed directories.',
    },
  ]

  async check(input: ToolUseInput | ToolResultInput | StopInput, ctx: DetectorContext): Promise<DetectorResult> {
    // Only check ToolUseInput with Edit/Write tools (code being written)
    if (!('tool' in input)) return { triggered: false }
    if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool)) return { triggered: false }

    const args = input.args as { file_path?: string; content?: string; old_string?: string; new_string?: string }
    const codeContent = args.content ?? args.new_string ?? ''
    if (!codeContent) return { triggered: false }

    const findings: OWASPCheck[] = []

    for (const check of this.checks) {
      for (const pattern of check.patterns) {
        if (pattern.test(codeContent)) {
          findings.push(check)
          break // Only report each check once per scan
        }
      }
    }

    if (findings.length === 0) return { triggered: false }

    // Group findings by severity
    const critical = findings.filter(f => f.severity === 'CRITICAL')
    const high = findings.filter(f => f.severity === 'HIGH')

    if (critical.length > 0) {
      ctx.eventBus.emit('security.owasp_critical', {
        file: args.file_path,
        findings: critical.map(f => f.id)
      }, { sessionId: input.sessionId })

      return {
        triggered: true,
        severity: 'block',
        reason: this.formatFindings(critical, 'CRITICAL'),
        suggestion: 'Fix critical security vulnerabilities before committing.',
      }
    }

    if (high.length > 0) {
      ctx.eventBus.emit('security.owasp_high', {
        file: args.file_path,
        findings: high.map(f => f.id)
      }, { sessionId: input.sessionId })

      return {
        triggered: true,
        severity: 'warn',
        reason: this.formatFindings(high, 'HIGH'),
        suggestion: 'Review and fix high severity security issues.',
      }
    }

    // Medium severity - info only
    ctx.eventBus.emit('security.owasp_info', {
      file: args.file_path,
      findings: findings.map(f => f.id)
    }, { sessionId: input.sessionId })

    return {
      triggered: true,
      severity: 'warn',
      reason: this.formatFindings(findings.filter(f => f.severity === 'MEDIUM'), 'MEDIUM'),
    }
  }

  private formatFindings(findings: OWASPCheck[], severity: string): string {
    const lines = [
      `\n🚨 OWASP Security Alert (${severity})`,
      '',
    ]

    for (const f of findings) {
      lines.push(`[${f.category}] ${f.name}`)
      lines.push(`  Issue: ${f.description}`)
      lines.push(`  Fix: ${f.remediation}`)
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Manual scan for code review
   */
  scanCode(code: string): OWASPCheck[] {
    const findings: OWASPCheck[] = []
    for (const check of this.checks) {
      for (const pattern of check.patterns) {
        if (pattern.test(code)) {
          findings.push(check)
          break
        }
      }
    }
    return findings
  }

  /**
   * Get all check definitions
   */
  getChecks(): OWASPCheck[] {
    return this.checks
  }
}

/**
 * Security scan result for reporting
 */
export interface SecurityScanResult {
  file: string
  findings: OWASPCheck[]
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  summary: string
}

/**
 * Batch security scanner for multiple files
 */
export class SecurityScanner {
  private detector = new OWASPDetector()

  scanFile(content: string, filePath: string): SecurityScanResult {
    const findings = this.detector.scanCode(content)

    const riskLevel = this.calculateRiskLevel(findings)

    const summary = findings.length === 0
      ? 'No security issues detected'
      : `Found ${findings.length} potential security issues (${riskLevel} risk)`

    return {
      file: filePath,
      findings,
      riskLevel,
      summary,
    }
  }

  private calculateRiskLevel(findings: OWASPCheck[]): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    if (findings.some(f => f.severity === 'CRITICAL')) return 'CRITICAL'
    if (findings.some(f => f.severity === 'HIGH')) return 'HIGH'
    if (findings.some(f => f.severity === 'MEDIUM')) return 'MEDIUM'
    return 'LOW'
  }
}