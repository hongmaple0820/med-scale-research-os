// SCALE Engine — Out-of-Scope Knowledge Base
// 借鉴 mattpocock/skills 的 .out-of-scope/ 设计模式
// 持久化被拒绝的功能请求，提供机构记忆和去重

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { logger } from '../core/logger.js'

export interface OutOfScopeEntry {
  concept: string       // kebab-case concept name (used as filename)
  title: string         // Human-readable title
  reason: string        // Why this was rejected
  technicalContext?: string  // Technical constraints that led to rejection
  priorRequests: string[]   // Issue IDs or URLs of prior requests
  createdAt: number
  updatedAt: number
}

export class OutOfScopeStore {
  private dir: string

  constructor(scaleDir: string) {
    this.dir = join(scaleDir, 'out-of-scope')
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  /**
   * Record a rejected concept.
   * If a file for this concept already exists, append the new request to Prior requests.
   */
  add(entry: Omit<OutOfScopeEntry, 'createdAt' | 'updatedAt'>): OutOfScopeEntry {
    const now = Date.now()
    const filePath = join(this.dir, `${entry.concept}.md`)

    if (existsSync(filePath)) {
      // Append to existing entry
      const existing = this.parseMarkdown(readFileSync(filePath, 'utf-8'), basename(filePath))
      const newRequests = entry.priorRequests.filter(r => !existing.priorRequests.includes(r))
      const updated: OutOfScopeEntry = {
        ...existing,
        priorRequests: [...existing.priorRequests, ...newRequests],
        updatedAt: now,
      }
      writeFileSync(filePath, this.formatMarkdown(updated), 'utf-8')
      logger.info({ concept: entry.concept, appended: newRequests.length }, 'Out-of-scope entry updated')
      return updated
    }

    const full: OutOfScopeEntry = {
      ...entry,
      createdAt: now,
      updatedAt: now,
    }
    writeFileSync(filePath, this.formatMarkdown(full), 'utf-8')
    logger.info({ concept: entry.concept }, 'Out-of-scope entry created')
    return full
  }

  /**
   * Check if a concept or description matches any existing out-of-scope entry.
   * Matching is by concept similarity — exact concept name OR keyword overlap in title.
   */
  check(concept: string, description?: string): OutOfScopeEntry | null {
    if (!existsSync(this.dir)) return null

    const files = readdirSync(this.dir).filter(f => f.endsWith('.md'))
    const exactMatch = files.find(f => f === `${concept}.md`)
    if (exactMatch) {
      return this.parseMarkdown(readFileSync(join(this.dir, exactMatch), 'utf-8'), exactMatch)
    }

    // Fuzzy match by description keywords
    if (description) {
      const keywords = description.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      for (const file of files) {
        const entry = this.parseMarkdown(readFileSync(join(this.dir, file), 'utf-8'), file)
        const entryText = `${entry.title} ${entry.reason}`.toLowerCase()
        const matchCount = keywords.filter(kw => entryText.includes(kw)).length
        if (matchCount >= 2) return entry
      }
    }

    return null
  }

  /**
   * List all out-of-scope entries.
   */
  list(): OutOfScopeEntry[] {
    if (!existsSync(this.dir)) return []

    return readdirSync(this.dir)
      .filter(f => f.endsWith('.md'))
      .map(f => this.parseMarkdown(readFileSync(join(this.dir, f), 'utf-8'), f))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Remove an out-of-scope entry (maintainer changed their mind).
   */
  remove(concept: string): boolean {
    const filePath = join(this.dir, `${concept}.md`)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      logger.info({ concept }, 'Out-of-scope entry removed')
      return true
    }
    return false
  }

  /**
   * Get the out-of-scope directory path.
   */
  getDir(): string {
    return this.dir
  }

  // ============================================================================
  // Markdown Format
  // ============================================================================

  private formatMarkdown(entry: OutOfScopeEntry): string {
    let md = `# ${entry.title}\n\n`
    md += `${entry.reason}\n\n`

    if (entry.technicalContext) {
      md += `## Technical Context\n\n${entry.technicalContext}\n\n`
    }

    if (entry.priorRequests.length > 0) {
      md += `## Prior Requests\n\n`
      for (const req of entry.priorRequests) {
        md += `- ${req}\n`
      }
      md += '\n'
    }

    md += `---\n`
    md += `_Created: ${new Date(entry.createdAt).toISOString().split('T')[0]}_  \n`
    md += `_Updated: ${new Date(entry.updatedAt).toISOString().split('T')[0]}_\n`
    return md
  }

  private parseMarkdown(md: string, filename?: string): OutOfScopeEntry {
    const lines = md.split('\n')
    const title = lines[0]?.replace(/^# /, '') ?? 'Unknown'
    const reasonLines: string[] = []
    let techLines: string[] = []
    let inTech = false
    const priorRequests: string[] = []
    let inPrior = false

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('## Technical Context')) { inTech = true; continue }
      if (line.startsWith('## Prior Requests')) { inTech = false; inPrior = true; continue }
      if (line.startsWith('---')) break
      if (line.startsWith('_Created:')) continue
      if (line.startsWith('_Updated:')) continue

      if (inPrior && line.startsWith('- ')) {
        priorRequests.push(line.replace(/^- /, '').trim())
      } else if (inTech) {
        techLines.push(line)
      } else if (line.trim()) {
        reasonLines.push(line)
      }
    }

    return {
      concept: filename ? basename(filename, '.md') : basename(title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')),
      title,
      reason: reasonLines.join('\n').trim(),
      technicalContext: techLines.join('\n').trim() || undefined,
      priorRequests,
      createdAt: 0,
      updatedAt: 0,
    }
  }
}
