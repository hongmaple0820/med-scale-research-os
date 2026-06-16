---
paths:
  - "**/*"
---
# Security Guidelines

## Mandatory Checks

Before ANY commit:
- [ ] No hardcoded secrets
- [ ] All user inputs validated
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Auth/authorization verified

## Secret Management

- NEVER hardcode secrets in code
- ALWAYS use environment variables
- Validate secrets at startup
- Rotate exposed secrets

## OWASP Top 10

1. Broken Access Control
2. Cryptographic Failures
3. Injection
4. Insecure Design
5. Security Misconfiguration
6. Vulnerable Components
7. Auth Failures
8. Data Integrity
9. Logging Failures
10. SSRF

## Response Protocol

If security issue found:
1. STOP immediately
2. Fix CRITICAL issues first
3. Rotate exposed secrets
4. Review for similar issues
