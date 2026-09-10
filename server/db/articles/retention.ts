import { getDb, getNamed, allNamed } from '../connection.js'
import { deleteArticlesFromSearch } from '../../search/sync.js'
import { deleteArticleImages } from '../../fetcher/article-images.js'
import { logger } from '../../logger.js'

const log = logger.child('retention')

export function getReadingStats(opts?: {
  since?: string
  until?: string
}): { total: number; read: number; unread: number; by_feed: { feed_id: number; feed_name: string; total: number; read: number; unread: number }[] } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts?.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts?.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  const totals = getNamed<{ total: number; read: number; unread: number }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    ${where}
  `, params)

  const byFeed = allNamed<{ feed_id: number; feed_name: string; total: number; read: number; unread: number }>(`
    SELECT
      a.feed_id,
      f.name AS feed_name,
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    GROUP BY a.feed_id
    ORDER BY total DESC
  `, params)

  return { ...totals, by_feed: byFeed }
}

// --- Retention policy ---

export function getRetentionStats(readDays: number, unreadDays: number): { readEligible: number; unreadEligible: number } {
  const readRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(readDays) as { cnt: number }

  const unreadRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(unreadDays) as { cnt: number }

  return { readEligible: readRow.cnt, unreadEligible: unreadRow.cnt }
}

export function purgeExpiredArticles(readDays: number, unreadDays: number): { purged: number } {
  const db = getDb()

  // Collect IDs to purge — use seen_at for read status (consistent with UI unread indicator)
  const readIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(readDays) as { id: number }[]

  const unreadIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(unreadDays) as { id: number }[]

  const allIds = [...readIds, ...unreadIds].map(r => r.id)
  if (allIds.length === 0) return { purged: 0 }

  // Process in batches to avoid overly large SQL
  const BATCH = 500
  let purged = 0

  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')

    // Clean up archived images before the transaction (external I/O)
    const articlesWithImages = db.prepare(
      `SELECT id FROM articles WHERE id IN (${placeholders}) AND images_archived_at IS NOT NULL`,
    ).all(...batch) as { id: number }[]

    for (const { id } of articlesWithImages) {
      try {
        deleteArticleImages(id)
      } catch (err) {
        log.warn(`Failed to delete images for article ${id}:`, err)
      }
    }

    // Soft delete + search index removal in a transaction to keep them consistent
    const result = db.transaction(() => {
      const res = db.prepare(`
        UPDATE articles
        SET full_text = NULL,
            full_text_translated = NULL,
            excerpt = NULL,
            summary = NULL,
            og_image = NULL,
            images_archived_at = NULL,
            last_error = NULL,
            retry_count = 0,
            purged_at = datetime('now')
        WHERE id IN (${placeholders})
      `).run(...batch)

      deleteArticlesFromSearch(batch)

      return res
    })()

    purged += result.changes
  }

  return { purged }
}
