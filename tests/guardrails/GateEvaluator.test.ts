import { describe, it, expect } from 'vitest'
import { GateEvaluator } from '../../src/guardrails/GateEvaluator.js'

describe('GateEvaluator', () => {
  it('should parse condition expressions', () => {
    const conditions = GateEvaluator.parseConditions('buildExitCode == 0 && testPassed == true && testCoverage >= 80')
    expect(conditions.length).toBe(3)
    expect(conditions[0].field).toBe('buildExitCode')
    expect(conditions[0].operator).toBe('==')
    expect(conditions[0].value).toBe(0)
    expect(conditions[1].field).toBe('testPassed')
    expect(conditions[1].value).toBe(true)
    expect(conditions[2].field).toBe('testCoverage')
    expect(conditions[2].operator).toBe('>=')
    expect(conditions[2].value).toBe(80)
  })

  it('should evaluate passing conditions', () => {
    const payload = { buildExitCode: 0, testPassed: true, testCoverage: 85, testTotal: 10, testFailed: 0 }
    expect(GateEvaluator.evaluate('buildExitCode == 0', payload)).toBe(true)
    expect(GateEvaluator.evaluate('testPassed == true', payload)).toBe(true)
    expect(GateEvaluator.evaluate('testCoverage >= 80', payload)).toBe(true)
    expect(GateEvaluator.evaluate('buildExitCode == 0 && testPassed == true && testCoverage >= 80', payload)).toBe(true)
  })

  it('should evaluate failing conditions', () => {
    const payload = { buildExitCode: 1, testPassed: false, testCoverage: 50 }
    expect(GateEvaluator.evaluate('buildExitCode == 0', payload)).toBe(false)
    expect(GateEvaluator.evaluate('testPassed == true', payload)).toBe(false)
    expect(GateEvaluator.evaluate('testCoverage >= 80', payload)).toBe(false)
  })

  it('should detect empty tests (Harness Engineering)', () => {
    const payload = { buildExitCode: 0, testPassed: true, testTotal: 0, testFailed: 0 }
    expect(GateEvaluator.evaluate('testTotal > 0', payload)).toBe(false)
  })

  it('should check harness gates ci-strict', () => {
    const payload = { buildExitCode: 0, testPassed: true, testTotal: 10, testFailed: 0, testCoverage: 85, reviewPassed: true, lintStatus: 'success' }
    const result = GateEvaluator.checkHarnessGates(payload)
    expect(result.passed).toBe(true)
    expect(result.gateResults.length).toBe(4)
  })

  it('should fail harness gates when review not passed', () => {
    const payload = { buildExitCode: 0, testPassed: true, testTotal: 10, testFailed: 0, testCoverage: 85, reviewPassed: false, lintStatus: 'success' }
    const result = GateEvaluator.checkHarnessGates(payload)
    expect(result.passed).toBe(false)
    expect(result.gateResults.some(r => r.gate.name === 'Code Review Gate' && !r.passed)).toBe(true)
  })
})
