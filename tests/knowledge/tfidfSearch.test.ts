// SCALE Engine — TfidfIndex Tests

import { describe, it, expect, beforeEach } from 'vitest'
import { TfidfIndex } from '../../src/knowledge/TfidfIndex.js'

describe('TfidfIndex', () => {
  let index: TfidfIndex

  beforeEach(() => {
    index = new TfidfIndex()
  })

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(index.size).toBe(0)
    })

    it('adds documents', () => {
      index.upsert('doc1', 'hello world')
      expect(index.size).toBe(1)
    })

    it('removes documents', () => {
      index.upsert('doc1', 'hello world')
      index.remove('doc1')
      expect(index.size).toBe(0)
    })

    it('updates existing documents', () => {
      index.upsert('doc1', 'hello world')
      index.upsert('doc1', 'goodbye world')
      expect(index.size).toBe(1)
    })

    it('clears all documents', () => {
      index.upsert('doc1', 'hello world')
      index.upsert('doc2', 'goodbye world')
      index.clear()
      expect(index.size).toBe(0)
    })
  })

  describe('search', () => {
    it('returns empty for empty index', () => {
      const results = index.search('hello', 5)
      expect(results).toEqual([])
    })

    it('returns empty for empty query', () => {
      index.upsert('doc1', 'hello world')
      const results = index.search('', 5)
      expect(results).toEqual([])
    })

    it('finds exact matches', () => {
      index.upsert('doc1', 'javascript programming language')
      index.upsert('doc2', 'python programming language')
      index.upsert('doc3', 'cooking recipes')

      const results = index.search('javascript programming', 5)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('doc1')
    })

    it('ranks by relevance', () => {
      index.upsert('doc1', 'javascript programming language tutorial')
      index.upsert('doc2', 'javascript basics')
      index.upsert('doc3', 'cooking recipes for beginners')

      const results = index.search('javascript programming', 5)
      expect(results.length).toBeGreaterThanOrEqual(2)
      // doc1 should rank higher than doc2 (more matches)
      expect(results[0].id).toBe('doc1')
    })

    it('respects topK limit', () => {
      // Need docs where query terms have varying TF-IDF (not all docs contain "react")
      index.upsert('doc1', 'react javascript programming')
      index.upsert('doc2', 'react javascript tutorial')
      index.upsert('doc3', 'react javascript basics')
      index.upsert('doc4', 'python advanced')
      index.upsert('doc5', 'go expert')

      const results = index.search('react javascript', 3)
      expect(results.length).toBe(3)
    })

    it('returns scores between 0 and 1', () => {
      index.upsert('doc1', 'javascript programming language')
      index.upsert('doc2', 'python programming language')

      const results = index.search('javascript', 5)
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('handles Chinese text', () => {
      index.upsert('doc1', '用户认证 登录 密码')
      index.upsert('doc2', '数据库 设计 优化')
      index.upsert('doc3', '用户管理 权限控制')

      const results = index.search('用户 认证', 5)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('doc1')
    })
  })

  describe('buildFromRows', () => {
    it('builds index from rows', () => {
      const rows = [
        { id: 'kb1', title: 'JWT Authentication', tags: '["auth","jwt"]', content_ref: 'Token-based auth guide' },
        { id: 'kb2', title: 'Database Design', tags: '["db","sql"]', content_ref: 'Schema design patterns' },
        { id: 'kb3', title: 'API Security', tags: '["auth","security"]', content_ref: 'Securing REST APIs' },
      ]

      index.buildFromRows(rows)
      expect(index.size).toBe(3)
    })

    it('searches across title and tags', () => {
      const rows = [
        { id: 'kb1', title: 'JWT Authentication', tags: '["auth","jwt"]', content_ref: '' },
        { id: 'kb2', title: 'Database Design', tags: '["db","sql"]', content_ref: '' },
      ]

      index.buildFromRows(rows)
      const results = index.search('jwt auth', 5)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('kb1')
    })

    it('clears previous data on rebuild', () => {
      index.upsert('old', 'old document')
      expect(index.size).toBe(1)

      index.buildFromRows([{ id: 'new', title: 'new document', tags: '[]', content_ref: '' }])
      expect(index.size).toBe(1)

      const results = index.search('old', 5)
      expect(results.length).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('handles documents with only stop words', () => {
      index.upsert('doc1', 'the is are was were')
      expect(index.size).toBe(1)

      const results = index.search('the is', 5)
      // Stop words should not match
      expect(results.length).toBe(0)
    })

    it('handles very short tokens', () => {
      index.upsert('doc1', 'a b c d e f g')
      index.upsert('doc2', 'javascript programming language')
      expect(index.size).toBe(2)

      // Single-letter tokens should be filtered
      const results = index.search('a b c', 5)
      expect(results.length).toBe(0)
    })

    it('handles special characters', () => {
      index.upsert('doc1', 'hello! @world #test')
      index.upsert('doc2', 'python programming language')
      expect(index.size).toBe(2)

      const results = index.search('hello world', 5)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('doc1')
    })

    it('handles duplicate terms', () => {
      index.upsert('doc1', 'test test test')
      index.upsert('doc2', 'test')
      index.upsert('doc3', 'python programming')

      const results = index.search('test', 5)
      expect(results.length).toBe(2)
    })
  })
})
