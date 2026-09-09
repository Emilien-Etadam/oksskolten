import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, markArticleSeen, insertSimilarity } from '../db.js'
import { getTopStories } from './stories.js'

beforeEach(() => setupTestDb())

const now = () => new Date().toISOString()

function article(feedId: number, title: string, extra: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({ feed_id: feedId, title, url: `https://f${feedId}.example.com/${Math.random()}`, published_at: now(), ...extra })
}

describe('getTopStories', () => {
  it('returns nothing without similarities', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    article(f.id, 'Solo')
    expect(getTopStories()).toEqual([])
  })

  it('ignores clusters covered by a single source', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    const a = article(f.id, 'Same story')
    const b = article(f.id, 'Same story again')
    insertSimilarity(a, b, 0.9)
    expect(getTopStories()).toEqual([])
  })

  it('clusters transitively and ranks by number of sources', () => {
    const fa = createFeed({ name: 'A', url: 'https://a.example.com' })
    const fb = createFeed({ name: 'B', url: 'https://b.example.com' })
    const fc = createFeed({ name: 'C', url: 'https://c.example.com' })

    // Story 1: three sources, chained a-b, b-c
    const a1 = article(fa.id, 'Big launch', { og_image: 'https://img/1.jpg' })
    const b1 = article(fb.id, 'Big launch covered')
    const c1 = article(fc.id, 'Launch is big')
    insertSimilarity(a1, b1, 0.8)
    insertSimilarity(b1, c1, 0.7)

    // Story 2: two sources
    const a2 = article(fa.id, 'Minor news')
    const b2 = article(fb.id, 'Minor news too')
    insertSimilarity(a2, b2, 0.6)

    const stories = getTopStories()
    expect(stories).toHaveLength(2)
    expect(stories[0].sources.map(s => s.feed_name)).toEqual(['A', 'B', 'C'])
    expect(stories[0].leader.id).toBe(a1) // unread with an image
    expect(stories[0].others.map(o => o.id).sort()).toEqual([b1, c1].sort())
    expect(stories[0].unread_count).toBe(3)
    expect(stories[1].sources).toHaveLength(2)
  })

  it('prefers an unread leader', () => {
    const fa = createFeed({ name: 'A', url: 'https://a.example.com' })
    const fb = createFeed({ name: 'B', url: 'https://b.example.com' })
    const a = article(fa.id, 'Read one', { og_image: 'https://img/1.jpg' })
    const b = article(fb.id, 'Unread one')
    insertSimilarity(a, b, 0.8)
    markArticleSeen(a, true)
    const [story] = getTopStories()
    expect(story.leader.id).toBe(b)
    expect(story.unread_count).toBe(1)
  })

  it('leaves old coverage out of the window', () => {
    const fa = createFeed({ name: 'A', url: 'https://a.example.com' })
    const fb = createFeed({ name: 'B', url: 'https://b.example.com' })
    const a = article(fa.id, 'Old', { published_at: '2020-01-01T00:00:00Z' })
    const b = article(fb.id, 'Old too', { published_at: '2020-01-01T00:00:00Z' })
    insertSimilarity(a, b, 0.8)
    expect(getTopStories({ days: 3 })).toEqual([])
  })
})
