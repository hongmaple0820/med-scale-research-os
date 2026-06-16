// SCALE Engine 鈥?Cerebrum Manager
// Manages Do-Not-Repeat rules and user preferences via the Knowledge Base.
// Inspired by OpenWolf's cerebrum system.

import type { KnowledgeEntry } from '../artifact/types.js'
import type { IKnowledgeBase } from './KnowledgeBase.js'

export interface CerebrumEntry {
  id: string
  type: 'preference' | 'do_not_repeat'
  pattern: string
  description: string
  createdAt: number
  hitCount: number
}

export interface CerebrumHit {
  entry: CerebrumEntry
  matchedWords: string[]
}

export class CerebrumManager {
  private entries: CerebrumEntry[] = []

  constructor(private kb: IKnowledgeBase) {}

  async addDoNotRepeat(pattern: string, description: string): Promise<CerebrumEntry> {
    const kbEntry = await this.kb.add({
      type: 'do_not_repeat',
      title: pattern,
      tags: ['cerebrum', 'do_not_repeat'],
      contentRef: description,
      verified: true,
      verifiedBy: 'cerebrum',
      verifiedAt: Date.now(),
    })

    const entry: CerebrumEntry = {
      id: kbEntry.id,
      type: 'do_not_repeat',
      pattern,
      description,
      createdAt: kbEntry.createdAt,
      hitCount: 0,
    }
    this.entries.push(entry)
    return entry
  }

  async addPreference(description: string, tags: string[] = []): Promise<CerebrumEntry> {
    const kbEntry = await this.kb.add({
      type: 'preference',
      title: description,
      tags: ['cerebrum', 'preference', ...tags],
      contentRef: description,
      verified: true,
      verifiedBy: 'cerebrum',
      verifiedAt: Date.now(),
    })

    const entry: CerebrumEntry = {
      id: kbEntry.id,
      type: 'preference',
      pattern: description,
      description,
      createdAt: kbEntry.createdAt,
      hitCount: 0,
    }
    this.entries.push(entry)
    return entry
  }

  check(content: string): CerebrumHit[] {
    const hits: CerebrumHit[] = []
    const contentTokens = tokenize(content)

    for (const entry of this.entries) {
      if (entry.type !== 'do_not_repeat') continue
      const patternTokens = tokenize(entry.pattern)
      const overlap = contentTokens.filter(w => patternTokens.includes(w))

      if (overlap.length > 0 && overlap.length >= Math.ceil(patternTokens.length * 0.4)) {
        entry.hitCount++
        hits.push({ entry, matchedWords: overlap })
      }
    }

    return hits
  }

  async loadAll(): Promise<CerebrumEntry[]> {
    const doNotRepeat = await this.kb.recall({ type: 'do_not_repeat', limit: 200 })
    const preferences = await this.kb.recall({ type: 'preference', limit: 200 })

    this.entries = [
      ...doNotRepeat.map(e => this.fromKbEntry(e, 'do_not_repeat')),
      ...preferences.map(e => this.fromKbEntry(e, 'preference')),
    ]
    return this.entries
  }

  toMarkdown(): string {
    const lines: string[] = [
      '# cerebrum.md',
      '',
      `> Auto-maintained by SCALE Engine. Last updated: ${new Date().toISOString()}`,
      '',
    ]

    const dnr = this.entries.filter(e => e.type === 'do_not_repeat')
    const prefs = this.entries.filter(e => e.type === 'preference')

    if (dnr.length > 0) {
      lines.push('## Do Not Repeat')
      lines.push('')
      for (const e of dnr) {
        lines.push(`- **${e.pattern}** - ${e.description} (hits: ${e.hitCount})`)
      }
      lines.push('')
    }

    if (prefs.length > 0) {
      lines.push('## Preferences')
      lines.push('')
      for (const e of prefs) {
        lines.push(`- ${e.description}`)
      }
      lines.push('')
    }

    if (dnr.length === 0 && prefs.length === 0) {
      lines.push('_No entries yet._')
      lines.push('')
    }

    return lines.join('\n')
  }

  getEntries(): CerebrumEntry[] {
    return this.entries
  }

  private fromKbEntry(kb: KnowledgeEntry, type: 'preference' | 'do_not_repeat'): CerebrumEntry {
    return {
      id: kb.id,
      type,
      pattern: kb.title,
      description: kb.contentRef || kb.title,
      createdAt: kb.createdAt,
      hitCount: kb.accessCount,
    }
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
}
