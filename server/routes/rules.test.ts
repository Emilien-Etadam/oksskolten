import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle, getArticleById, getDb } from '../db.js'
import { applyRulesToArticle } from '../rules.js'
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

describe('rules API', () => {
  it('creates, lists, updates and deletes a rule', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const created = await app.inject({ method: 'POST', url: '/api/rules', headers: json, payload: { feed_id: feed.id, field: 'title', pattern: '^sponsored', action: 'hide' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().feed_name).toBe('A')

    const list = await app.inject({ method: 'GET', url: '/api/rules' })
    expect(list.json().rules).toHaveLength(1)

    const patched = await app.inject({ method: 'PATCH', url: `/api/rules/${created.json().id}`, headers: json, payload: { enabled: false, feed_id: null } })
    expect(patched.json().enabled).toBe(0)
    expect(patched.json().feed_id).toBeNull()

    expect((await app.inject({ method: 'DELETE', url: `/api/rules/${created.json().id}` })).statusCode).toBe(204)
  })

  it('rejects invalid patterns and a score rule without a value', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/rules', headers: json, payload: { pattern: '(unclosed', action: 'hide' } })
    expect(bad.statusCode).toBe(400)
    const noValue = await app.inject({ method: 'POST', url: '/api/rules', headers: json, payload: { pattern: 'x', action: 'score' } })
    expect(noValue.statusCode).toBe(400)
  })

  it('previews matches over recent articles', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    seed(feed.id, 'Sponsored: buy this')
    seed(feed.id, 'Real news')
    const res = await app.inject({ method: 'POST', url: '/api/rules/preview', headers: json, payload: { field: 'title', pattern: '^sponsored' } })
    expect(res.json()).toMatchObject({ scanned: 2, matched: 1 })
    expect(res.json().samples[0].title).toBe('Sponsored: buy this')
  })

  it('applies a rule to existing articles', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const hit = seed(feed.id, 'Sponsored: buy this')
    const miss = seed(feed.id, 'Real news')
    const rule = (await app.inject({ method: 'POST', url: '/api/rules', headers: json, payload: { pattern: '^sponsored', action: 'mark_read' } })).json()
    const res = await app.inject({ method: 'POST', url: `/api/rules/${rule.id}/apply` })
    expect(res.json()).toEqual({ matched: 1 })
    expect(getArticleById(hit)?.seen_at).not.toBeNull()
    expect(getArticleById(miss)?.seen_at).toBeNull()
    const list = await app.inject({ method: 'GET', url: '/api/rules' })
    expect(list.json().rules[0].match_count).toBe(1)
  })
})

describe('applyRulesToArticle', () => {
  it('runs feed-scoped and global rules and performs every action', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    const other = createFeed({ name: 'B', url: 'https://b.example.com' })
    for (const payload of [
      { feed_id: feed.id, field: 'title', pattern: 'hide me', action: 'hide' },
      { field: 'url', pattern: 'example\\.com', action: 'bookmark' },
      { field: 'content', pattern: 'great', action: 'like' },
      { field: 'any', pattern: 'boost', action: 'score', value: 4 },
      { feed_id: other.id, field: 'title', pattern: '.*', action: 'mark_read' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/rules', headers: json, payload })
      expect(res.statusCode).toBe(201)
    }

    const id = seed(feed.id, 'Please hide me and boost', { full_text: 'a great article' })
    const matched = applyRulesToArticle(id, feed.id, { title: 'Please hide me and boost', url: 'https://example.com/x', content: 'a great article' })
    expect(matched.map(r => r.action).sort()).toEqual(['bookmark', 'hide', 'like', 'score'])

    const row = getDb().prepare('SELECT filtered_at, bookmarked_at, liked_at, rule_boost, score, seen_at FROM articles WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.filtered_at).not.toBeNull()
    expect(row.bookmarked_at).not.toBeNull()
    expect(row.liked_at).not.toBeNull()
    expect(row.rule_boost).toBe(4)
    expect(row.score as number).toBeGreaterThan(0)
    // The other feed's rule did not run
    expect(row.seen_at).toBeNull()
  })

  it('never matches with an invalid or disabled rule', async () => {
    const feed = createFeed({ name: 'A', url: 'https://a.example.com' })
    getDb().prepare("INSERT INTO feed_rules (feed_id, field, pattern, action, enabled) VALUES (NULL, 'title', '(', 'hide', 1)").run()
    getDb().prepare("INSERT INTO feed_rules (feed_id, field, pattern, action, enabled) VALUES (NULL, 'title', '.*', 'hide', 0)").run()
    const id = seed(feed.id, 'anything')
    expect(applyRulesToArticle(id, feed.id, { title: 'anything', url: 'https://x', content: null })).toEqual([])
    expect(getArticleById(id)?.filtered_at ?? null).toBeNull()
  })
})
