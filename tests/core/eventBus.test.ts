// W1 Unit Tests: EventBus
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
    expect(event.id).toMatch(/^EVT-\d+-\d{5}$/)
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
    const content = readFileSync(`${TMP}/${files[0]}`, 'utf-8')
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
