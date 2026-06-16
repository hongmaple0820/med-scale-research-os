import { afterEach, describe, expect, it } from 'vitest'
import { SENSITIVE_LOG_PATHS, resolveLogLevel } from '../../src/core/logger.js'

const originalLogLevel = process.env.SCALE_LOG_LEVEL
const originalNodeEnv = process.env.NODE_ENV
const originalVitest = process.env.VITEST

afterEach(() => {
  if (originalLogLevel === undefined) delete process.env.SCALE_LOG_LEVEL
  else process.env.SCALE_LOG_LEVEL = originalLogLevel

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv

  if (originalVitest === undefined) delete process.env.VITEST
  else process.env.VITEST = originalVitest
})

describe('logger', () => {
  it('honors explicit SCALE_LOG_LEVEL', () => {
    process.env.SCALE_LOG_LEVEL = 'debug'
    process.env.NODE_ENV = 'test'

    expect(resolveLogLevel()).toBe('debug')
  })

  it('silences logs during tests by default', () => {
    delete process.env.SCALE_LOG_LEVEL
    process.env.NODE_ENV = 'test'

    expect(resolveLogLevel()).toBe('silent')
  })

  it('keeps normal CLI output quiet unless verbose logging is requested', () => {
    delete process.env.SCALE_LOG_LEVEL
    delete process.env.NODE_ENV
    delete process.env.VITEST

    expect(resolveLogLevel()).toBe('warn')
  })

  it('redacts common secret-bearing fields', () => {
    expect(SENSITIVE_LOG_PATHS).toEqual(expect.arrayContaining([
      'password',
      '*.token',
      'headers.authorization',
      '*.headers.cookie',
      'privateKey',
    ]))
  })
})
