import { getDb } from '../db/connection.js'

export interface SimilarArticle {
  id: number
  feed_name: string
  title: string
  url: string
  published_at: string | null
  read_at: string | null
  score: number
}

/**
 * Insert a bidirectional similarity relationship.
 * Silently ignores duplicates (ON CONFLICT DO NOTHING).
 */
export function insertSimilarity(articleId: number, similarToId: number, score: number): void {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO article_similarities (article_id, similar_to_id, score) VALUES (?, ?, ?)',
  )
  db.transaction(() => {
    stmt.run(articleId, similarToId, score)
    stmt.run(similarToId, articleId, score)
  })()
}

export interface SimilarityPair {
  article_id: number
  similar_to_id: number
  title: string
  similar_title: string
}

/** Every stored link with the titles at both ends, to re-check them against the matching rule. */
export function getSimilarityPairs(): SimilarityPair[] {
  return getDb()
    .prepare(
      `SELECT s.article_id, s.similar_to_id, a.title, b.title AS similar_title
       FROM article_similarities s
       JOIN active_articles a ON a.id = s.article_id
       JOIN active_articles b ON b.id = s.similar_to_id`,
    )
    .all() as SimilarityPair[]
}

/** Delete links in both directions, in one transaction. */
export function deleteSimilarities(pairs: Array<[number, number]>): void {
  if (pairs.length === 0) return
  const db = getDb()
  const stmt = db.prepare('DELETE FROM article_similarities WHERE article_id = ? AND similar_to_id = ?')
  db.transaction(() => {
    for (const [a, b] of pairs) {
      stmt.run(a, b)
      stmt.run(b, a)
    }
  })()
}

/**
 * Get similar articles for a given article ID.
 */
export function getSimilarArticles(articleId: number): SimilarArticle[] {
  return getDb()
    .prepare(
      `SELECT a.id, f.name AS feed_name, a.title, a.url, a.published_at, a.read_at, s.score
       FROM article_similarities s
       JOIN active_articles a ON a.id = s.similar_to_id
       JOIN feeds f ON f.id = a.feed_id
       WHERE s.article_id = ?
       ORDER BY s.score DESC`,
    )
    .all(articleId) as SimilarArticle[]
}

/**
 * Check if any similar article to the given one has been read.
 * Returns the first read similar article ID, or null.
 */
export function findReadSimilarArticle(articleId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT a.id
       FROM article_similarities s
       JOIN active_articles a ON a.id = s.similar_to_id
       WHERE s.article_id = ? AND a.read_at IS NOT NULL
       LIMIT 1`,
    )
    .get(articleId) as { id: number } | undefined
  return row?.id ?? null
}

/**
 * IDs of a feed's articles published within [since, until] (ISO strings), or
 * undated, excluding `excludeId`. Newest first, capped at `limit`.
 */
export function getFeedArticleIdsInWindow(
  feedId: number,
  excludeId: number,
  since: string,
  until: string,
  limit: number,
): number[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM active_articles
       WHERE feed_id = ? AND id != ?
         AND (published_at IS NULL OR (published_at >= ? AND published_at <= ?))
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(feedId, excludeId, since, until, limit) as { id: number }[]
  return rows.map(r => r.id)
}
