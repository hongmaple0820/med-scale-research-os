// QCoder (Qwen Code) Adapter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QCoderAdapter } from '../../src/adapters/QCoderAdapter.js'
import { createAdapter, SUPPORTED_AGENTS } from '../../src/adapters/index.js'
import { Doctor } from '../../src/api/doctor.js'
import { SkillDiscovery } from '../../src/skills/SkillDiscovery.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-qcoder'

describe('QCoderAdapter', () => {
  let adapter: QCoderAdapter

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    adapter = new QCoderAdapter()
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('agentType is qcoder', () => {
    expect(adapter.agentType).toBe('qcoder')
  })

  it('settings path is .qwen/settings.json', () => {
    expect(adapter.getSettingsPath().replace(/\\/g, '/')).toMatch(/\.qwen\/settings\.json$/)
  })

  it('knowledge doc path is QWEN.md', () => {
    expect(adapter.getKnowledgeDocPath().replace(/\\/g, '/')).toMatch(/QWEN\.md$/)
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

  it('generateKnowledgeDoc produces QWEN.md content', () => {
    const doc = adapter.generateKnowledgeDoc('qwen-proj', ['Python'])
    expect(doc).toContain('# qwen-proj')
    expect(doc).toContain('Python')
    expect(doc).toContain('SCALE Engine Integration (QCoder / Qwen Code)')
  })

  it('init creates .qwen/settings.json + QWEN.md + .scale/ tree', async () => {
    const result = await adapter.init({ projectDir: TMP })
    expect(result.settingsPath).toBe(join(TMP, '.qwen', 'settings.json'))
    expect(result.knowledgeDocPath).toBe(join(TMP, 'QWEN.md'))
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

  it('isInstalled detects existing .qwen directory', async () => {
    expect(adapter.isInstalled()).toBe(false)
    await adapter.init({ projectDir: TMP })
    const sameAdapter = new QCoderAdapter()
    await sameAdapter.init({ projectDir: TMP })
    expect(sameAdapter.isInstalled()).toBe(true)
  })
})

describe('createAdapter / SUPPORTED_AGENTS — qcoder', () => {
  it('createAdapter returns QCoderAdapter for "qcoder"', () => {
    expect(createAdapter('qcoder').agentType).toBe('qcoder')
  })
  it('SUPPORTED_AGENTS includes qcoder', () => {
    expect(SUPPORTED_AGENTS).toContain('qcoder')
  })
})

describe('QCoder — Doctor + SkillDiscovery', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('SkillDiscovery.detectPlatform returns qcoder when .qwen/settings.json exists', async () => {
    const adapter = new QCoderAdapter()
    await adapter.init({ projectDir: TMP })
    expect(new SkillDiscovery(TMP).detectPlatform()).toBe('qcoder')
  })

  it('Doctor reports healthy after scale init --agent qcoder', async () => {
    const adapter = new QCoderAdapter()
    await adapter.init({ projectDir: TMP })
    const report = await new Doctor(TMP).diagnose()
    expect(report.overall).toBe('healthy')
    expect(report.checks.find((c) => c.name === 'Agent settings')?.message).toContain('qcoder')
    expect(report.checks.find((c) => c.name === 'Knowledge doc')?.message).toContain('QWEN.md')
  })
})
