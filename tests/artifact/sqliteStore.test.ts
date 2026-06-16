// W3 Tests: SQLiteArtifactStore
// NOTE: better-sqlite3 is not supported in Bun runtime
// These tests will be skipped when running with Bun test runner

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

// Detect Bun runtime
const isBun = typeof process !== 'undefined' && process.versions?.bun !== undefined

// Skip all tests in Bun environment
const describeOrSkip = isBun ? describe.skip : describe

const TMP = './tmp/test-sqlite'
const DB = `${TMP}/test.db`
const EVT = `${TMP}/events`
const ART = `${TMP}/artifacts`
const me = { kind: 'human' as const, userId: 'tester' }

describeOrSkip('SQLiteArtifactStore', async () => {
  // Dynamic imports for non-Bun environments
  const { EventBus } = await import('../../src/core/eventBus.js')
  const { SQLiteArtifactStore } = await import('../../src/artifact/sqliteStore.js')
  const { FSM } = await import('../../src/artifact/fsm.js')
  const { registerAllFSMs, INITIAL_STATES } = await import('../../src/artifact/fsmDefinitions.js')
  const { ArtifactNotFoundError } = await import('../../src/artifact/types.js')

  let bus: InstanceType<typeof EventBus>
  let store: InstanceType<typeof SQLiteArtifactStore>

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: EVT })
    store = new SQLiteArtifactStore(bus, { dbPath: DB, artifactsDir: ART })
  })

  afterEach(() => {
    store.close()
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('create + get', async () => {
    const a = await store.create({ type: 'Spec', title: 'T', payload: { x: 1 }, initialStatus: 'DRAFT', createdBy: me })
    expect(a.id).toMatch(/^SPEC-/)
    const loaded = await store.get(a.id)
    expect(loaded!.title).toBe('T')
    expect(loaded!.payload).toEqual({ x: 1 })
  })

  it('get returns null for missing', async () => {
    expect(await store.get('NOPE-0000')).toBeNull()
  })

  it('update increments version', async () => {
    const a = await store.create({ type: 'Task', title: 'T1', payload: {}, initialStatus: 'PENDING', createdBy: me })
    const u = await store.update(a.id, { title: 'T1v2' })
    expect(u.version).toBe(2)
    expect(u.title).toBe('T1v2')
  })

  it('update throws on missing', async () => {
    await expect(store.update('NOPE', { title: 'x' })).rejects.toThrow(ArtifactNotFoundError)
  })

  it('delete removes artifact', async () => {
    const a = await store.create({ type: 'Need', title: 'D', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    await store.delete(a.id)
    expect(await store.get(a.id)).toBeNull()
  })

  it('parent-child edges', async () => {
    const p = await store.create({ type: 'Spec', title: 'P', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    const c = await store.create({ type: 'Plan', title: 'C', payload: {}, parents: [p.id], initialStatus: 'DRAFT', createdBy: me })
    const children = await store.findChildren(p.id)
    expect(children.length).toBe(1)
    expect(children[0].id).toBe(c.id)
    const parents = await store.findParents(c.id)
    expect(parents[0].id).toBe(p.id)
  })

  it('query by type', async () => {
    await store.create({ type: 'Spec', title: 'S', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    await store.create({ type: 'Plan', title: 'P', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    const specs = await store.query({ type: 'Spec' })
    expect(specs.length).toBe(1)
  })

  it('query by status', async () => {
    await store.create({ type: 'Task', title: 'A', payload: {}, initialStatus: 'PENDING', createdBy: me })
    await store.create({ type: 'Task', title: 'B', payload: {}, initialStatus: 'COMPLETED', createdBy: me })
    const r = await store.query({ status: 'PENDING' })
    expect(r.length).toBe(1)
  })

  it('query with limit', async () => {
    for (let i = 0; i < 5; i++) await store.create({ type: 'Need', title: `N${i}`, payload: {}, initialStatus: 'DRAFT', createdBy: me })
    const r = await store.query({ limit: 3 })
    expect(r.length).toBe(3)
  })

  it('setGate add and update', async () => {
    const a = await store.create({ type: 'Spec', title: 'G', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    await store.setGate(a.id, { name: 'lint', required: true, passed: false })
    let g = (await store.get(a.id))!.gates
    expect(g.length).toBe(1)
    expect(g[0].passed).toBe(false)
    await store.setGate(a.id, { name: 'lint', required: true, passed: true })
    g = (await store.get(a.id))!.gates
    expect(g.length).toBe(1)
    expect(g[0].passed).toBe(true)
  })

  it('stats', async () => {
    await store.create({ type: 'Spec', title: 'S', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    await store.create({ type: 'Plan', title: 'P', payload: {}, initialStatus: 'DRAFT', createdBy: me })
    const s = store.stats()
    expect(s.artifactCount).toBe(2)
    expect(s.byType['Spec']).toBe(1)
  })

  it('data survives close + reopen', async () => {
    const a = await store.create({ type: 'Spec', title: 'Persist', payload: { ok: true }, initialStatus: 'DRAFT', createdBy: me })
    store.close()
    const store2 = new SQLiteArtifactStore(bus, { dbPath: DB, artifactsDir: ART })
    const loaded = await store2.get(a.id)
    expect(loaded!.title).toBe('Persist')
    expect(loaded!.payload).toEqual({ ok: true })
    store2.close()
    store = new SQLiteArtifactStore(bus, { dbPath: DB, artifactsDir: ART })
  })

  it('FSM integration with SQLite', async () => {
    const fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    const spec = await store.create({
      type: 'Spec', title: 'FSM', payload: { successCriteria: ['ok'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    let r = await fsm.transition(spec.id, 'refine', { actor: me })
    expect(r.artifact?.status).toBe('REVIEWING')
    r = await fsm.transition(spec.id, 'approve', { actor: me })
    expect(r.artifact?.status).toBe('FROZEN')
    const loaded = await store.get(spec.id)
    expect(loaded!.status).toBe('FROZEN')
  })

  it('guard block persists in SQLite', async () => {
    const fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    const spec = await store.create({
      type: 'Spec', title: 'GF', payload: { successCriteria: ['x'], ambiguityScore: 0.9 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    const r = await fsm.transition(spec.id, 'approve', { actor: me })
    expect(r.success).toBe(false)
    expect((await store.get(spec.id))!.status).toBe('REVIEWING')
  })
})

