// SCALE Engine — FSMAgentBridge Tests
import { describe, it, expect, beforeEach } from 'vitest'
import { FSMAgentBridge } from '../../src/fsm/FSMAgentBridge.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { SpecFSM, PlanFSM, TaskFSM } from '../../src/artifact/fsmDefinitions.js'
import { EventBus } from '../../src/core/eventBus.js'

describe('FSMAgentBridge', () => {
  let store: InMemoryArtifactStore
  let fsm: FSM
  let bus: EventBus
  let bridge: FSMAgentBridge

  beforeEach(async () => {
    bus = new EventBus({ eventsDir: '.scale/events' })
    store = new InMemoryArtifactStore(bus)
    fsm = new FSM(store)
    fsm.register(SpecFSM)
    fsm.register(PlanFSM)
    fsm.register(TaskFSM)
    bridge = new FSMAgentBridge(fsm, store)
  })

  describe('getFSMContext', () => {
    it('returns null for non-existent artifact', async () => {
      const ctx = await bridge.getFSMContext('non-existent')
      expect(ctx).toBeNull()
    })

    it('returns FSM snapshot for existing artifact', async () => {
      const spec = await store.create({
        type: 'Spec',
        title: 'Test Spec',
        payload: {},
        initialStatus: 'DRAFT'
      })

      const ctx = await bridge.getFSMContext(spec.id)
      expect(ctx).not.toBeNull()
      expect(ctx?.artifactId).toBe(spec.id)
      expect(ctx?.artifactType).toBe('Spec')
      expect(ctx?.currentStatus).toBe('DRAFT')
      expect(ctx?.allowedTransitions).toContain('refine')
    })
  })

  describe('getSessionContext', () => {
    it('returns empty context for session with no artifacts', async () => {
      const ctx = await bridge.getSessionContext('empty-session', bus)
      expect(ctx.sessionId).toBe('empty-session')
      expect(ctx.artifacts.length).toBe(0)
    })

    it('returns context with correct sessionId', async () => {
      const ctx = await bridge.getSessionContext('test-session', bus)
      expect(ctx.sessionId).toBe('test-session')
      expect(ctx.generatedAt).toBeGreaterThan(0)
    })
  })

  describe('checkOperation', () => {
    it('returns not allowed for non-existent artifact', async () => {
      const result = await bridge.checkOperation('non-existent', 'refine')
      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('Artifact not found')
    })

    it('returns not allowed for invalid transition', async () => {
      const spec = await store.create({ type: 'Spec', title: 'T', payload: {}, initialStatus: 'DRAFT' })
      const result = await bridge.checkOperation(spec.id, 'freeze')
      expect(result.allowed).toBe(false)
      expect(result.reasons[0]).toContain('not a valid transition')
    })

    it('returns allowed for valid transition', async () => {
      const spec = await store.create({ type: 'Spec', title: 'T', payload: {}, initialStatus: 'DRAFT' })
      const result = await bridge.checkOperation(spec.id, 'refine')
      expect(result.allowed).toBe(true)
    })
  })

  describe('getCreationPrerequisites', () => {
    it('returns prerequisites for Task creation', async () => {
      const prereq = await bridge.getCreationPrerequisites('Task')
      expect(prereq.message).toContain('Plan')
      expect(prereq.message).toContain('APPROVED')
    })
  })
})
