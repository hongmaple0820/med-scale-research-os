// SCALE Engine — Knowledge Base (W7 完整实现 + v0.7.2 TF-IDF)
// 设计参考：docs/03-CORE-MODULES.md §3.4
// Phase 3 增强：TF-IDF 文本相似度计算

import type { KnowledgeEntry, KnowledgeQuery } from '../artifact/types.js'
import type { IEventBus } from '../core/eventBus.js'
import { logger } from '../core/logger.js'

export interface IKnowledgeBase {
  add(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>): Promise<KnowledgeEntry>
  recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]>
  recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]>
  markHelpful(id: string, sessionId: string): Promise<void>
  markUseless(id: string, sessionId: string): Promise<void>
  verify(id: string, verifiedBy: string): Promise<void>
  decay(): Promise<void>
}

export class KnowledgeBase implements IKnowledgeBase {
  private entries = new Map<string, KnowledgeEntry>()
  private seq = 0
  // TF-IDF cache
  private documentFrequencies = new Map<string, number>()
  private totalDocuments = 0

  constructor(private eventBus: IEventBus) {}

  async add(input: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'accessCount' | 'relevance'>): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = {
      ...input,
      id: this.generateId(),
      createdAt: Date.now(),
      accessCount: 0,
      relevance: 0.5,
    }
    this.entries.set(entry.id, entry)
    this.eventBus.emit('lesson.proposed', { lessonId: entry.id }, { artifactId: input.sourceArtifact })
    return entry
  }

  async recall(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    let results = Array.from(this.entries.values())
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type]
      results = results.filter((e) => types.includes(e.type))
    }
    if (query.tags) results = results.filter((e) => query.tags!.every((t) => e.tags.includes(t)))
    if (query.minRelevance) results = results.filter((e) => e.relevance >= query.minRelevance!)
    if (query.verifiedOnly) results = results.filter((e) => e.verified)
    results.sort((a, b) => b.relevance - a.relevance)
    return results.slice(0, query.limit ?? 10)
  }

  async recallByVector(text: string, topK: number): Promise<KnowledgeEntry[]> {
    // v0.7.2: TF-IDF implementation (Phase 3 enhancement)
    const queryTerms = this.tokenize(text)
    if (queryTerms.length === 0) return this.recall({ verifiedOnly: true, limit: topK })

    const scored: Array<{ entry: KnowledgeEntry; score: number }> = []

    for (const entry of this.entries.values()) {
      // Use title + tags for document representation (contentRef is file path)
      const docText = `${entry.title} ${entry.tags.join(' ')}`
      const docTerms = this.tokenize(docText)
      const score = this.cosineSimilarity(queryTerms, docTerms)
      if (score > 0) scored.push({ entry, score })
    }

    // Fallback to verified recall if no TF-IDF matches
    if (scored.length === 0) return this.recall({ verifiedOnly: true, limit: topK })

    // Sort by TF-IDF similarity, then by relevance as tiebreaker
    scored.sort((a, b) => b.score - a.score || b.entry.relevance - a.entry.relevance)

    return scored.slice(0, topK).map(s => s.entry)
  }

  // ============================================================================
  // TF-IDF Helper Methods (Phase 3)
  // ============================================================================

  /**
   * Tokenize text into lowercase terms (simple word splitting)
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2) // Skip short terms
  }

  /**
   * Calculate term frequency (TF) for a term in a document
   */
  private termFrequency(term: string, docTerms: string[]): number {
    const count = docTerms.filter(t => t === term).length
    return count / docTerms.length
  }

  /**
   * Calculate inverse document frequency (IDF) for a term
   */
  private inverseDocumentFrequency(term: string): number {
    // Update document frequencies if needed
    if (this.documentFrequencies.size === 0 || this.totalDocuments !== this.entries.size) {
      this.rebuildDocumentFrequencies()
    }
    const df = this.documentFrequencies.get(term) ?? 0
    if (df === 0) return 0
    return Math.log(this.totalDocuments / df)
  }

  /**
   * Rebuild document frequency cache
   */
  private rebuildDocumentFrequencies(): void {
    this.documentFrequencies.clear()
    this.totalDocuments = this.entries.size

    for (const entry of this.entries.values()) {
      // Use title + tags for document representation (contentRef is file path)
      const docText = `${entry.title} ${entry.tags.join(' ')}`
      const terms = new Set(this.tokenize(docText))
      for (const term of terms) {
        this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1)
      }
    }
  }

  /**
   * Calculate TF-IDF vector for a document
   */
  private tfidfVector(terms: string[]): Map<string, number> {
    const tfidf = new Map<string, number>()
    const uniqueTerms = new Set(terms)
    for (const term of uniqueTerms) {
      const tf = this.termFrequency(term, terms)
      const idf = this.inverseDocumentFrequency(term)
      if (tf * idf > 0) tfidf.set(term, tf * idf)
    }
    return tfidf
  }

  /**
   * Calculate cosine similarity between two term sets
   */
  private cosineSimilarity(queryTerms: string[], docTerms: string[]): number {
    const queryVec = this.tfidfVector(queryTerms)
    const docVec = this.tfidfVector(docTerms)

    if (queryVec.size === 0 || docVec.size === 0) return 0

    // Dot product
    let dot = 0
    for (const [term, weight] of queryVec) {
      if (docVec.has(term)) dot += weight * docVec.get(term)!
    }

    // Magnitudes
    const queryMag = Math.sqrt(Array.from(queryVec.values()).reduce((s, w) => s + w * w, 0))
    const docMag = Math.sqrt(Array.from(docVec.values()).reduce((s, w) => s + w * w, 0))

    if (queryMag === 0 || docMag === 0) return 0
    return dot / (queryMag * docMag)
  }

  async markHelpful(id: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.relevance = Math.min(1, entry.relevance + 0.05)
      entry.accessCount += 1
      entry.lastAccessed = Date.now()
      this.eventBus.emit('lesson.helpful', { lessonId: id }, { sessionId })
    }
  }

  async markUseless(id: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.relevance = Math.max(0.05, entry.relevance - 0.1)
      this.eventBus.emit('lesson.useless', { lessonId: id }, { sessionId })
    }
  }

  async verify(id: string, verifiedBy: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry) {
      entry.verified = true
      entry.verifiedBy = verifiedBy
      entry.verifiedAt = Date.now()
      this.eventBus.emit('lesson.approved', { lessonId: id, verifiedBy })
    }
  }

  async decay(): Promise<void> {
    const DAY = 24 * 60 * 60 * 1000
    for (const entry of this.entries.values()) {
      const days = entry.lastAccessed ? (Date.now() - entry.lastAccessed) / DAY : 90
      const recency = Math.exp(-days / 30)
      entry.relevance = Math.max(0.05, entry.relevance * 0.95 + recency * 0.05)
    }
  }

  private generateId(): string {
    this.seq = (this.seq + 1) % 10000
    return `KB-${Date.now()}-${this.seq.toString().padStart(4, '0')}`
  }
}
