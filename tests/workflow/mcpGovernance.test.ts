// SCALE Engine — MCP Governance Tests

import { describe, expect, it } from 'vitest'
import { McpGovernor } from '../../src/workflow/McpGovernance.js'

const FIXED_DATE = new Date('2026-05-22T00:00:00.000Z')

describe('McpGovernor', () => {
  it('registers and lists servers', () => {
    const gov = new McpGovernor()

    const reg = gov.register({
      id: 'context7',
      name: 'context7',
      transport: 'stdio',
      securityLevel: 'trusted',
      capabilities: ['docs-lookup'],
    })

    expect(reg.id).toBe('context7')
    expect(reg.registeredAt).toBeDefined()
    expect(reg.status).toBe('unknown')

    const servers = gov.listServers()
    expect(servers).toHaveLength(1)
    expect(servers[0].id).toBe('context7')
  })

  it('unregisters servers', () => {
    const gov = new McpGovernor()
    gov.register({ id: 'test', name: 'test', transport: 'stdio', securityLevel: 'trusted', capabilities: [] })
    expect(gov.listServers()).toHaveLength(1)

    gov.unregister('test')
    expect(gov.listServers()).toHaveLength(0)
  })

  it('gets server by id', () => {
    const gov = new McpGovernor()
    gov.register({ id: 'test', name: 'test', transport: 'stdio', securityLevel: 'trusted', capabilities: [] })

    expect(gov.getServer('test')).toBeDefined()
    expect(gov.getServer('nonexistent')).toBeUndefined()
  })

  it('checks health of registered server', () => {
    const gov = new McpGovernor(undefined, () => FIXED_DATE)
    gov.register({
      id: 'context7',
      name: 'context7',
      transport: 'stdio',
      securityLevel: 'trusted',
      capabilities: ['docs-lookup', 'resolve-library'],
    })

    const result = gov.checkHealth('context7')
    expect(result.serverId).toBe('context7')
    expect(result.status).toBe('healthy')
    expect(result.latency).toBeDefined()
    expect(result.toolCount).toBe(2)
    expect(result.checkedAt).toBe('2026-05-22T00:00:00.000Z')
  })

  it('returns unhealthy for unregistered server', () => {
    const gov = new McpGovernor()
    const result = gov.checkHealth('nonexistent')
    expect(result.status).toBe('unhealthy')
    expect(result.error).toContain('not registered')
  })

  it('blocks untrusted servers when policy enables blockUntrusted', () => {
    const gov = new McpGovernor({ ...new McpGovernor().getConfig(), blockUntrusted: true })
    gov.register({
      id: 'sketchy',
      name: 'sketchy',
      transport: 'stdio',
      securityLevel: 'untrusted',
      capabilities: ['do-stuff'],
    })

    const result = gov.checkHealth('sketchy')
    expect(result.status).toBe('blocked')

    const server = gov.getServer('sketchy')
    expect(server?.status).toBe('blocked')
  })

  it('does not block untrusted servers when policy disables blockUntrusted', () => {
    const gov = new McpGovernor({ ...new McpGovernor().getConfig(), blockUntrusted: false })
    gov.register({
      id: 'sketchy',
      name: 'sketchy',
      transport: 'stdio',
      securityLevel: 'untrusted',
      capabilities: ['do-stuff'],
    })

    const result = gov.checkHealth('sketchy')
    expect(result.status).toBe('healthy')
  })

  it('checks all health', () => {
    const gov = new McpGovernor()
    gov.register({ id: 'a', name: 'a', transport: 'stdio', securityLevel: 'trusted', capabilities: [] })
    gov.register({ id: 'b', name: 'b', transport: 'stdio', securityLevel: 'trusted', capabilities: [] })

    const results = gov.checkAllHealth()
    expect(results).toHaveLength(2)
    expect(results.every(r => r.status === 'healthy')).toBe(true)
  })

  it('scans security and detects untrusted level', () => {
    const gov = new McpGovernor()
    gov.register({
      id: 'test',
      name: 'test',
      transport: 'stdio',
      securityLevel: 'untrusted',
      capabilities: [],
    })

    const scan = gov.scanSecurity('test')
    expect(scan.findings).toHaveLength(1)
    expect(scan.findings[0].severity).toBe('high')
    expect(scan.findings[0].title).toContain('Untrusted')
    expect(scan.riskLevel).toBe('high')
  })

  it('scans security and detects command injection', () => {
    const gov = new McpGovernor()
    gov.register({
      id: 'test',
      name: 'test',
      transport: 'stdio',
      command: 'node server.js && rm -rf /',
      securityLevel: 'trusted',
      capabilities: [],
    })

    const scan = gov.scanSecurity('test')
    const cmdFindings = scan.findings.filter(f => f.title.includes('command injection'))
    expect(cmdFindings).toHaveLength(1)
    expect(cmdFindings[0].severity).toBe('critical')
    expect(scan.riskLevel).toBe('critical')
  })

  it('scans security and detects insecure transport', () => {
    const gov = new McpGovernor()
    gov.register({
      id: 'test',
      name: 'test',
      transport: 'sse',
      url: 'http://example.com/mcp',
      securityLevel: 'trusted',
      capabilities: [],
    })

    const scan = gov.scanSecurity('test')
    const transportFindings = scan.findings.filter(f => f.title.includes('Insecure'))
    expect(transportFindings).toHaveLength(1)
    expect(transportFindings[0].severity).toBe('medium')
  })

  it('scans security for unregistered server', () => {
    const gov = new McpGovernor()
    const scan = gov.scanSecurity('nonexistent')
    expect(scan.riskLevel).toBe('high')
    expect(scan.findings[0].title).toContain('Unregistered')
  })

  it('reports low risk for clean trusted server', () => {
    const gov = new McpGovernor()
    gov.register({
      id: 'clean',
      name: 'clean',
      transport: 'stdio',
      command: 'node server.js',
      securityLevel: 'trusted',
      capabilities: ['tool-a', 'tool-b'],
    })

    const scan = gov.scanSecurity('clean')
    expect(scan.riskLevel).toBe('low')
    expect(scan.findings).toHaveLength(0)
  })

  it('isAllowed checks server existence, status, and capability', () => {
    const gov = new McpGovernor()
    gov.register({
      id: 'test',
      name: 'test',
      transport: 'stdio',
      securityLevel: 'trusted',
      capabilities: ['docs-lookup'],
    })

    expect(gov.isAllowed('test', 'docs-lookup')).toEqual({ allowed: true })
    expect(gov.isAllowed('test', 'unknown-tool').allowed).toBe(false)
    expect(gov.isAllowed('nonexistent', 'any').allowed).toBe(false)
  })

  it('isAllowed blocks untrusted when policy enables blockUntrusted', () => {
    const gov = new McpGovernor({ ...new McpGovernor().getConfig(), blockUntrusted: true })
    gov.register({
      id: 'test',
      name: 'test',
      transport: 'stdio',
      securityLevel: 'untrusted',
      capabilities: ['tool'],
    })

    expect(gov.isAllowed('test', 'tool').allowed).toBe(false)
  })

  it('updates config', () => {
    const gov = new McpGovernor()
    gov.updateConfig({ blockUntrusted: true, maxLatencyMs: 10000 })
    const config = gov.getConfig()
    expect(config.blockUntrusted).toBe(true)
    expect(config.maxLatencyMs).toBe(10000)
  })

  it('loads from project gracefully when file missing', () => {
    const gov = new McpGovernor()
    gov.loadFromProject('/nonexistent-path')
    expect(gov.listServers()).toHaveLength(0)
  })

  it('preserves registeredAt on re-register', () => {
    const gov = new McpGovernor(undefined, () => FIXED_DATE)
    gov.register({ id: 'test', name: 'test', transport: 'stdio', securityLevel: 'trusted', capabilities: [] })

    const firstReg = gov.getServer('test')
    const firstTime = firstReg?.registeredAt

    // Re-register
    gov.register({ id: 'test', name: 'test-v2', transport: 'stdio', securityLevel: 'trusted', capabilities: ['new'] })

    const secondReg = gov.getServer('test')
    expect(secondReg?.registeredAt).toBe(firstTime)
    expect(secondReg?.name).toBe('test-v2')
  })
})
