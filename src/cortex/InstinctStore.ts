// SCALE Cortex — Instinct Store
// 对齐 ECC: hierarchical filesystem-based storage under .scale/instincts/
// Future: SQLite-backed in Cortex v2

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { logger } from '../core/logger.js'
import type { Instinct } from './InstinctExtractor.js'

// ---------------------------------------------------------------------------
// InstinctStore
// ---------------------------------------------------------------------------

export class InstinctStore {
  private baseDir: string

  constructor(baseDir: string = join(process.cwd(), '.scale', 'instincts')) {
    this.baseDir = baseDir
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })
  }

  /**
   * Save an instinct to disk.
   * Deduplication: if an instinct with the same trigger exists, only keep the higher-confidence one.
   */
  save(instinct: Instinct): string {
    const existing = this.findByTrigger(instinct.trigger)
    if (existing && existing.confidence >= instinct.confidence) {
      // Keep existing. Increment observation count.
      existing.observations += instinct.observations
      existing.updatedAt = new Date().toISOString()
      this.writeInstinctFile(existing)
      return existing.id
    }

    // New or higher-confidence instinct replaces existing
    if (existing) {
      this.delete(existing.id)
    }

    instinct.updatedAt = new Date().toISOString()
    this.writeInstinctFile(instinct)
    return instinct.id
  }

  /**
   * Load all instincts from disk.
   */
  loadAll(): Instinct[] {
    const instincts: Instinct[] = []
    if (!existsSync(this.baseDir)) return instincts

    try {
      for (const domain of readdirSync(this.baseDir)) {
        const domainDir = join(this.baseDir, domain)
        if (!domain.endsWith('.yaml') && existsSync(domainDir) && !domain.startsWith('.')) {
          // Directory-based domain
          try {
            for (const file of readdirSync(domainDir)) {
              if (!file.endsWith('.yaml')) continue
              const instinct = this.parseInstinctFile(join(domainDir, file))
              if (instinct) instincts.push(instinct)
            }
          } catch { /* skip unreadable domains */ }
        } else if (domain.endsWith('.yaml')) {
          // Flat file in root
          const instinct = this.parseInstinctFile(join(this.baseDir, domain))
          if (instinct) instincts.push(instinct)
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load instincts')
    }

    return instincts.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Get instincts filtered by confidence threshold and scope.
   */
  query(options: {
    minConfidence?: number
    domain?: string
    scope?: 'project' | 'global'
    projectId?: string
  }): Instinct[] {
    let instincts = this.loadAll()

    if (options.minConfidence) {
      instincts = instincts.filter(i => i.confidence >= options.minConfidence!)
    }
    if (options.domain) {
      instincts = instincts.filter(i => i.domain === options.domain)
    }
    if (options.scope) {
      instincts = instincts.filter(i => i.scope === options.scope)
    }
    if (options.projectId) {
      instincts = instincts.filter(i => !i.projectId || i.projectId === options.projectId)
    }

    return instincts
  }

  /**
   * Get high-confidence instincts for SessionStart injection (0.7+).
   */
  getInjectionInstincts(projectId?: string): Instinct[] {
    return this.query({ minConfidence: 0.7, projectId })
  }

  /**
   * Find an instinct by trigger pattern.
   */
  findByTrigger(trigger: string): Instinct | null {
    const hash = createHash('sha256').update(trigger).digest('hex').slice(0, 10)
    const id = `instinct-${hash}`
    return this.findById(id)
  }

  /**
   * Find an instinct by ID.
   */
  findById(id: string): Instinct | null {
    // Search all domain directories
    if (!existsSync(this.baseDir)) return null

    try {
      for (const entry of readdirSync(this.baseDir)) {
        const full = join(this.baseDir, entry)
        if (existsSync(full) && !entry.startsWith('.')) {
          if (!entry.endsWith('.yaml')) {
            // Domain directory
            const filePath = join(full, `${id}.yaml`)
            if (existsSync(filePath)) return this.parseInstinctFile(filePath)
          }
        }
      }
    } catch { /* skip */ }

    // Flat file search
    const flatPath = join(this.baseDir, `${id}.yaml`)
    if (existsSync(flatPath)) return this.parseInstinctFile(flatPath)

    return null
  }

  /**
   * Delete an instinct by ID.
   */
  delete(id: string): boolean {
    const instinct = this.findById(id)
    if (!instinct) return false

    const domainDir = join(this.baseDir, instinct.domain)
    const filePath = join(domainDir, `${id}.yaml`)

    try {
      if (existsSync(filePath)) unlinkSync(filePath)
      return true
    } catch (err) {
      logger.warn({ err, id }, 'Failed to delete instinct')
      return false
    }
  }

  /**
   * Record an instinct was applied (for hit rate tracking).
   */
  recordApplication(id: string, success: boolean): void {
    const instinct = this.findById(id)
    if (!instinct) return

    instinct.appliedCount++
    instinct.hitRate = instinct.observations > 0
      ? instinct.appliedCount / instinct.observations
      : 0
    instinct.updatedAt = new Date().toISOString()

    this.writeInstinctFile(instinct)
  }

  /**
   * Get store statistics.
   */
  stats(): { total: number; byDomain: Record<string, number>; byConfidence: Record<string, number> } {
    const all = this.loadAll()
    const byDomain: Record<string, number> = {}
    const byConfidence: Record<string, number> = {
      'near-certain (0.9)': 0,
      'strong (0.7)': 0,
      'moderate (0.5)': 0,
      'tentative (0.3)': 0,
    }

    for (const i of all) {
      byDomain[i.domain] = (byDomain[i.domain] ?? 0) + 1
      if (i.confidence >= 0.9) byConfidence['near-certain (0.9)']++
      else if (i.confidence >= 0.7) byConfidence['strong (0.7)']++
      else if (i.confidence >= 0.5) byConfidence['moderate (0.5)']++
      else byConfidence['tentative (0.3)']++
    }

    return { total: all.length, byDomain, byConfidence }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private writeInstinctFile(instinct: Instinct): void {
    const domainDir = join(this.baseDir, instinct.domain)
    if (!existsSync(domainDir)) mkdirSync(domainDir, { recursive: true })

    const filePath = join(domainDir, `${instinct.id}.yaml`)
    const yaml = this.serializeInstinct(instinct)
    writeFileSync(filePath, yaml, 'utf-8')
  }

  private serializeInstinct(instinct: Instinct): string {
    const frontmatter = [
      `id: ${instinct.id}`,
      `trigger: "${instinct.trigger.replace(/"/g, '\\"')}"`,
      `confidence: ${instinct.confidence}`,
      `domain: ${instinct.domain}`,
      `source: "${instinct.source}"`,
      `scope: ${instinct.scope}`,
      `project_id: ${instinct.projectId ?? ''}`,
      `observations: ${instinct.observations}`,
      `applied_count: ${instinct.appliedCount}`,
      `hit_rate: ${instinct.hitRate.toFixed(2)}`,
      `created_at: ${instinct.createdAt}`,
      `updated_at: ${instinct.updatedAt}`,
    ].join('\n')

    const evidence = instinct.evidence.map(e => `  - "${e}"`).join('\n')

    return [
      '---',
      frontmatter,
      '---',
      '',
      instinct.action,
      '',
      '## Evidence',
      evidence,
      '',
    ].join('\n')
  }

  private parseInstinctFile(filePath: string): Instinct | null {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (!fmMatch) return null

      const frontmatter = fmMatch[1]
      const body = fmMatch[2] ?? ''

      const getYamlVal = (key: string): string => {
        const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)$`, 'm'))
        return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : ''
      }

      return {
        id: getYamlVal('id'),
        trigger: getYamlVal('trigger'),
        confidence: parseFloat(getYamlVal('confidence')) || 0.3,
        domain: getYamlVal('domain') || 'general',
        source: getYamlVal('source'),
        scope: (getYamlVal('scope') as 'project' | 'global') || 'project',
        projectId: getYamlVal('project_id') || undefined,
        action: body.trim(),
        evidence: [],
        observations: parseInt(getYamlVal('observations'), 10) || 0,
        createdAt: getYamlVal('created_at') || new Date().toISOString(),
        updatedAt: getYamlVal('updated_at') || new Date().toISOString(),
        appliedCount: parseInt(getYamlVal('applied_count'), 10) || 0,
        hitRate: parseFloat(getYamlVal('hit_rate')) || 0,
      }
    } catch (err) {
      logger.warn({ err, path: filePath }, 'Failed to parse instinct file')
      return null
    }
  }
}
