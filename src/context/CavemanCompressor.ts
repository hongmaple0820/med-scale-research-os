// SCALE Engine - Caveman Compressor (mattpocock/skills style)
import { logger } from "../core/logger.js"
export interface CavemanConfig { enabled: boolean; preserveTerms: string[]; symbolMap: Record<string, string>; maxCompressionRatio: number }
export const DEFAULT_SYMBOL_MAP: Record<string, string> = { "->": "switch to", "v": "verified", "x": "failed", "?": "unknown", "!": "critical", "+": "add", "-": "remove" }
export const DEFAULT_PRESERVE_TERMS = ["TypeScript", "JavaScript", "React", "Vue", "Node.js", "PostgreSQL", "API", "async", "await", "Promise", "interface", "type"]
export interface ICavemanCompressor { compress(text: string, config: CavemanConfig): string; shouldActivate(tokenUsage: number, tokenLimit: number): boolean }
export class CavemanCompressor implements ICavemanCompressor {
  compress(text: string, config: CavemanConfig): string { if (!config.enabled) return text; let r = this.removeFillerWords(text); r = this.applySymbols(r); return r }
  shouldActivate(tokenUsage: number, tokenLimit: number): boolean { return (tokenLimit - tokenUsage) < 50000 }
  private removeFillerWords(text: string): string { const f = ["I", "have", "analyzed", "the", "a", "is", "that"]; let r = text; for (const w of f) r = r.replace(new RegExp("\b" + w + "\b", "gi"), ""); return r.replace(/\s+/g, " ").trim() }
  private applySymbols(text: string): string { const m = { "switch to": "->", "verified": "v", "failed": "x", "add": "+", "remove": "-" }; let r = text; for (const [p, s] of Object.entries(m)) r = r.replace(new RegExp(p, "gi"), s); return r }
}
export function createCavemanCompressor(): ICavemanCompressor { return new CavemanCompressor() }
export const DEFAULT_CAVEMAN_CONFIG: CavemanConfig = { enabled: false, preserveTerms: DEFAULT_PRESERVE_TERMS, symbolMap: DEFAULT_SYMBOL_MAP, maxCompressionRatio: 0.25 }
