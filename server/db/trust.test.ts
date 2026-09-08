import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, recordArticleRead, markArticleLiked } from '../db.js'
import { recalculateFeedTrust, getFeedTrust } from './trust.js'

beforeEach(() => setupTestDb())

function seed(feedId: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => insertArticle({
    feed_id: feedId, title: `A${i}`, url: `https://f${feedId}.example.com/${i}`, published_at: new Date().toISOString(),
  }))
}

describe('recalculateFeedTrust', () => {
  it('is 0 for a feed nobody reads', () => {
    const feed = createFeed({ name: 'Quiet', url: 'https://q.example.com' })
    seed(feed.id, 5)
    recalculateFeedTrust()
    expect(getFeedTrust(feed.id)).toBe(0)
  })

  it('grows with reads and likes, capped below 1', () => {
    const feed = createFeed({ name: 'Loved', url: 'https://l.example.com' })
    const ids = seed(feed.id, 10)
    for (const id of ids) recordArticleRead(id)
    recalculateFeedTrust()
    const readOnly = getFeedTrust(feed.id)
    expect(readOnly).toBeGreaterThan(0.8)
    expect(readOnly).toBeLessThan(1)

    for (const id of ids.slice(0, 5)) markArticleLiked(id, true)
    recalculateFeedTrust()
    expect(getFeedTrust(feed.id)).toBeGreaterThan(readOnly)
  })

  it('dilutes tiny samples', () => {
    const feed = createFeed({ name: 'New', url: 'https://n.example.com' })
    const [only] = seed(feed.id, 1)
    recordArticleRead(only)
    recalculateFeedTrust()
    // One read out of a sample floor of 10 → 1 - exp(-0.2) ≈ 0.18
    expect(getFeedTrust(feed.id)).toBeCloseTo(0.181, 2)
  })
})
