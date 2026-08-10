import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle } from '../db.js'
import type { FastifyInstance } from 'fastify'
import { redditJsonUrl } from './comments.js'

let app: FastifyInstance
const mockFetch = vi.fn()

function seedArticle(url: string): number {
  const feed = createFeed({ name: 'Feed', url: 'https://feed.example.com' })
  return insertArticle({
    feed_id: feed.id,
    title: 'Post',
    url,
    published_at: '2026-01-01T00:00:00Z',
  })
}

const redditPayload = [
  { data: { children: [] } },
  {
    data: {
      children: [
        {
          kind: 't1',
          data: {
            author: 'alice', score: 42, body: 'Great **post**',
            replies: { data: { children: [
              { kind: 't1', data: { author: 'bob', score: 7, body: 'Agreed', replies: '' } },
            ] } },
          },
        },
        { kind: 't1', data: { author: 'AutoModerator', score: 1, body: 'I am a bot', replies: '' } },
        { kind: 't1', data: { author: 'mod', score: 5, body: 'Read the rules', stickied: true, replies: '' } },
        { kind: 't1', data: { author: 'ghost', score: 2, body: '[removed]', replies: '' } },
        { kind: 'more', data: {} },
      ],
    },
  },
]

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('redditJsonUrl', () => {
  it('maps reddit post URLs (any subdomain) to the JSON endpoint', () => {
    expect(redditJsonUrl('https://www.reddit.com/r/LocalLLM/comments/abc/post_title/'))
      .toBe('https://www.reddit.com/r/LocalLLM/comments/abc/post_title.json?raw_json=1&sort=top&limit=50&depth=2')
    expect(redditJsonUrl('https://old.reddit.com/r/x/comments/1/t/')).toContain('https://www.reddit.com/r/x/comments/1/t.json')
  })

  it('returns null for non-reddit or non-post URLs', () => {
    expect(redditJsonUrl('https://example.com/article')).toBeNull()
    expect(redditJsonUrl('https://www.reddit.com/r/LocalLLM/')).toBeNull()
    expect(redditJsonUrl('not a url')).toBeNull()
  })
})

describe('GET /api/articles/:id/comments', () => {
  it('returns provider null without fetching for non-reddit articles', async () => {
    const id = seedArticle('https://example.com/article')
    const res = await app.inject({ method: 'GET', url: `/api/articles/${id}/comments` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ provider: null, comments: [] })
    // The stubbed fetch also sees Meilisearch sync calls — only reddit matters
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('reddit.com'))).toHaveLength(0)
  })

  it('returns parsed top comments for reddit articles', async () => {
    const id = seedArticle('https://www.reddit.com/r/LocalLLM/comments/abc/post/')
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(redditPayload) })

    const res = await app.inject({ method: 'GET', url: `/api/articles/${id}/comments` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.provider).toBe('reddit')
    // AutoModerator, stickied, and removed comments are filtered out
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0].author).toBe('alice')
    expect(body.comments[0].score).toBe(42)
    expect(body.comments[0].replies).toHaveLength(1)
    expect(body.comments[0].replies[0].author).toBe('bob')
  })

  it('returns an empty list when reddit is unreachable', async () => {
    const id = seedArticle('https://www.reddit.com/r/LocalLLM/comments/abc/post/')
    mockFetch.mockRejectedValue(new Error('network down'))

    const res = await app.inject({ method: 'GET', url: `/api/articles/${id}/comments` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ provider: 'reddit', comments: [] })
  })

  it('404s for unknown articles', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/articles/99999/comments' })
    expect(res.statusCode).toBe(404)
  })
})
