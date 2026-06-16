// SCALE Engine — E2E Test Runner
// 集成 BrowserQACapability 到 WorkflowEngine 的 G8 门控
// 设计参考：docs/03-CORE-MODULES.md §3.5 + WorkflowEngine

import type { IEventBus } from '../../core/eventBus.js'
import type { VerificationResult } from '../types.js'
import { BrowserQACapability, type UserFlow, type QAResult } from '../../capabilities/BrowserQACapability.js'

/**
 * E2E 测试配置
 */
export interface E2ETestConfig {
  baseUrl: string
  flows: UserFlow[]
  timeoutMs: number
  retryCount: number
  screenshotDir: string
  accessibilityCheck: boolean
  performanceCheck: boolean
}

/**
 * E2E 测试结果
 */
export interface E2ETestResult {
  passed: boolean
  totalFlows: number
  passedFlows: number
  failedFlows: number
  results: QAResult[]
  accessibilityIssues: number
  performanceMetrics?: {
    avgLoadTimeMs: number
    maxLoadTimeMs: number
  }
  report: string
}

/**
 * E2E Test Runner
 *
 * 运行 E2E 测试并生成验证结果：
 * 1. 执行用户流程测试
 * 2. 检查 Console 错误
 * 3. Accessibility 检查（可选）
 * 4. 性能检查（可选）
 * 5. 生成 Honest Delivery 报告
 */
export class E2ETestRunner {
  private eventBus: IEventBus
  private browserQA: BrowserQACapability
  private config: E2ETestConfig

  constructor(eventBus: IEventBus, config: E2ETestConfig) {
    this.eventBus = eventBus
    this.config = config
    this.browserQA = new BrowserQACapability(eventBus, config.baseUrl, config.screenshotDir)
  }

  /**
   * 运行完整 E2E 测试
   */
  async run(): Promise<E2ETestResult> {
    this.eventBus.emit('e2e.start', {
      baseUrl: this.config.baseUrl,
      flowsCount: this.config.flows.length
    })

    const startTime = Date.now()
    let results: QAResult[] = []
    let accessibilityIssues = 0
    let performanceMetrics: { avgLoadTimeMs: number; maxLoadTimeMs: number } | undefined

    // 执行流程测试（带重试）
    for (const flow of this.config.flows) {
      let flowResult: QAResult | null = null
      let attempts = 0

      while (attempts < this.config.retryCount && (flowResult === null || !flowResult.passed)) {
        attempts++
        this.eventBus.emit('e2e.flow.attempt', {
          flowName: flow.name,
          attempt: attempts
        })

        flowResult = await this.browserQA.runE2ETest(this.config.baseUrl, flow)

        if (!flowResult.passed && attempts < this.config.retryCount) {
          this.eventBus.emit('e2e.flow.retry', {
            flowName: flow.name,
            reason: flowResult.error ?? 'Console errors detected'
          })
          // 等待后重试
          await this.sleep(1000)
        }
      }

      if (flowResult) {
        results.push(flowResult)
      }
    }

    // Accessibility 检查
    if (this.config.accessibilityCheck) {
      this.eventBus.emit('e2e.accessibility.check', {})
      const issues = await this.browserQA.runAccessibilityCheck(this.config.baseUrl)
      accessibilityIssues = issues.length
    }

    // 性能检查
    if (this.config.performanceCheck) {
      this.eventBus.emit('e2e.performance.check', {})
      const perfResult = await this.browserQA.runPerformanceCheck(this.config.baseUrl)
      performanceMetrics = {
        avgLoadTimeMs: perfResult.loadTimeMs,
        maxLoadTimeMs: perfResult.domContentLoadedMs
      }
    }

    // 生成报告
    const report = this.browserQA.generateQAReport(results)
    const passedCount = results.filter(r => r.passed).length
    const passed = passedCount === results.length && accessibilityIssues === 0

    const testResult: E2ETestResult = {
      passed,
      totalFlows: results.length,
      passedFlows: passedCount,
      failedFlows: results.length - passedCount,
      results,
      accessibilityIssues,
      performanceMetrics,
      report
    }

    this.eventBus.emit('e2e.end', {
      passed: testResult.passed,
      durationMs: Date.now() - startTime,
      passedFlows: testResult.passedFlows,
      failedFlows: testResult.failedFlows
    })

    return testResult
  }

  /**
   * 转换为 VerificationResult（用于 WorkflowEngine G8 门控）
   */
  toVerificationResult(result: E2ETestResult): VerificationResult[] {
    const verifications: VerificationResult[] = []

    // 流程验证
    for (const qaResult of result.results) {
      verifications.push({
        criterion: `E2E Flow: ${qaResult.flowName}`,
        passed: qaResult.passed,
        evidence: qaResult.passed
          ? `Flow completed in ${qaResult.durationMs}ms without errors`
          : `Flow failed: ${qaResult.error ?? qaResult.consoleErrors.map(e => e.text).join(', ')}`
      })
    }

    // Accessibility 验证
    if (this.config.accessibilityCheck) {
      verifications.push({
        criterion: 'Accessibility Check',
        passed: result.accessibilityIssues === 0,
        evidence: result.accessibilityIssues === 0
          ? 'No accessibility issues detected'
          : `${result.accessibilityIssues} accessibility issues found`
      })
    }

    // 性能验证
    if (this.config.performanceCheck && result.performanceMetrics) {
      const loadTimeOk = result.performanceMetrics.avgLoadTimeMs < 3000 // 3秒阈值
      verifications.push({
        criterion: 'Performance Check (Load Time < 3s)',
        passed: loadTimeOk,
        evidence: loadTimeOk
          ? `Average load time: ${result.performanceMetrics.avgLoadTimeMs}ms`
          : `Load time exceeds threshold: ${result.performanceMetrics.avgLoadTimeMs}ms`
      })
    }

    return verifications
  }

  /**
   * 运行并生成 VerificationResult（用于 G8 门控）
   */
  async runForVerification(): Promise<VerificationResult[]> {
    const result = await this.run()
    return this.toVerificationResult(result)
  }

  /**
   * 添加自定义流程
   */
  addFlow(flow: UserFlow): void {
    this.config.flows.push(flow)
  }

  /**
   * 获取 MCP 工具调用序列（用于 Claude Code 实际执行）
   */
  getMCPExecutionPlan(): { flow: UserFlow; calls: ReturnType<BrowserQACapability['getMCPCallSequence']> }[] {
    return this.config.flows.map(flow => ({
      flow,
      calls: this.browserQA.getMCPCallSequence(this.config.baseUrl, flow)
    }))
  }

  /**
   * 快速验证（仅检查关键流程）
   */
  async quickVerify(): Promise<boolean> {
    // 只运行第一个流程，快速检查
    if (this.config.flows.length === 0) {
      this.eventBus.emit('e2e.quick.empty', {})
      return true
    }

    const criticalFlow = this.config.flows[0]
    const result = await this.browserQA.runE2ETest(this.config.baseUrl, criticalFlow)

    return result.passed && result.consoleErrors.length === 0
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * E2E 测试配置预设
 */
export const E2EPresets = {
  /**
   * 快速测试（仅关键流程，无重试）
   */
  quick: (baseUrl: string, flows: UserFlow[]): E2ETestConfig => ({
    baseUrl,
    flows,
    timeoutMs: 5000,
    retryCount: 1,
    screenshotDir: './qa-screenshots',
    accessibilityCheck: false,
    performanceCheck: false
  }),

  /**
   * 标准测试（完整流程，2次重试）
   */
  standard: (baseUrl: string, flows: UserFlow[]): E2ETestConfig => ({
    baseUrl,
    flows,
    timeoutMs: 10000,
    retryCount: 2,
    screenshotDir: './qa-screenshots',
    accessibilityCheck: true,
    performanceCheck: false
  }),

  /**
   * 完整测试（所有检查，3次重试）
   */
  full: (baseUrl: string, flows: UserFlow[]): E2ETestConfig => ({
    baseUrl,
    flows,
    timeoutMs: 15000,
    retryCount: 3,
    screenshotDir: './qa-screenshots',
    accessibilityCheck: true,
    performanceCheck: true
  })
}

/**
 * G8 浏览器门控检查
 *
 * 用于 WorkflowEngine 的第 8 个门控（浏览器 QA）
 */
export async function browserGateCheck(
  eventBus: IEventBus,
  baseUrl: string,
  flows: UserFlow[]
): Promise<{ passed: boolean; verifications: VerificationResult[]; report: string }> {
  const config = E2EPresets.standard(baseUrl, flows)
  const runner = new E2ETestRunner(eventBus, config)

  const verifications = await runner.runForVerification()
  const passed = verifications.every(v => v.passed)

  const report = passed
    ? 'All browser QA checks passed'
    : `Browser QA failed: ${verifications.filter(v => !v.passed).map(v => v.criterion).join(', ')}`

  return { passed, verifications, report }
}