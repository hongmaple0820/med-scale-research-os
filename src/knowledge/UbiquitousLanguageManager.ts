// SCALE Engine - Ubiquitous Language Manager (mattpocock/skills style)
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import type { IEventBus } from "../core/eventBus.js"
import type { TermDefinition, TermSource, ADRRecord, ADRStatus, AmbiguityReport } from "../artifact/types.js"
import { logger } from "../core/logger.js"

export interface IUbiquitousLanguageManager {
  loadContextMd(): Map<string, TermDefinition>
  updateTerm(term: string, definition: string, source: TermSource): void
  removeTerm(term: string): void
  detectAmbiguity(): AmbiguityReport[]
  proposeADR(title: string, context: string, decision: string): ADRRecord
  acceptADR(id: string): void
  deprecateADR(id: string, supersededBy: string): void
  generateContextMd(): string
  generateADRMarkdown(adr: ADRRecord): string
  sync(): Promise<void>
  getTerm(term: string): TermDefinition | undefined
  getADR(id: string): ADRRecord | undefined
  listTerms(): TermDefinition[]
  listADRs(): ADRRecord[]
}

export class UbiquitousLanguageManager implements IUbiquitousLanguageManager {
  private contextMdPath: string
  private adrDir: string
  private terms = new Map<string, TermDefinition>()
  private adrs = new Map<string, ADRRecord>()
  private eventBus: IEventBus | null
  private dirty = false

  constructor(projectDir: string, eventBus?: IEventBus, contextMdPath?: string, adrDir?: string) {
    this.contextMdPath = contextMdPath ?? join(projectDir, "CONTEXT.md")
    this.adrDir = adrDir ?? join(projectDir, "docs", "adr")
    this.eventBus = eventBus ?? null
    this.loadFromFiles()
  }

  loadContextMd(): Map<string, TermDefinition> {
    if (!existsSync(this.contextMdPath)) return this.terms
    const content = readFileSync(this.contextMdPath, "utf-8")
    this.terms = this.parseContextMd(content)
    logger.info({ count: this.terms.size }, "Loaded terms")
    return this.terms
  }

  updateTerm(term: string, definition: string, source: TermSource): void {
    const existing = this.terms.get(term)
    this.terms.set(term, { term, definition, examples: existing?.examples ?? [], aliases: existing?.aliases ?? [], lastUpdated: Date.now(), source })
    this.dirty = true
    this.eventBus?.emit("term.updated", { term, source })
  }

  removeTerm(term: string): void { this.terms.delete(term); this.dirty = true }

  detectAmbiguity(): AmbiguityReport[] {
    const reports: AmbiguityReport[] = []
    for (const [term, def] of this.terms) {
      for (const alias of def.aliases) {
        const aliasDef = this.terms.get(alias)
        if (aliasDef && aliasDef.definition !== def.definition) reports.push({ term, definitions: [def.definition, aliasDef.definition], sources: [def.source, aliasDef.source] })
      }
    }
    if (reports.length) this.eventBus?.emit("term.ambiguity_detected", { reports })
    return reports
  }

  getTerm(term: string) { return this.terms.get(term) }
  listTerms() { return Array.from(this.terms.values()) }

  proposeADR(title: string, context: string, decision: string): ADRRecord {
    const now = Date.now()
    const num = this.getNextADRNumber()
    const id = "ADR-" + num + "-" + this.slugify(title)
    const adr: ADRRecord = { id, title, status: "proposed", context, decision, consequences: "", createdAt: now, updatedAt: now }
    this.adrs.set(id, adr)
    this.dirty = true
    this.eventBus?.emit("adr.proposed", { adrId: id })
    return adr
  }

  acceptADR(id: string): void {
    const adr = this.adrs.get(id)
    if (!adr || adr.status !== "proposed") return
    adr.status = "accepted"; adr.updatedAt = Date.now(); this.dirty = true
    this.eventBus?.emit("adr.accepted", { adrId: id })
  }

  deprecateADR(id: string, supersededBy: string): void {
    const adr = this.adrs.get(id)
    if (!adr || adr.status !== "accepted") return
    adr.status = "deprecated"; adr.supersededBy = supersededBy; adr.updatedAt = Date.now(); this.dirty = true
    this.eventBus?.emit("adr.deprecated", { adrId: id, supersededBy })
  }

  getADR(id: string) { return this.adrs.get(id) }
  listADRs() { return Array.from(this.adrs.values()) }

  generateContextMd(): string {
    const lines = ["# CONTEXT.md", "", "| Term | Definition | Examples | Aliases | Source |", "|------|------------|----------|---------|--------|"]
    for (const t of this.terms.values()) lines.push("| " + t.term + " | " + t.definition + " | " + (t.examples.join("; ") || "-") + " | " + (t.aliases.join(", ") || "-") + " | " + t.source + " |")
    return lines.join("\n")
  }

  generateADRMarkdown(adr: ADRRecord): string {
    return "# " + adr.id + ": " + adr.title + "\n\n**Status**: " + adr.status + "\n\n## Context\n" + adr.context + "\n\n## Decision\n" + adr.decision
  }

  async sync(): Promise<void> {
    if (!this.dirty) return
    this.ensureDir(dirname(this.contextMdPath))
    writeFileSync(this.contextMdPath, this.generateContextMd(), "utf-8")
    this.ensureDir(this.adrDir)
    for (const adr of this.adrs.values()) writeFileSync(join(this.adrDir, adr.id + ".md"), this.generateADRMarkdown(adr), "utf-8")
    this.dirty = false
  }

  private loadFromFiles() { this.loadContextMd(); this.loadADRs() }
  private loadADRs(): void {
    if (!existsSync(this.adrDir)) return
    for (const file of readdirSync(this.adrDir)) {
      if (!file.endsWith(".md") || !file.startsWith("ADR-")) continue
      const adr = this.parseADRMarkdown(readFileSync(join(this.adrDir, file), "utf-8"), file.replace(".md", ""))
      if (adr) this.adrs.set(adr.id, adr)
    }
  }
  private parseContextMd(content: string): Map<string, TermDefinition> {
    const terms = new Map<string, TermDefinition>()
    for (const line of content.split("\n")) {
      if (line.startsWith("|") && !line.includes("Term") && !line.includes("------")) {
        const parts = line.split("|").map(p => p.trim()).filter(Boolean)
        if (parts.length >= 5) terms.set(parts[0], { term: parts[0], definition: parts[1], examples: parts[2] === "-" ? [] : parts[2].split("; "), aliases: parts[3] === "-" ? [] : parts[3].split(", "), lastUpdated: Date.now(), source: parts[4] as TermSource || "user-defined" })
      }
    }
    return terms
  }
  private parseADRMarkdown(content: string, id: string): ADRRecord | null {
    const titleMatch = /^# ADR-\d+: (.+)$/m.exec(content)
    const statusMatch = /\*\*Status\*\*:\s*(\w+)/.exec(content)
    return { id, title: titleMatch?.[1] ?? "Untitled", status: statusMatch?.[1] as ADRStatus ?? "proposed", context: "", decision: "", consequences: "", createdAt: Date.now(), updatedAt: Date.now() }
  }
  private getNextADRNumber(): number { let max = 0; for (const adr of this.adrs.values()) { const m = /^ADR-(\d+)/.exec(adr.id); if (m) max = Math.max(max, parseInt(m[1], 10)) } return max + 1 }
  private slugify(title: string): string { return title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 50) }
  private ensureDir(path: string): void { if (!existsSync(path)) mkdirSync(path, { recursive: true }) }
}

export function createUbiquitousLanguageManager(projectDir: string, eventBus?: IEventBus): IUbiquitousLanguageManager { return new UbiquitousLanguageManager(projectDir, eventBus) }
