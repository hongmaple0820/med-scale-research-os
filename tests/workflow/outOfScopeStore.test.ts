// OutOfScopeStore Unit Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OutOfScopeStore } from '../../src/workflow/OutOfScopeStore.js'
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = './tmp/test-outofscope'

describe('OutOfScopeStore', () => {
  let store: OutOfScopeStore

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    store = new OutOfScopeStore(TMP)
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('add creates a markdown file for a new concept', () => {
    const entry = store.add({
      concept: 'dark-mode',
      title: 'Dark Mode Support',
      reason: 'The rendering pipeline assumes a single color palette. Supporting multiple themes would require a theme context provider wrapping the entire component tree.',
      priorRequests: ['#42', '#87'],
    })

    expect(entry.concept).toBe('dark-mode')
    expect(existsSync(join(TMP, 'out-of-scope', 'dark-mode.md'))).toBe(true)

    const content = readFileSync(join(TMP, 'out-of-scope', 'dark-mode.md'), 'utf-8')
    expect(content).toContain('# Dark Mode Support')
    expect(content).toContain('rendering pipeline')
    expect(content).toContain('## Prior Requests')
    expect(content).toContain('#42')
    expect(content).toContain('#87')
    expect(content).toContain('_Created:')
  })

  it('add appends to existing concept', () => {
    store.add({
      concept: 'plugin-system',
      title: 'Plugin System',
      reason: 'Too early for plugin architecture.',
      priorRequests: ['#10'],
    })

    const updated = store.add({
      concept: 'plugin-system',
      title: 'Plugin System',
      reason: 'Will not change decision.',
      priorRequests: ['#25', '#10'], // #10 is duplicate
    })

    expect(updated.priorRequests).toHaveLength(2)
    expect(updated.priorRequests).toContain('#10')
    expect(updated.priorRequests).toContain('#25')

    const content = readFileSync(join(TMP, 'out-of-scope', 'plugin-system.md'), 'utf-8')
    expect(content.match(/- #/g)).toHaveLength(2) // exactly 2 prior requests
  })

  it('add with technical context', () => {
    store.add({
      concept: 'graphql-api',
      title: 'GraphQL API',
      reason: 'REST is sufficient for current use cases.',
      technicalContext: 'Adding GraphQL would require schema stitching across 3 services.',
      priorRequests: ['#99'],
    })

    const content = readFileSync(join(TMP, 'out-of-scope', 'graphql-api.md'), 'utf-8')
    expect(content).toContain('## Technical Context')
    expect(content).toContain('schema stitching')
  })

  it('check finds exact concept match', () => {
    store.add({
      concept: 'real-time-sync',
      title: 'Real-time Sync',
      reason: 'Polling is sufficient.',
      priorRequests: [],
    })

    const match = store.check('real-time-sync')
    expect(match).not.toBeNull()
    expect(match!.title).toBe('Real-time Sync')
  })

  it('check returns null for unknown concept', () => {
    const match = store.check('nonexistent')
    expect(match).toBeNull()
  })

  it('check fuzzy matches by description keywords', () => {
    store.add({
      concept: 'dark-mode',
      title: 'Dark Mode Support',
      reason: 'The rendering pipeline assumes a single color palette. Supporting multiple themes would require significant architectural changes to the rendering pipeline.',
      priorRequests: [],
    })

    // "night theme" shares keywords with "dark mode" description
    const match = store.check('night-theme', 'dark color theme rendering')
    expect(match).not.toBeNull()
    expect(match!.concept).toBe('dark-mode')
  })

  it('check returns null when no keyword overlap', () => {
    store.add({
      concept: 'dark-mode',
      title: 'Dark Mode Support',
      reason: 'Rendering pipeline limitation.',
      priorRequests: [],
    })

    const match = store.check('plugin-system', 'extensible architecture hooks')
    expect(match).toBeNull()
  })

  it('list returns all entries sorted by updatedAt', () => {
    store.add({ concept: 'a-feature', title: 'A', reason: 'No', priorRequests: [] })
    store.add({ concept: 'b-feature', title: 'B', reason: 'No', priorRequests: [] })
    store.add({ concept: 'c-feature', title: 'C', reason: 'No', priorRequests: [] })

    const entries = store.list()
    expect(entries).toHaveLength(3)
    expect(entries[0].updatedAt).toBeGreaterThanOrEqual(entries[2].updatedAt)
  })

  it('list returns empty array when no entries', () => {
    expect(store.list()).toEqual([])
  })

  it('list from nonexistent directory returns empty', () => {
    const freshStore = new OutOfScopeStore('./tmp/nonexistent-oos')
    expect(freshStore.list()).toEqual([])
  })

  it('remove deletes entry', () => {
    store.add({ concept: 'to-remove', title: 'To Remove', reason: 'Test', priorRequests: [] })
    expect(existsSync(join(TMP, 'out-of-scope', 'to-remove.md'))).toBe(true)

    const removed = store.remove('to-remove')
    expect(removed).toBe(true)
    expect(existsSync(join(TMP, 'out-of-scope', 'to-remove.md'))).toBe(false)
  })

  it('remove returns false for nonexistent concept', () => {
    expect(store.remove('nonexistent')).toBe(false)
  })

  it('getDir returns the out-of-scope directory path', () => {
    expect(store.getDir()).toBe(join(TMP, 'out-of-scope'))
  })

  it('creates out-of-scope directory on construction', () => {
    expect(existsSync(join(TMP, 'out-of-scope'))).toBe(true)
  })
})
