// OWASPDetector Unit Tests
// Tests for OWASP Top 10 security pattern detection

import { describe, it, expect } from 'vitest'
import { OWASPDetector, SecurityScanner } from '../../src/guardrails/OWASPDetector.js'
import type { ToolUseInput } from '../../src/artifact/types.js'

describe('OWASPDetector', () => {
  const detector = new OWASPDetector()

  describe('SQL Injection Detection', () => {
    it('should detect SQL injection with string concatenation', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-1',
        tool: 'Write',
        args: {
          file_path: 'db.ts',
          content: `const query = "SELECT * FROM users WHERE id = " + userId;`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('SQL Injection')
    })

    it('should detect SQL injection with template literal', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-2',
        tool: 'Write',
        args: {
          file_path: 'api.ts',
          content: `db.query(\`SELECT * FROM users WHERE name = '\${req.body.name}'\`)`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
    })

    it('should not flag parameterized queries', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-3',
        tool: 'Write',
        args: {
          file_path: 'safe.ts',
          content: `db.query('SELECT * FROM users WHERE id = $1', [userId])`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(false)
    })
  })

  describe('XSS Detection', () => {
    it('should detect innerHTML assignment', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-4',
        tool: 'Write',
        args: {
          file_path: 'ui.ts',
          content: `element.innerHTML = userInput;`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('XSS')
    })

    it('should detect dangerouslySetInnerHTML', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-5',
        tool: 'Write',
        args: {
          file_path: 'react.tsx',
          content: `<div dangerouslySetInnerHTML={{ __html: userContent }} />`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
    })
  })

  describe('Auth Bypass Detection', () => {
    it('should detect skipAuth = true', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-6',
        tool: 'Edit',
        args: {
          file_path: 'auth.ts',
          old_string: 'const authenticated = true;',
          new_string: 'const skipAuth = true;'
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('Authentication Bypass')
    })
  })

  describe('Weak Crypto Detection', () => {
    it('should detect MD5 usage', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-7',
        tool: 'Write',
        args: {
          file_path: 'hash.ts',
          content: `const hash = md5(password);`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      // MD5 is HIGH severity (not CRITICAL) - still dangerous but not immediately exploitable
      expect(result.severity).toBe('warn')
      expect(result.reason).toContain('Weak Cryptography')
    })

    it('should detect SHA1 usage', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-8',
        tool: 'Write',
        args: {
          file_path: 'crypto.ts',
          content: `const digest = createHash('sha1').update(data).digest('hex');`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
    })
  })

  describe('Hardcoded Secret Detection', () => {
    it('should detect hardcoded password', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-9',
        tool: 'Write',
        args: {
          file_path: 'config.ts',
          content: `const password = "supersecret123";`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('Hardcoded Secret')
    })

    it('should detect hardcoded API key', async () => {
      const awsKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
      const input: ToolUseInput = {
        sessionId: 'test-10',
        tool: 'Write',
        args: {
          file_path: 'api.ts',
          content: `const api_key = "${awsKey}";`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
    })
  })

  describe('SSRF Detection', () => {
    it('should detect user-controlled URL in fetch', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-11',
        tool: 'Write',
        args: {
          file_path: 'proxy.ts',
          content: `fetch(req.body.url);`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('SSRF')
    })
  })

  describe('Path Traversal Detection', () => {
    it('should detect user input in readFileSync', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-12',
        tool: 'Write',
        args: {
          file_path: 'files.ts',
          content: `fs.readFileSync(req.params.path);`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('Path Traversal')
    })
  })

  describe('CORS Misconfiguration Detection', () => {
    it('should detect wildcard CORS', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-13',
        tool: 'Write',
        args: {
          file_path: 'server.ts',
          content: `cors({ origin: '*' })`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
    })
  })

  describe('Command Injection Detection', () => {
    it('should detect eval with user input', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-14',
        tool: 'Write',
        args: {
          file_path: 'exec.ts',
          content: `eval(req.body.code);`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.severity).toBe('block')
      expect(result.reason).toContain('Command Injection')
    })
  })

  describe('Empty Catch Block Detection', () => {
    it('should detect empty catch', async () => {
      const input: ToolUseInput = {
        sessionId: 'test-15',
        tool: 'Write',
        args: {
          file_path: 'error.ts',
          content: `try { doSomething(); } catch (e) { }`
        }
      }

      const result = await detector.check(input, {
        eventBus: { emit: () => {}, query: async () => [] } as any,
        cache: new Map()
      })

      expect(result.triggered).toBe(true)
      expect(result.reason).toContain('Error silently swallowed')
    })
  })

  describe('SecurityScanner', () => {
    const scanner = new SecurityScanner()

    it('should return CRITICAL risk level for SQL injection', () => {
      const maliciousCode = `
        const query = "SELECT * FROM users WHERE id = " + userId;
        const hash = md5(password);
        eval(userInput);
      `

      const result = scanner.scanFile(maliciousCode, 'malicious.ts')

      // SQL injection and command injection are CRITICAL severity
      expect(result.riskLevel).toBe('CRITICAL')
      expect(result.findings.length).toBeGreaterThan(0)
    })

    it('should return CRITICAL for auth bypass and hardcoded secrets', () => {
      const awsKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
      const criticalCode = `
        const skipAuth = true;
        const api_key = "${awsKey}";
      `

      const result = scanner.scanFile(criticalCode, 'critical.ts')

      expect(result.riskLevel).toBe('CRITICAL')
    })

    it('should return LOW for clean code', () => {
      const cleanCode = `
        const query = db.query('SELECT * FROM users WHERE id = $1', [userId]);
        const hash = bcrypt.hashSync(password, 10);
      `

      const result = scanner.scanFile(cleanCode, 'clean.ts')

      expect(result.riskLevel).toBe('LOW')
      expect(result.findings.length).toBe(0)
    })
  })

  describe('scanCode method', () => {
    it('should return all matching checks', () => {
      const code = `
        const query = "SELECT * FROM users WHERE id = " + userId;
        element.innerHTML = userInput;
        eval(req.body.code);
      `

      const findings = detector.scanCode(code)

      expect(findings.length).toBeGreaterThanOrEqual(2)
      // SQL injection and command injection should be detected
      expect(findings.some(f => f.id === 'sql-injection')).toBe(true)
      expect(findings.some(f => f.id === 'command-injection')).toBe(true)
    })
  })
})
