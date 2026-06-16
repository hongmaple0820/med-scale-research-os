// W4 Tests: TaskEngine
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../../src/artifact/store.js'
import { FSM } from '../../src/artifact/fsm.js'
import { TaskEngine } from '../../src/tasks/TaskEngine.js'
import type { TaskStep, StepResult } from '../../src/tasks/TaskEngine.js'
import { registerAllFSMs, INITIAL_STATES } from '../../src/artifact/fsmDefinitions.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-taskengine'
const me = { kind: 'human' as const, userId: 'tester' }

describe('TaskEngine', () => {
  let bus: EventBus
  let store: InMemoryArtifactStore
  let fsm: FSM
  let engine: TaskEngine

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: `${TMP}/events` })
    store = new InMemoryArtifactStore(bus, { artifactsDir: `${TMP}/artifacts` })
    fsm = new FSM(store, bus)
    registerAllFSMs(fsm)
    engine = new TaskEngine(store, fsm, bus, { checkpointsDir: `${TMP}/checkpoints` })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  async function createTask(title = 'Test Task') {
    return store.create({ type: 'Task', title, payload: {}, initialStatus: INITIAL_STATES.Task, createdBy: me })
  }

  const okStep = (id: string): TaskStep => ({
    id, name: id,
    handler: async (ctx) => {
      ctx.set(`${id}_done`, true)
      return { success: true, output: `${id} ok` }
    },
  })

  const failStep = (id: string): TaskStep => ({
    id, name: id,
    handler: async () => ({ success: false, error: `${id} failed` }),
  })

  describe('schedule + execute', () => {
    it('executes all steps successfully', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      const result = await engine.execute(task.id, [okStep('s1'), okStep('s2'), okStep('s3')])
      expect(result.success).toBe(true)
      expect(result.completedSteps).toEqual(['s1', 's2', 's3'])
      expect(result.duration).toBeGreaterThan(0)
      const t = await store.get(task.id)
      expect(t!.status).toBe('COMPLETED')
    })

    it('fails on bad step and stops', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      const result = await engine.execute(task.id, [okStep('s1'), failStep('s2'), okStep('s3')])
      expect(result.success).toBe(false)
      expect(result.completedSteps).toEqual(['s1'])
      expect(result.failedStep).toBe('s2')
      expect(result.error).toBe('s2 failed')
      const t = await store.get(task.id)
      expect(t!.status).toBe('FAILED')
    })

    it('executes with zero steps → immediate complete', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      const result = await engine.execute(task.id, [])
      expect(result.success).toBe(true)
      expect(result.completedSteps).toEqual([])
    })
  })

  describe('context', () => {
    it('steps can read/write shared context', async () => {
      const task = await createTask()
      await engine.schedule(task.id)

      const steps: TaskStep[] = [
        { id: 'write', name: 'write', handler: async (ctx) => { ctx.set('value', 42); return { success: true } } },
        { id: 'read', name: 'read', handler: async (ctx) => {
          const v = ctx.get('value')
          return v === 42 ? { success: true, output: v } : { success: false, error: 'wrong value' }
        }},
      ]

      const result = await engine.execute(task.id, steps)
      expect(result.success).toBe(true)
      expect(engine.getContext(task.id)).toHaveProperty('value', 42)
    })

    it('setContext before execute', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      engine.setContext(task.id, 'preset', 'hello')

      const steps: TaskStep[] = [
        { id: 'check', name: 'check', handler: async (ctx) => {
          return ctx.get('preset') === 'hello' ? { success: true } : { success: false, error: 'no preset' }
        }},
      ]

      const result = await engine.execute(task.id, steps)
      expect(result.success).toBe(true)
    })
  })

  describe('checkpoint + restore', () => {
    it('saves and restores checkpoint', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      engine.setContext(task.id, 'progress', 50)

      const cp = await engine.checkpoint(task.id, 'mid-point')
      expect(cp.id).toMatch(/^CKP-/)
      expect(cp.state.context).toHaveProperty('progress', 50)

      // Clear runtime
      engine.setContext(task.id, 'progress', 0)

      // Restore
      const state = await engine.restoreFromCheckpoint(task.id)
      expect(state.context).toHaveProperty('progress', 50)
    })
  })

  describe('step timeout', () => {
    it('fails step that exceeds timeout', async () => {
      const task = await createTask()
      await engine.schedule(task.id)

      const slowStep: TaskStep = {
        id: 'slow', name: 'slow', timeout: 50,
        handler: async () => {
          await new Promise((r) => setTimeout(r, 200))
          return { success: true }
        },
      }

      const result = await engine.execute(task.id, [slowStep])
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })
  })

  describe('step retry', () => {
    it('retries retryable step', async () => {
      const task = await createTask()
      await engine.schedule(task.id)

      let attempts = 0
      const retryStep: TaskStep = {
        id: 'flaky', name: 'flaky', retries: 2,
        handler: async () => {
          attempts++
          if (attempts < 3) return { success: false, error: 'flaky', retryable: true }
          return { success: true }
        },
      }

      const result = await engine.execute(task.id, [retryStep])
      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })
  })

  describe('decompose', () => {
    it('creates subtasks linked to parent', async () => {
      const parent = await createTask('Parent')

      const subtaskIds = await engine.decompose({
        parentTaskId: parent.id,
        subtasks: [
          { title: 'Sub 1', payload: { step: 1 } },
          { title: 'Sub 2', payload: { step: 2 }, dependencies: ['Sub 1'] },
        ],
      })

      expect(subtaskIds.length).toBe(2)

      const children = await store.findChildren(parent.id)
      expect(children.length).toBe(2)
      expect(children.map((c) => c.title).sort()).toEqual(['Sub 1', 'Sub 2'])

      // 子任务有 dependencies
      const sub2 = children.find((c) => c.title === 'Sub 2')!
      expect((sub2.payload as any).dependencies).toEqual(['Sub 1'])
    })
  })

  describe('cancel', () => {
    it('cancels a scheduled task', async () => {
      const task = await createTask()
      await engine.schedule(task.id)
      await engine.cancel(task.id, 'no longer needed')
      const t = await store.get(task.id)
      expect(t!.status).toBe('CANCELLED')
    })
  })

  describe('auto-checkpoint on steps', () => {
    it('creates checkpoint after each step by default', async () => {
      const task = await createTask()
      await engine.schedule(task.id)

      const events: string[] = []
      bus.on('task.checkpointed', () => { events.push('ckp') })

      await engine.execute(task.id, [okStep('a'), okStep('b')])
      await new Promise((r) => setTimeout(r, 30))
      expect(events.length).toBe(2)
    })

    it('skips checkpoint when step.checkpoint=false', async () => {
      const task = await createTask()
      await engine.schedule(task.id)

      const events: string[] = []
      bus.on('task.checkpointed', () => { events.push('ckp') })

      const noCkpStep: TaskStep = { id: 'fast', name: 'fast', checkpoint: false, handler: async () => ({ success: true }) }
      await engine.execute(task.id, [noCkpStep, okStep('b')])
      await new Promise((r) => setTimeout(r, 30))
      expect(events.length).toBe(1) // only step 'b' triggers checkpoint
    })
  })
})

