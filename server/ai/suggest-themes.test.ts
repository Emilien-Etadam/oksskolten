import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle } from '../db.js'
import { getDb } from '../db/connection.js'
import { parseSuggestedThemes } from './tasks.js'
import type { FastifyInstance } from 'fastify'

const { mockCreateMessage } = vi.hoisted(() => ({ mockCreateMessage: vi.fn() }))

vi.mock('./providers/llm/index.js', () => ({
  getProvider: () => ({
    name: 'ollama',
    requireKey: () => {},
    createMessage: mockCreateMessage,
    streamMessage: vi.fn(),
  }),
}))

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

function reply(text: string) {
  return { text, inputTokens: 1, outputTokens: 1 }
}

function seedArticles() {
  const feed = createFeed({ name: 'Tech', url: 'https://tech.example.com' })
  const now = new Date().toISOString()
  insertArticle({ feed_id: feed.id, title: 'Kernel 7.2 lands', url: 'https://tech.example.com/1', published_at: now })
  const hidden = insertArticle({ feed_id: feed.id, title: 'Spam promo', url: 'https://tech.example.com/2', published_at: now })
  getDb().prepare("UPDATE articles SET filtered_at = datetime('now') WHERE id = ?").run(hidden)
}

beforeEach(async () => {
  setupTestDb()
  mockCreateMessage.mockReset()
  app = await buildApp()
})

describe('parseSuggestedThemes', () => {
  it('reads a JSON array wrapped in prose or code fences', () => {
    const text = 'Here you go:\n```json\n[{"label":"Linux","description":"kernel, distros"},{"label":""},{"x":1}]\n```'
    expect(parseSuggestedThemes(text)).toEqual([{ label: 'Linux', description: 'kernel, distros' }])
  })

  it('returns nothing for an unreadable answer', () => {
    expect(parseSuggestedThemes('no idea')).toEqual([])
    expect(parseSuggestedThemes('[not json]')).toEqual([])
  })
})

describe('POST /api/classification/suggest-themes', () => {
  it('refuses when there is no article to learn from', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/classification/suggest-themes', headers: json, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('proposes unique themes with Other last, from visible titles only', async () => {
    seedArticles()
    mockCreateMessage.mockResolvedValue(reply(JSON.stringify([
      { label: 'Linux', description: 'kernel, distros' },
      { label: 'linux', description: 'duplicate' },
      { label: 'Other', description: 'model added it anyway' },
      { label: 'Self-hosting', description: 'home servers, NAS' },
    ])))

    const res = await app.inject({ method: 'POST', url: '/api/classification/suggest-themes', headers: json, payload: { count: 10 } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sampled).toBe(1)
    expect(body.themes.map((t: { id: string }) => t.id)).toEqual(['LINUX', 'SELF_HOSTING', 'OTHER'])

    const prompt = mockCreateMessage.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Kernel 7.2 lands')
    expect(prompt).not.toContain('Spam promo')
    expect(prompt).toContain('about 10')
    // Nothing saved
    const settings = (await app.inject({ method: 'GET', url: '/api/classification/settings' })).json()
    expect(settings.themes.map((t: { id: string }) => t.id)).toContain('AI')
  })

  it('reports a model failure or an unusable answer as 502', async () => {
    seedArticles()
    mockCreateMessage.mockResolvedValueOnce(reply('sorry'))
    const empty = await app.inject({ method: 'POST', url: '/api/classification/suggest-themes', headers: json, payload: {} })
    expect(empty.statusCode).toBe(502)

    mockCreateMessage.mockRejectedValueOnce(new Error('connection refused'))
    const failed = await app.inject({ method: 'POST', url: '/api/classification/suggest-themes', headers: json, payload: {} })
    expect(failed.statusCode).toBe(502)
    expect(failed.json().error).toBe('connection refused')
  })

  it('rejects an out-of-range count', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/classification/suggest-themes', headers: json, payload: { count: 99 } })
    expect(res.statusCode).toBe(400)
  })
})
