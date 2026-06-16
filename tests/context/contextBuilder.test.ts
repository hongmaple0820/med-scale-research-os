// W6 Tests: ContextBuilder + KnowledgeBase
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { KnowledgeBase } from '../../src/knowledge/KnowledgeBase.js'
import { ContextBuilder } from '../../src/context/ContextBuilder.js'
import { INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-context'
const me = { kind: 'human' as const, userId: 'tester' }

describe('KnowledgeBase', () => {
  let bus: EventBus
  let kb: KnowledgeBase

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    kb = new KnowledgeBase(bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('add and recall', async () => {
    const entry = await kb.add({
      type: 'lesson',
      title: 'Always run tests before claiming done',
      tags: ['testing', 'workflow'],
      contentRef: 'lessons/001.md',
      verified: false,
    })
    expect(entry.id).toMatch(/^KB-/)
    expect(entry.relevance).toBe(0.5)

    const results = await kb.recall({ tags: ['testing'] })
    expect(results.length).toBe(1)
    expect(results[0].title).toContain('tests')
  })

  it('recall filters by type', async () => {
    await kb.add({ type: 'lesson', title: 'L1', tags: [], contentRef: 'a', verified: false })
    await kb.add({ type: 'pattern', title: 'P1', tags: [], contentRef: 'b', verified: false })
    const lessons = await kb.recall({ type: 'lesson' })
    expect(lessons.length).toBe(1)
    expect(lessons[0].title).toBe('L1')
  })

  it('recall filters by minRelevance', async () => {
    const e1 = await kb.add({ type: 'lesson', title: 'High', tags: [], contentRef: 'a', verified: false })
    const e2 = await kb.add({ type: 'lesson', title: 'Low', tags: [], contentRef: 'b', verified: false })
    // Manually set relevance
    await kb.markHelpful(e1.id, 's1')
    await kb.markHelpful(e1.id, 's1')
    await kb.markHelpful(e1.id, 's1')
    const results = await kb.recall({ minRelevance: 0.6 })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('High')
  })

  it('markHelpful increases relevance', async () => {
    const entry = await kb.add({ type: 'lesson', title: 'T', tags: [], contentRef: 'a', verified: false })
    const before = entry.relevance
    await kb.markHelpful(entry.id, 's1')
    const results = await kb.recall({})
    expect(results[0].relevance).toBeGreaterThan(before)
    expect(results[0].accessCount).toBe(1)
  })

  it('markUseless decreases relevance', async () => {
    const entry = await kb.add({ type: 'lesson', title: 'Bad', tags: [], contentRef: 'a', verified: false })
    const before = entry.relevance
    await kb.markUseless(entry.id, 's1')
    const results = await kb.recall({})
    expect(results[0].relevance).toBeLessThan(before)
  })

  it('verify marks entry as verified', async () => {
    const entry = await kb.add({ type: 'lesson', title: 'V', tags: [], contentRef: 'a', verified: false })
    await kb.verify(entry.id, 'reviewer1')
    const results = await kb.recall({ verifiedOnly: true })
    expect(results.length).toBe(1)
    expect(results[0].verified).toBe(true)
    expect(results[0].verifiedBy).toBe('reviewer1')
  })

  it('decay reduces old entries relevance', async () => {
    const entry = await kb.add({ type: 'lesson', title: 'Old', tags: [], contentRef: 'a', verified: false })
    // Simulate old access
    const results1 = await kb.recall({})
    const before = results1[0].relevance

    await kb.decay()
    const results2 = await kb.recall({})
    // Decay should slightly change relevance (since no lastAccessed, treated as 90 days old)
    expect(results2[0].relevance).toBeLessThanOrEqual(before)
  })

  it('recallByVector falls back to verified recall', async () => {
    await kb.add({ type: 'lesson', title: 'Unverified', tags: [], contentRef: 'a', verified: false })
    const v = await kb.add({ type: 'lesson', title: 'Verified', tags: [], contentRef: 'b', verified: false })
    await kb.verify(v.id, 'admin')

    const results = await kb.recallByVector('anything', 5)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Verified')
  })
})

describe('ContextBuilder', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let kb: KnowledgeBase
  let builder: ContextBuilder

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    kb = new KnowledgeBase(bus)
    builder = new ContextBuilder(store, kb, bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('builds basic context with system rules', async () => {
    const ctx = await builder.build({ sessionId: 'test-session' })
    expect(ctx.system).toContain('SCALE Engine v10.0')
    expect(ctx.metadata.layers).toContain('system_rules')
    expect(ctx.metadata.totalTokens).toBeGreaterThan(0)
  })

  it('includes role prompt when roleId provided', async () => {
    const ctx = await builder.build({ sessionId: 's1', roleId: 'implementer' })
    expect(ctx.system).toContain('implementer')
    expect(ctx.metadata.layers).toContain('role_prompt')
  })

  it('includes current artifact when artifactId provided', async () => {
    const spec = await store.create({
      type: 'Spec', title: 'My Feature',
      payload: { what: 'Build X' },
      initialStatus: INITIAL_STATES.Spec,
      createdBy: me,
    })
    const ctx = await builder.build({ sessionId: 's1', currentArtifactId: spec.id })
    expect(ctx.system).toContain('My Feature')
    expect(ctx.metadata.layers).toContain('current_artifact')
  })

  it('includes recalled lessons when artifact has knowledge', async () => {
    const entry = await kb.add({ type: 'lesson', title: 'Important lesson', tags: [], contentRef: 'a', verified: false })
    await kb.verify(entry.id, 'admin')

    const spec = await store.create({
      type: 'Spec', title: 'Test',
      payload: {},
      initialStatus: INITIAL_STATES.Spec,
      createdBy: me,
    })

    const ctx = await builder.build({ sessionId: 's1', currentArtifactId: spec.id })
    expect(ctx.metadata.layers).toContain('recalled_lessons')
    expect(ctx.system).toContain('Important lesson')
  })

  it('emits context.built event', async () => {
    let emitted = false
    bus.on('context.built', () => { emitted = true })
    await builder.build({ sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(emitted).toBe(true)
  })
})

