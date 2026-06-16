// SCALE Engine — MCP Capability Types v0.10.0

export interface BrowserAction {
  type: 'navigate' | 'click' | 'fill' | 'screenshot' | 'snapshot' | 'evaluate' | 'wait' | 'hover' | 'press_key'
  target?: string
  value?: string
  timeout?: number
}

export interface BrowserSession {
  sessionId: string
  url: string
  status: 'active' | 'idle' | 'closed'
  createdAt: number
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  relevance?: number
}

export interface CapabilityResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  durationMs: number
}

export interface IMCPCapability {
  readonly name: string
  readonly category: 'browser' | 'search' | 'computer' | 'exa' | 'ui-ux'
  isAvailable(): boolean
  initialize(): Promise<boolean>
  shutdown(): Promise<void>
}

export interface IBrowserCapability extends IMCPCapability {
  createSession(options?: { url?: string }): Promise<CapabilityResult<BrowserSession>>
  executeAction(sessionId: string, action: BrowserAction): Promise<CapabilityResult<unknown>>
  takeScreenshot(sessionId: string): Promise<CapabilityResult<string>>
}

export interface ISearchCapability extends IMCPCapability {
  search(query: string, options?: { limit?: number }): Promise<CapabilityResult<SearchResult[]>>
  fetch(url: string): Promise<CapabilityResult<{ content: string }>>
}

export interface IComputerCapability extends IMCPCapability {
  execute(action: { type: 'click' | 'type' | 'scroll'; coordinate?: [number, number]; text?: string }): Promise<CapabilityResult<void>>
}

export interface ExaSearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
  author?: string
}

export interface IExaCapability extends IMCPCapability {
  webSearch(query: string, options?: { numResults?: number; category?: string }): Promise<CapabilityResult<ExaSearchResult[]>>
  getCodeContext(query: string, options?: { tokensNum?: number }): Promise<CapabilityResult<string>>
}

export interface CapabilityConfig {
  browser: { enabled: boolean; preferredEngine: 'playwright' | 'chrome-devtools' }
  search: { enabled: boolean; defaultLimit: number }
  computer: { enabled: boolean; safetyMode: 'strict' | 'standard' }
}

export const DEFAULT_CONFIG: CapabilityConfig = {
  browser: { enabled: true, preferredEngine: 'playwright' },
  search: { enabled: true, defaultLimit: 10 },
  computer: { enabled: true, safetyMode: 'standard' }
}

export interface ICapabilityRegistry {
  getBrowser(): IBrowserCapability | null
  getSearch(): ISearchCapability | null
  getComputer(): IComputerCapability | null
  getExa(): IExaCapability | null
  getAll(): IMCPCapability[]
  configure(config: Partial<CapabilityConfig>): void
}
