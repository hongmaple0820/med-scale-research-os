// W9 Tests: Effects Wiring + Model Router
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { wireEffects } from '../../src/orchestration/EffectsWiring.js'
import { ModelRouter, DEFAULT_MODELS } from '../../src/routing/ModelRouter.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-w9'
const me = { kind: 'human' as const, userId: 'tester' }

describe('EffectsWiring', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    wireEffects(fsm, store, bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('Spec challenge auto-invalidates child Plans', async () => {
    // Create Spec → FROZEN
    const spec = await store.create({
      type: 'Spec', title: 'Feature A',
      payload: { successCriteria: ['works'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    await fsm.transition(spec.id, 'approve', { actor: me })
    expect((await store.get(spec.id))!.status).toBe('FROZEN')

    // Create Plan child → APPROVED
    const plan = await store.create({
      type: 'Plan', title: 'Plan A',
      parents: [spec.id],
      payload: { rollbackStrategy: 'feature flag' },
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })
    await fsm.transition(plan.id, 'review', { actor: me })
    expect((await store.get(plan.id))!.status).toBe('APPROVED')

    // Challenge Spec → should auto-invalidate Plan
    const result = await fsm.transition(spec.id, 'challenge', { actor: me, reason: 'scope changed' })
    expect(result.success).toBe(true)
    expect(result.artifact?.status).toBe('REVISING')
    expect(result.effectsExecuted).toContain('invalidate_downstream_plans')

    // Plan should now be REVISING
    const planAfter = await store.get(plan.id)
    expect(planAfter!.status).toBe('REVISING')
  })

  it('Spec challenge does not affect Plans in DRAFT', async () => {
    const spec = await store.create({
      type: 'Spec', title: 'Feature B',
      payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    await fsm.transition(spec.id, 'approve', { actor: me })

    // Plan in DRAFT (not APPROVED)
    const plan = await store.create({
      type: 'Plan', title: 'Draft Plan',
      parents: [spec.id],
      payload: {},
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })

    await fsm.transition(spec.id, 'challenge', { actor: me })
    // DRAFT Plan should not be invalidated
    expect((await store.get(plan.id))!.status).toBe('DRAFT')
  })

  it('Spec challenge auto-invalidates IMPLEMENTING Plans too', async () => {
    const spec = await store.create({
      type: 'Spec', title: 'Feature C',
      payload: { successCriteria: ['x'], ambiguityScore: 0.1 },
      initialStatus: INITIAL_STATES.Spec, createdBy: me,
    })
    await fsm.transition(spec.id, 'refine', { actor: me })
    await fsm.transition(spec.id, 'approve', { actor: me })

    const plan = await store.create({
      type: 'Plan', title: 'Impl Plan',
      parents: [spec.id],
      payload: { rollbackStrategy: 'rollback' },
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })
    await fsm.transition(plan.id, 'review', { actor: me })
    await fsm.transition(plan.id, 'implement', { actor: me })
    expect((await store.get(plan.id))!.status).toBe('IMPLEMENTING')

    await fsm.transition(spec.id, 'challenge', { actor: me })
    expect((await store.get(plan.id))!.status).toBe('REVISING')
  })

  it('Plan complete with incomplete tasks emits warning', async () => {
    const plan = await store.create({
      type: 'Plan', title: 'Plan D',
      payload: { rollbackStrategy: 'flag' },
      initialStatus: INITIAL_STATES.Plan, createdBy: me,
    })
    await fsm.transition(plan.id, 'review', { actor: me })
    await fsm.transition(plan.id, 'implement', { actor: me })

    // Create child Task in RUNNING
    const task = await store.create({
      type: 'Task', title: 'Incomplete Task',
      parents: [plan.id],
      payload: {},
      initialStatus: INITIAL_STATES.Task, createdBy: me,
    })
    await fsm.transition(task.id, 'schedule', { actor: me })
    await fsm.transition(task.id, 'start', { actor: me })

    let warningEmitted = false
    bus.on('artifact.gate_checked', (e) => {
      if ((e.payload as Record<string, unknown>).warning) warningEmitted = true
    })

    await fsm.transition(plan.id, 'complete', { actor: me })
    await new Promise((r) => setTimeout(r, 30))
    expect(warningEmitted).toBe(true)
  })

  it('Defect verify → CLOSED triggers lesson extraction event', async () => {
    const defect = await store.create({
      type: 'Defect', title: 'Bug X',
      payload: { rootCauseCategory: 'null_ref', tags: [] },
      initialStatus: INITIAL_STATES.Defect, createdBy: me,
    })
    await fsm.transition(defect.id, 'assign', { actor: me })
    await store.update(defect.id, { payload: { rootCauseCategory: 'null_ref', tags: [] } })
    await fsm.transition(defect.id, 'diagnose', { actor: me })
    await fsm.transition(defect.id, 'fix', { actor: me })

    let lessonTriggered = false
    bus.on('lesson.proposed', (e) => {
      if ((e.payload as Record<string, unknown>).trigger === 'defect_closed') lessonTriggered = true
    })

    await fsm.transition(defect.id, 'verify', { actor: me })
    await new Promise((r) => setTimeout(r, 30))
    expect(lessonTriggered).toBe(true)
  })
})

describe('ModelRouter', () => {
  let bus: EventBus
  let router: ModelRouter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    router = new ModelRouter(bus)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('routes simple task to fast model', () => {
    const model = router.route({ taskComplexity: 0.1, stepCount: 1 })
    expect(model.tier).toBe('fast')
    expect(model.name).toBe('claude-haiku')
  })

  it('routes complex task to powerful model', () => {
    const model = router.route({ taskComplexity: 0.9 })
    expect(model.tier).toBe('powerful')
    expect(model.name).toBe('claude-opus')
  })

  it('routes average task to balanced model', () => {
    const model = router.route({ taskComplexity: 0.5 })
    expect(model.tier).toBe('balanced')
    expect(model.name).toBe('claude-sonnet')
  })

  it('budget=low forces fast', () => {
    const model = router.route({ taskComplexity: 0.9, budget: 'low' })
    expect(model.tier).toBe('fast')
  })

  it('budget=high forces powerful', () => {
    const model = router.route({ taskComplexity: 0.1, budget: 'high' })
    expect(model.tier).toBe('powerful')
  })

  it('repeated failures escalate to powerful', () => {
    const model = router.route({ taskComplexity: 0.3, previousFailures: 3 })
    expect(model.tier).toBe('powerful')
  })

  it('default (no context) routes to balanced', () => {
    const model = router.route({})
    expect(model.tier).toBe('balanced')
  })

  it('getModels returns all tiers', () => {
    const models = router.getModels()
    expect(Object.keys(models)).toEqual(['fast', 'balanced', 'powerful', 'local'])
  })

  it('setModel allows custom model config', () => {
    router.setModel('fast', {
      tier: 'fast', name: 'gpt-4o-mini', maxTokens: 128_000, costPerMToken: 0.15,
    })
    const model = router.route({ taskComplexity: 0.1, stepCount: 1 })
    expect(model.name).toBe('gpt-4o-mini')
  })

  it('DEFAULT_MODELS has reasonable costs', () => {
    expect(DEFAULT_MODELS.fast.costPerMToken).toBeLessThan(DEFAULT_MODELS.balanced.costPerMToken)
    expect(DEFAULT_MODELS.balanced.costPerMToken).toBeLessThan(DEFAULT_MODELS.powerful.costPerMToken)
    expect(DEFAULT_MODELS.local.costPerMToken).toBe(0)
  })
})

