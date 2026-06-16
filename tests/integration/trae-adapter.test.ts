// Trae Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraeAdapter } from '../../src/adapters/TraeAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-trae'

describe('TraeAdapter', () => {
  let adapter: TraeAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new TraeAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is trae', () => {
    expect(adapter.agentType).toBe('trae')
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
    const settings = adapter.generateSettings()
    expect(settings.permissions!.allow).toContain('scale:*')
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

  it('generateKnowledgeDoc produces TRAE.md content', () => {
    const doc = adapter.generateKnowledgeDoc('my-trae-project', ['Vue', 'TS'])
    expect(doc).toContain('# my-trae-project')
    expect(doc).toContain('Vue')
    expect(doc).toContain('SCALE Engine Integration (Trae)')
  })

  it('init creates .trae/settings.json + TRAE.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.trae', 'settings.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'TRAE.md'))
    expect(existsSync(result.settingsPath)).toBe(true)
    expect(existsSync(result.knowledgeDocPath)).toBe(true)
    expect(existsSync(join(result.scaleDir, 'events'))).toBe(true)
    expect(existsSync(join(result.scaleDir, 'artifacts'))).toBe(true)
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'))
    expect(settings.hooks['before-stop']).toBeDefined()
  })

  it('init is idempotent — second call merges, does not overwrite', async () => {
    await adapter.init({ projectDir: TMP })
    const result2 = await adapter.init({ projectDir: TMP })
    expect(result2.skipped.length).toBeGreaterThan(0)
  })

  it('isInstalled detects existing .trae directory', async () => {
    expect(adapter.isInstalled()).toBe(false)
    await adapter.init({ projectDir: TMP })
    const sameAdapter = new TraeAdapter()
    await sameAdapter.init({ projectDir: TMP })
    expect(sameAdapter.isInstalled()).toBe(true)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — trae', () => {
  it('createAdapter returns TraeAdapter for "trae"', () => {
    expect(createAdapter('trae').agentType).toBe('trae')
  })
  it('SUPPORTED_AGENTS includes trae', () => {
    expect(SUPPORTED_AGENTS).toContain('trae')
  })
})

describe('Trae — Doctor + SkillDiscovery', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('SkillDiscovery.detectPlatform returns trae when .trae/settings.json exists', async () => {
    const adapter = new TraeAdapter()
    await adapter.init({ projectDir: TMP })
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe('trae')
  })

  it('Doctor reports healthy after scale init --agent trae', async () => {
    const adapter = new TraeAdapter()
    await adapter.init({ projectDir: TMP })
    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck?.message).toContain('trae')
    const kdCheck = report.checks.find((c) => c.name === 'Knowledge doc')
    expect(kdCheck?.message).toContain('TRAE.md')
  })
})
