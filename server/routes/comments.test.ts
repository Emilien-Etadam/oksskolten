import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle } from '../db.js'
import type { FastifyInstance } from 'fastify'

const mockTranslateSnippet = vi.fn()
const mockFlareSolverr = vi.fn()

vi.mock('../fetcher/ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetcher/ai.js')>()
  return {
    ...actual,
    translateSnippet: (text: string) => mockTranslateSnippet(text),
  }
})

vi.mock('../fetcher/flaresolverr.js', () => ({
  fetchViaFlareSolverr: (url: string) => mockFlareSolverr(url),
}))

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
  mockFlareSolverr.mockReset()
  mockFlareSolverr.mockResolvedValue(null)
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

  it('returns an empty list when reddit and FlareSolverr are unreachable', async () => {
    const id = seedArticle('https://www.reddit.com/r/LocalLLM/comments/abc/post/')
    mockFetch.mockRejectedValue(new Error('network down'))

    const res = await app.inject({ method: 'GET', url: `/api/articles/${id}/comments` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ provider: 'reddit', comments: [] })
    expect(mockFlareSolverr).toHaveBeenCalled()
  })

  it('falls back to FlareSolverr when reddit blocks the direct request', async () => {
    const id = seedArticle('https://www.reddit.com/r/LocalLLM/comments/abc/post/')
    mockFetch.mockImplementation((url: string) =>
      String(url).includes('reddit.com')
        ? Promise.resolve({ ok: false, status: 403 })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    // Chromium wraps JSON responses in an HTML viewer with a <pre> element
    const wrapped = `<html><body><pre>${JSON.stringify(redditPayload).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`
    mockFlareSolverr.mockResolvedValue({ body: wrapped, contentType: 'text/html', url: 'x' })

    const res = await app.inject({ method: 'GET', url: `/api/articles/${id}/comments` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.provider).toBe('reddit')
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0].author).toBe('alice')
  })

  it('404s for unknown articles', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/articles/99999/comments' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/comments/translate', () => {
  it('translates each text preserving order', async () => {
    mockTranslateSnippet.mockImplementation((text: string) =>
      Promise.resolve({ textTranslated: `FR:${text}` }))

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/translate',
      headers: { 'content-type': 'application/json' },
      payload: { texts: ['Hello', 'World'] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ translations: ['FR:Hello', 'FR:World'] })
  })

  it('falls back to the original text when one translation fails', async () => {
    mockTranslateSnippet
      .mockResolvedValueOnce({ textTranslated: 'FR:Hello' })
      .mockRejectedValueOnce(new Error('vLLM down'))

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/translate',
      headers: { 'content-type': 'application/json' },
      payload: { texts: ['Hello', 'World'] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ translations: ['FR:Hello', 'World'] })
  })

  it('rejects invalid payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/translate',
      headers: { 'content-type': 'application/json' },
      payload: { texts: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})
