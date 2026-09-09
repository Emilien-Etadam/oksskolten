import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, markArticleSeen, markArticleBookmarked } from '../db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

function seed(feedId: number, title: string, extra: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({ feed_id: feedId, title, url: `https://example.com/${Math.random()}`, published_at: new Date().toISOString(), ...extra })
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
})

describe('smart folders', () => {
  it('creates, lists, updates and deletes a folder', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'Rust', query: 'rust unread:true' } })
    expect(created.statusCode).toBe(201)
    const id = created.json().id

    const list = await app.inject({ method: 'GET', url: '/api/smart-folders' })
    expect(list.json().folders).toHaveLength(1)
    // Free-text folders carry no badge count
    expect(list.json().folders[0].unread_count).toBeNull()

    const patched = await app.inject({ method: 'PATCH', url: `/api/smart-folders/${id}`, headers: json, payload: { name: 'Rust lang' } })
    expect(patched.json().name).toBe('Rust lang')

    const deleted = await app.inject({ method: 'DELETE', url: `/api/smart-folders/${id}` })
    expect(deleted.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/smart-folders' })).json().folders).toEqual([])
  })

  it('rejects an empty query', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'x', query: '  ' } })
    expect(res.statusCode).toBe(400)
  })

  it('counts unread matches of filter-only folders', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const a = seed(feed.id, 'one')
    seed(feed.id, 'two')
    markArticleBookmarked(a, true)
    await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'Marked', query: 'bookmarked:true' } })
    const list = await app.inject({ method: 'GET', url: '/api/smart-folders' })
    expect(list.json().folders[0].unread_count).toBe(1)
  })

  it('serves matching articles with the SQL fallback when search is not ready', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const other = createFeed({ name: 'B', url: 'https://b.example.com' })
    const rustUnread = seed(feed.id, 'Rust 2.0 released')
    const rustRead = seed(feed.id, 'Rust in production')
    markArticleSeen(rustRead, true)
    seed(feed.id, 'Go 2.0 released')
    seed(other.id, 'Rust elsewhere')

    const folder = (await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'Rust', query: `rust unread:true feed:${feed.id}` } })).json()
    const res = await app.inject({ method: 'GET', url: `/api/smart-folders/${folder.id}/articles` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.articles.map((a: { id: number }) => a.id)).toEqual([rustUnread])
    expect(body.total).toBe(1)
    expect(body.has_more).toBe(false)
    expect(body.folder.name).toBe('Rust')
  })

  it('applies a relative window', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const fresh = seed(feed.id, 'fresh')
    seed(feed.id, 'stale', { published_at: '2020-01-01T00:00:00Z' })
    const folder = (await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'Week', query: '@week' } })).json()
    const res = await app.inject({ method: 'GET', url: `/api/smart-folders/${folder.id}/articles` })
    expect(res.json().articles.map((a: { id: number }) => a.id)).toEqual([fresh])
  })

  it('404s on an unknown folder', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/smart-folders/999/articles' })
    expect(res.statusCode).toBe(404)
  })
})
