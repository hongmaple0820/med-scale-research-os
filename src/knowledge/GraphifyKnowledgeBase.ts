import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { KnowledgeEntry, KnowledgeQuery } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { externalCommandExists, runExternalCommandSync } from '../core/ExternalCommand.js'
import type { IKnowledgeBase } from './KnowledgeBase.js'

interface GraphifyKnowledgeBaseOptions {
  projectDir?: string
  scaleDir?: string
  graphPath?: string
  reportPath?: string
  entriesDir?: string
}

interface OverlayRecord {
  entry: KnowledgeEntry
  notePath: string
}

export class GraphifyKnowledgeBase implements IKnowledgeBase {
  private projectDir: string
  private scaleRoot: string
  private graphPath: string
  private reportPath: string
  private entriesDir: string
  private indexPath: string
  private seq = 0

  constructor(
    private eventBus: IEventBus,
    options: GraphifyKnowledgeBaseOptions = {},
  ) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = resolveScaleRoot(this.projectDir, options.scaleDir)
    this.graphPath = resolveProjectPath(this.projectDir, options.graphPath ?? join('graphify-out', 'graph.json'))
    this.reportPath = resolveProjectPath(this.projectDir, options.reportPath ?? join('graphify-out', 'GRAPH_REPORT.md'))
    this.entriesDir = resolveProjectPath(this.projectDir, options.entriesDir ?? join(this.scaleRoot, 'graphify-knowledge', 'entries'))
    this.indexPath = join(dirname(this.entriesDir), 'index.json')
    this.seq = this.loadOverlayEntries().length
  }

  async add(input: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = {
      ...input,
      id: this.generateId(),
      createdAt: Date.now(),
      accessCount: 0,
      relevance: 0.5,
    }
    const record: OverlayRecord = {
      entry,
      notePath: join(this.entriesDir, `${entry.id}.md`),
    }
    const records = this.loadOverlayRecords()
    records.push(record)
    this.writeOverlayRecords(records)
    this.eventBus.emit('lesson.proposed', { lessonId: entry.id }, { artifactId: input.sourceArtifact })
    return entry
  }

  async recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    const records = this.loadOverlayRecords()
      .map(record => record.entry)
      .filter(entry => matchesKnowledgeQuery(entry, query))
      .sort((a, b) => b.relevance - a.relevance || b.createdAt - a.createdAt)

    if (records.length > 0) return records.slice(0, query.limit ?? 10)

    const graphEntries = this.graphEntries(query.limit ?? 10)
      .filter(entry => matchesKnowledgeQuery(entry, query))
      .sort((a, b) => b.relevance - a.relevance)
    return graphEntries.slice(0, query.limit ?? 10)
  }

  async recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]> {
    const overlayHits = this.searchOverlay(text, topK)
    const graphHits = this.searchGraph(text, topK)
    const merged = dedupeKnowledgeEntries([...overlayHits, ...graphHits])
      .sort((a, b) => b.relevance - a.relevance || b.accessCount - a.accessCount)
      .slice(0, topK)
    if (merged.length > 0) return merged
    return this.recall({ verifiedOnly: true, limit: topK })
  }

  async markHelpful(id: string, sessionId: string): Promise<void> {
    const records = this.loadOverlayRecords()
    const record = records.find(item => item.entry.id === id)
    if (!record) return
    record.entry.relevance = Math.min(1, record.entry.relevance + 0.05)
    record.entry.accessCount += 1
    record.entry.lastAccessed = Date.now()
    this.writeOverlayRecords(records)
    this.eventBus.emit('lesson.helpful', { lessonId: id }, { sessionId })
  }

  async markUseless(id: string, sessionId: string): Promise<void> {
    const records = this.loadOverlayRecords()
    const record = records.find(item => item.entry.id === id)
    if (!record) return
    record.entry.relevance = Math.max(0.05, record.entry.relevance - 0.1)
    this.writeOverlayRecords(records)
    this.eventBus.emit('lesson.useless', { lessonId: id }, { sessionId })
  }

  async verify(id: string, verifiedBy: string): Promise<void> {
    const records = this.loadOverlayRecords()
    const record = records.find(item => item.entry.id === id)
    if (!record) return
    record.entry.verified = true
    record.entry.verifiedBy = verifiedBy
    record.entry.verifiedAt = Date.now()
    this.writeOverlayRecords(records)
    this.eventBus.emit('lesson.approved', { lessonId: id, verifiedBy })
  }

  async decay(): Promise<void> {
    const DAY = 24 * 60 * 60 * 1000
    const now = Date.now()
    const records = this.loadOverlayRecords()
    for (const record of records) {
      const days = record.entry.lastAccessed ? (now - record.entry.lastAccessed) / DAY : 90
      const recency = Math.exp(-days / 30)
      record.entry.relevance = Math.max(0.05, record.entry.relevance * 0.95 + recency * 0.05)
    }
    this.writeOverlayRecords(records)
  }

  private searchOverlay(text: string, topK: number): KnowledgeEntry[] {
    const tokens = tokenize(text)
    if (tokens.length === 0) return []
    return this.loadOverlayRecords()
      .map(record => {
        const corpus = [
          record.entry.title,
          record.entry.tags.join(' '),
          record.entry.contentRef,
          previewText(record.notePath),
        ].join(' ')
        return {
          entry: record.entry,
          score: scoreText(tokens, corpus),
        }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.relevance - a.entry.relevance)
      .slice(0, topK)
      .map(item => ({
        ...item.entry,
        relevance: Math.min(1, Math.max(item.entry.relevance, item.score)),
      }))
  }

  private searchGraph(text: string, topK: number): KnowledgeEntry[] {
    const cliHits = this.searchGraphWithCli(text, topK)
    if (cliHits.length > 0) return cliHits

    const graph = this.loadGraphDocument()
    const nodes = graphNodes(graph)
    const tokens = tokenize(text)
    return nodes
      .map(node => {
        const corpus = nodeCorpus(node)
        return {
          node,
          score: scoreText(tokens, corpus),
        }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((item, index) => nodeToKnowledgeEntry(item.node, index, item.score))
  }

  private searchGraphWithCli(text: string, topK: number): KnowledgeEntry[] {
    if (!commandExists('graphify') || !existsSync(this.graphPath)) return []
    try {
      const output = runExternalCommandSync('graphify', ['query', text, '--graph', this.graphPath], {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const lines = String(output).split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean)
      return lines.slice(0, topK).map((line, index) => ({
        id: `GRAPHIFY-CLI-${index + 1}`,
        type: 'reference',
        title: truncate(line, 140),
        tags: ['graphify', 'cli-query'],
        contentRef: normalizeProjectPath(this.projectDir, this.graphPath),
        relevance: Math.max(0.55, 0.95 - index * 0.05),
        accessCount: 0,
        verified: true,
        verifiedBy: 'graphify',
        verifiedAt: Date.now(),
        createdAt: Date.now(),
      }))
    } catch {
      return []
    }
  }

  private graphEntries(limit: number): KnowledgeEntry[] {
    const nodes = graphNodes(this.loadGraphDocument())
      .slice(0, limit)
      .map((node, index) => nodeToKnowledgeEntry(node, index, 0.5))
    if (nodes.length > 0) return nodes
    if (!existsSync(this.reportPath)) return []
    return [{
      id: 'GRAPHIFY-REPORT-1',
      type: 'reference',
      title: 'Graphify project report',
      tags: ['graphify', 'report'],
      contentRef: normalizeProjectPath(this.projectDir, this.reportPath),
      relevance: 0.5,
      accessCount: 0,
      verified: true,
      verifiedBy: 'graphify',
      verifiedAt: Date.now(),
      createdAt: Date.now(),
    }]
  }

  private loadGraphDocument(): unknown {
    if (!existsSync(this.graphPath)) return null
    try {
      return JSON.parse(readFileSync(this.graphPath, 'utf-8')) as unknown
    } catch {
      return null
    }
  }

  private loadOverlayEntries(): KnowledgeEntry[] {
    return this.loadOverlayRecords().map(record => record.entry)
  }

  private loadOverlayRecords(): OverlayRecord[] {
    if (!existsSync(this.indexPath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf-8')) as Array<Partial<OverlayRecord>>
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(item => ({
          entry: item.entry as KnowledgeEntry,
          notePath: String(item.notePath ?? ''),
        }))
        .filter(item => item.entry?.id && item.notePath)
    } catch {
      return []
    }
  }

  private writeOverlayRecords(records: OverlayRecord[]): void {
    mkdirSync(this.entriesDir, { recursive: true })
    writeFileSync(this.indexPath, JSON.stringify(records, null, 2), 'utf-8')
    for (const record of records) {
      writeFileSync(record.notePath, renderKnowledgeNote(record.entry), 'utf-8')
    }
    const existing = existsSync(this.entriesDir) ? readdirSync(this.entriesDir) : []
    for (const file of existing) {
      if (!file.endsWith('.md')) continue
      const absolute = join(this.entriesDir, file)
      if (!records.some(record => record.notePath === absolute)) {
        try {
          writeFileSync(absolute, '', 'utf-8')
        } catch {
          // ignore stale note cleanup failures
        }
      }
    }
  }

  private generateId(): string {
    this.seq = (this.seq + 1) % 10000
    return `KB-${Date.now()}-${this.seq.toString().padStart(4, '0')}`
  }
}

function graphNodes(document: unknown): Array<Record<string, unknown>> {
  if (!document || typeof document !== 'object') return []
  const record = document as Record<string, unknown>
  const direct = Array.isArray(record.nodes) ? record.nodes : []
  if (direct.length > 0) return direct.filter(isRecord)
  const graph = isRecord(record.graph) && Array.isArray(record.graph.nodes) ? record.graph.nodes : []
  if (graph.length > 0) return graph.filter(isRecord)
  const elements = isRecord(record.elements) && Array.isArray(record.elements.nodes) ? record.elements.nodes : []
  return elements.filter(isRecord)
}

function nodeToKnowledgeEntry(node: Record<string, unknown>, index: number, score: number): KnowledgeEntry {
  const now = Date.now()
  const title = firstString(
    node.title,
    node.label,
    node.name,
    nestedValue(node, ['data', 'title']),
    nestedValue(node, ['data', 'label']),
    nestedValue(node, ['data', 'name']),
  ) ?? `Graphify node ${index + 1}`
  const contentRef = normalizePath(firstString(
    node.file,
    node.path,
    nestedValue(node, ['source', 'path']),
    nestedValue(node, ['source', 'file']),
    nestedValue(node, ['data', 'file']),
    nestedValue(node, ['data', 'path']),
  ) ?? 'graphify-out/graph.json')
  const tags = dedupeStrings([
    'graphify',
    firstString(node.type, node.kind, nestedValue(node, ['data', 'type']), nestedValue(node, ['data', 'kind'])),
  ])
  return {
    id: firstString(node.id, nestedValue(node, ['data', 'id'])) ?? `GRAPHIFY-${index + 1}`,
    type: 'reference',
    title: truncate(title, 140),
    tags,
    contentRef,
    relevance: Math.min(1, Math.max(0.45, score)),
    accessCount: 0,
    verified: true,
    verifiedBy: 'graphify',
    verifiedAt: now,
    createdAt: now,
  }
}

function nodeCorpus(node: Record<string, unknown>): string {
  return [
    firstString(
      node.title,
      node.label,
      node.name,
      node.text,
      node.summary,
      nestedValue(node, ['data', 'title']),
      nestedValue(node, ['data', 'label']),
      nestedValue(node, ['data', 'name']),
      nestedValue(node, ['data', 'text']),
      nestedValue(node, ['data', 'summary']),
    ) ?? '',
    firstString(
      node.file,
      node.path,
      nestedValue(node, ['source', 'path']),
      nestedValue(node, ['source', 'file']),
      nestedValue(node, ['data', 'file']),
      nestedValue(node, ['data', 'path']),
    ) ?? '',
    dedupeStrings([
      firstString(node.type, node.kind, nestedValue(node, ['data', 'type']), nestedValue(node, ['data', 'kind'])),
    ]).join(' '),
  ].join(' ')
}

function matchesKnowledgeQuery(entry: KnowledgeEntry, query: KnowledgeQuery): boolean {
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type]
    if (!types.includes(entry.type)) return false
  }
  if (query.tags && query.tags.some(tag => !entry.tags.includes(tag))) return false
  if (query.minRelevance !== undefined && entry.relevance < query.minRelevance) return false
  if (query.verifiedOnly && !entry.verified) return false
  return true
}

function scoreText(tokens: string[], corpus: string): number {
  if (tokens.length === 0) return 0
  const haystack = corpus.toLowerCase()
  let hits = 0
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1
  }
  return hits === 0 ? 0 : Math.min(0.98, hits / tokens.length)
}

function previewText(path: string): string {
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8').slice(0, 800)
  } catch {
    return ''
  }
}

function renderKnowledgeNote(entry: KnowledgeEntry): string {
  const lines = [
    '---',
    `id: ${entry.id}`,
    `type: ${entry.type}`,
    `verified: ${entry.verified}`,
    `relevance: ${entry.relevance}`,
    `createdAt: ${entry.createdAt}`,
    `contentRef: ${entry.contentRef}`,
    'tags:',
    ...entry.tags.map(tag => `  - ${tag}`),
    '---',
    '',
    `# ${entry.title}`,
    '',
    `- Source Artifact: ${entry.sourceArtifact ?? 'n/a'}`,
    `- Verified By: ${entry.verifiedBy ?? 'n/a'}`,
    '',
    '## Notes',
    '',
    entry.contentRef || 'No additional notes recorded.',
    '',
  ]
  return lines.join('\n')
}

function dedupeKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const seen = new Map<string, KnowledgeEntry>()
  for (const entry of entries) {
    const key = `${entry.id}::${entry.contentRef}`
    const existing = seen.get(key)
    if (!existing || existing.relevance < entry.relevance) seen.set(key, entry)
  }
  return [...seen.values()]
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2)
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map(value => value.trim()))]
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(value => typeof value === 'string' ? value.trim() : '').find(Boolean)
}

function nestedValue(record: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = record
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeProjectPath(projectDir: string, targetPath: string): string {
  const absolute = isAbsolute(targetPath) ? targetPath : resolve(projectDir, targetPath)
  const relativePath = normalizePath(absolute.startsWith(projectDir) ? absolute.slice(projectDir.length).replace(/^[/\\]+/, '') : targetPath)
  return relativePath || normalizePath(targetPath)
}

function resolveScaleRoot(projectDir: string, scaleDir?: string): string {
  return isAbsolute(scaleDir ?? '') ? String(scaleDir) : join(projectDir, scaleDir ?? '.scale')
}

function resolveProjectPath(projectDir: string, targetPath: string): string {
  return isAbsolute(targetPath) ? targetPath : resolve(projectDir, targetPath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function commandExists(command: string): boolean {
  return externalCommandExists(command)
}
