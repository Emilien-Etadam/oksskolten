import { getDb } from '../connection.js'
import type { Article } from '../types.js'
import { RETRY_MAX_ATTEMPTS, RETRY_BATCH_LIMIT } from '../../fetcher/util.js'
import { normalizeUrl } from './scoring.js'

/**
 * One-day backoff window between refresh attempts. After we try to repair
 * a stale article and fail (e.g. RSS has no description, the body is
 * legitimately short, or the item dropped out of the current feed), the
 * article is excluded from refresh queries for this long so we don't
 * bypass the RSS HTTP cache on every fetch tick forever.
 */
const REFRESH_ATTEMPT_BACKOFF = "datetime('now', '-1 day')"

/**
 * Return id + url + full_text for active articles in the given feed whose
 * stored full_text trimmed length is below the threshold and that have not
 * been attempted within the backoff window. Used by the fetcher to detect
 * previously-saved articles where extraction returned only a page title
 * (e.g. thin SPA sites) so the RSS excerpt fallback can be retried.
 *
 * Driven by feed_id, not by the current RSS URL list, so articles that
 * have rolled off the live feed still get their backoff timestamp updated
 * — otherwise their stale rows would keep skipCache enabled forever.
 */
export function getArticlesNeedingRefresh(
  feedId: number,
  minLength: number,
): { id: number; url: string; full_text: string | null }[] {
  return getDb().prepare(`
    SELECT id, url, full_text
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      AND length(coalesce(trim(full_text), '')) < ?
      AND (last_refresh_attempt_at IS NULL OR datetime(last_refresh_attempt_at) < ${REFRESH_ATTEMPT_BACKOFF})
  `).all(feedId, minLength) as { id: number; url: string; full_text: string | null }[]
}

/**
 * Count active articles for the given feed that are still eligible for a
 * refresh attempt. The fetcher uses a positive count as the signal to
 * bypass the RSS HTTP cache for that feed so the refresh path can run
 * even when the feed XML hasn't changed. Articles inside their backoff
 * window are excluded so unfixable stale rows don't keep the cache
 * disabled forever.
 */
export function countStaleArticlesByFeed(feedId: number, minLength: number): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      AND length(coalesce(trim(full_text), '')) < ?
      AND (last_refresh_attempt_at IS NULL OR datetime(last_refresh_attempt_at) < ${REFRESH_ATTEMPT_BACKOFF})
  `).get(feedId, minLength) as { n: number }
  return row.n
}

export function getExistingArticleUrls(urls: string[]): Set<string> {
  if (urls.length === 0) return new Set()
  const normalized = urls.map(normalizeUrl)

  // Query both protocol variants so a feed item that arrives as https://
  // is treated as duplicate when we already stored it as http://, and
  // vice versa. This is an intentional design trade-off: sites that serve
  // genuinely different content at http:// vs https:// (extremely rare for
  // RSS feeds) would lose the http version. The alternative — strict
  // per-protocol dedup — causes duplicate articles when the same blog is
  // referenced under both protocols in different feeds.
  const expanded = new Set<string>()
  for (const u of normalized) {
    expanded.add(u)
    if (u.startsWith('https://')) {
      expanded.add('http://' + u.slice(8))
    } else if (u.startsWith('http://')) {
      expanded.add('https://' + u.slice(7))
    }
  }
  const expandedList = [...expanded]
  const placeholders = expandedList.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT url FROM articles WHERE url IN (${placeholders})`,
  ).all(...expandedList) as { url: string }[]

  const dbUrls = new Set(rows.map(r => r.url))
  const existing = new Set<string>()
  for (const u of normalized) {
    if (dbUrls.has(u)) { existing.add(u); continue }
    if (u.startsWith('https://') && dbUrls.has('http://' + u.slice(8))) existing.add(u)
    else if (u.startsWith('http://') && dbUrls.has('https://' + u.slice(7))) existing.add(u)
  }
  return existing
}

// Backoff deadline: datetime when the article becomes eligible for retry again.
// 30 * 2^retry_count minutes, clamped to 32 hours via MIN(retry_count, 6).
const BACKOFF_DEADLINE = `datetime(last_retry_at, '+' || (30 * (1 << MIN(retry_count, 6))) || ' minutes')`

export function getRetryArticles(
  maxAttempts = RETRY_MAX_ATTEMPTS,
  batchLimit = RETRY_BATCH_LIMIT,
): Article[] {
  return getDb().prepare(`
    SELECT a.* FROM active_articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.retry_count < :max_attempts
      AND (
        a.last_retry_at IS NULL
        OR ${BACKOFF_DEADLINE} <= datetime('now')
      )
      AND (
        (a.last_error IS NOT NULL AND a.full_text IS NULL)
        OR (
          f.type = 'clip'
          AND length(trim(COALESCE(a.full_text, ''))) < :min_body
        )
      )
    ORDER BY a.retry_count ASC, a.last_retry_at ASC
    LIMIT :batch_limit
  `).all({
    max_attempts: maxAttempts,
    batch_limit: batchLimit,
    // Mirrors MIN_EXTRACTED_LENGTH in fetcher/content.ts. Duplicated so the
    // DB layer does not import the worker-pool module. A clip whose body is
    // only shell chrome would otherwise sit forever: retry used to require
    // full_text IS NULL, and a successful-looking 80-character extract is not.
    min_body: 200,
  }) as Article[]
}

export interface RetryStats {
  eligible: number
  backoff_waiting: number
  exceeded: number
}

export function getRetryStats(maxAttempts = RETRY_MAX_ATTEMPTS): RetryStats {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN retry_count < :max_attempts AND (
        last_retry_at IS NULL
        OR ${BACKOFF_DEADLINE} <= datetime('now')
      ) THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN retry_count < :max_attempts AND
        last_retry_at IS NOT NULL AND
        ${BACKOFF_DEADLINE} > datetime('now')
      THEN 1 ELSE 0 END) AS backoff_waiting,
      SUM(CASE WHEN retry_count >= :max_attempts THEN 1 ELSE 0 END) AS exceeded
    FROM active_articles
    WHERE last_error IS NOT NULL AND full_text IS NULL
  `).get({ max_attempts: maxAttempts }) as { eligible: number | null; backoff_waiting: number | null; exceeded: number | null }
  return {
    eligible: row.eligible ?? 0,
    backoff_waiting: row.backoff_waiting ?? 0,
    exceeded: row.exceeded ?? 0,
  }
}
