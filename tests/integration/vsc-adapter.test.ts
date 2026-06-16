// VSC Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VSCAdapter } from '../../src/adapters/VSCAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-vsc'

describe('VSCAdapter', () => {
  let adapter: VSCAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new VSCAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is vsc', () => {
    expect(adapter.agentType).toBe('vsc')
  })

  it('settings path is .vscode/scale.json (not .vscode/settings.json — does not collide)', () => {
    expect(adapter.getSettingsPath().replace(/\\/g, '/')).toMatch(/\.vscode\/scale\.json$/)
  })

  it('generateSettings produces pre-exec/post-exec/before-stop hooks', () => {
    const settings = adapter.generateSettings()
    expect(settings.hooks!['pre-exec']).toHaveLength(2)
    expect(settings.hooks!['post-exec']).toHaveLength(2)
    expect(settings.hooks!['before-stop']).toHaveLength(1)
    for (const entries of Object.values(settings.hooks!)) {
      for (const entry of entries) {
        expect(entry.command).toMatch(/^scale /)
      }
    }
  })

  it('generateSettings includes scale:* permission', () => {
    expect(adapter.generateSettings().permissions!.allow).toContain('scale:*')
  })

  it('mergeSettings preserves existing custom hooks + permissions', () => {
    const existing = {
      hooks: { 'pre-exec': [{ matcher: '', command: 'my-custom' }] },
      permissions: { allow: ['custom:*'] },
    }
    const merged = adapter.mergeSettings(existing)
    expect(merged.hooks!['pre-exec'].some((e) => e.command === 'my-custom')).toBe(true)
    expect(merged.hooks!['pre-exec'].some((e) => e.command.includes('scale '))).toBe(true)
    expect(merged.permissions!.allow).toContain('custom:*')
    expect(merged.permissions!.allow).toContain('scale:*')
  })

  it('generateKnowledgeDoc produces VSC.md content', () => {
    const doc = adapter.generateKnowledgeDoc('vsc-proj', ['React'])
    expect(doc).toContain('# vsc-proj')
    expect(doc).toContain('React')
    expect(doc).toContain('SCALE Engine Integration (VSC)')
  })

  it('init creates .vscode/scale.json + VSC.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.vscode', 'scale.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'VSC.md'))
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks['before-stop']).toBeDefined()
  })

  it('init is idempotent', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
  })

  it('isInstalled detects existing .vscode/scale.json', async () => {
    expect(adapter.isInstalled()).toBe(false)
    await adapter.init({ projectDir: TMP })
    const sameAdapter = new VSCAdapter()
    await sameAdapter.init({ projectDir: TMP })
    expect(sameAdapter.isInstalled()).toBe(true)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — vsc', () => {
  it('createAdapter returns VSCAdapter for "vsc"', () => {
    expect(createAdapter('vsc').agentType).toBe('vsc')
  })
  it('SUPPORTED_AGENTS includes vsc', () => {
    expect(SUPPORTED_AGENTS).toContain('vsc')
  })
})

describe('VSC — Doctor + SkillDiscovery', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('SkillDiscovery.detectPlatform returns vsc when .vscode/scale.json exists', async () => {
    const adapter = new VSCAdapter()
    await adapter.init({ projectDir: TMP })
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe('vsc')
  })

  it('Doctor reports healthy after scale init --agent vsc', async () => {
    const adapter = new VSCAdapter()
    await adapter.init({ projectDir: TMP })
    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.find((c) => c.name === 'Agent settings')?.message).toContain('vsc')
    expect(report.checks.find((c) => c.name === 'Knowledge doc')?.message).toContain('VSC.md')
  })
})
