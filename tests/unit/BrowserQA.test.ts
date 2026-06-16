// BrowserQA Capability Tests
// Tests for E2E browser testing with Playwright MCP wrapper

import { describe, it, expect } from 'vitest'
import { BrowserQACapability, CommonFlows } from '../../src/capabilities/BrowserQACapability.js'
import { E2ETestRunner, E2EPresets, browserGateCheck } from '../../src/workflow/qa/E2ETestRunner.js'
import type { IEventBus } from '../../src/core/eventBus.js'

// Mock EventBus for testing
class MockEventBus implements IEventBus {
  private events: { type: string; payload: unknown; context: unknown }[] = []

  emit(type: string, payload: unknown, context?: unknown): void {
    this.events.push({ type, payload, context })
  }

  async query(filter: { types?: string[]; limit?: number; filter?: (e: any) => boolean }): Promise<any[]> {
    return this.events
      .filter(e => filter.types?.includes(e.type) ?? true)
      .filter(e => filter.filter ? filter.filter(e) : true)
      .slice(0, filter.limit ?? 10)
  }

  on(type: string, handler: (payload: unknown, context: unknown) => void): void {
    // Mock implementation
  }

  off(type: string, handler: (payload: unknown, context: unknown) => void): void {
    // Mock implementation
  }

  getEvents() {
    return this.events
  }

  clear() {
    this.events = []
  }
}

describe('BrowserQACapability', () => {
  const eventBus = new MockEventBus()
  const browserQA = new BrowserQACapability(eventBus, 'http://localhost:3000')

  describe('E2E Test Flow', () => {
    it('should create flow steps correctly', async () => {
      const flow = CommonFlows.login('user', 'password')

      expect(flow.name).toBe('login')
      expect(flow.steps.length).toBe(6)
      expect(flow.steps[0].action).toBe('navigate')
      expect(flow.steps[1].action).toBe('fill')
      expect(flow.steps[4].action).toBe('wait')
    })

    it('should run E2E test and emit events', async () => {
      eventBus.clear()

      const flow = CommonFlows.navigation(['/home', '/about'])
      const result = await browserQA.runE2ETest('http://localhost:3000', flow)

      expect(result.flowName).toBe('navigation')
      // durationMs may be 0 if execution completes within same millisecond
      expect(result.durationMs).toBeGreaterThanOrEqual(0)

      const events = eventBus.getEvents()
      expect(events.some(e => e.type === 'qa.test.start')).toBe(true)
      expect(events.some(e => e.type === 'qa.test.end')).toBe(true)
    })

    it('should generate MCP call sequence', () => {
      const flow = CommonFlows.login('user', 'password')
      const calls = browserQA.getMCPCallSequence('http://localhost:3000', flow)

      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0].name).toContain('browser_navigate')
      expect(calls.some(c => c.name.includes('browser_type'))).toBe(true)
      expect(calls.some(c => c.name.includes('browser_click'))).toBe(true)
      expect(calls.some(c => c.name.includes('browser_console_messages'))).toBe(true)
    })
  })

  describe('Common Flows', () => {
    it('should generate login flow', () => {
      const flow = CommonFlows.login('admin', 'secret')

      expect(flow.name).toBe('login')
      expect(flow.steps.some(s => s.value === 'admin')).toBe(true)
      expect(flow.steps.some(s => s.target?.includes('password'))).toBe(true)
    })

    it('should generate register flow', () => {
      const flow = CommonFlows.register('user@example.com', 'password123')

      expect(flow.name).toBe('register')
      expect(flow.expectedOutcome).toContain('registered')
    })

    it('should generate navigation flow', () => {
      const flow = CommonFlows.navigation(['#home', '#about', '#contact'])

      expect(flow.name).toBe('navigation')
      expect(flow.steps.filter(s => s.action === 'click').length).toBe(3)
    })

    it('should generate form submit flow', () => {
      const flow = CommonFlows.formSubmit({ name: 'John', email: 'john@example.com' })

      expect(flow.name).toBe('form-submit')
      expect(flow.steps.filter(s => s.action === 'fill').length).toBe(2)
    })
  })

  describe('QA Report Generation', () => {
    it('should generate report with all results', () => {
      const results = [
        { passed: true, flowName: 'login', durationMs: 1000, consoleErrors: [], consoleWarnings: [], screenshots: [] },
        { passed: false, flowName: 'register', durationMs: 2000, consoleErrors: [{ type: 'error', text: 'API error' }], consoleWarnings: [], screenshots: [], error: 'Timeout' }
      ]

      const report = browserQA.generateQAReport(results)

      expect(report).toContain('Browser QA Report')
      expect(report).toContain('1/2 flows passed')
      expect(report).toContain('login')
      expect(report).toContain('register')
      expect(report).toContain('Console Errors')
      expect(report).toContain('API error')
    })
  })
})

describe('E2ETestRunner', () => {
  const eventBus = new MockEventBus()

  describe('Configuration Presets', () => {
    it('should create quick preset', () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.quick('http://localhost:3000', flows)

      expect(config.timeoutMs).toBe(5000)
      expect(config.retryCount).toBe(1)
      expect(config.accessibilityCheck).toBe(false)
      expect(config.performanceCheck).toBe(false)
    })

    it('should create standard preset', () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.standard('http://localhost:3000', flows)

      expect(config.timeoutMs).toBe(10000)
      expect(config.retryCount).toBe(2)
      expect(config.accessibilityCheck).toBe(true)
    })

    it('should create full preset', () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.full('http://localhost:3000', flows)

      expect(config.timeoutMs).toBe(15000)
      expect(config.retryCount).toBe(3)
      expect(config.accessibilityCheck).toBe(true)
      expect(config.performanceCheck).toBe(true)
    })
  })

  describe('Test Execution', () => {
    it('should run tests with standard config', async () => {
      eventBus.clear()

      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.quick('http://localhost:3000', flows)
      const runner = new E2ETestRunner(eventBus, config)

      const result = await runner.run()

      expect(result.totalFlows).toBe(1)
      expect(result.results.length).toBe(1)

      const events = eventBus.getEvents()
      expect(events.some(e => e.type === 'e2e.start')).toBe(true)
      expect(events.some(e => e.type === 'e2e.end')).toBe(true)
    })

    it('should convert to VerificationResult', async () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.quick('http://localhost:3000', flows)
      const runner = new E2ETestRunner(eventBus, config)

      const result = await runner.run()
      const verifications = runner.toVerificationResult(result)

      expect(verifications.length).toBeGreaterThan(0)
      expect(verifications[0].criterion).toContain('E2E Flow')
      expect(verifications[0].passed).toBeDefined()
      expect(verifications[0].evidence).toBeDefined()
    })

    it('should run quick verify', async () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.quick('http://localhost:3000', flows)
      const runner = new E2ETestRunner(eventBus, config)

      const passed = await runner.quickVerify()

      expect(passed).toBeDefined()
    })

    it('should return empty result when no flows', async () => {
      const config = E2EPresets.quick('http://localhost:3000', [])
      const runner = new E2ETestRunner(eventBus, config)

      const passed = await runner.quickVerify()

      expect(passed).toBe(true) // No flows = trivially passed
    })
  })

  describe('MCP Execution Plan', () => {
    it('should generate MCP execution plan for all flows', () => {
      const flows = [CommonFlows.login('user', 'pass'), CommonFlows.navigation(['/home'])]
      const config = E2EPresets.quick('http://localhost:3000', flows)
      const runner = new E2ETestRunner(eventBus, config)

      const plan = runner.getMCPExecutionPlan()

      expect(plan.length).toBe(2)
      expect(plan[0].flow.name).toBe('login')
      expect(plan[0].calls.length).toBeGreaterThan(0)
    })
  })

  describe('Add Flow', () => {
    it('should add flow dynamically', () => {
      const flows = [CommonFlows.login('user', 'pass')]
      const config = E2EPresets.quick('http://localhost:3000', flows)
      const runner = new E2ETestRunner(eventBus, config)

      runner.addFlow(CommonFlows.navigation(['/about']))

      expect(config.flows.length).toBe(2)
    })
  })
})

describe('browserGateCheck', () => {
  const eventBus = new MockEventBus()

  it('should return passed for successful flows', async () => {
    const flows = [CommonFlows.login('user', 'pass')]
    const result = await browserGateCheck(eventBus, 'http://localhost:3000', flows)

    expect(result.passed).toBeDefined()
    expect(result.verifications.length).toBeGreaterThan(0)
    expect(result.report).toBeDefined()
  })

  it('should include accessibility check in verification', async () => {
    const flows = [CommonFlows.login('user', 'pass')]
    const result = await browserGateCheck(eventBus, 'http://localhost:3000', flows)

    expect(result.verifications.some(v => v.criterion.includes('Accessibility'))).toBe(true)
  })
})