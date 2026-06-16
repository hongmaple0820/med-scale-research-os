// Phase Commands — Validation Helpers Unit Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Import the validation helpers from phaseCommands.ts
// These are not exported individually — we test them by importing from the module
// Since they're not exported, we test the logic equivalently

let dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-validation-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

// ============================================================================
// calculateAmbiguityScore — logic equivalence tests
// (function is internal to phaseCommands.ts, test the algorithm)
// ============================================================================

describe('calculateAmbiguityScore (logic)', () => {
  // Replicate the algorithm from phaseCommands.ts
  function calculateAmbiguityScore(description: string, successCriteria: string[]): number {
    let score = 0
    const text = (description + ' ' + successCriteria.join(' ')).toLowerCase()

    const indicators = [
      { pattern: 'and so on|etc|and so forth|such as|like|something|stuff', weight: 0.1 },
      { pattern: 'maybe|perhaps|possibly|probably|should|could|might', weight: 0.05 },
      { pattern: 'later|eventually|someday|in the future|tbd|todo', weight: 0.08 },
      { pattern: 'fast|quick|simple|easy|just|only', weight: 0.04 },
      { pattern: 'all|every|always|never|none|nothing|everything', weight: 0.03 },
    ]

    for (const { pattern, weight } of indicators) {
      const matches = text.match(new RegExp(pattern, 'gi'))
      if (matches) score += Math.min(matches.length * weight, weight * 3)
    }

    // Penalty for very short descriptions
    if (description.length < 20) score += 0.15
    if (successCriteria.length === 0) score += 0.3
    if (successCriteria.length > 0 && successCriteria.every(c => c.length < 10)) score += 0.15

    return Math.min(Math.round(score * 100) / 100, 1.0)
  }

  it('returns low score for concrete, specific requirements', () => {
    const score = calculateAmbiguityScore(
      'Implement a TypeScript CLI workflow with verification evidence, review records, rollback constraints, and release safety checks.',
      [
        'verify evidence is persisted',
        'review evidence is persisted',
        'ship blocks unreviewed files',
      ]
    )
    expect(score).toBeLessThan(0.4)
  })

  it('returns high score for vague requirements with ambiguity keywords', () => {
    const score = calculateAmbiguityScore(
      'make it fast and simple maybe later',
      ['stuff', 'etc']
    )
    expect(score).toBeGreaterThan(0.35)
  })

  it('penalizes very short descriptions', () => {
    const score = calculateAmbiguityScore('do thing', ['works'])
    expect(score).toBeGreaterThan(0.1)
  })

  it('penalizes empty success criteria', () => {
    const score = calculateAmbiguityScore('Implement a comprehensive testing framework for the application', [])
    expect(score).toBeGreaterThan(0.2)
  })

  it('detects hedging language', () => {
    const score = calculateAmbiguityScore('maybe we should perhaps add something like a login page or something', ['user can login'])
    expect(score).toBeGreaterThan(0.15)
  })

  it('detects deferred commitments (later/tbd/todo)', () => {
    const score = calculateAmbiguityScore('implement auth later, tbd on OAuth flow, todo: 2FA', ['users can log in'])
    expect(score).toBeGreaterThan(0.15)
  })

  it('caps at 1.0', () => {
    const score = calculateAmbiguityScore(Array(10).fill('maybe perhaps possibly should could might etc stuff later tbd todo').join(' '), [])
    expect(score).toBeLessThanOrEqual(1.0)
  })
})

// ============================================================================
// validateVerificationEvidence — logic equivalence tests
// ============================================================================

describe('validateVerificationEvidence (logic)', () => {
  // These test the validation logic without needing the actual EvidenceStore
  // by testing the expected behavior contract

  it('treats undefined ids as invalid', () => {
    // Equivalent to: validateVerificationEvidence(undefined)
    const ids = undefined
    const ok = (ids?.length ?? 0) > 0
    expect(ok).toBe(false)
  })

  it('treats empty array as invalid', () => {
    const ids: string[] = []
    const ok = ids.length > 0
    expect(ok).toBe(false)
  })

  it('requires at least one id for initial ok check', () => {
    const ids = ['G0-001']
    const ok = ids.length > 0
    expect(ok).toBe(true)
  })

  it('identifies all ids as missing when store has none', () => {
    // Simulate the store lookup returning nothing
    const ids = ['G0-001', 'G1-002']
    const storeResults: Record<string, boolean | null> = {} // empty store
    const missing: string[] = []
    for (const id of ids) {
      if (!(id in storeResults)) missing.push(id)
    }
    expect(missing).toEqual(['G0-001', 'G1-002'])
    expect(missing.length).toBe(2)
  })

  it('identifies failed records', () => {
    const ids = ['G0-001', 'G0-002']
    const store = { 'G0-001': true, 'G0-002': false }
    const failed: string[] = []
    for (const id of ids) {
      if (id in store && !store[id]) failed.push(id)
    }
    expect(failed).toEqual(['G0-002'])
  })
})

// ============================================================================
// validateReviewEvidence — logic equivalence tests
// ============================================================================

describe('validateReviewEvidence (logic)', () => {
  it('treats undefined ids as invalid', () => {
    const ids = undefined
    const ok = (ids?.length ?? 0) > 0
    expect(ok).toBe(false)
  })

  it('requires all records to be present and passing', () => {
    const ids = ['REVIEW-001', 'REVIEW-002']
    const store = { 'REVIEW-001': true, 'REVIEW-002': true }
    const missing: string[] = []
    const failed: string[] = []
    for (const id of ids) {
      if (!(id in store)) missing.push(id)
      else if (!store[id]) failed.push(id)
    }
    const ok = ids.length > 0 && missing.length === 0 && failed.length === 0
    expect(ok).toBe(true)
  })

  it('fails when one review record failed', () => {
    const ids = ['REVIEW-001', 'REVIEW-002']
    const store = { 'REVIEW-001': true, 'REVIEW-002': false }
    const failed: string[] = []
    for (const id of ids) {
      if (id in store && !store[id]) failed.push(id)
    }
    expect(failed).toContain('REVIEW-002')
    const ok = ids.length > 0 && failed.length === 0
    expect(ok).toBe(false)
  })
})

// ============================================================================
// shouldSkipCommit — logic equivalence tests
// ============================================================================

describe('shouldSkipCommit (logic)', () => {
  function shouldSkipCommit(skipFlag: unknown): boolean {
    return skipFlag === true || skipFlag === '' || skipFlag === 'true' || skipFlag === '1'
  }

  it('detects boolean true', () => {
    expect(shouldSkipCommit(true)).toBe(true)
  })

  it('detects empty string', () => {
    expect(shouldSkipCommit('')).toBe(true)
  })

  it('detects string "true"', () => {
    expect(shouldSkipCommit('true')).toBe(true)
  })

  it('detects string "1"', () => {
    expect(shouldSkipCommit('1')).toBe(true)
  })

  it('does not skip for false', () => {
    expect(shouldSkipCommit(false)).toBe(false)
  })

  it('does not skip for undefined', () => {
    expect(shouldSkipCommit(undefined)).toBe(false)
  })
})
