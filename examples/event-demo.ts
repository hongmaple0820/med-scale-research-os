// W1 Demo: EventBus 创建/订阅/持久化/重放
import { EventBus } from '../src/core/eventBus.js'
import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'

const TMP = './tmp/demo-events'
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })

const bus = new EventBus({ eventsDir: TMP })

// 1. 订阅
let receivedCount = 0
bus.on('artifact.created', (e) => {
  receivedCount++
  console.log(`  [handler] Got event ${e.id}: ${(e.payload as { title: string }).title}`)
})

bus.on('*', (e) => {
  console.log(`  [wildcard] ${e.type} @ ${new Date(e.timestamp).toISOString()}`)
})

// 2. 发射 3 个事件
console.log('=== Emitting 3 events ===')
for (let i = 1; i <= 3; i++) {
  bus.emit('artifact.created', { title: `Demo Need #${i}` }, {
    sessionId: 'demo-session',
    actor: { kind: 'human', userId: 'liming' },
  })
}

// 3. 等异步 handler 跑完
await new Promise((r) => setTimeout(r, 50))

// 4. 验证持久化
console.log('\n=== Persisted files ===')
const files = readdirSync(TMP)
console.log('  files:', files)
const content = readFileSync(`${TMP}/${files[0]}`, 'utf-8')
console.log('  lines:', content.trim().split('\n').length)

// 5. 重放
console.log('\n=== Replay all events ===')
let replayCount = 0
await bus.replay({}, (e) => {
  replayCount++
  console.log(`  [replay] ${e.id} ${e.type}`)
})

// 6. Query
console.log('\n=== Query (limit 2) ===')
const results = await bus.query({ types: ['artifact.created'], limit: 2 })
console.log(`  got ${results.length} events`)

console.log(`\n✅ Demo done. handlers fired: ${receivedCount}, replayed: ${replayCount}`)
