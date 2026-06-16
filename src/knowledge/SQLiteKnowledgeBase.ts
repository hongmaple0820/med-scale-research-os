// SCALE Engine — SQLite Knowledge Base
// Persistent version of KnowledgeBase using better-sqlite3
// Design ref: docs/03-CORE-MODULES.md §3.4

import Database from 'better-sqlite3'
import type { KnowledgeEntry, KnowledgeQuery } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import type { IKnowledgeBase } from './KnowledgeBase.js'
import { TfidfIndex } from './TfidfIndex.js'
import { logger } from '../core/logger.js'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const KB_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]',
  content_ref     TEXT NOT NULL DEFAULT '',
  embedding_id    TEXT,
  relevance       REAL NOT NULL DEFAULT 0.5,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed   INTEGER,
  verified        INTEGER NOT NULL DEFAULT 0,
  verified_by     TEXT,
  verified_at     INTEGER,
  created_at      INTEGER NOT NULL,
  source_artifact TEXT
);

CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_entries(type);
CREATE INDEX IF NOT EXISTS idx_kb_relevance ON knowledge_entries(relevance);
CREATE INDEX IF NOT EXISTS idx_kb_verified ON knowledge_entries(verified);
CREATE INDEX IF NOT EXISTS idx_kb_created ON knowledge_entries(created_at);
`

interface KBRow {
  id: string
  type: string
  title: string
  tags: string
  content_ref: string
  embedding_id: string | null
  relevance: number
  access_count: number
  last_accessed: number | null
  verified: number
  verified_by: string | null
  verified_at: number | null
  created_at: number
  source_artifact: string | null
}

export class SQLiteKnowledgeBase implements IKnowledgeBase {
  private db: Database.Database
  private seq = 0
  private tfidfIndex: TfidfIndex | null = null

  constructor(
    private eventBus: IEventBus,
    opts: { dbPath?: string } = {},
  ) {
    const dbPath = opts.dbPath ?? '.scale/knowledge.db'
    mkdirSync(dirname(dbPath), { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(KB_SCHEMA)

    // Restore seq from max id
    const maxRow = this.db.prepare(
      'SELECT id FROM knowledge_entries ORDER BY created_at DESC LIMIT 1',
    ).get() as { id: string } | undefined
    if (maxRow) {
      const parts = maxRow.id.split('-')
      this.seq = parseInt(parts[parts.length - 1], 10) || 0
    }
  }

  async add(
    input: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>,
  ): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = {
      ...input,
      id: this.generateId(),
      createdAt: Date.now(),
      accessCount: 0,
      relevance: 0.5,
    }

    this.db.prepare(`
      INSERT INTO knowledge_entries
        (id, type, title, tags, content_ref, embedding_id, relevance,
         access_count, last_accessed, verified, verified_by, verified_at,
         created_at, source_artifact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.type,
      entry.title,
      JSON.stringify(entry.tags),
      entry.contentRef,
      entry.embeddingId ?? null,
      entry.relevance,
      entry.accessCount,
      entry.lastAccessed ?? null,
      entry.verified ? 1 : 0,
      entry.verifiedBy ?? null,
      entry.verifiedAt ?? null,
      entry.createdAt,
      entry.sourceArtifact ?? null,
    )

    this.eventBus.emit('lesson.proposed', { lessonId: entry.id }, { artifactId: input.sourceArtifact })

    // Update TF-IDF index
    if (this.tfidfIndex) {
      const text = [entry.title, JSON.stringify(entry.tags), entry.contentRef].filter(Boolean).join(' ')
      this.tfidfIndex.upsert(entry.id, text)
    }

    return entry
  }

  async recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    const conditions: string[] = ['1=1']
    const params: unknown[] = []

    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      conditions.push(`type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }

    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        conditions.push(`tags LIKE ?`)
        params.push(`%"${tag}"%`)
      }
    }

    if (query.minRelevance !== undefined) {
      conditions.push('relevance >= ?')
      params.push(query.minRelevance)
    }

    if (query.verifiedOnly) {
      conditions.push('verified = 1')
    }

    const limit = query.limit ?? 10
    const sql = `SELECT * FROM knowledge_entries WHERE ${conditions.join(' AND ')} ORDER BY relevance DESC LIMIT ?`
    params.push(limit)

    const rows = this.db.prepare(sql).all(...params) as KBRow[]
    return rows.map((r) => this.fromRow(r))
  }

  async recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]> {
    // Build TF-IDF index if not already built
    if (!this.tfidfIndex) {
      this.tfidfIndex = new TfidfIndex()
      const rows = this.db.prepare('SELECT id, title, tags, content_ref FROM knowledge_entries').all() as KBRow[]
      this.tfidfIndex.buildFromRows(rows)
      logger.debug({ docCount: rows.length }, 'TF-IDF index built')
    }

    const results = this.tfidfIndex.search(text, topK)
    if (results.length === 0) {
      logger.debug({ text, topK }, 'recallByVector: no matches found')
      return this.recall({ verifiedOnly: true, limit: topK })
    }

    const entries: KnowledgeEntry[] = []
    for (const { id, score } of results) {
      const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as KBRow | undefined
      if (row) {
        const entry = this.fromRow(row)
        // Boost relevance by similarity score
        entry.relevance = Math.min(1, entry.relevance * (1 + score))
        entries.push(entry)
      }
    }

    logger.debug({ text, topK, matches: entries.length }, 'recallByVector (TF-IDF)')
    return entries
  }

  async markHelpful(id: string, sessionId: string): Promise<void> {
    const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as KBRow | undefined
    if (!row) return

    const newRelevance = Math.min(1, row.relevance + 0.05)
    const newCount = row.access_count + 1
    const now = Date.now()

    this.db.prepare(
      'UPDATE knowledge_entries SET relevance = ?, access_count = ?, last_accessed = ? WHERE id = ?',
    ).run(newRelevance, newCount, now, id)

    this.eventBus.emit('lesson.helpful', { lessonId: id }, { sessionId })
  }

  async markUseless(id: string, sessionId: string): Promise<void> {
    const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as KBRow | undefined
    if (!row) return

    const newRelevance = Math.max(0.05, row.relevance - 0.1)
    this.db.prepare('UPDATE knowledge_entries SET relevance = ? WHERE id = ?').run(newRelevance, id)
    this.eventBus.emit('lesson.useless', { lessonId: id }, { sessionId })
  }

  async verify(id: string, verifiedBy: string): Promise<void> {
    const now = Date.now()
    const result = this.db.prepare(
      'UPDATE knowledge_entries SET verified = 1, verified_by = ?, verified_at = ? WHERE id = ?',
    ).run(verifiedBy, now, id)

    if (result.changes > 0) {
      this.eventBus.emit('lesson.approved', { lessonId: id, verifiedBy })
    }
  }

  async decay(): Promise<void> {
    const DAY = 24 * 60 * 60 * 1000
    const now = Date.now()
    const rows = this.db.prepare('SELECT id, relevance, last_accessed FROM knowledge_entries').all() as Array<{
      id: string
      relevance: number
      last_accessed: number | null
    }>

    const stmt = this.db.prepare('UPDATE knowledge_entries SET relevance = ? WHERE id = ?')
    const updateAll = this.db.transaction(() => {
      for (const row of rows) {
        const days = row.last_accessed ? (now - row.last_accessed) / DAY : 90
        const recency = Math.exp(-days / 30)
        const newRelevance = Math.max(0.05, row.relevance * 0.95 + recency * 0.05)
        stmt.run(newRelevance, row.id)
      }
    })
    updateAll()
  }

  /** Close database connection */
  close(): void {
    this.db.close()
  }

  /** Get stats */
  stats(): { entryCount: number; verifiedCount: number; byType: Record<string, number> } {
    const entryCount = (this.db.prepare('SELECT COUNT(*) as c FROM knowledge_entries').get() as { c: number }).c
    const verifiedCount = (this.db.prepare('SELECT COUNT(*) as c FROM knowledge_entries WHERE verified = 1').get() as { c: number }).c
    const rows = this.db.prepare('SELECT type, COUNT(*) as c FROM knowledge_entries GROUP BY type').all() as { type: string; c: number }[]
    const byType: Record<string, number> = {}
    for (const r of rows) byType[r.type] = r.c
    return { entryCount, verifiedCount, byType }
  }

  private generateId(): string {
    this.seq = (this.seq + 1) % 10000
    return `KB-${Date.now()}-${this.seq.toString().padStart(4, '0')}`
  }

  private fromRow(row: KBRow): KnowledgeEntry {
    return {
      id: row.id,
      type: row.type as KnowledgeEntry['type'],
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      contentRef: row.content_ref,
      embeddingId: row.embedding_id ?? undefined,
      relevance: row.relevance,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed ?? undefined,
      verified: row.verified === 1,
      verifiedBy: row.verified_by ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
      createdAt: row.created_at,
      sourceArtifact: row.source_artifact ?? undefined,
    }
  }
}
