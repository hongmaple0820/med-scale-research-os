// SCALE Engine — MCP Lifecycle Governance (v0.34.0)
// MCP server lifecycle management with health checks, security scanning, and policy enforcement

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { randomUUID } from 'node:crypto'

export type McpServerStatus = 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'blocked'
export type McpSecurityLevel = 'trusted' | 'review' | 'untrusted'

export interface McpServerRegistration {
  id: string
  name: string
  transport: 'stdio' | 'sse' | 'streamable-http'
  command?: string
  url?: string
  version?: string
  securityLevel: McpSecurityLevel
  capabilities: string[]
  registeredAt: string
  lastHealthCheck?: string
  status: McpServerStatus
}

export interface McpHealthCheckResult {
  serverId: string
  status: McpServerStatus
  latency?: number
  toolCount?: number
  error?: string
  checkedAt: string
}

export interface McpGovernanceConfig {
  autoHealthCheck: boolean
  healthCheckIntervalMs: number
  blockUntrusted: boolean
  requiredCapabilities: string[]
  maxLatencyMs: number
}

export interface McpSecurityScanResult {
  serverId: string
  findings: McpSecurityFinding[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  scannedAt: string
}

export interface McpSecurityFinding {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  recommendation: string
}

const DEFAULT_GOVERNANCE_CONFIG: McpGovernanceConfig = {
  autoHealthCheck: true,
  healthCheckIntervalMs: 30000,
  blockUntrusted: false,
  requiredCapabilities: [],
  maxLatencyMs: 5000,
}

export class McpGovernor {
  private servers: Map<string, McpServerRegistration> = new Map()
  private config: McpGovernanceConfig
  private now: () => Date

  constructor(config?: McpGovernanceConfig, now?: () => Date) {
    this.config = config ?? { ...DEFAULT_GOVERNANCE_CONFIG }
    this.now = now ?? (() => new Date())
  }

  register(server: Omit<McpServerRegistration, 'registeredAt' | 'status'>): McpServerRegistration {
    const existing = this.servers.get(server.id)
    const registration: McpServerRegistration = {
      ...server,
      registeredAt: existing?.registeredAt ?? this.now().toISOString(),
      status: existing?.status ?? 'unknown',
      lastHealthCheck: existing?.lastHealthCheck,
    }
    this.servers.set(server.id, registration)
    return registration
  }

  unregister(id: string): void {
    this.servers.delete(id)
  }

  getServer(id: string): McpServerRegistration | undefined {
    return this.servers.get(id)
  }

  listServers(): McpServerRegistration[] {
    return [...this.servers.values()]
  }

  checkHealth(id: string): McpHealthCheckResult {
    const server = this.servers.get(id)
    if (!server) {
      return {
        serverId: id,
        status: 'unhealthy',
        error: 'Server not registered',
        checkedAt: this.now().toISOString(),
      }
    }

    // Blocked servers stay blocked
    if (server.status === 'blocked') {
      return {
        serverId: id,
        status: 'blocked',
        error: 'Server is blocked by governance policy',
        checkedAt: this.now().toISOString(),
      }
    }

    // Check security level against policy
    if (this.config.blockUntrusted && server.securityLevel === 'untrusted') {
      server.status = 'blocked'
      return {
        serverId: id,
        status: 'blocked',
        error: 'Untrusted server blocked by governance policy',
        checkedAt: this.now().toISOString(),
      }
    }

    // Simulate health check based on registration data
    const latency = server.transport === 'stdio' ? 50 : 200
    const status: McpServerStatus = latency > this.config.maxLatencyMs ? 'degraded' : 'healthy'

    server.status = status
    server.lastHealthCheck = this.now().toISOString()

    return {
      serverId: id,
      status,
      latency,
      toolCount: server.capabilities.length,
      checkedAt: server.lastHealthCheck,
    }
  }

  checkAllHealth(): McpHealthCheckResult[] {
    return [...this.servers.keys()].map(id => this.checkHealth(id))
  }

  scanSecurity(id: string): McpSecurityScanResult {
    const server = this.servers.get(id)
    const scannedAt = this.now().toISOString()

    if (!server) {
      return {
        serverId: id,
        findings: [{
          id: `MCP-SEC-${randomUUID().slice(0, 8)}`,
          severity: 'high',
          title: 'Unregistered server',
          description: `Server "${id}" is not registered in the governance system`,
          recommendation: 'Register the server before use',
        }],
        riskLevel: 'high',
        scannedAt,
      }
    }

    const findings: McpSecurityFinding[] = []

    // Check security level
    if (server.securityLevel === 'untrusted') {
      findings.push({
        id: `MCP-SEC-${randomUUID().slice(0, 8)}`,
        severity: 'high',
        title: 'Untrusted security level',
        description: `Server "${server.name}" has untrusted security level`,
        recommendation: 'Review server source and upgrade to "review" or "trusted" after validation',
      })
    }

    // Check required capabilities
    for (const cap of this.config.requiredCapabilities) {
      if (!server.capabilities.includes(cap)) {
        findings.push({
          id: `MCP-SEC-${randomUUID().slice(0, 8)}`,
          severity: 'medium',
          title: 'Missing required capability',
          description: `Server "${server.name}" is missing required capability "${cap}"`,
          recommendation: `Add "${cap}" capability to the server configuration`,
        })
      }
    }

    // Check transport security
    if (server.transport === 'sse' && !server.url?.startsWith('https://')) {
      findings.push({
        id: `MCP-SEC-${randomUUID().slice(0, 8)}`,
        severity: 'medium',
        title: 'Insecure transport',
        description: `Server "${server.name}" uses SSE without HTTPS`,
        recommendation: 'Use HTTPS for SSE transport to prevent MITM attacks',
      })
    }

    // Check for stdio with command injection risk
    if (server.transport === 'stdio' && server.command) {
      if (server.command.includes('&&') || server.command.includes('|') || server.command.includes(';')) {
        findings.push({
          id: `MCP-SEC-${randomUUID().slice(0, 8)}`,
          severity: 'critical',
          title: 'Potential command injection',
          description: `Server "${server.name}" command contains shell operators`,
          recommendation: 'Remove shell operators from the command; use separate arguments',
        })
      }
    }

    const riskLevel = findings.some(f => f.severity === 'critical')
      ? 'critical'
      : findings.some(f => f.severity === 'high')
        ? 'high'
        : findings.some(f => f.severity === 'medium')
          ? 'medium'
          : 'low'

    return { serverId: id, findings, riskLevel, scannedAt }
  }

  isAllowed(id: string, toolName: string): { allowed: boolean; reason?: string } {
    const server = this.servers.get(id)
    if (!server) return { allowed: false, reason: 'Server not registered' }
    if (server.status === 'blocked') return { allowed: false, reason: 'Server is blocked' }
    if (this.config.blockUntrusted && server.securityLevel === 'untrusted') {
      return { allowed: false, reason: 'Untrusted server blocked by governance policy' }
    }
    if (!server.capabilities.includes(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" not in server capabilities` }
    }
    return { allowed: true }
  }

  getConfig(): McpGovernanceConfig {
    return { ...this.config }
  }

  updateConfig(patch: Partial<McpGovernanceConfig>): void {
    Object.assign(this.config, patch)
  }

  loadFromProject(projectDir?: string): void {
    const dir = resolve(projectDir ?? process.cwd())
    const configPath = join(dir, '.scale', 'mcp-servers.yaml')
    if (!existsSync(configPath)) return

    try {
      const content = readFileSync(configPath, 'utf-8')
      const parsed = yaml.load(content) as { governance?: Partial<McpGovernanceConfig>; servers?: Array<Omit<McpServerRegistration, 'registeredAt' | 'status'>> }

      if (parsed.governance) {
        Object.assign(this.config, parsed.governance)
      }

      if (Array.isArray(parsed.servers)) {
        for (const server of parsed.servers) {
          this.register(server)
        }
      }
    } catch {
      // ignore parse errors
    }
  }
}
