import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventBus } from '../../src/core/eventBus.js'
import { GraphifyKnowledgeBase } from '../../src/knowledge/GraphifyKnowledgeBase.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('GraphifyKnowledgeBase', () => {
  let projectDir: string
  let scaleDir: string
  let bus: EventBus
  let kb: GraphifyKnowledgeBase

  beforeEach(() => {
    projectDir = makeDir('scale-graphify-kb-project-')
    scaleDir = join(projectDir, '.scale')
    mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
    writeFileSync(join(projectDir, 'graphify-out', 'graph.json'), JSON.stringify({
      nodes: [
        {
          id: 'node-oauth',
          title: 'OAuth callback state flow',
          type: 'decision',
          file: 'src/auth/oauth.ts',
          summary: 'Resolve callback state from Redis before binding the provider.',
        },
      ],
    }, null, 2), 'utf-8')
    bus = new EventBus({ eventsDir: join(scaleDir, 'events') })
    kb = new GraphifyKnowledgeBase(bus, { projectDir, scaleDir })
  })

  it('recalls graph knowledge from graphify artifacts by semantic query', async () => {
    const results = await kb.recallByVector('oauth redis callback state', 3)

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'node-oauth',
        title: 'OAuth callback state flow',
        contentRef: 'src/auth/oauth.ts',
        verified: true,
      }),
    ]))
  })

  it('stores promoted knowledge as graphify-sidecar notes and can query it back', async () => {
    const entry = await kb.add({
      type: 'decision',
      title: 'Use RTK as the default CLI proxy',
      tags: ['rtk', 'cli', 'token'],
      contentRef: 'docs/rtk.md',
      verified: false,
      sourceArtifact: 'TASK-RTK-1',
    })

    expect(entry.id).toMatch(/^KB-/)
    expect(existsSync(join(scaleDir, 'graphify-knowledge', 'entries', `${entry.id}.md`))).toBe(true)

    await kb.markHelpful(entry.id, 'SESSION-1')
    await kb.verify(entry.id, 'reviewer')

    const recalled = await kb.recall({ type: 'decision', verifiedOnly: true, limit: 5 })
    expect(recalled).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: entry.id,
        title: 'Use RTK as the default CLI proxy',
        verified: true,
        verifiedBy: 'reviewer',
      }),
    ]))

    const vector = await kb.recallByVector('rtk cli token proxy', 5)
    expect(vector).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: entry.id }),
    ]))
  })
})
