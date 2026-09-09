import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, insertSimilarity } from '../db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

describe('GET /api/stories', () => {
  it('returns clustered stories', async () => {
    const fa = createFeed({ name: 'A', url: 'https://a.example.com' })
    const fb = createFeed({ name: 'B', url: 'https://b.example.com' })
    const a = insertArticle({ feed_id: fa.id, title: 'Event', url: 'https://a.example.com/1', published_at: new Date().toISOString() })
    const b = insertArticle({ feed_id: fb.id, title: 'Event too', url: 'https://b.example.com/1', published_at: new Date().toISOString() })
    insertSimilarity(a, b, 0.8)

    const res = await app.inject({ method: 'GET', url: '/api/stories?days=3&limit=10' })
    expect(res.statusCode).toBe(200)
    const { stories } = res.json()
    expect(stories).toHaveLength(1)
    expect(stories[0].sources.map((s: { feed_name: string }) => s.feed_name)).toEqual(['A', 'B'])
    expect(stories[0].leader.feed_name).toBeDefined()
  })
})
