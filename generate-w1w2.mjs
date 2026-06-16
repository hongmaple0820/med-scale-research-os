#!/usr/bin/env node
// W1+W2 batch generator: FSM definitions, demos, tests.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const ROOT = 'F:/project/work/maple-cart-mall/3d-car-mall/scale-engine'

const FILES = {
  // -------------------------------------------------------------------
  // 11 种 Artifact 的 FSM 完整定义
  // -------------------------------------------------------------------
  'src/artifact/fsmDefinitions.ts': `// SCALE Engine — 11 种 Artifact 的 FSM 定义
// 设计参考：docs/02-DATA-MODEL.md §三

import type { FSMDefinition, NeedPayload, SpecPayload, PlanPayload, DefectPayload } from './types.js'

// ============================================================================
// Need
// ============================================================================
export const NeedFSM: FSMDefinition = {
  type: 'Need',
  states: ['DRAFT', 'CLARIFIED', 'FULFILLED', 'ABANDONED'] as const,
  initial: 'DRAFT',
  terminal: ['FULFILLED', 'ABANDONED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'refine', to: 'CLARIFIED' },
    { from: 'DRAFT', action: 'discard', to: 'ABANDONED' },
    { from: 'CLARIFIED', action: 'fulfill', to: 'FULFILLED' },
    { from: 'CLARIFIED', action: 'discard', to: 'ABANDONED' },
  ],
}

// ============================================================================
// Insight
// ============================================================================
export const InsightFSM: FSMDefinition = {
  type: 'Insight',
  states: ['DRAFT', 'VERIFIED', 'INVALIDATED'] as const,
  initial: 'DRAFT',
  terminal: ['INVALIDATED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'verify', to: 'VERIFIED' },
    { from: 'DRAFT', action: 'invalidate', to: 'INVALIDATED' },
    { from: 'VERIFIED', action: 'invalidate', to: 'INVALIDATED' },
  ],
}

// ============================================================================
// Spec (核心)
// ============================================================================
export const SpecFSM: FSMDefinition = {
  type: 'Spec',
  states: ['DRAFT', 'REVIEWING', 'FROZEN', 'REVISING', 'OBSOLETED'] as const,
  initial: 'DRAFT',
  terminal: ['OBSOLETED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'refine', to: 'REVIEWING' },
    { from: 'REVIEWING', action: 'reject', to: 'DRAFT' },
    {
      from: 'REVIEWING',
      action: 'approve',
      to: 'FROZEN',
      guards: [
        {
          name: 'ambiguity_below_threshold',
          check: (a) => ((a.payload as Partial<SpecPayload>) as { ambiguityScore?: number }).ambiguityScore !== undefined
            ? (((a.payload as { ambiguityScore?: number }).ambiguityScore!) <= 0.2)
            : true, // 若未设置则放行（开发期友好）
          errorMessage: 'Spec 模糊度必须 ≤ 0.2 才能 FROZEN',
        },
        {
          name: 'has_success_criteria',
          check: (a) => ((a.payload as Partial<SpecPayload>).successCriteria?.length ?? 0) > 0,
          errorMessage: 'Spec 必须有至少一条 successCriteria',
        },
      ],
    },
    { from: 'FROZEN', action: 'challenge', to: 'REVISING' },
    { from: 'REVISING', action: 'finalize', to: 'FROZEN' },
    { from: 'FROZEN', action: 'supersede', to: 'OBSOLETED' },
    { from: 'REVISING', action: 'supersede', to: 'OBSOLETED' },
  ],
}

// ============================================================================
// Plan
// ============================================================================
export const PlanFSM: FSMDefinition = {
  type: 'Plan',
  states: ['DRAFT', 'APPROVED', 'IMPLEMENTING', 'DONE', 'REVISING', 'SUPERSEDED'] as const,
  initial: 'DRAFT',
  terminal: ['SUPERSEDED'] as const,
  transitions: [
    {
      from: 'DRAFT',
      action: 'review',
      to: 'APPROVED',
      guards: [
        {
          name: 'has_rollback_strategy',
          check: (a) => !!(a.payload as Partial<PlanPayload>).rollbackStrategy,
          errorMessage: 'Plan 必须填写 rollbackStrategy 才能 APPROVED',
        },
      ],
    },
    { from: 'APPROVED', action: 'implement', to: 'IMPLEMENTING' },
    { from: 'IMPLEMENTING', action: 'complete', to: 'DONE' },
    { from: 'APPROVED', action: 'invalidate', to: 'REVISING' },
    { from: 'IMPLEMENTING', action: 'invalidate', to: 'REVISING' },
    { from: 'REVISING', action: 'review', to: 'APPROVED' },
    { from: 'DRAFT', action: 'supersede', to: 'SUPERSEDED' },
    { from: 'DONE', action: 'supersede', to: 'SUPERSEDED' },
  ],
}

// ============================================================================
// TestPlan
// ============================================================================
export const TestPlanFSM: FSMDefinition = {
  type: 'TestPlan',
  states: ['DRAFT', 'APPROVED', 'EXECUTING', 'PASSED', 'FAILED'] as const,
  initial: 'DRAFT',
  terminal: ['PASSED', 'FAILED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'approve', to: 'APPROVED' },
    { from: 'APPROVED', action: 'execute', to: 'EXECUTING' },
    { from: 'EXECUTING', action: 'pass', to: 'PASSED' },
    { from: 'EXECUTING', action: 'fail', to: 'FAILED' },
    { from: 'FAILED', action: 'retry', to: 'EXECUTING' },
  ],
}

// ============================================================================
// Task
// ============================================================================
export const TaskFSM: FSMDefinition = {
  type: 'Task',
  states: ['PENDING', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const,
  initial: 'PENDING',
  terminal: ['COMPLETED', 'FAILED', 'CANCELLED'] as const,
  transitions: [
    { from: 'PENDING', action: 'schedule', to: 'READY' },
    { from: 'PENDING', action: 'cancel', to: 'CANCELLED' },
    { from: 'READY', action: 'start', to: 'RUNNING' },
    { from: 'READY', action: 'cancel', to: 'CANCELLED' },
    { from: 'RUNNING', action: 'pause', to: 'PAUSED' },
    { from: 'RUNNING', action: 'complete', to: 'COMPLETED' },
    { from: 'RUNNING', action: 'fail', to: 'FAILED' },
    { from: 'PAUSED', action: 'resume', to: 'RUNNING' },
    { from: 'PAUSED', action: 'cancel', to: 'CANCELLED' },
    { from: 'FAILED', action: 'retry', to: 'READY' },
  ],
}

// ============================================================================
// Change
// ============================================================================
export const ChangeFSM: FSMDefinition = {
  type: 'Change',
  states: ['DRAFT', 'COMMITTED', 'VERIFIED', 'REVERTED'] as const,
  initial: 'DRAFT',
  terminal: ['REVERTED'] as const,
  transitions: [
    { from: 'DRAFT', action: 'commit', to: 'COMMITTED' },
    { from: 'COMMITTED', action: 'verify', to: 'VERIFIED' },
    { from: 'COMMITTED', action: 'revert', to: 'REVERTED' },
    { from: 'VERIFIED', action: 'revert', to: 'REVERTED' },
  ],
}

// ============================================================================
// Evidence
// ============================================================================
export const EvidenceFSM: FSMDefinition = {
  type: 'Evidence',
  states: ['COLLECTED', 'PASS', 'FAIL'] as const,
  initial: 'COLLECTED',
  terminal: ['PASS', 'FAIL'] as const,
  transitions: [
    { from: 'COLLECTED', action: 'pass', to: 'PASS' },
    { from: 'COLLECTED', action: 'fail', to: 'FAIL' },
  ],
}

// ============================================================================
// Defect
// ============================================================================
export const DefectFSM: FSMDefinition = {
  type: 'Defect',
  states: ['OPEN', 'INVESTIGATING', 'DIAGNOSED', 'FIXED', 'CLOSED', 'DUPLICATE'] as const,
  initial: 'OPEN',
  terminal: ['CLOSED', 'DUPLICATE'] as const,
  transitions: [
    { from: 'OPEN', action: 'assign', to: 'INVESTIGATING' },
    { from: 'OPEN', action: 'duplicate', to: 'DUPLICATE' },
    {
      from: 'INVESTIGATING',
      action: 'diagnose',
      to: 'DIAGNOSED',
      guards: [
        {
          name: 'has_root_cause',
          check: (a) => {
            const p = a.payload as Partial<DefectPayload>
            return !!p.rootCauseCategory && p.rootCauseCategory !== 'unknown'
          },
          errorMessage: 'Defect 必须填写 rootCauseCategory（且不能是 unknown）才能 DIAGNOSED',
        },
      ],
    },
    { from: 'DIAGNOSED', action: 'fix', to: 'FIXED' },
    { from: 'FIXED', action: 'verify', to: 'CLOSED' },
    { from: 'CLOSED', action: 'reopen', to: 'OPEN' },
    { from: 'INVESTIGATING', action: 'duplicate', to: 'DUPLICATE' },
  ],
}

// ============================================================================
// Lesson
// ============================================================================
export const LessonFSM: FSMDefinition = {
  type: 'Lesson',
  states: ['PROPOSED', 'APPROVED', 'ACTIVE', 'PROMOTED_TO_RULE', 'REJECTED', 'SUPERSEDED'] as const,
  initial: 'PROPOSED',
  terminal: ['REJECTED', 'SUPERSEDED'] as const,
  transitions: [
    { from: 'PROPOSED', action: 'review', to: 'APPROVED' },
    { from: 'PROPOSED', action: 'reject', to: 'REJECTED' },
    { from: 'APPROVED', action: 'promote', to: 'ACTIVE' },
    { from: 'ACTIVE', action: 'evolve', to: 'PROMOTED_TO_RULE' },
    { from: 'ACTIVE', action: 'supersede', to: 'SUPERSEDED' },
  ],
}

// ============================================================================
// Release
// ============================================================================
export const ReleaseFSM: FSMDefinition = {
  type: 'Release',
  states: ['PLANNED', 'READY', 'DEPLOYING', 'DEPLOYED', 'ROLLED_BACK'] as const,
  initial: 'PLANNED',
  terminal: ['DEPLOYED', 'ROLLED_BACK'] as const,
  transitions: [
    { from: 'PLANNED', action: 'prepare', to: 'READY' },
    { from: 'READY', action: 'ship', to: 'DEPLOYING' },
    { from: 'DEPLOYING', action: 'verify', to: 'DEPLOYED' },
    { from: 'DEPLOYING', action: 'rollback', to: 'ROLLED_BACK' },
    { from: 'DEPLOYED', action: 'rollback', to: 'ROLLED_BACK' },
  ],
}

// ============================================================================
// 注册所有 FSM
// ============================================================================
export const ALL_FSMS = [
  NeedFSM, InsightFSM, SpecFSM, PlanFSM, TestPlanFSM, TaskFSM,
  ChangeFSM, EvidenceFSM, DefectFSM, LessonFSM, ReleaseFSM,
] as const

import type { IFSM } from './fsm.js'
import type { ArtifactType } from './types.js'

export function registerAllFSMs(fsm: IFSM): void {
  for (const def of ALL_FSMS) {
    fsm.register(def)
  }
}

/** 各 Artifact 类型的初始状态查询表 */
export const INITIAL_STATES: Record<ArtifactType, string> = Object.fromEntries(
  ALL_FSMS.map((f) => [f.type, f.initial])
) as Record<ArtifactType, string>
${''}
// (Plan -> 自动失效下游) — 在引擎启动后注入 effects (避免循环依赖)
// 使用见 src/index.ts wireEffects()
`,

  // -------------------------------------------------------------------
  // 让 store.create 用正确的 initial 状态
  // -------------------------------------------------------------------
  // (会用 replace_string_in_file 更新 store.ts，不在这里覆盖)

  // -------------------------------------------------------------------
  // Demo 1: event-demo (W1)
  // -------------------------------------------------------------------
  'examples/event-demo.ts': `// W1 Demo: EventBus 创建/订阅/持久化/重放
import { EventBus } from '../src/core/eventBus.js'
import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'

const TMP = './tmp/demo-events'
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })

const bus = new EventBus({ eventsDir: TMP })

// 1. 订阅
let receivedCount = 0
bus.on('artifact.created', (e) => {
  receivedCount++
  console.log(\`  [handler] Got event \${e.id}: \${(e.payload as { title: string }).title}\`)
})

bus.on('*', (e) => {
  console.log(\`  [wildcard] \${e.type} @ \${new Date(e.timestamp).toISOString()}\`)
})

// 2. 发射 3 个事件
console.log('=== Emitting 3 events ===')
for (let i = 1; i <= 3; i++) {
  bus.emit('artifact.created', { title: \`Demo Need #\${i}\` }, {
    sessionId: 'demo-session',
    actor: { kind: 'human', userId: 'liming' },
  })
}

// 3. 等异步 handler 跑完
await new Promise((r) => setTimeout(r, 50))

// 4. 验证持久化
console.log('\\n=== Persisted files ===')
const files = readdirSync(TMP)
console.log('  files:', files)
const content = readFileSync(\`\${TMP}/\${files[0]}\`, 'utf-8')
console.log('  lines:', content.trim().split('\\n').length)

// 5. 重放
console.log('\\n=== Replay all events ===')
let replayCount = 0
await bus.replay({}, (e) => {
  replayCount++
  console.log(\`  [replay] \${e.id} \${e.type}\`)
})

// 6. Query
console.log('\\n=== Query (limit 2) ===')
const results = await bus.query({ types: ['artifact.created'], limit: 2 })
console.log(\`  got \${results.length} events\`)

console.log(\`\\n✅ Demo done. handlers fired: \${receivedCount}, replayed: \${replayCount}\`)
`,

  // -------------------------------------------------------------------
  // Demo 2: fsm-demo (W2)
  // -------------------------------------------------------------------
  'examples/fsm-demo.ts': `// W2 Demo: FSM 完整生命周期 + Guard 拦截 + 反馈传播
import { EventBus } from '../src/core/eventBus.js'
import { InMemoryArtifactStore } from '../src/artifact/store.js'
import { FSM } from '../src/artifact/fsm.js'
import { registerAllFSMs, INITIAL_STATES } from '../src/artifact/fsmDefinitions.js'
import { rmSync, existsSync } from 'node:fs'

const TMP = './tmp/demo-fsm'
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
if (existsSync('./tmp/demo-events-fsm')) rmSync('./tmp/demo-events-fsm', { recursive: true, force: true })
if (existsSync('./tmp/demo-artifacts-fsm')) rmSync('./tmp/demo-artifacts-fsm', { recursive: true, force: true })

const bus = new EventBus({ eventsDir: './tmp/demo-events-fsm' })
const store = new InMemoryArtifactStore(bus, { artifactsDir: './tmp/demo-artifacts-fsm' })
const fsm = new FSM(store, bus)
registerAllFSMs(fsm)

const me = { kind: 'human' as const, userId: 'liming' }

console.log('=== 1. Create Spec (DRAFT) ===')
const spec = await store.create({
  type: 'Spec',
  title: '增加订单导出 Excel 功能',
  payload: {
    what: '用户能在订单列表导出 Excel',
    successCriteria: ['支持筛选条件', '10 万行导出 < 30s'],
    outOfScope: ['CSV 格式'],
    edgeCases: ['超过 10 万行 → 拒绝并提示'],
    northStar: '让运营在不写代码情况下能拿到订单数据',
    ambiguityScore: 0.4,    // 故意设高，等下要触发 guard 拦截
  },
  initialStatus: INITIAL_STATES.Spec,
  createdBy: me,
})
console.log(\`  Spec created: \${spec.id} status=\${spec.status}\`)

console.log('\\n=== 2. transition: refine -> REVIEWING ===')
const r1 = await fsm.transition(spec.id, 'refine', { actor: me })
console.log(\`  result: \${r1.success ? '✓' : '✗'} status=\${r1.artifact?.status}\`)

console.log('\\n=== 3. transition: approve -> FROZEN (应该被 guard 拦截) ===')
const r2 = await fsm.transition(spec.id, 'approve', { actor: me })
console.log(\`  result: \${r2.success ? '✓' : '✗ BLOCKED'}\`)
if (r2.blockedBy) {
  for (const b of r2.blockedBy) console.log(\`    blocked by: [\${b.guard}] \${b.message}\`)
}

console.log('\\n=== 4. 修正 ambiguity_score → 0.15，重试 approve ===')
await store.update(spec.id, {
  payload: { ...(spec.payload as Record<string, unknown>), ambiguityScore: 0.15 },
})
const r3 = await fsm.transition(spec.id, 'approve', { actor: me })
console.log(\`  result: \${r3.success ? '✓' : '✗'} status=\${r3.artifact?.status}\`)

console.log('\\n=== 5. 创建 Plan (parent=Spec) ===')
const plan = await store.create({
  type: 'Plan',
  title: '订单导出实现方案',
  parents: [spec.id],
  payload: {
    approach: '复用现有 ExcelWriter，加分页流式写入',
    techChoices: [],
    modules: [],
    rollbackStrategy: '功能开关，可一键关闭',
    estimatedComplexity: 0.4,
  },
  initialStatus: INITIAL_STATES.Plan,
  createdBy: me,
})
console.log(\`  Plan created: \${plan.id} status=\${plan.status}\`)

const r4 = await fsm.transition(plan.id, 'review', { actor: me })
console.log(\`  Plan review: \${r4.success ? '✓' : '✗'} status=\${r4.artifact?.status}\`)

console.log('\\n=== 6. Spec 进入 REVISING（模拟需求变更） ===')
const r5 = await fsm.transition(spec.id, 'challenge', { actor: me, reason: '运营要求加 PDF 格式' })
console.log(\`  Spec challenge: \${r5.success ? '✓' : '✗'} status=\${r5.artifact?.status}\`)
console.log('  注：W4 会注入 effect 自动 invalidate 下游 Plan')

console.log('\\n=== 7. availableActions 查询 ===')
const acts = await fsm.availableActions(spec.id)
console.log(\`  Spec 当前可用 actions: [\${acts.join(', ')}]\`)

console.log('\\n=== 8. 检查事件流 ===')
const events = await bus.query({ artifactId: spec.id, limit: 100 })
console.log(\`  本 Spec 共触发 \${events.length} 个事件:\`)
for (const e of events.reverse()) console.log(\`    \${e.type}\`)

console.log('\\n✅ FSM Demo done.')
`,

  // -------------------------------------------------------------------
  // 测试: EventBus
  // -------------------------------------------------------------------
  'tests/core/eventBus.test.ts': `// W1 Unit Tests: EventBus
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { rmSync, existsSync, mkdirSync } from 'node:fs'

const TMP = './tmp/test-eventbus'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    bus = new EventBus({ eventsDir: TMP })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('emits event with auto-generated id and timestamp', () => {
    const event = bus.emit('artifact.created', { foo: 'bar' })
    expect(event.id).toMatch(/^EVT-\\d+-\\d{5}$/)
    expect(event.type).toBe('artifact.created')
    expect(event.timestamp).toBeGreaterThan(0)
    expect(event.payload).toEqual({ foo: 'bar' })
  })

  it('event is frozen and immutable', () => {
    const event = bus.emit('artifact.created', { foo: 'bar' })
    expect(Object.isFrozen(event)).toBe(true)
  })

  it('subscribed handler receives event', async () => {
    let received: unknown = null
    bus.on('artifact.created', (e) => { received = e.payload })
    bus.emit('artifact.created', { test: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toEqual({ test: true })
  })

  it('wildcard handler receives all event types', async () => {
    const types: string[] = []
    bus.on('*', (e) => { types.push(e.type) })
    bus.emit('artifact.created', {})
    bus.emit('tool.called', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(types).toContain('artifact.created')
    expect(types).toContain('tool.called')
  })

  it('once handler fires only once', async () => {
    let count = 0
    bus.once('artifact.created', () => { count++ })
    bus.emit('artifact.created', {})
    bus.emit('artifact.created', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(count).toBe(1)
  })

  it('unsubscribe removes handler', async () => {
    let count = 0
    const sub = bus.on('artifact.created', () => { count++ })
    bus.emit('artifact.created', {})
    await new Promise((r) => setTimeout(r, 20))
    sub.unsubscribe()
    bus.emit('artifact.created', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(count).toBe(1)
  })

  it('handler exception does not break dispatch', async () => {
    let secondFired = false
    bus.on('artifact.created', () => { throw new Error('boom') })
    bus.on('artifact.created', () => { secondFired = true })
    bus.emit('artifact.created', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(secondFired).toBe(true)
  })

  it('persists event to JSONL', async () => {
    bus.emit('artifact.created', { persisted: true })
    await new Promise((r) => setTimeout(r, 20))
    const { readdirSync, readFileSync } = await import('node:fs')
    const files = readdirSync(TMP)
    expect(files.length).toBeGreaterThan(0)
    const content = readFileSync(\`\${TMP}/\${files[0]}\`, 'utf-8')
    expect(content).toContain('persisted')
  })

  it('replay reads all persisted events', async () => {
    bus.emit('artifact.created', { x: 1 })
    bus.emit('artifact.created', { x: 2 })
    bus.emit('artifact.updated', { x: 3 })
    await new Promise((r) => setTimeout(r, 30))

    const collected: unknown[] = []
    await bus.replay({}, (e) => { collected.push(e.payload) })
    expect(collected.length).toBe(3)
  })

  it('replay filters by type', async () => {
    bus.emit('artifact.created', { x: 1 })
    bus.emit('artifact.updated', { x: 2 })
    await new Promise((r) => setTimeout(r, 30))

    const collected: unknown[] = []
    await bus.replay({ types: ['artifact.created'] }, (e) => { collected.push(e.payload) })
    expect(collected.length).toBe(1)
    expect(collected[0]).toEqual({ x: 1 })
  })

  it('query returns events from memory ring', async () => {
    bus.emit('artifact.created', { x: 1 })
    bus.emit('artifact.created', { x: 2 })
    await new Promise((r) => setTimeout(r, 20))

    const results = await bus.query({ types: ['artifact.created'], limit: 10 })
    expect(results.length).toBe(2)
  })

  it('middleware can transform event', async () => {
    bus.use((event) => ({ ...event, payload: { ...event.payload as object, tagged: true } } as typeof event))
    let received: unknown = null
    bus.on('artifact.created', (e) => { received = e.payload })
    bus.emit('artifact.created', { foo: 'bar' })
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toEqual({ foo: 'bar', tagged: true })
  })

  it('middleware can drop event by returning null', async () => {
    bus.use(() => null)
    let received = false
    bus.on('artifact.created', () => { received = true })
    bus.emit('artifact.created', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toBe(false)
  })

  it('emitAsync awaits all handlers', async () => {
    let order: string[] = []
    bus.on('artifact.created', async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push('handler')
    })
    await bus.emitAsync('artifact.created', {})
    order.push('after')
    expect(order).toEqual(['handler', 'after'])
  })
})
`,

  // -------------------------------------------------------------------
  // 测试: FSM
  // -------------------------------------------------------------------
  'tests/artifact/fsm.test.ts': `// W2 Unit Tests: FSM
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
        payload: {},
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
`,

  // -------------------------------------------------------------------
  // Vitest 配置
  // -------------------------------------------------------------------
  'vitest.config.ts': `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/api/**', 'src/adapters/**'],
    },
  },
})
`,
}

// ===== Run =====
let created = 0, skipped = 0
for (const [relpath, content] of Object.entries(FILES)) {
  const fullpath = `${ROOT}/${relpath}`
  mkdirSync(dirname(fullpath), { recursive: true })
  if (existsSync(fullpath)) {
    const existing = require('node:fs').readFileSync(fullpath, 'utf-8')
    if (existing.length > 200) {
      console.log(`SKIP  ${relpath} (exists ${existing.length}b)`)
      skipped++
      continue
    }
  }
  writeFileSync(fullpath, content, 'utf-8')
  console.log(`WRITE ${relpath} (${content.length}b)`)
  created++
}
console.log(`\nDone. Created ${created}, skipped ${skipped}.`)

