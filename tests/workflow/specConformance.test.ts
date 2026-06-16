// Spec Conformance Analysis Unit Tests (双轴 Review — Spec 维度)
import { describe, it, expect } from 'vitest'
import { analyzeSpecConformance, type ChangedFile, type DiffInput } from '../../src/workflow/ReviewAnalyzer.js'

describe('analyzeSpecConformance', () => {
  it('returns high coverage when all spec keywords appear in changed files', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/auth/login.ts' },
      { status: 'A', path: 'src/auth/OAuthProvider.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/auth/login.ts', text: 'function authenticate() { ... }' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Implement OAuth login with "OAuthProvider" token-based "authenticate" flow',
      changedFiles,
      diffs,
    })

    expect(result.coverageScore).toBeGreaterThan(0.5)
    // Should find: OAuthProvider (PascalCase), authenticate (quoted), login
  })

  it('reports missing when spec keyword is not in diffs', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/ui/button.tsx' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/ui/button.tsx', text: 'export const Button = () => <button>Click</button>' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Implement "PaymentGateway" with Stripe integration',
      changedFiles,
      diffs,
    })

    expect(result.coverageScore).toBeLessThan(1.0)
    expect(result.specFindings.some(f => f.type === 'missing')).toBe(true)
  })

  it('detects scope creep when changed files are unrelated to spec', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/unrelated/logger.ts' },
      { status: 'A', path: 'src/unrelated/cache.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/unrelated/logger.ts', text: 'console.log' },
      { file: 'src/unrelated/cache.ts', text: 'Map' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Implement user "authentication" module',
      changedFiles,
      diffs,
    })

    expect(result.specFindings.some(f => f.type === 'extra')).toBe(true)
  })

  it('ignores .scale/ and node_modules/ files in scope creep check', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: '.scale/events/2026.jsonl' },
      { status: 'M', path: 'node_modules/pkg/index.js' },
      { status: 'M', path: 'dist/bundle.js' },
    ]
    const diffs: DiffInput[] = []

    const result = analyzeSpecConformance({
      specContent: 'Implement feature X',
      changedFiles,
      diffs,
    })

    // No "extra" findings because all files are in ignored dirs
    expect(result.specFindings.filter(f => f.type === 'extra')).toHaveLength(0)
  })

  it('extracts PascalCase identifiers from spec', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'A', path: 'src/models/UserProfile.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/models/UserProfile.ts', text: 'export class UserProfile {}' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Create UserProfile model with AddressValidation',
      changedFiles,
      diffs,
    })

    expect(result.coverageScore).toBeGreaterThan(0)
  })

  it('extracts quoted terms from spec', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/api/webhook.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/api/webhook.ts', text: 'webhook handler for stripe events' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Add "stripe" webhook handler',
      changedFiles,
      diffs,
    })

    expect(result.coverageScore).toBeGreaterThan(0)
  })

  it('returns 1.0 coverage for empty spec (no keywords to check)', () => {
    const result = analyzeSpecConformance({
      specContent: '',
      changedFiles: [],
      diffs: [],
    })

    expect(result.coverageScore).toBe(1.0)
    expect(result.specFindings).toHaveLength(0)
  })

  it('uses taskDescription for keyword extraction', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/payment/checkout.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/payment/checkout.ts', text: 'checkout flow implementation' },
    ]

    const result = analyzeSpecConformance({
      specContent: '',
      changedFiles,
      diffs,
      taskDescription: 'Implement checkout payment flow',
    })

    // Should find "checkout" from taskDescription
    expect(result.coverageScore).toBeGreaterThan(0)
  })

  it('filters out stop words from keywords', () => {
    const changedFiles: ChangedFile[] = [
      { status: 'M', path: 'src/feature.ts' },
    ]
    const diffs: DiffInput[] = [
      { file: 'src/feature.ts', text: 'specific implementation' },
    ]

    const result = analyzeSpecConformance({
      specContent: 'Implement the feature with this description and that requirement',
      changedFiles,
      diffs,
    })

    // "the", "this", "that", "and", "with", "implement", "description", "requirement" should be filtered
    const missing = result.specFindings.filter(f => f.type === 'missing')
    // If stop words work, only "feature" should be extracted (and it matches)
    expect(missing).toHaveLength(0)
  })
})
