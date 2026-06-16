import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { WorkflowEvalStore, type FailureReplayRecord } from '../eval/WorkflowEval.js'
import { RuntimeEvidenceLedger, type RuntimeEvidenceRecord } from '../runtime/RuntimeEvidenceLedger.js'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'
import type { MemoryLearningCandidate } from './MemoryLearning.js'

export type MemoryNodeType = 'fact' | 'decision' | 'incident' | 'relation' | 'contradiction'
export type MemoryNodeSource = 'runtime-evidence' | 'task-artifact' | 'docs' | 'git' | 'manual'
export type MemoryNodeScope = 'project' | 'workspace' | 'global-candidate'
export type MemoryNodeStatus = 'candidate' | 'active' | 'stale' | 'rejected'

export interface MemoryNode {
  id: string
  type: MemoryNodeType
  title: string
  summary: string
  entities: string[]
  source: MemoryNodeSource
  evidencePaths: string[]
  confidence: number
  scope: MemoryNodeScope
  status: MemoryNodeStatus
  createdAt: string
  updatedAt: string
  lastVerifiedAt?: string
  metadata?: Record<string, unknown>
}

export interface MemoryBrainOptions {
  projectDir?: string
  scaleDir?: string
  dbPath?: string
  now?: () => Date
}

export interface MemoryIngestOptions {
  from: 'evidence' | 'candidate' | 'failure'
  taskId?: string
  sessionId?: string
  candidateId?: string
  failureId?: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}

export interface MemoryIngestReport {
  ok: boolean
  source: MemoryIngestOptions['from']
  created: number
  skipped: number
  nodes: MemoryNode[]
  warnings: string[]
}

export interface MemoryQueryReport {
  query: string
  count: number
  nodes: MemoryNode[]
}

export interface MemoryContradiction {
  id: string
  title: string
  summary: string
  nodeIds: string[]
  entities: string[]
  evidencePaths: string[]
  confidence: number
}

export interface MemoryContradictionReport {
  ok: boolean
  count: number
  contradictions: MemoryContradiction[]
}

export interface MemoryDreamReport {
  ok: boolean
  generatedAt: string
  summary: {
    total: number
    active: number
    candidate: number
    stale: number
    missingEvidence: number
    duplicateGroups: number
    contradictions: number
  }
  promotionCandidates: Array<{ id: string; title: string; confidence: number; evidencePaths: string[] }>
  staleCandidates: Array<{ id: string; title: string; reason: string }>
  duplicateGroups: Array<{ fingerprint: string; nodeIds: string[]; title: string }>
  contradictions: MemoryContradiction[]
  suggestedDocs: string[]
}

export interface MemoryPromoteReport {
  ok: boolean
  node?: MemoryNode
  warnings: string[]
}

export interface MemoryStatusUpdateReport {
  ok: boolean
  node?: MemoryNode
  previousStatus?: MemoryNodeStatus
  warnings: string[]
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  entities TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  evidence_paths TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_type ON memory_nodes(type);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_status ON memory_nodes(status);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope ON memory_nodes(scope);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_fingerprint ON memory_nodes(fingerprint);

CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', '1');
`

export class MemoryBrain {
  private projectDir: string
  private scaleRoot: string
  private dbPath: string
  private db: Database.Database
  private now: () => Date

  constructor(options: MemoryBrainOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = resolveScaleRoot(this.projectDir, options.scaleDir)
    this.dbPath = options.dbPath ?? join(this.scaleRoot, 'memory', 'brain.sqlite')
    this.now = options.now ?? (() => new Date())
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(SCHEMA)
    this.writeManifest()
  }

  addNode(input: Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'>): MemoryNode {
    const now = this.now().toISOString()
    const candidate: MemoryNode = sanitizeNode({
      id: input.id ?? `MEM-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: input.type,
      title: input.title,
      summary: input.summary,
      entities: unique(input.entities ?? inferEntities(`${input.title}\n${input.summary}`)),
      source: input.source,
      evidencePaths: unique(input.evidencePaths ?? []),
      confidence: clampConfidence(input.confidence ?? 0.55),
      scope: input.scope ?? 'project',
      status: input.status ?? 'candidate',
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: input.lastVerifiedAt,
      metadata: input.metadata ?? {},
    })
    assertNode(candidate)
    this.upsert(candidate)
    return candidate
  }

  ingest(options: MemoryIngestOptions): MemoryIngestReport {
    if (options.from === 'candidate') return this.ingestCandidate(options)
    if (options.from === 'failure') return this.ingestFailureReplay(options)
    return this.ingestEvidence(options)
  }

  query(query: string, options: { limit?: number; status?: MemoryNodeStatus } = {}): MemoryQueryReport {
    const terms = tokenize(query)
    const nodes = this.list({ status: options.status })
      .map(node => ({ node, score: scoreNode(node, terms) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence)
      .slice(0, options.limit ?? 8)
      .map(item => item.node)
    return {
      query,
      count: nodes.length,
      nodes,
    }
  }

  contradictions(): MemoryContradictionReport {
    const contradictions = detectContradictions(this.list({ status: 'active' }))
    return {
      ok: contradictions.length === 0,
      count: contradictions.length,
      contradictions,
    }
  }

  dream(): MemoryDreamReport {
    const nodes = this.list()
    const duplicateGroups = duplicateGroupsFor(nodes)
    const contradictions = detectContradictions(nodes.filter(node => node.status === 'active' || node.status === 'candidate'))
    const missingEvidence = nodes.filter(node => node.status === 'active' && node.evidencePaths.length === 0)
    const staleCandidates = nodes
      .filter(node => node.status === 'active' && isStale(node))
      .map(node => ({ id: node.id, title: node.title, reason: 'last verification is older than 30 days or missing' }))
    const promotionCandidates = nodes
      .filter(node => node.status === 'candidate' && node.evidencePaths.length > 0 && node.confidence >= 0.7)
      .map(node => ({ id: node.id, title: node.title, confidence: node.confidence, evidencePaths: node.evidencePaths }))

    return {
      ok: missingEvidence.length === 0,
      generatedAt: this.now().toISOString(),
      summary: {
        total: nodes.length,
        active: nodes.filter(node => node.status === 'active').length,
        candidate: nodes.filter(node => node.status === 'candidate').length,
        stale: staleCandidates.length,
        missingEvidence: missingEvidence.length,
        duplicateGroups: duplicateGroups.length,
        contradictions: contradictions.length,
      },
      promotionCandidates,
      staleCandidates,
      duplicateGroups,
      contradictions,
      suggestedDocs: suggestDocs(nodes, contradictions),
    }
  }

  promote(id: string, options: { scope?: MemoryNodeScope } = {}): MemoryPromoteReport {
    let node = this.get(id) ?? this.getMemoryNodeForCandidate(id)
    const warnings: string[] = []
    if (!node) {
      const candidate = this.readLearningCandidate(id)
      if (!candidate) {
        return { ok: false, warnings: [`Memory node or learning candidate not found: ${id}`] }
      }
      const report = this.ingestCandidate({ from: 'candidate', candidateId: id, scope: options.scope })
      node = report.nodes[0]
      warnings.push(...report.warnings)
    }
    if (!node) return { ok: false, warnings: [`Unable to promote: ${id}`] }
    if (node.evidencePaths.length === 0) {
      return { ok: false, node, warnings: [...warnings, 'Active memory requires at least one evidence path.'] }
    }
    const promoted: MemoryNode = {
      ...node,
      status: 'active',
      scope: options.scope ?? node.scope,
      confidence: Math.max(node.confidence, 0.75),
      updatedAt: this.now().toISOString(),
      lastVerifiedAt: this.now().toISOString(),
    }
    assertNode(promoted)
    this.upsert(promoted)
    return { ok: true, node: promoted, warnings }
  }

  updateStatus(id: string, status: Exclude<MemoryNodeStatus, 'active'>, options: { scope?: MemoryNodeScope } = {}): MemoryStatusUpdateReport {
    let node = this.get(id) ?? this.getMemoryNodeForCandidate(id)
    const warnings: string[] = []
    if (!node) {
      const candidate = this.readLearningCandidate(id)
      if (!candidate) {
        return { ok: false, warnings: [`Memory node or learning candidate not found: ${id}`] }
      }
      const report = this.ingestCandidate({ from: 'candidate', candidateId: id, scope: options.scope })
      node = report.nodes[0]
      warnings.push(...report.warnings)
    }
    if (!node) return { ok: false, warnings: [`Unable to update memory status: ${id}`] }
    const previousStatus = node.status
    const updated: MemoryNode = {
      ...node,
      status,
      scope: options.scope ?? node.scope,
      updatedAt: this.now().toISOString(),
      lastVerifiedAt: status === 'candidate' ? undefined : node.lastVerifiedAt,
      metadata: {
        ...(node.metadata ?? {}),
        reviewedAt: this.now().toISOString(),
      },
    }
    assertNode(updated)
    this.upsert(updated)
    return { ok: true, node: updated, previousStatus, warnings }
  }

  exportJsonl(): string {
    return this.list().map(node => JSON.stringify(node)).join('\n') + '\n'
  }

  importJsonl(filePath: string): { ok: boolean; imported: number; skipped: number; warnings: string[] } {
    const warnings: string[] = []
    let imported = 0
    let skipped = 0
    const text = readFileSync(filePath, 'utf-8')
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try {
        const node = sanitizeNode(JSON.parse(line) as MemoryNode)
        assertNode(node)
        this.upsert(node)
        imported += 1
      } catch (error) {
        skipped += 1
        warnings.push(`Skipped line: ${(error as Error).message}`)
      }
    }
    return { ok: warnings.length === 0, imported, skipped, warnings }
  }

  list(filter: { status?: MemoryNodeStatus; scope?: MemoryNodeScope } = {}): MemoryNode[] {
    let sql = 'SELECT * FROM memory_nodes'
    const where: string[] = []
    const params: Record<string, string> = {}
    if (filter.status) {
      where.push('status = @status')
      params.status = filter.status
    }
    if (filter.scope) {
      where.push('scope = @scope')
      params.scope = filter.scope
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`
    sql += ' ORDER BY updated_at DESC'
    return this.db.prepare(sql).all(params).map(rowToNode)
  }

  get(id: string): MemoryNode | null {
    const row = this.db.prepare('SELECT * FROM memory_nodes WHERE id = ?').get(id)
    return row ? rowToNode(row) : null
  }

  private getMemoryNodeForCandidate(id: string): MemoryNode | null {
    return id.startsWith('MEM-') ? null : this.get(`MEM-${id}`)
  }

  close(): void {
    this.db.close()
  }

  private ingestEvidence(options: MemoryIngestOptions): MemoryIngestReport {
    const ledger = new RuntimeEvidenceLedger({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
      createDirs: false,
    })
    const records = ledger.list({ taskId: options.taskId, sessionId: options.sessionId, limit: Number.MAX_SAFE_INTEGER })
    const warnings: string[] = []
    const nodes: MemoryNode[] = []
    let skipped = 0
    for (const record of records) {
      if (record.status === 'skipped') {
        skipped += 1
        continue
      }
      const node = this.addNode(nodeFromEvidence(record, {
        projectDir: this.projectDir,
        scaleRoot: this.scaleRoot,
        type: options.type,
        scope: options.scope,
      }))
      nodes.push(node)
    }
    if (records.length === 0) warnings.push('No runtime evidence matched the requested task/session scope.')
    return {
      ok: nodes.length > 0,
      source: 'evidence',
      created: nodes.length,
      skipped,
      nodes,
      warnings,
    }
  }

  private ingestCandidate(options: MemoryIngestOptions): MemoryIngestReport {
    const candidate = this.readLearningCandidate(options.candidateId)
    if (!candidate) {
      return {
        ok: false,
        source: 'candidate',
        created: 0,
        skipped: 0,
        nodes: [],
        warnings: [`Learning candidate not found: ${options.candidateId ?? '<latest>'}`],
      }
    }
    const node = this.addNode(nodeFromCandidate(candidate, {
      projectDir: this.projectDir,
      scaleRoot: this.scaleRoot,
      type: options.type,
      scope: options.scope,
    }))
    return {
      ok: true,
      source: 'candidate',
      created: 1,
      skipped: 0,
      nodes: [node],
      warnings: candidate.promotable ? [] : ['Learning candidate is not marked promotable; keep it as candidate until more evidence is recorded.'],
    }
  }

  private ingestFailureReplay(options: MemoryIngestOptions): MemoryIngestReport {
    const store = new WorkflowEvalStore({
      projectDir: this.projectDir,
      scaleDir: this.scaleRoot,
    })
    const failures = options.failureId
      ? [store.getFailure(options.failureId)].filter((failure): failure is FailureReplayRecord => Boolean(failure))
      : store.listFailures({ taskId: options.taskId })
    const warnings: string[] = []
    const nodes: MemoryNode[] = []
    let skipped = 0
    for (const failure of failures) {
      if (failure.status === 'closed' || failure.status === 'accepted-risk') {
        skipped += 1
        continue
      }
      const node = this.addNode(nodeFromFailureReplay(failure, {
        projectDir: this.projectDir,
        scaleRoot: this.scaleRoot,
        type: options.type,
        scope: options.scope,
      }))
      nodes.push(node)
    }
    if (failures.length === 0) warnings.push(`Failure replay not found: ${options.failureId ?? options.taskId ?? '<latest>'}`)
    return {
      ok: nodes.length > 0,
      source: 'failure',
      created: nodes.length,
      skipped,
      nodes,
      warnings,
    }
  }

  private readLearningCandidate(candidateId?: string): MemoryLearningCandidate | null {
    const dir = join(this.scaleRoot, 'memory', 'learning-candidates')
    if (!existsSync(dir)) return null
    const file = candidateId
      ? join(dir, `${safePathSegment(candidateId)}.json`)
      : readdirSync(dir)
          .filter(name => name.endsWith('.json'))
          .map(name => join(dir, name))
          .sort()
          .at(-1)
    if (!file || !existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')) as MemoryLearningCandidate
    } catch {
      return null
    }
  }

  private upsert(node: MemoryNode): void {
    const fingerprint = fingerprintFor(node)
    this.db.prepare(`
      INSERT INTO memory_nodes (
        id, type, title, summary, entities, source, evidence_paths, confidence, scope, status,
        created_at, updated_at, last_verified_at, metadata, fingerprint
      ) VALUES (
        @id, @type, @title, @summary, @entities, @source, @evidencePaths, @confidence, @scope, @status,
        @createdAt, @updatedAt, @lastVerifiedAt, @metadata, @fingerprint
      )
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        summary = excluded.summary,
        entities = excluded.entities,
        source = excluded.source,
        evidence_paths = excluded.evidence_paths,
        confidence = excluded.confidence,
        scope = excluded.scope,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_verified_at = excluded.last_verified_at,
        metadata = excluded.metadata,
        fingerprint = excluded.fingerprint
    `).run({
      id: node.id,
      type: node.type,
      title: node.title,
      summary: node.summary,
      entities: JSON.stringify(node.entities),
      source: node.source,
      evidencePaths: JSON.stringify(node.evidencePaths),
      confidence: node.confidence,
      scope: node.scope,
      status: node.status,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      lastVerifiedAt: node.lastVerifiedAt ?? null,
      metadata: JSON.stringify(node.metadata ?? {}),
      fingerprint,
    })
  }

  private writeManifest(): void {
    const manifestPath = join(this.scaleRoot, 'memory', 'brain-manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({
      version: '1.0',
      dbPath: normalizeProjectPath(this.projectDir, this.dbPath),
      scope: 'project',
      activeMemoryRequiresEvidence: true,
      generatedAt: this.now().toISOString(),
    }, null, 2), 'utf-8')
  }
}

function nodeFromEvidence(record: RuntimeEvidenceRecord, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const evidencePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'evidence', 'runtime', `${record.id}.json`))
  return {
    id: `MEM-${record.id}`,
    type: input.type ?? (record.status === 'failed' ? 'incident' : 'fact'),
    title: record.title,
    summary: record.summary,
    entities: inferEntities(`${record.title}\n${record.summary}\n${record.command ?? ''}`),
    source: 'runtime-evidence',
    evidencePaths: unique([evidencePath, ...(record.artifacts ?? [])]),
    confidence: record.status === 'passed' ? 0.72 : 0.58,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: record.taskId,
      sessionId: record.sessionId,
      evidenceId: record.id,
      evidenceStatus: record.status,
      command: record.command,
      exitCode: record.exitCode,
    },
  }
}

function nodeFromCandidate(candidate: MemoryLearningCandidate, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const candidatePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'memory', 'learning-candidates', `${candidate.id}.json`))
  const artifactPaths = (candidate.artifactPaths ?? [])
    .map(path => normalizeProjectPath(input.projectDir, path))
    .filter(Boolean)
  return {
    id: `MEM-${candidate.id}`,
    type: input.type ?? 'decision',
    title: candidate.title,
    summary: candidate.summary,
    entities: inferEntities(`${candidate.title}\n${candidate.summary}\n${candidate.tags.join(' ')}`),
    source: 'task-artifact',
    evidencePaths: unique([
      candidatePath,
      ...artifactPaths,
      ...candidate.graphRefs.map(path => normalizeProjectPath(input.projectDir, path)),
      ...candidate.evidenceIds.map(id => join('.scale', 'evidence', 'runtime', `${id}.json`)),
    ]),
    confidence: candidate.promotable ? 0.72 : 0.5,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: candidate.taskId,
      sessionId: candidate.sessionId,
      candidateId: candidate.id,
      recommendedAction: candidate.recommendedAction,
      tags: candidate.tags,
    },
  }
}

function nodeFromFailureReplay(failure: FailureReplayRecord, input: {
  projectDir: string
  scaleRoot: string
  type?: MemoryNodeType
  scope?: MemoryNodeScope
}): Partial<MemoryNode> & Pick<MemoryNode, 'type' | 'title' | 'summary' | 'source'> {
  const failurePath = normalizeProjectPath(input.projectDir, join(input.scaleRoot, 'evals', 'failures', `${safePathSegment(failure.id)}.json`))
  const summary = [
    failure.wrongTurn,
    `Prevention: ${failure.prevention}`,
    `Correction: ${failure.correction}`,
  ].join(' ')
  return {
    id: `MEM-${failure.id}`,
    type: input.type ?? 'incident',
    title: `Failure replay: ${failure.category} in ${failure.caseId}`,
    summary,
    entities: inferEntities(`${failure.category}\n${failure.phase}\n${failure.task}\n${failure.prevention}`),
    source: 'task-artifact',
    evidencePaths: [failurePath],
    confidence: failure.status === 'promoted' ? 0.7 : 0.62,
    scope: input.scope ?? 'project',
    status: 'candidate',
    metadata: {
      taskId: failure.taskId,
      suiteId: failure.suiteId,
      caseId: failure.caseId,
      failureId: failure.id,
      category: failure.category,
      phase: failure.phase,
      failureStatus: failure.status,
      replayCommand: failure.replayCommand,
      redactionApplied: failure.redactionApplied,
    },
  }
}

function detectContradictions(nodes: MemoryNode[]): MemoryContradiction[] {
  const contradictions: MemoryContradiction[] = []
  const pairs = new Set<string>()
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i]
      const right = nodes[j]
      const shared = left.entities.filter(entity => right.entities.includes(entity))
      if (shared.length === 0) continue
      if (!polaritiesConflict(left, right)) continue
      const key = [left.id, right.id].sort().join(':')
      if (pairs.has(key)) continue
      pairs.add(key)
      contradictions.push({
        id: `CON-${hash(key).slice(0, 10)}`,
        title: `Contradiction around ${shared.slice(0, 3).join(', ')}`,
        summary: `${left.title} conflicts with ${right.title}.`,
        nodeIds: [left.id, right.id],
        entities: shared,
        evidencePaths: unique([...left.evidencePaths, ...right.evidencePaths]),
        confidence: Math.min(0.9, Math.max(left.confidence, right.confidence)),
      })
    }
  }
  return contradictions
}

function polaritiesConflict(left: MemoryNode, right: MemoryNode): boolean {
  const l = polarity(`${left.title}\n${left.summary}`)
  const r = polarity(`${right.title}\n${right.summary}`)
  if (l.enabled && r.disabled) return true
  if (l.disabled && r.enabled) return true
  if (l.exists && r.missing) return true
  if (l.missing && r.exists) return true
  if (l.allowed && r.blocked) return true
  if (l.blocked && r.allowed) return true
  return false
}

function polarity(text: string): Record<string, boolean> {
  const lower = text.toLowerCase()
  return {
    enabled: /\b(enabled|enable|available|works|passed|active|on)\b/.test(lower),
    disabled: /\b(disabled|disable|unavailable|not available|failed|inactive|off)\b/.test(lower),
    exists: /\b(exists|present|configured|found)\b/.test(lower),
    missing: /\b(missing|absent|not configured|not found)\b/.test(lower),
    allowed: /\b(allowed|permitted|safe)\b/.test(lower),
    blocked: /\b(blocked|forbidden|unsafe|denied)\b/.test(lower),
  }
}

function duplicateGroupsFor(nodes: MemoryNode[]): Array<{ fingerprint: string; nodeIds: string[]; title: string }> {
  const groups = new Map<string, MemoryNode[]>()
  for (const node of nodes) {
    const key = fingerprintFor(node)
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      fingerprint,
      nodeIds: group.map(node => node.id),
      title: group[0].title,
    }))
}

function suggestDocs(nodes: MemoryNode[], contradictions: MemoryContradiction[]): string[] {
  const suggestions = new Set<string>()
  if (nodes.some(node => node.type === 'decision')) suggestions.add('docs/architecture/')
  if (nodes.some(node => node.type === 'incident')) suggestions.add('docs/worklog/metrics.md')
  if (contradictions.length > 0) suggestions.add('docs/workflow/README.md')
  return [...suggestions]
}

function isStale(node: MemoryNode): boolean {
  const date = node.lastVerifiedAt ?? node.updatedAt
  const ageMs = Date.now() - Date.parse(date)
  return Number.isFinite(ageMs) && ageMs > 30 * 24 * 60 * 60 * 1000
}

function scoreNode(node: MemoryNode, terms: string[]): number {
  if (terms.length === 0) return 1
  const haystack = `${node.title}\n${node.summary}\n${node.entities.join(' ')}\n${node.evidencePaths.join(' ')}`.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function rowToNode(row: unknown): MemoryNode {
  const value = row as Record<string, unknown>
  return {
    id: String(value.id),
    type: value.type as MemoryNodeType,
    title: String(value.title),
    summary: String(value.summary),
    entities: parseJsonArray(value.entities),
    source: value.source as MemoryNodeSource,
    evidencePaths: parseJsonArray(value.evidence_paths),
    confidence: Number(value.confidence),
    scope: value.scope as MemoryNodeScope,
    status: value.status as MemoryNodeStatus,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    lastVerifiedAt: value.last_verified_at ? String(value.last_verified_at) : undefined,
    metadata: parseJsonObject(value.metadata),
  }
}

function assertNode(node: MemoryNode): void {
  if (node.status === 'active' && node.evidencePaths.length === 0) {
    throw new Error('Active memory requires at least one evidence path.')
  }
  if (node.scope === 'global-candidate' && node.status === 'active') {
    throw new Error('Global candidate memory cannot be activated inside a project brain.')
  }
}

function sanitizeNode(node: MemoryNode): MemoryNode {
  const redacted = redactEvidenceValue(node).value as MemoryNode
  const redact = (value: string) => redactEvidenceText(value).value
  return {
    ...redacted,
    title: redact(redacted.title),
    summary: redact(redacted.summary),
    entities: unique((redacted.entities ?? []).map(entity => redact(String(entity))).filter(Boolean)),
    evidencePaths: unique((redacted.evidencePaths ?? []).map(path => String(path)).filter(Boolean)),
    confidence: clampConfidence(redacted.confidence),
    metadata: redacted.metadata ?? {},
  }
}

function tokenize(text: string): string[] {
  return unique(text.toLowerCase().split(/[^a-z0-9._/-]+/).filter(term => term.length >= 2))
}

function inferEntities(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9._/-]{2,}/g) ?? []
  return unique(matches.map(item => item.toLowerCase()).filter(item => !STOP_WORDS.has(item))).slice(0, 12)
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'task', 'tests', 'passed', 'failed', 'summary'])

function fingerprintFor(node: MemoryNode): string {
  return hash(`${node.type}:${node.scope}:${node.title.toLowerCase().replace(/\s+/g, ' ').trim()}`)
}

function hash(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.round(Math.max(0.05, Math.min(0.95, value)) * 100) / 100
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'memory-learning'
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? scaleDir as string : join(projectDir, scaleDir ?? '.scale')
}

function normalizeProjectPath(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  return rel && !rel.startsWith('..') && !isAbsolute(rel)
    ? rel.replace(/\\/g, '/')
    : filePath
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
