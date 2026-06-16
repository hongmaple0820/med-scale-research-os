// SCALE Engine — TF-IDF Index
// 本地向量搜索，零外部依赖，基于 TF-IDF + 余弦相似度

export interface TfidfSearchResult {
  id: string
  score: number
}

export class TfidfIndex {
  private docTerms: Map<string, string[]> = new Map()
  private docFreq: Map<string, number> = new Map()  // term → 出现在多少文档中
  private docCount = 0

  /**
   * 添加/更新文档到索引
   */
  upsert(id: string, text: string): void {
    // 如果已存在，先移除旧的
    if (this.docTerms.has(id)) {
      this.remove(id)
    }

    const terms = this.tokenize(text)
    this.docTerms.set(id, terms)
    this.docCount++

    // 更新文档频率
    const uniqueTerms = new Set(terms)
    for (const term of uniqueTerms) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1)
    }
  }

  /**
   * 从索引中移除文档
   */
  remove(id: string): void {
    const terms = this.docTerms.get(id)
    if (!terms) return

    const uniqueTerms = new Set(terms)
    for (const term of uniqueTerms) {
      const count = this.docFreq.get(term) ?? 0
      if (count <= 1) {
        this.docFreq.delete(term)
      } else {
        this.docFreq.set(term, count - 1)
      }
    }

    this.docTerms.delete(id)
    this.docCount--
  }

  /**
   * 搜索最相似的 topK 个文档
   */
  search(query: string, topK: number): TfidfSearchResult[] {
    if (this.docCount === 0) return []

    const queryTerms = this.tokenize(query)
    if (queryTerms.length === 0) return []

    const queryVec = this.tfidfVector(queryTerms)
    if (queryVec.size === 0) return []

    const results: TfidfSearchResult[] = []

    for (const [id, docTerms] of this.docTerms) {
      const docVec = this.tfidfVector(docTerms)
      const score = this.cosineSimilarity(queryVec, docVec)
      if (score > 0) {
        results.push({ id, score })
      }
    }

    // 按分数降序排序
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, topK)
  }

  /**
   * 从行数据批量构建索引
   */
  buildFromRows(rows: Array<{ id: string; title: string; tags: string; content_ref: string }>): void {
    this.clear()
    for (const row of rows) {
      // 组合 title + tags + content_ref 作为搜索文本
      const text = [row.title, row.tags, row.content_ref].filter(Boolean).join(' ')
      this.upsert(row.id, text)
    }
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.docTerms.clear()
    this.docFreq.clear()
    this.docCount = 0
  }

  /**
   * 获取索引大小
   */
  get size(): number {
    return this.docCount
  }

  /**
   * 分词：小写 + 按非字母数字分割 + 过滤停用词和短词
   */
  private tokenize(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from',
      'by', 'for', 'with', 'about', 'against', 'between', 'through',
      'during', 'before', 'after', 'above', 'below', 'to', 'from',
      'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just',
      'don', 'now',
      // 中文停用词
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都',
      '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你',
      '会', '着', '没有', '看', '好', '自己', '这',
    ])

    const rawTokens = text
      .toLowerCase()
      .split(/[^a-z0-9一-鿿]+/)
      .filter(token => token && !stopWords.has(token))

    const tokens: string[] = []
    for (const token of rawTokens) {
      if (/[一-鿿]/.test(token)) {
        // CJK: emit each character as a token (words aren't space-separated)
        for (const ch of token) {
          if (/[一-鿿]/.test(ch)) tokens.push(ch)
        }
      } else if (token.length >= 2) {
        tokens.push(token)
      }
    }
    return tokens
  }

  /**
   * 计算 TF-IDF 向量
   */
  private tfidfVector(terms: string[]): Map<string, number> {
    const tfidf = new Map<string, number>()
    const uniqueTerms = new Set(terms)

    // 计算词频 (TF)
    const tf = new Map<string, number>()
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1)
    }

    for (const term of uniqueTerms) {
      const termFreq = (tf.get(term) ?? 0) / terms.length
      const docFreq = this.docFreq.get(term) ?? 0
      const idf = docFreq > 0 ? Math.log(this.docCount / docFreq) : 0
      const weight = termFreq * idf
      if (weight > 0) tfidf.set(term, weight)
    }

    return tfidf
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) return 0

    // 点积
    let dot = 0
    for (const [term, weight] of a) {
      if (b.has(term)) dot += weight * b.get(term)!
    }

    // 模
    const magA = Math.sqrt(Array.from(a.values()).reduce((s, w) => s + w * w, 0))
    const magB = Math.sqrt(Array.from(b.values()).reduce((s, w) => s + w * w, 0))

    if (magA === 0 || magB === 0) return 0
    return dot / (magA * magB)
  }
}
