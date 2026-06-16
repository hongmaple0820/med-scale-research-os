// SCALE Engine — TaskLevelDetector Tests

import { describe, it, expect } from 'vitest'
import { TaskLevelDetector } from '../../src/workflow/TaskLevelDetector.js'

describe('TaskLevelDetector', () => {
  const detector = new TaskLevelDetector()

  describe('classify', () => {
    it('classifies S level for small changes', () => {
      const result = detector.classify({
        fileCount: 2,
        lineDelta: 10,
        crossModule: false,
        criticalFileHits: [],
        descriptionKeywords: ['fix', 'typo'],
        topDirs: ['src'],
      })

      expect(result.level).toBe('S')
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('classifies M level for medium changes', () => {
      const result = detector.classify({
        fileCount: 8,
        lineDelta: 150,
        crossModule: false,
        criticalFileHits: [],
        descriptionKeywords: ['add', 'feature'],
        topDirs: ['src'],
      })

      expect(result.level).toBe('M')
    })

    it('classifies L or CRITICAL for large changes', () => {
      const result = detector.classify({
        fileCount: 25,
        lineDelta: 600,
        crossModule: true,
        criticalFileHits: [],
        descriptionKeywords: ['refactor', 'module'],
        topDirs: ['src', 'tests'],
      })

      expect(['L', 'CRITICAL']).toContain(result.level)
    })

    it('classifies CRITICAL when migration keyword detected', () => {
      const result = detector.classify({
        fileCount: 5,
        lineDelta: 100,
        crossModule: false,
        criticalFileHits: [],
        descriptionKeywords: ['database', 'migration'],
        topDirs: ['src'],
      })

      expect(result.level).toBe('CRITICAL')
    })

    it('classifies L or CRITICAL when critical file hit', () => {
      const result = detector.classify({
        fileCount: 3,
        lineDelta: 50,
        crossModule: false,
        criticalFileHits: ['src/auth/login.ts'],
        descriptionKeywords: ['update'],
        topDirs: ['src'],
      })

      expect(['L', 'CRITICAL']).toContain(result.level)
    })

    it('classifies L when cross-module change', () => {
      const result = detector.classify({
        fileCount: 10,
        lineDelta: 200,
        crossModule: true,
        criticalFileHits: [],
        descriptionKeywords: ['update'],
        topDirs: ['src', 'api', 'db'],
      })

      expect(result.level).toBe('L')
    })

    it('downgrades to S when S-level keywords present', () => {
      const result = detector.classify({
        fileCount: 8,
        lineDelta: 100,
        crossModule: false,
        criticalFileHits: [],
        descriptionKeywords: ['typo', 'readme'],
        topDirs: ['docs'],
      })

      expect(result.level).toBe('S')
    })

    it('returns reasons for classification', () => {
      const result = detector.classify({
        fileCount: 25,
        lineDelta: 600,
        crossModule: true,
        criticalFileHits: ['src/auth/login.ts'],
        descriptionKeywords: ['migration'],
        topDirs: ['src', 'db'],
      })

      expect(result.reasons.length).toBeGreaterThan(0)
      expect(result.reasons.some(r => r.includes('CRITICAL'))).toBe(true)
    })
  })

  describe('detectFromDescription', () => {
    it('detects S level from description', () => {
      const result = detector.detectFromDescription('fix typo in README', ['README.md'])

      expect(result.level).toBe('S')
    })

    it('detects CRITICAL from description', () => {
      const result = detector.detectFromDescription('add database migration for user auth', [
        'src/migrations/001_users.ts',
        'src/auth/login.ts',
      ])

      expect(result.level).toBe('CRITICAL')
    })

    it('detects L from large file list', () => {
      const files = Array.from({ length: 25 }, (_, i) => `src/module${i}/file.ts`)
      const result = detector.detectFromDescription('refactor modules', files)

      expect(result.level).toBe('L')
    })

    it('detects M for moderate changes', () => {
      const result = detector.detectFromDescription('add new feature for user profile', [
        'src/profile.ts',
        'src/profile.test.ts',
        'src/types.ts',
      ])

      expect(['M', 'S']).toContain(result.level)
    })
  })

  describe('edge cases', () => {
    it('handles empty file list', () => {
      const result = detector.detectFromDescription('simple task', [])

      expect(result.level).toBeDefined()
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('handles empty description', () => {
      const result = detector.detectFromDescription('', ['src/foo.ts'])

      expect(result.level).toBeDefined()
    })

    it('handles zero changes', () => {
      const result = detector.classify({
        fileCount: 0,
        lineDelta: 0,
        crossModule: false,
        criticalFileHits: [],
        descriptionKeywords: [],
        topDirs: [],
      })

      expect(result.level).toBe('S')
    })
  })
})
