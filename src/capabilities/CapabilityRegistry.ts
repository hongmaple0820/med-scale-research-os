// SCALE Engine — Capability Registry
// Central registry for all MCP capabilities

import type { IEventBus } from '../core/eventBus.js'
import type { IBrowserCapability, ISearchCapability, IComputerCapability, IExaCapability, IMCPCapability, CapabilityConfig, ICapabilityRegistry } from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { PlaywrightBrowserCapability, ChromeDevToolsBrowserCapability } from './BrowserCapability.js'
import { WebSearchCapability, Context7SearchCapability, ExaCapability } from './SearchCapability.js'
import { CUACapability, PlaywrightComputerCapability } from './ComputerCapability.js'

export class CapabilityRegistry implements ICapabilityRegistry {
  private browser: IBrowserCapability | null = null
  private search: ISearchCapability | null = null
  private computer: IComputerCapability | null = null
  private exa: IExaCapability | null = null
  private config: CapabilityConfig
  private eventBus: IEventBus

  constructor(eventBus: IEventBus, config: CapabilityConfig = DEFAULT_CONFIG) {
    this.eventBus = eventBus
    this.config = config
  }

  getBrowser(): IBrowserCapability | null {
    if (!this.browser && this.config.browser.enabled) {
      this.browser = this.config.browser.preferredEngine === 'playwright'
        ? new PlaywrightBrowserCapability(this.eventBus, this.config.browser)
        : new ChromeDevToolsBrowserCapability(this.eventBus)
    }
    return this.browser
  }

  getSearch(): ISearchCapability | null {
    if (!this.search && this.config.search.enabled) {
      this.search = new WebSearchCapability(this.eventBus, this.config.search)
    }
    return this.search
  }

  getComputer(): IComputerCapability | null {
    if (!this.computer && this.config.computer.enabled) {
      this.computer = new CUACapability(this.eventBus, this.config.computer)
    }
    return this.computer
  }

  getExa(): IExaCapability | null {
    if (!this.exa) {
      // Exa requires API key from MCP config, check env var
      const apiKey = process.env.EXA_API_KEY
      if (apiKey) {
        this.exa = new ExaCapability(this.eventBus, apiKey)
      }
    }
    return this.exa
  }

  getAll(): IMCPCapability[] {
    const caps: IMCPCapability[] = []
    if (this.browser) caps.push(this.browser)
    if (this.search) caps.push(this.search)
    if (this.computer) caps.push(this.computer)
    if (this.exa) caps.push(this.exa)
    return caps
  }

  configure(config: Partial<CapabilityConfig>): void {
    this.config = { ...this.config, ...config }
    this.browser = null
    this.search = null
    this.computer = null
  }
}
