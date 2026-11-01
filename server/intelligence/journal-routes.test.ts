import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, upsertSetting } from '../db.js'
import { getDb } from '../db/connection.js'
import type { FastifyInstance } from 'fastify'
import type { JournalOverview } from '../../shared/journal.js'

const { mockCreateMessage } = vi.hoisted(() => ({ mockCreateMessage: vi.fn() }))

vi.mock('../ai/providers/llm/index.js', () => ({
  getProvider: () => ({
    name: 'ollama',
    requireKey: () => {},
    createMessage: mockCreateMessage,
    streamMessage: vi.fn(),
  }),
}))

let app: FastifyInstance

function reply(text: string) {
  return { text, inputTokens: 1, outputTokens: 1 }
}

async function overview(): Promise<JournalOverview> {
  return (await app.inject({ method: 'GET', url: '/api/journal' })).json() as JournalOverview
}

async function generateAndWait(): Promise<JournalOverview> {
  const res = await app.inject({ method: 'POST', url: '/api/journal/generate' })
  expect(res.statusCode).toBe(202)
  let current = await overview()
  await vi.waitFor(async () => {
    current = await overview()
    expect(current.latest?.status).not.toBe('running')
  })
  return current
}

beforeEach(async () => {
  setupTestDb()
  mockCreateMessage.mockReset()
  app = await buildApp()
})

describe('POST /api/journal/generate', () => {
  it('returns 422 when nothing arrived', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/journal/generate' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('no_articles')
  })

  it('writes a sourced edition and marks the covered articles read', async () => {
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    const a = insertArticle({ feed_id: feed.id, title: 'Quantization results', url: 'https://blog.example.com/1', published_at: new Date().toISOString() })
    const b = insertArticle({ feed_id: feed.id, title: 'Backup guide', url: 'https://blog.example.com/2', published_at: new Date().toISOString() })
    mockCreateMessage
      .mockResolvedValueOnce(reply('Two things happened [1]. Also this [2, 1].'))
      .mockResolvedValueOnce(reply('- The key point [2]'))

    const result = await generateAndWait()
    const edition = result.latest!
    expect(edition.status).toBe('done')
    expect(edition.number).toBe(1)
    expect(edition.article_count).toBe(2)

    const content = edition.content!
    expect(content.sections).toHaveLength(1)
    expect(content.sections[0].summary).toBe('Two things happened [1]. Also this [2][1].')
    expect(content.sections[0].article_ids.sort()).toEqual([a, b].sort())
    expect(content.sources.map(s => s.n)).toEqual([1, 2])
    expect(content.essentials).toEqual([{ text: 'The key point [2]', refs: [2], theme: '_' }])

    const unread = getDb().prepare('SELECT COUNT(*) AS n FROM articles WHERE seen_at IS NULL').get() as { n: number }
    expect(unread.n).toBe(0)
    expect(result.pending_count).toBe(0)
  })

  it('leaves starred GitHub releases and clips out', async () => {
    const stars = createFeed({ name: 'GitHub Releases (me)', url: 'https://github.com/stars/me' })
    insertArticle({ feed_id: stars.id, title: 'v1.0', url: 'https://github.com/x/y/releases/v1', published_at: new Date().toISOString() })
    const res = await app.inject({ method: 'POST', url: '/api/journal/generate' })
    expect(res.statusCode).toBe(422)
  })

  it('records a failed edition when the model errors', async () => {
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    insertArticle({ feed_id: feed.id, title: 'Something', url: 'https://blog.example.com/1', published_at: new Date().toISOString() })
    mockCreateMessage.mockRejectedValue(new Error('model down'))

    const result = await generateAndWait()
    expect(result.latest?.status).toBe('error')
    expect(result.latest?.error).toBe('model down')
    // Nothing was consumed: the next edition covers the same articles
    expect(result.pending_count).toBe(1)
  })

  it('passes the theme instruction to the model', async () => {
    upsertSetting('classify.enabled', 'on')
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Model news', url: 'https://blog.example.com/1', published_at: new Date().toISOString() })
    getDb().prepare("UPDATE articles SET theme = 'AI' WHERE id = ?").run(id)
    await app.inject({ method: 'PUT', url: '/api/journal/instructions/AI', payload: { instruction: 'Ignore memes' } })
    mockCreateMessage.mockResolvedValue(reply('Nothing new [1].'))

    const result = await generateAndWait()
    expect(result.latest?.content?.sections[0].theme).toBe('AI')
    const prompt = mockCreateMessage.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Ignore memes')
    expect(result.instructions).toEqual({ AI: 'Ignore memes' })
  })
})

describe('POST /api/journal/feedback', () => {
  it('stores a vote and likes the article on "more like this"', async () => {
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Good one', url: 'https://blog.example.com/1', published_at: new Date().toISOString() })
    const res = await app.inject({ method: 'POST', url: '/api/journal/feedback', payload: { article_id: id, vote: 1 } })
    expect(res.statusCode).toBe(200)
    const row = getDb().prepare('SELECT liked_at FROM articles WHERE id = ?').get(id) as { liked_at: string | null }
    expect(row.liked_at).not.toBeNull()
  })

  it('returns 404 for an unknown article', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/journal/feedback', payload: { article_id: 999, vote: -1 } })
    expect(res.statusCode).toBe(404)
  })
})
