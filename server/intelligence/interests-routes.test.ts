import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, markArticleLiked, markArticleSeen, recordArticleRead, getDb } from '../db.js'
import { _resetInterestsForTests } from './interests.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  setupTestDb()
  _resetInterestsForTests()
  app = await buildApp()
})

describe('interests API', () => {
  it('rebuilds the profile and mutes a term', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (const title of ['Rust news', 'Rust again']) {
      const id = insertArticle({ feed_id: feed.id, title, url: `https://a.example.com/${title}`, published_at: new Date().toISOString() })
      markArticleLiked(id, true)
    }
    expect((await app.inject({ method: 'GET', url: '/api/interests' })).json().islands).toEqual([])

    const rebuilt = await app.inject({ method: 'POST', url: '/api/interests/rebuild' })
    const terms = rebuilt.json().islands.flatMap((i: { terms: { term: string }[] }) => i.terms.map(t => t.term))
    expect(terms).toContain('rust')

    const muted = await app.inject({ method: 'PATCH', url: '/api/interests/rust', headers: json, payload: { muted: true } })
    expect(muted.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: '/api/interests' })
    expect(after.json().islands.flatMap((i: { terms: { term: string; muted: number }[] }) => i.terms).find((t: { term: string }) => t.term === 'rust').muted).toBe(1)

    expect((await app.inject({ method: 'PATCH', url: '/api/interests/nope', headers: json, payload: { muted: true } })).statusCode).toBe(404)
  })

  it('returns class affinities and mutes a class', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (let i = 0; i < 6; i++) {
      const id = insertArticle({ feed_id: feed.id, title: `Post ${i}`, url: `https://a.example.com/p${i}`, published_at: new Date().toISOString() })
      getDb().prepare("UPDATE articles SET theme = 'AI', format = 'QUESTION', classified_at = datetime('now') WHERE id = ?").run(id)
      markArticleSeen(id, true)
      recordArticleRead(id)
    }
    const rebuilt = (await app.inject({ method: 'POST', url: '/api/interests/rebuild' })).json()
    expect(rebuilt.classes.map((c: { kind: string; class_id: string }) => `${c.kind}:${c.class_id}`).sort()).toEqual(['format:QUESTION', 'theme:AI'])

    const muted = await app.inject({ method: 'PATCH', url: '/api/interests/classes/theme/AI', headers: json, payload: { muted: true } })
    expect(muted.statusCode).toBe(200)
    const after = (await app.inject({ method: 'GET', url: '/api/interests' })).json()
    expect(after.classes.find((c: { class_id: string }) => c.class_id === 'AI').muted).toBe(1)

    expect((await app.inject({ method: 'PATCH', url: '/api/interests/classes/theme/NOPE', headers: json, payload: { muted: true } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/api/interests/classes/color/AI', headers: json, payload: { muted: true } })).statusCode).toBe(400)
  })
})
