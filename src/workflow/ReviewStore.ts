import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ReviewSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type ReviewCategory = 'style' | 'logic' | 'security' | 'performance' | 'process'

export interface ReviewFinding {
  category: ReviewCategory
  severity: ReviewSeverity
  description: string
  file?: string
  evidence?: string
}

export interface ReviewSummary {
  critical: number
  high: number
  medium: number
  low: number
}

export interface ReviewRecord {
  id: string
  taskId?: string
  passed: boolean
  findings: ReviewFinding[]
  changedFiles: string[]
  summary: ReviewSummary
  /** Spec维度：diff 是否匹配原始 Spec/PRD 要求 */
  specFindings?: string[]
  /** Spec关键词覆盖率 0..1 */
  specCoverage?: number
  createdAt: number
}

export class ReviewStore {
  private reviewsDir: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.reviewsDir = join(scaleDir, 'reviews')
    if (!existsSync(this.reviewsDir)) mkdirSync(this.reviewsDir, { recursive: true })
  }

  saveReview(input: Omit<ReviewRecord, 'id' | 'createdAt'>): ReviewRecord {
    const record: ReviewRecord = {
      id: `REVIEW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      ...input,
    }
    const file = join(this.reviewsDir, `${record.id}.json`)
    writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
    return record
  }

  listReviews(limit = 20): ReviewRecord[] {
    if (!existsSync(this.reviewsDir)) return []
    return readdirSync(this.reviewsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => this.readRecordFile(join(this.reviewsDir, file)))
      .filter((record): record is ReviewRecord => Boolean(record))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  getReview(id: string): ReviewRecord | null {
    const file = join(this.reviewsDir, `${id}.json`)
    return this.readRecordFile(file)
  }

  private readRecordFile(file: string): ReviewRecord | null {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as ReviewRecord
    } catch {
      return null
    }
  }
}
