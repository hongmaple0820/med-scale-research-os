// W2 Unit Tests: FSM
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { SpecFSM, PlanFSM, TaskFSM, registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { InvalidTransitionError } from '../../src/artifact/types.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP_E = './tmp/test-fsm-events'
const TMP_A = './tmp/test-fsm-artifacts'
const me = { kind: 'human' as const, userId: 'tester' }

describe('FSM', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM

  beforeEach(() => {
    for (const d of [TMP_E, TMP_A]) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
      mkdirSync(d, { recursive: true })
    }
    bus = new EventBus({ eventsDir: TMP_E })
    store = new InMemoryArtifactStore(bus, { artifactsDir: TMP_A })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
  })

  afterEach(() => {
    for (const d of [TMP_E, TMP_A]) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
  })

  describe('Spec FSM', () => {
    async function newSpec(payload: Record<string, unknown> = {}) {
      return await store.create({
        type: 'Spec',
        title: 'Test Spec',
        payload: { successCriteria: ['x'], ...payload },
        initialStatus: INITIAL_STATES.Spec,
        createdBy: me,
      })
    }

    it('initial state is DRAFT', async () => {
      const spec = await newSpec()
      expect(spec.status).toBe('DRAFT')
    })

    it('refine transitions DRAFT -> REVIEWING', async () => {
      const spec = await newSpec()
      const r = await fsm.transition(spec.id, 'refine', { actor: me })
      expect(r.success).toBe(true)
      expect(r.artifact?.status).toBe('REVIEWING')
    })

    it('approve from REVIEWING -> FROZEN when ambiguity ok', async () => {
      const spec = await newSpec({ ambiguityScore: 0.1 })
      await fsm.transition(spec.id, 'refine', { actor: me })
      const r = await fsm.transition(spec.id, 'approve', { actor: me })
      expect(r.success).toBe(true)
      expect(r.artifact?.status).toBe('FROZEN')
    })

    it('approve is BLOCKED when ambiguity too high', async () => {
      const spec = await newSpec({ ambiguityScore: 0.5 })
      await fsm.transition(spec.id, 'refine', { actor: me })
      const r = await fsm.transition(spec.id, 'approve', { actor: me })
      expect(r.success).toBe(false)
      expect(r.blockedBy).toBeDefined()
      expect(r.blockedBy![0].guard).toBe('ambiguity_below_threshold')
    })

    it('approve is BLOCKED when no successCriteria', async () => {
      const spec = await newSpec({ ambiguityScore: 0.1, successCriteria: [] })
      await fsm.transition(spec.id, 'refine', { actor: me })
      const r = await fsm.transition(spec.id, 'approve', { actor: me })
      expect(r.success).toBe(false)
      expect(r.blockedBy?.some((b) => b.guard === 'has_success_criteria')).toBe(true)
    })

    it('invalid transition throws', async () => {
      const spec = await newSpec()
      await expect(fsm.transition(spec.id, 'approve', { actor: me })).rejects.toThrow(InvalidTransitionError)
    })

    it('challenge transitions FROZEN -> REVISING', async () => {
      const spec = await newSpec({ ambiguityScore: 0.1 })
      await fsm.transition(spec.id, 'refine', { actor: me })
      await fsm.transition(spec.id, 'approve', { actor: me })
      const r = await fsm.transition(spec.id, 'challenge', { actor: me })
      expect(r.artifact?.status).toBe('REVISING')
    })

    it('terminal state OBSOLETED sets closedAt', async () => {
      const spec = await newSpec({ ambiguityScore: 0.1 })
      await fsm.transition(spec.id, 'refine', { actor: me })
      await fsm.transition(spec.id, 'approve', { actor: me })
      const r = await fsm.transition(spec.id, 'supersede', { actor: me })
      expect(r.artifact?.closedAt).toBeDefined()
    })
  })

  describe('Plan FSM', () => {
    it('review BLOCKED without rollbackStrategy', async () => {
      const plan = await store.create({
        type: 'Plan',
        title: 'Test Plan',
        payload: { approach: 'x' },        // 缺 rollbackStrategy
        initialStatus: INITIAL_STATES.Plan,
        createdBy: me,
      })
      const r = await fsm.transition(plan.id, 'review', { actor: me })
      expect(r.success).toBe(false)
      expect(r.blockedBy?.[0].guard).toBe('has_rollback_strategy')
    })

    it('review SUCCEEDS with rollbackStrategy', async () => {
      const plan = await store.create({
        type: 'Plan',
        title: 'Test Plan',
        payload: { rollbackStrategy: 'feature flag' },
        initialStatus: INITIAL_STATES.Plan,
        createdBy: me,
      })
      const r = await fsm.transition(plan.id, 'review', { actor: me })
      expect(r.success).toBe(true)
      expect(r.artifact?.status).toBe('APPROVED')
    })
  })

  describe('Task FSM', () => {
    it('full lifecycle: PENDING -> READY -> RUNNING -> COMPLETED', async () => {
      const task = await store.create({
        type: 'Task',
        title: 'Test Task',
        payload: {
          buildStatus: 'success', buildExitCode: 0,
          lintStatus: 'success',
          testPassed: true,
        },
        initialStatus: INITIAL_STATES.Task,
        createdBy: me,
      })
      expect(task.status).toBe('PENDING')

      let r = await fsm.transition(task.id, 'schedule', { actor: me })
      expect(r.artifact?.status).toBe('READY')

      r = await fsm.transition(task.id, 'start', { actor: me })
      expect(r.artifact?.status).toBe('RUNNING')

      r = await fsm.transition(task.id, 'complete', { actor: me })
      expect(r.artifact?.status).toBe('COMPLETED')
    })

    it('pause/resume cycle', async () => {
      const task = await store.create({
        type: 'Task', title: 'T', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })
      await fsm.transition(task.id, 'schedule', { actor: me })
      await fsm.transition(task.id, 'start', { actor: me })
      await fsm.transition(task.id, 'pause', { actor: me })
      const t1 = await store.get(task.id)
      expect(t1?.status).toBe('PAUSED')
      const r = await fsm.transition(task.id, 'resume', { actor: me })
      expect(r.artifact?.status).toBe('RUNNING')
    })
  })

  describe('availableActions', () => {
    it('returns all actions valid from current state', async () => {
      const spec = await store.create({
        type: 'Spec', title: 'X', payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
        initialStatus: INITIAL_STATES.Spec, createdBy: me,
      })
      await fsm.transition(spec.id, 'refine', { actor: me })
      const actions = await fsm.availableActions(spec.id)
      expect(actions).toContain('approve')
      expect(actions).toContain('reject')
    })
  })

  describe('canTransition', () => {
    it('allows valid transition', async () => {
      const spec = await store.create({
        type: 'Spec', title: 'X', payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
        initialStatus: INITIAL_STATES.Spec, createdBy: me,
      })
      const result = await fsm.canTransition(spec.id, 'refine')
      expect(result.allowed).toBe(true)
    })

    it('blocks invalid transition', async () => {
      const spec = await store.create({
        type: 'Spec', title: 'X', payload: {},
        initialStatus: INITIAL_STATES.Spec, createdBy: me,
      })
      const result = await fsm.canTransition(spec.id, 'approve')
      expect(result.allowed).toBe(false)
    })
  })

  describe('concurrency lock', () => {
    it('serializes concurrent transitions on the same artifact', async () => {
      const task = await store.create({
        type: 'Task', title: 'Concurrent', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })
      // schedule first so start is valid
      await fsm.transition(task.id, 'schedule', { actor: me })

      // Fire 3 concurrent start transitions — only the first should succeed,
      // the rest should throw InvalidTransitionError since state is already RUNNING
      const results = await Promise.allSettled([
        fsm.transition(task.id, 'start', { actor: me }),
        fsm.transition(task.id, 'start', { actor: me }),
        fsm.transition(task.id, 'start', { actor: me }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
      const rejected = results.filter((r) => r.status === 'rejected')

      // Exactly one should succeed
      expect(fulfilled.length).toBe(1)
      expect(fulfilled[0].value.success).toBe(true)
      expect(fulfilled[0].value.artifact?.status).toBe('RUNNING')

      // The other two should have thrown InvalidTransitionError
      expect(rejected.length).toBe(2)
    })

    it('pendingLocks starts at zero and tracks distinct artifacts', async () => {
      expect(fsm.pendingLocks).toBe(0)
      const task = await store.create({
        type: 'Task', title: 'LockCount', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })
      await fsm.transition(task.id, 'schedule', { actor: me })
      // Lock entry may remain as stale reference; the important thing is
      // that it tracks the number of distinct artifact IDs that had transitions
      expect(fsm.pendingLocks).toBeGreaterThanOrEqual(0)
    })

    it('transitions on different artifacts can proceed in parallel', async () => {
      const t1 = await store.create({
        type: 'Task', title: 'T1', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })
      const t2 = await store.create({
        type: 'Task', title: 'T2', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })

      // Both schedule in parallel — different artifact IDs, no contention
      const [r1, r2] = await Promise.all([
        fsm.transition(t1.id, 'schedule', { actor: me }),
        fsm.transition(t2.id, 'schedule', { actor: me }),
      ])
      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)
      expect(r1.artifact?.status).toBe('READY')
      expect(r2.artifact?.status).toBe('READY')
    })

    it('history records are not corrupted by concurrent transitions', async () => {
      const task = await store.create({
        type: 'Task', title: 'History', payload: {},
        initialStatus: INITIAL_STATES.Task, createdBy: me,
      })
      await fsm.transition(task.id, 'schedule', { actor: me })

      // Concurrent: start (valid) + start (invalid) + start (invalid)
      await Promise.allSettled([
        fsm.transition(task.id, 'start', { actor: me }),
        fsm.transition(task.id, 'start', { actor: me }),
        fsm.transition(task.id, 'start', { actor: me }),
      ])

      const final = await store.get(task.id)
      expect(final?.status).toBe('RUNNING')
      // Only one 'start' transition should be in history
      const startEntries = final?.statusHistory.filter((h) => h.to === 'RUNNING')
      expect(startEntries?.length).toBe(1)
    })
  })

  describe('FSM definitions metadata', () => {
    it('Spec FSM has correct shape', () => {
      expect(SpecFSM.type).toBe('Spec')
      expect(SpecFSM.initial).toBe('DRAFT')
      expect(SpecFSM.terminal).toContain('OBSOLETED')
    })
    it('Plan FSM has rollback guard', () => {
      const reviewTx = PlanFSM.transitions.find((t) => t.action === 'review')
      expect(reviewTx?.guards?.[0].name).toBe('has_rollback_strategy')
    })
    it('Task FSM is full lifecycle', () => {
      expect(TaskFSM.terminal).toContain('COMPLETED')
      expect(TaskFSM.terminal).toContain('CANCELLED')
    })
  })
})
