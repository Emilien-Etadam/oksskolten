import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { insertSimilarity, getSimilarArticles, findReadSimilarArticle, getFeedArticleIdsInWindow } from './similarity-db.js'
import { getDb } from '../db/connection.js'

function seedFeedAndArticles() {
  const db = getDb()
  db.prepare('INSERT INTO categories (id, name) VALUES (1, \'Tech\')').run()
  db.prepare('INSERT INTO feeds (id, name, url, category_id) VALUES (1, \'Feed A\', \'https://a.com\', 1)').run()
  db.prepare('INSERT INTO feeds (id, name, url, category_id) VALUES (2, \'Feed B\', \'https://b.com\', 1)').run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (1, 1, \'Article A\', \'https://a.com/1\', 1)',
  ).run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (2, 2, \'Article B\', \'https://b.com/1\', 1)',
  ).run()
  db.prepare(
    'INSERT INTO articles (id, feed_id, title, url, category_id) VALUES (3, 2, \'Article C\', \'https://b.com/2\', 1)',
  ).run()
}

beforeEach(() => {
  setupTestDb()
  seedFeedAndArticles()
})

describe('insertSimilarity', () => {
  it('inserts bidirectional similarity', () => {
    insertSimilarity(1, 2, 0.85)
    const db = getDb()
    const rows = db.prepare('SELECT * FROM article_similarities').all() as any[]
    expect(rows).toHaveLength(2)
    expect(rows.map(r => [r.article_id, r.similar_to_id])).toEqual(
      expect.arrayContaining([[1, 2], [2, 1]]),
    )
  })

  it('ignores duplicate inserts', () => {
    insertSimilarity(1, 2, 0.85)
    insertSimilarity(1, 2, 0.90) // should not fail
    const db = getDb()
    const rows = db.prepare('SELECT * FROM article_similarities').all()
    expect(rows).toHaveLength(2) // still 2 (bidirectional)
  })
})

describe('getSimilarArticles', () => {
  it('returns similar articles with feed info', () => {
    insertSimilarity(1, 2, 0.85)
    const similar = getSimilarArticles(1)
    expect(similar).toHaveLength(1)
    expect(similar[0].id).toBe(2)
    expect(similar[0].feed_name).toBe('Feed B')
    expect(similar[0].score).toBe(0.85)
  })

  it('returns empty array when no similarities', () => {
    expect(getSimilarArticles(1)).toEqual([])
  })

  it('returns multiple similar articles ordered by score', () => {
    insertSimilarity(1, 2, 0.60)
    insertSimilarity(1, 3, 0.90)
    const similar = getSimilarArticles(1)
    expect(similar).toHaveLength(2)
    expect(similar[0].id).toBe(3) // higher score first
    expect(similar[1].id).toBe(2)
  })
})

describe('findReadSimilarArticle', () => {
  it('returns null when no similar articles are read', () => {
    insertSimilarity(1, 2, 0.85)
    expect(findReadSimilarArticle(1)).toBeNull()
  })

  it('returns the read similar article id', () => {
    insertSimilarity(1, 2, 0.85)
    const db = getDb()
    db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = 2").run()
    expect(findReadSimilarArticle(1)).toBe(2)
  })

  it('returns null when no similarities exist', () => {
    expect(findReadSimilarArticle(1)).toBeNull()
  })
})

describe('getFeedArticleIdsInWindow', () => {
  it('returns the feed\'s other articles dated inside the window or undated', () => {
    const db = getDb()
    db.prepare('UPDATE articles SET published_at = ? WHERE id = 2').run('2026-01-02T00:00:00.000Z')
    db.prepare(
      'INSERT INTO articles (id, feed_id, title, url, category_id, published_at) VALUES (4, 2, \'Old\', \'https://b.com/3\', 1, \'2025-06-01T00:00:00.000Z\')',
    ).run()
    // id 3 is undated, id 4 is outside the window, id 1 belongs to another feed
    expect(getFeedArticleIdsInWindow(2, 99, '2025-12-29T00:00:00.000Z', '2026-01-04T00:00:00.000Z', 10))
      .toEqual([3, 2])
    expect(getFeedArticleIdsInWindow(2, 2, '2025-12-29T00:00:00.000Z', '2026-01-04T00:00:00.000Z', 10))
      .toEqual([3])
  })
})
