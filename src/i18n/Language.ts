import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type ScaleLanguage = 'zh' | 'en'

export interface ResolveLanguageOptions {
  lang?: unknown
  projectDir?: string
  scaleDir?: string
  env?: Record<string, string | undefined>
}

export function normalizeLanguage(value: unknown, fallback: ScaleLanguage = 'zh'): ScaleLanguage {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'en' || raw.startsWith('en-') || raw === 'english') return 'en'
  if (raw === 'zh' || raw.startsWith('zh-') || raw === 'cn' || raw === 'chinese' || raw === '中文') return 'zh'
  return fallback
}

export function resolveCliLanguage(options: ResolveLanguageOptions = {}): ScaleLanguage {
  const env = options.env ?? process.env
  if (options.lang !== undefined && String(options.lang).trim()) return normalizeLanguage(options.lang)
  if (env.SCALE_LANG) return normalizeLanguage(env.SCALE_LANG)
  const configured = readConfiguredLanguage(options.projectDir, options.scaleDir)
  return normalizeLanguage(configured, 'zh')
}

function readConfiguredLanguage(projectDir = process.cwd(), scaleDir = '.scale'): string | undefined {
  const configPath = join(resolveScaleRoot(projectDir, scaleDir), 'config.yaml')
  if (!existsSync(configPath)) return undefined
  try {
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^\s*(?:locale|language|lang)\s*:\s*["']?([^"'\s#]+)["']?/m)
    return match?.[1]
  } catch {
    return undefined
  }
}

function resolveScaleRoot(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}
