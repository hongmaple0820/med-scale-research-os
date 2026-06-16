import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CerebrumManager } from '../../src/knowledge/CerebrumManager.js'
import { SQLiteKnowledgeBase } from '../../src/knowledge/SQLiteKnowledgeBase.js'

function makeTestDir(): string {
  const dir = join(tmpdir(), `scale-test-cerebrum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch { /* Windows may lock files */ }
}

function createMockEventBus() {
  return { emit: () => {}, on: () => {}, off: () => {} } as any
}

describe('CerebrumManager', () => {
  let manager: CerebrumManager
  let kb: SQLiteKnowledgeBase
  let testDir: string

  beforeEach(() => {
    testDir = makeTestDir()
    const dbPath = join(testDir, 'test-kb.db')
    kb = new SQLiteKnowledgeBase(createMockEventBus(), { dbPath })
    manager = new CerebrumManager(kb)
  })

  afterEach(() => {
    kb.close()
    cleanupDir(testDir)
  })

  describe('addDoNotRepeat', () => {
    it('adds a do-not-repeat entry', async () => {
      const entry = await manager.addDoNotRepeat('never use var', 'Always use const or let')

      expect(entry.type).toBe('do_not_repeat')
      expect(entry.pattern).toBe('never use var')
      expect(entry.description).toBe('Always use const or let')
      expect(entry.id).toBeTruthy()
    })

    it('persists to knowledge base', async () => {
      await manager.addDoNotRepeat('no console.log', 'Use logger instead')

      const results = await kb.recall({ type: 'do_not_repeat', limit: 10 })
      expect(results.length).toBe(1)
      expect(results[0].title).toBe('no console.log')
    })
  })

  describe('addPreference', () => {
    it('adds a preference entry', async () => {
      const entry = await manager.addPreference('Use TypeScript strict mode', ['typescript'])

      expect(entry.type).toBe('preference')
      expect(entry.description).toBe('Use TypeScript strict mode')
    })

    it('persists to knowledge base', async () => {
      await manager.addPreference('Use 2 spaces for indentation')

      const results = await kb.recall({ type: 'preference', limit: 10 })
      expect(results.length).toBe(1)
    })
  })

  describe('check', () => {
    it('returns empty when no rules exist', () => {
      const hits = manager.check('const x = 1')
      expect(hits).toEqual([])
    })

    it('detects do-not-repeat pattern overlap', async () => {
      await manager.addDoNotRepeat('never use var keyword', 'Always use const or let')

      const hits = manager.check('var x = 1 // using var keyword')
      expect(hits.length).toBe(1)
      expect(hits[0].entry.pattern).toBe('never use var keyword')
    })

    it('does not match unrelated content', async () => {
      await manager.addDoNotRepeat('never use var keyword', 'Always use const or let')

      const hits = manager.check('const x = 1 // using const')
      expect(hits.length).toBe(0)
    })

    it('increments hit count on match', async () => {
      await manager.addDoNotRepeat('avoid console.log statements', 'Use proper logging')

      manager.check('console.log("debug") // just a log statement')
      const entries = manager.getEntries()
      const dnr = entries.find(e => e.pattern === 'avoid console.log statements')
      expect(dnr!.hitCount).toBe(1)
    })

    it('checks multiple rules', async () => {
      await manager.addDoNotRepeat('never use var', 'Use const or let')
      await manager.addDoNotRepeat('no any type', 'Use proper TypeScript types')

      const hits = manager.check('var x: any = getValue()')
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('loadAll', () => {
    it('loads entries from knowledge base', async () => {
      await manager.addDoNotRepeat('rule1', 'desc1')
      await manager.addPreference('pref1')

      const freshManager = new CerebrumManager(kb)
      const entries = await freshManager.loadAll()

      expect(entries.length).toBe(2)
      expect(entries.some(e => e.type === 'do_not_repeat')).toBe(true)
      expect(entries.some(e => e.type === 'preference')).toBe(true)
    })
  })

  describe('toMarkdown', () => {
    it('generates markdown with sections', async () => {
      await manager.addDoNotRepeat('no var usage', 'Use const or let')
      await manager.addPreference('TypeScript strict mode')

      const md = manager.toMarkdown()

      expect(md).toContain('# cerebrum.md')
      expect(md).toContain('## Do Not Repeat')
      expect(md).toContain('no var usage')
      expect(md).toContain('## Preferences')
      expect(md).toContain('TypeScript strict mode')
    })

    it('shows empty state when no entries', () => {
      const md = manager.toMarkdown()
      expect(md).toContain('No entries yet')
    })
  })

  describe('getEntries', () => {
    it('returns all loaded entries', async () => {
      await manager.addDoNotRepeat('rule1', 'desc1')
      await manager.addDoNotRepeat('rule2', 'desc2')
      await manager.addPreference('pref1')

      expect(manager.getEntries().length).toBe(3)
    })
  })
})
