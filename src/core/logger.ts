// SCALE Engine - Logger
import pino from 'pino'

export const SENSITIVE_LOG_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'privateKey',
  '*.privateKey',
  'authorization',
  '*.authorization',
  'headers.authorization',
  '*.headers.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  '*.headers.cookie',
  'set-cookie',
  '*.set-cookie',
]

export function resolveLogLevel(): string {
  if (process.env.SCALE_LOG_LEVEL) return process.env.SCALE_LOG_LEVEL
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return 'silent'
  if (process.argv.includes('--json')) return 'silent'
  return 'warn'
}

export const logger = pino({
  level: resolveLogLevel(),
  redact: {
    paths: SENSITIVE_LOG_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
})

export type Logger = typeof logger
