// Tests: SQLiteKnowledgeBase — persistent knowledge storage
// NOTE: better-sqlite3 is not supported in Bun runtime
// These tests will be skipped when running with Bun test runner

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

// Detect Bun runtime
const isBun = typeof process !== 'undefined' && process.versions?.bun !== undefined

// Skip all tests in Bun environment
const describeOrSkip = isBun ? describe.skip : describe

const TMP = './tmp/test-sqlite-kb'
const DB = `${TMP}/knowledge.db`
const EVT = `${TMP}/events`

describeOrSkip('SQLiteKnowledgeBase', async () => {
  // Dynamic imports for non-Bun environments
  const { EventBus } = await import('../../src/core/eventBus.js')
  const { SQLiteKnowledgeBase } = await import('../../src/knowledge/SQLiteKnowledgeBase.js')

  let bus: InstanceType<typeof EventBus>
  let kb: InstanceType<typeof SQLiteKnowledgeBase>

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: EVT })
    kb = new SQLiteKnowledgeBase(bus, { dbPath: DB })
  })

  afterEach(() => {
    kb.close()
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  // ===== add + recall =====

  it('add creates entry and recall retrieves it', async () => {
    const entry = await kb.add({
      type: 'lesson',
      title: 'Always validate input',
      tags: ['validation', 'security'],
      contentRef: 'lessons/validate.md',
      verified: false,
      sourceArtifact: 'DEFECT-0001',
    })
    expect(entry.id).toMatch(/^KB-/)
    expect(entry.relevance).toBe(0.5)
    expect(entry.accessCount).toBe(0)

    const results = await kb.recall({ type: 'lesson' })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Always validate input')
    expect(results[0].tags).toContain('validation')
  })

  it('recall filters by tags', async () => {
    await kb.add({ type: 'lesson', title: 'A', tags: ['x', 'y'], contentRef: '', verified: false })
    await kb.add({ type: 'lesson', title: 'B', tags: ['x', 'z'], contentRef: '', verified: false })

    const results = await kb.recall({ tags: ['y'] })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('A')
  })

  it('recall filters by minRelevance', async () => {
    const e = await kb.add({ type: 'lesson', title: 'Hot', tags: [], contentRef: '', verified: false })
    // Boost relevance
    for (let i = 0; i < 10; i++) await kb.markHelpful(e.id, 's1')

    const results = await kb.recall({ minRelevance: 0.9 })
    expect(results.length).toBe(1)
  })

  it('recall filters verifiedOnly', async () => {
    await kb.add({ type: 'lesson', title: 'Unverified', tags: [], contentRef: '', verified: false })
    const e2 = await kb.add({ type: 'lesson', title: 'Verified', tags: [], contentRef: '', verified: false })
    await kb.verify(e2.id, 'admin')

    const results = await kb.recall({ verifiedOnly: true })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Verified')
  })

  it('recall respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await kb.add({ type: 'lesson', title: `L${i}`, tags: [], contentRef: '', verified: false })
    }
    const results = await kb.recall({ limit: 3 })
    expect(results.length).toBe(3)
  })

  it('recall filters by multiple types', async () => {
    await kb.add({ type: 'lesson', title: 'L', tags: [], contentRef: '', verified: false })
    await kb.add({ type: 'pattern', title: 'P', tags: [], contentRef: '', verified: false })
    await kb.add({ type: 'best_practice', title: 'B', tags: [], contentRef: '', verified: false })

    const results = await kb.recall({ type: ['lesson', 'pattern'] })
    expect(results.length).toBe(2)
  })

  // ===== markHelpful / markUseless =====

  it('markHelpful increases relevance and accessCount', async () => {
    const e = await kb.add({ type: 'lesson', title: 'T', tags: [], contentRef: '', verified: false })
    expect(e.relevance).toBe(0.5)

    await kb.markHelpful(e.id, 'session-1')
    const results = await kb.recall({ type: 'lesson' })
    expect(results[0].relevance).toBeGreaterThan(0.5)
    expect(results[0].accessCount).toBe(1)
  })

  it('markUseless decreases relevance', async () => {
    const e = await kb.add({ type: 'lesson', title: 'T', tags: [], contentRef: '', verified: false })
    await kb.markUseless(e.id, 'session-1')
    const results = await kb.recall({ type: 'lesson' })
    expect(results[0].relevance).toBeLessThan(0.5)
  })

  it('markHelpful on missing id is a no-op', async () => {
    await kb.markHelpful('nonexistent', 's1') // should not throw
  })

  it('markUseless on missing id is a no-op', async () => {
    await kb.markUseless('nonexistent', 's1') // should not throw
  })

  // ===== verify =====

  it('verify sets verified flag', async () => {
    const e = await kb.add({ type: 'lesson', title: 'T', tags: [], contentRef: '', verified: false })
    expect(e.verified).toBe(false)

    await kb.verify(e.id, 'admin')
    const results = await kb.recall({ type: 'lesson' })
    expect(results[0].verified).toBe(true)
    expect(results[0].verifiedBy).toBe('admin')
    expect(results[0].verifiedAt).toBeDefined()
  })

  // ===== decay =====

  it('decay adjusts relevance based on recency', async () => {
    const e = await kb.add({ type: 'lesson', title: 'Old', tags: [], contentRef: '', verified: false })
    // Initial relevance is 0.5
    await kb.decay()
    const results = await kb.recall({ type: 'lesson' })
    // After decay, relevance should be adjusted (old entry with no lastAccessed → low recency)
    expect(results[0].relevance).toBeDefined()
    expect(results[0].relevance).toBeGreaterThanOrEqual(0.05)
  })

  // ===== persistence =====

  it('data survives close + reopen', async () => {
    await kb.add({ type: 'lesson', title: 'Persistent', tags: ['persist'], contentRef: '', verified: false })
    kb.close()

    const kb2 = new SQLiteKnowledgeBase(bus, { dbPath: DB })
    const results = await kb2.recall({ type: 'lesson' })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Persistent')
    kb2.close()

    // Re-assign so afterEach can close
    kb = new SQLiteKnowledgeBase(bus, { dbPath: DB })
  })

  it('relevance and accessCount persist across restarts', async () => {
    const e = await kb.add({ type: 'lesson', title: 'T', tags: [], contentRef: '', verified: false })
    await kb.markHelpful(e.id, 's1')
    await kb.markHelpful(e.id, 's1')
    await kb.verify(e.id, 'admin')
    kb.close()

    const kb2 = new SQLiteKnowledgeBase(bus, { dbPath: DB })
    const results = await kb2.recall({ type: 'lesson' })
    expect(results[0].accessCount).toBe(2)
    expect(results[0].verified).toBe(true)
    expect(results[0].relevance).toBeGreaterThan(0.5)
    kb2.close()
    kb = new SQLiteKnowledgeBase(bus, { dbPath: DB })
  })

  // ===== stats =====

  it('stats returns correct counts', async () => {
    await kb.add({ type: 'lesson', title: 'L', tags: [], contentRef: '', verified: false })
    await kb.add({ type: 'pattern', title: 'P', tags: [], contentRef: '', verified: false })
    const s = kb.stats()
    expect(s.entryCount).toBe(2)
    expect(s.byType['lesson']).toBe(1)
    expect(s.byType['pattern']).toBe(1)
  })

  // ===== recallByVector =====

  it('recallByVector falls back to recall', async () => {
    const e = await kb.add({ type: 'lesson', title: 'V', tags: [], contentRef: '', verified: false })
    await kb.verify(e.id, 'admin')
    const results = await kb.recallByVector('some text', 5)
    expect(results.length).toBe(1)
  })

  // ===== events =====

  it('emits lesson.proposed on add', async () => {
    let emitted = false
    bus.on('lesson.proposed', () => { emitted = true })
    await kb.add({ type: 'lesson', title: 'E', tags: [], contentRef: '', verified: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(emitted).toBe(true)
  })

  it('emits lesson.helpful on markHelpful', async () => {
    const e = await kb.add({ type: 'lesson', title: 'E', tags: [], contentRef: '', verified: false })
    let emitted = false
    bus.on('lesson.helpful', () => { emitted = true })
    await kb.markHelpful(e.id, 's1')
    await new Promise((r) => setTimeout(r, 20))
    expect(emitted).toBe(true)
  })

  it('emits lesson.approved on verify', async () => {
    const e = await kb.add({ type: 'lesson', title: 'E', tags: [], contentRef: '', verified: false })
    let emitted = false
    bus.on('lesson.approved', () => { emitted = true })
    await kb.verify(e.id, 'admin')
    await new Promise((r) => setTimeout(r, 20))
    expect(emitted).toBe(true)
  })
})
