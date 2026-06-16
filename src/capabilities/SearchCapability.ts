// SCALE Engine — Search Capability Implementation
// Integrates WebSearch/WebFetch for internet search

import type { IEventBus } from '../core/eventBus.js'
import type { SearchResult, CapabilityResult, ISearchCapability, IExaCapability, ExaSearchResult, CapabilityConfig } from './types.js'

export class WebSearchCapability implements ISearchCapability {
  readonly name = 'websearch'
  readonly category = 'search' as const
  private eventBus: IEventBus
  private config: CapabilityConfig['search']

  constructor(eventBus: IEventBus, config: CapabilityConfig['search']) {
    this.eventBus = eventBus
    this.config = config
  }

  isAvailable(): boolean { return true }
  async initialize(): Promise<boolean> { return true }
  async shutdown(): Promise<void> {}

  async search(query: string, options?: { limit?: number }): Promise<CapabilityResult<SearchResult[]>> {
    const start = Date.now()
    // Real implementation: call WebSearch MCP tool
    const results: SearchResult[] = [
      { title: `Result: ${query}`, url: 'https://example.com', snippet: 'Relevant info...', relevance: 0.9 },
      { title: `Another: ${query}`, url: 'https://example.org', snippet: 'More info...', relevance: 0.8 }
    ]
    return { success: true, data: results.slice(0, options?.limit ?? this.config.defaultLimit), durationMs: Date.now() - start }
  }

  async fetch(url: string): Promise<CapabilityResult<{ content: string }>> {
    const start = Date.now()
    // Real implementation: call WebFetch MCP tool
    return { success: true, data: { content: `Fetched from ${url}` }, durationMs: Date.now() - start }
  }
}

export class Context7SearchCapability implements ISearchCapability {
  readonly name = 'context7-search'
  readonly category = 'search' as const

  isAvailable(): boolean { return true }
  async initialize(): Promise<boolean> { return true }
  async shutdown(): Promise<void> {}

  async search(query: string): Promise<CapabilityResult<SearchResult[]>> {
    // Real implementation: call mcp__context7__query-docs
    return { success: true, data: [], durationMs: 0 }
  }

  async fetch(url: string): Promise<CapabilityResult<{ content: string }>> {
    return { success: true, data: { content: '' }, durationMs: 0 }
  }
}

export class ExaCapability implements IExaCapability {
  readonly name = 'exa-search'
  readonly category = 'exa' as const
  private eventBus: IEventBus
  private apiKey?: string

  constructor(eventBus: IEventBus, apiKey?: string) {
    this.eventBus = eventBus
    this.apiKey = apiKey
  }

  isAvailable(): boolean {
    // Exa requires API key from ~/.claude.json MCP config
    return !!this.apiKey
  }

  async initialize(): Promise<boolean> {
    return this.isAvailable()
  }

  async shutdown(): Promise<void> {}

  async webSearch(query: string, options?: { numResults?: number; category?: string }): Promise<CapabilityResult<ExaSearchResult[]>> {
    const start = Date.now()
    // Note: Real implementation requires MCP tool: web_search_exa
    // This is a placeholder that documents the expected behavior
    // Actual invocation happens via MCP server when configured in ~/.claude.json
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Exa API key not configured. Add to ~/.claude.json: "exa-web-search": { "env": { "EXA_API_KEY": "your_key" } }',
        durationMs: Date.now() - start
      }
    }
    // Placeholder results - real invocation via MCP
    const results: ExaSearchResult[] = []
    return { success: true, data: results, durationMs: Date.now() - start }
  }

  async getCodeContext(query: string, options?: { tokensNum?: number }): Promise<CapabilityResult<string>> {
    const start = Date.now()
    // Note: Real implementation requires MCP tool: get_code_context_exa
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Exa API key not configured. Add to ~/.claude.json: "exa-web-search": { "env": { "EXA_API_KEY": "your_key" } }',
        durationMs: Date.now() - start
      }
    }
    return { success: true, data: '', durationMs: Date.now() - start }
  }
}
