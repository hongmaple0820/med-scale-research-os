import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewStore } from '../../src/workflow/ReviewStore.js'

let dirs: string[] = []

function makeScaleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-review-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('ReviewStore', () => {
  it('persists and reads review records', () => {
    const store = new ReviewStore(makeScaleDir())

    const saved = store.saveReview({
      taskId: 'TASK-1',
      passed: true,
      findings: [],
      changedFiles: ['src/example.ts'],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
    })

    const loaded = store.getReview(saved.id)

    expect(loaded).toEqual(saved)
    expect(loaded?.changedFiles).toEqual(['src/example.ts'])
  })

  it('lists newest reviews first', async () => {
    const store = new ReviewStore(makeScaleDir())
    const first = store.saveReview({
      taskId: 'TASK-1',
      passed: false,
      findings: [{ category: 'security', severity: 'HIGH', description: 'failed review' }],
      changedFiles: ['src/a.ts'],
      summary: { critical: 0, high: 1, medium: 0, low: 0 },
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = store.saveReview({
      taskId: 'TASK-2',
      passed: true,
      findings: [],
      changedFiles: ['src/b.ts'],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
    })

    const reviews = store.listReviews()

    expect(reviews.map(review => review.id)).toEqual([second.id, first.id])
  })
})
