// W2 Demo: FSM 完整生命周期 + Guard 拦截 + 反馈传播
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
console.log(`  Spec created: ${spec.id} status=${spec.status}`)

console.log('\n=== 2. transition: refine -> REVIEWING ===')
const r1 = await fsm.transition(spec.id, 'refine', { actor: me })
console.log(`  result: ${r1.success ? '✓' : '✗'} status=${r1.artifact?.status}`)

console.log('\n=== 3. transition: approve -> FROZEN (应该被 guard 拦截) ===')
const r2 = await fsm.transition(spec.id, 'approve', { actor: me })
console.log(`  result: ${r2.success ? '✓' : '✗ BLOCKED'}`)
if (r2.blockedBy) {
  for (const b of r2.blockedBy) console.log(`    blocked by: [${b.guard}] ${b.message}`)
}

console.log('\n=== 4. 修正 ambiguity_score → 0.15，重试 approve ===')
await store.update(spec.id, {
  payload: { ...(spec.payload as Record<string, unknown>), ambiguityScore: 0.15 },
})
const r3 = await fsm.transition(spec.id, 'approve', { actor: me })
console.log(`  result: ${r3.success ? '✓' : '✗'} status=${r3.artifact?.status}`)

console.log('\n=== 5. 创建 Plan (parent=Spec) ===')
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
console.log(`  Plan created: ${plan.id} status=${plan.status}`)

const r4 = await fsm.transition(plan.id, 'review', { actor: me })
console.log(`  Plan review: ${r4.success ? '✓' : '✗'} status=${r4.artifact?.status}`)

console.log('\n=== 6. Spec 进入 REVISING（模拟需求变更） ===')
const r5 = await fsm.transition(spec.id, 'challenge', { actor: me, reason: '运营要求加 PDF 格式' })
console.log(`  Spec challenge: ${r5.success ? '✓' : '✗'} status=${r5.artifact?.status}`)
console.log('  注：W4 会注入 effect 自动 invalidate 下游 Plan')

console.log('\n=== 7. availableActions 查询 ===')
const acts = await fsm.availableActions(spec.id)
console.log(`  Spec 当前可用 actions: [${acts.join(', ')}]`)

console.log('\n=== 8. 检查事件流 ===')
const events = await bus.query({ artifactId: spec.id, limit: 100 })
console.log(`  本 Spec 共触发 ${events.length} 个事件:`)
for (const e of events.reverse()) console.log(`    ${e.type}`)

console.log('\n✅ FSM Demo done.')
