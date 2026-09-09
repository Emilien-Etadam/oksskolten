import { getDb } from '../db/connection.js'

/** Window over which a source's recent value is judged */
const TRUST_WINDOW_DAYS = 30
/** Below this many delivered articles the ratio is diluted, so a lucky single read is not a 100% feed */
const TRUST_MIN_SAMPLE = 10

/**
 * Feed trust: how much of what a source delivered recently the reader
 * actually valued. Opened articles count 1, bookmarks 2, likes 3; articles
 * the reader hid (rules or AI filter) count against it. Normalized to 0..1
 * with `1 - exp(-2x)`, so a feed whose every article is opened lands near
 * 0.86 and only likes push it further.
 */
export function recalculateFeedTrust(): { updated: number } {
  const result = getDb().prepare(`
    UPDATE feeds SET trust_score = COALESCE((
      SELECT ROUND(1.0 - exp(-2.0 * (
        (
          SUM(CASE WHEN a.read_at IS NOT NULL THEN 1 ELSE 0 END)
          + SUM(CASE WHEN a.bookmarked_at IS NOT NULL THEN 2 ELSE 0 END)
          + SUM(CASE WHEN a.liked_at IS NOT NULL THEN 3 ELSE 0 END)
          - SUM(CASE WHEN a.filtered_at IS NOT NULL THEN 1 ELSE 0 END)
        ) * 1.0 / MAX(COUNT(*), ${TRUST_MIN_SAMPLE})
      )), 3)
      FROM active_articles a
      WHERE a.feed_id = feeds.id
        AND a.fetched_at >= datetime('now', '-${TRUST_WINDOW_DAYS} days')
    ), 0)
    WHERE type = 'rss'
  `).run()
  // exp() may be missing on older SQLite builds; the CASE above then errors
  // out of the statement before any row is touched, which the caller logs.
  return { updated: result.changes }
}

export function getFeedTrust(feedId: number): number {
  const row = getDb().prepare('SELECT trust_score FROM feeds WHERE id = ?').get(feedId) as { trust_score: number } | undefined
  return row?.trust_score ?? 0
}
