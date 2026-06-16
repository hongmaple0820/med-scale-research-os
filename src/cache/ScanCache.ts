import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'

export interface CacheEntry {
  key: string
  gateId: string
  result: unknown
  passed: boolean
  durationMs: number
  fileHashes: Record<string, string>
  createdAt: string
  ttl: number // seconds
}

export interface CacheStats {
  totalEntries: number
  hits: number
  misses: number
  hitRate: number
  bytesUsed: number
}

export class ScanCache {
  private cacheDir: string
  private hitCount = 0
  private missCount = 0

  constructor(projectDir: string = process.cwd()) {
    this.cacheDir = join(projectDir, '.scale', 'cache', 'scans')
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true })
  }

  /**
   * Compute a cache key from file paths and their content hashes.
   */
  computeKey(files: Record<string, string>): string {
    const sorted = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
    const payload = sorted.map(([path, content]) => `${path}:${this.sha256(content)}`).join('\n')
    return this.sha256(payload)
  }

  /**
   * Get a cached gate result. Returns null on miss or expiry.
   */
  get(gateId: string, key: string): CacheEntry | null {
    const entryPath = join(this.cacheDir, `${gateId}-${key}.json`)
    if (!existsSync(entryPath)) { this.missCount++; return null }

    try {
      const entry: CacheEntry = JSON.parse(readFileSync(entryPath, 'utf-8'))
      const age = (Date.now() - new Date(entry.createdAt).getTime()) / 1000
      if (age > entry.ttl) {
        // Expired -- clean up
        try { unlinkSync(entryPath) } catch {}
        this.missCount++
        return null
      }
      this.hitCount++
      return entry
    } catch {
      this.missCount++
      return null
    }
  }

  /**
   * Store a gate result in cache.
   */
  set(gateId: string, key: string, result: unknown, passed: boolean, durationMs: number, fileHashes: Record<string, string>, ttlSeconds: number = 300): void {
    const entry: CacheEntry = {
      key,
      gateId,
      result,
      passed,
      durationMs,
      fileHashes,
      createdAt: new Date().toISOString(),
      ttl: ttlSeconds,
    }
    const entryPath = join(this.cacheDir, `${gateId}-${key}.json`)
    writeFileSync(entryPath, JSON.stringify(entry, null, 2))
  }

  stats(): CacheStats {
    const entries = existsSync(this.cacheDir) ? this.listEntries() : []
    let bytesUsed = 0
    for (const e of entries) {
      try { bytesUsed += readFileSync(join(this.cacheDir, e), 'utf-8').length } catch {}
    }
    return {
      totalEntries: entries.length,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: (this.hitCount + this.missCount) > 0 ? this.hitCount / (this.hitCount + this.missCount) : 0,
      bytesUsed,
    }
  }

  clear(): number {
    const entries = this.listEntries()
    for (const e of entries) {
      try { unlinkSync(join(this.cacheDir, e)) } catch {}
    }
    return entries.length
  }

  private listEntries(): string[] {
    const { readdirSync } = require('node:fs')
    try { return readdirSync(this.cacheDir) as string[] } catch { return [] }
  }

  /** Compute the hash of file contents for changed-file detection */
  hashFiles(filePaths: string[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const fp of filePaths) {
      try {
        const content = readFileSync(fp, 'utf-8')
        result[fp] = this.sha256(content)
      } catch {
        result[fp] = 'missing'
      }
    }
    return result
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 16)
  }
}
