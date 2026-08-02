import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, createCategory, insertArticle, markArticleSeen } from '../db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2026-01-01T00:00:00Z',
    ...overrides,
  })
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

describe('GET /api/frontpage', () => {
  it('returns an empty front page with no articles', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/frontpage' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ hero: null, sections: [] })
  })

  it('returns a hero and per-category sections of unread articles', async () => {
    const category = createCategory('Tech')
    const feed = createFeed({ name: 'Feed A', url: 'https://a.example.com', category_id: category.id })
    const heroId = seedArticle(feed.id, { title: 'Hero', og_image: 'https://a.example.com/img.jpg' })
    const otherId = seedArticle(feed.id, { title: 'Other' })
    const readId = seedArticle(feed.id, { title: 'Read' })
    markArticleSeen(readId, true)

    const res = await app.inject({ method: 'GET', url: '/api/frontpage' })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.hero.id).toBe(heroId)
    expect(body.sections).toHaveLength(1)
    expect(body.sections[0].category.name).toBe('Tech')
    const sectionIds = body.sections[0].articles.map((a: { id: number }) => a.id)
    // Hero and read articles are excluded from sections
    expect(sectionIds).toEqual([otherId])
  })

  it('omits categories without unread articles', async () => {
    const catA = createCategory('Active')
    const catB = createCategory('Quiet')
    const feedA = createFeed({ name: 'A', url: 'https://a.example.com', category_id: catA.id })
    const feedB = createFeed({ name: 'B', url: 'https://b.example.com', category_id: catB.id })
    seedArticle(feedA.id, { title: 'A1' })
    seedArticle(feedA.id, { title: 'A2' })
    const readId = seedArticle(feedB.id, { title: 'B1' })
    markArticleSeen(readId, true)

    const res = await app.inject({ method: 'GET', url: '/api/frontpage' })
    const body = res.json()
    expect(body.sections.map((s: { category: { name: string } }) => s.category.name)).toEqual(['Active'])
  })
})
