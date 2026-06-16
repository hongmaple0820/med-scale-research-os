// SCALE Engine — Event Bus
// 系统的"神经系统"。所有模块通过它解耦。
// 内存 pub/sub + JSONL 持久化 + 重放能力。
// 设计参考：docs/03-CORE-MODULES.md §3.1

import type { Event, EventType, EventId, Actor, ArtifactId, SessionId, Timestamp } from '../artifact/types.js'
import { logger } from './logger.js'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>
export interface Subscription { unsubscribe(): void }

export interface EmitOptions {
  sessionId?: SessionId
  actor?: Actor
  artifactId?: ArtifactId
  causedBy?: EventId
  correlationId?: string
}

export interface ReplayFilter {
  fromTimestamp?: Timestamp
  toTimestamp?: Timestamp
  types?: EventType[]
  sessionId?: SessionId
  artifactId?: ArtifactId
}

export interface QueryFilter extends ReplayFilter {
  limit?: number
  filter?: (event: Event) => boolean
}

export type EventMiddleware = (event: Event) => Event | null

export interface IEventBus {
  on<T = unknown>(type: EventType | '*', handler: EventHandler<T>): Subscription
  once<T = unknown>(type: EventType, handler: EventHandler<T>): void
  emit<T = unknown>(type: EventType, payload: T, opts?: EmitOptions): Event<T>
  emitAsync<T = unknown>(type: EventType, payload: T, opts?: EmitOptions): Promise<Event<T>>
  use(middleware: EventMiddleware): void
  replay(filter: ReplayFilter, handler: EventHandler): Promise<void>
  query(filter: QueryFilter): Promise<Event[]>
  flush(): Promise<void>
}

export class EventBus implements IEventBus {
  private handlers = new Map<EventType | '*', Set<EventHandler>>()
  private middlewares: EventMiddleware[] = []
  private memoryRing: Event[] = []
  private maxRingSize = 1000
  private seq = 0
  private eventsDir: string

  constructor(opts: { eventsDir?: string } = {}) {
    this.eventsDir = opts.eventsDir ?? '.scale/events'
    if (!existsSync(this.eventsDir)) mkdirSync(this.eventsDir, { recursive: true })
  }

  on<T>(type: EventType | '*', handler: EventHandler<T>): Subscription {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    const handlers = this.handlers.get(type)!
    handlers.add(handler as EventHandler)
    return { unsubscribe: () => { handlers.delete(handler as EventHandler); if (handlers.size === 0) this.handlers.delete(type) } }
  }

  once<T>(type: EventType, handler: EventHandler<T>): void {
    const sub = this.on<T>(type, (e) => { sub.unsubscribe(); handler(e) })
  }

  use(mw: EventMiddleware): void { this.middlewares.push(mw) }

  emit<T>(type: EventType, payload: T, opts: EmitOptions = {}): Event<T> {
    const event: Event<T> = Object.freeze({
      id: this.generateId(),
      type, timestamp: Date.now(),
      sessionId: opts.sessionId ?? 'system',
      actor: opts.actor ?? { kind: 'system', component: 'EventBus' },
      artifactId: opts.artifactId, payload,
      causedBy: opts.causedBy, correlationId: opts.correlationId,
    })
    let processed: Event<T> | null = event
    for (const mw of this.middlewares) {
      processed = mw(processed) as Event<T> | null
      if (!processed) return event
    }
    this.persist(processed); this.pushToRing(processed); this.dispatchAsync(processed)
    return processed
  }

  async emitAsync<T>(type: EventType, payload: T, opts?: EmitOptions): Promise<Event<T>> {
    const event = this.emit(type, payload, opts)
    await this.dispatchSync(event)
    return event
  }

  async replay(filter: ReplayFilter, handler: EventHandler): Promise<void> {
    for (const file of this.getEventFiles(filter)) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Event
          if (this.matchesFilter(event, filter)) await handler(event)
        } catch (e) { logger.warn({ file, error: (e as Error).message }, 'Failed to parse event') }
      }
    }
  }

  async query(filter: QueryFilter): Promise<Event[]> {
    const results: Event[] = []
    const limit = filter.limit ?? 1000
    for (let i = this.memoryRing.length - 1; i >= 0; i--) {
      const event = this.memoryRing[i]
      if (this.matchesFilter(event, filter) && (!filter.filter || filter.filter(event))) {
        results.push(event); if (results.length >= limit) return results
      }
    }
    if (results.length < limit) {
      await this.replay(filter, (event) => {
        if (results.length >= limit) return
        if (!filter.filter || filter.filter(event)) {
          if (!results.find((r) => r.id === event.id)) results.push(event)
        }
      })
    }
    return results.slice(0, limit)
  }

  async flush(): Promise<void> { /* sync append */ }

  private generateId(): EventId {
    this.seq = (this.seq + 1) % 100000
    return `EVT-${Date.now()}-${this.seq.toString().padStart(5, '0')}`
  }

  private persist(event: Event): void {
    const date = new Date(event.timestamp).toISOString().slice(0, 10)
    const file = join(this.eventsDir, `${date}.jsonl`)
    try { appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8') }
    catch (e) { logger.error({ event: event.id, error: (e as Error).message }, 'Failed to persist event') }
  }

  private pushToRing(event: Event): void {
    this.memoryRing.push(event)
    if (this.memoryRing.length > this.maxRingSize) this.memoryRing.shift()
  }

  private dispatchAsync(event: Event): void { setImmediate(() => this.dispatchSync(event)) }

  private async dispatchSync(event: Event): Promise<void> {
    const handlers = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])]
    for (const handler of handlers) {
      try { await handler(event) }
      catch (e) { logger.error({ event: event.id, type: event.type, error: (e as Error).message }, 'Event handler threw') }
    }
  }

  private getEventFiles(filter: ReplayFilter): string[] {
    if (!existsSync(this.eventsDir)) return []
    const all = readdirSync(this.eventsDir).filter((f) => f.endsWith('.jsonl')).sort()
    if (!filter.fromTimestamp && !filter.toTimestamp) return all.map((f) => join(this.eventsDir, f))
    return all.filter((f) => {
      const date = f.replace('.jsonl', '')
      const fileStart = new Date(date).getTime()
      const fileEnd = fileStart + 24 * 60 * 60 * 1000
      if (filter.fromTimestamp && fileEnd < filter.fromTimestamp) return false
      if (filter.toTimestamp && fileStart > filter.toTimestamp) return false
      return true
    }).map((f) => join(this.eventsDir, f))
  }

  private matchesFilter(event: Event, filter: ReplayFilter): boolean {
    if (filter.fromTimestamp && event.timestamp < filter.fromTimestamp) return false
    if (filter.toTimestamp && event.timestamp > filter.toTimestamp) return false
    if (filter.types && !filter.types.includes(event.type)) return false
    if (filter.sessionId && event.sessionId !== filter.sessionId) return false
    if (filter.artifactId && event.artifactId !== filter.artifactId) return false
    return true
  }
}
