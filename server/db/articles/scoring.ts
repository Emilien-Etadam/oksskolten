import { getDb } from '../connection.js'
import type { MeiliArticleDoc } from '../../search/client.js'
import { syncArticleScoreToSearch } from '../../search/sync.js'

/** Normalize a URL so that raw-Unicode and percent-encoded forms compare equal. */
export function normalizeUrl(raw: string): string {
  try { return new URL(raw).href } catch { return raw }
}

export function buildMeiliDoc(id: number): MeiliArticleDoc | null {
  const row = getDb().prepare(`
    SELECT id, feed_id, category_id, title,
           COALESCE(full_text, '') AS full_text,
           COALESCE(full_text_translated, '') AS full_text_translated,
           lang,
           COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
           COALESCE(score, 0) AS score,
           (seen_at IS NULL) AS is_unread,
           (liked_at IS NOT NULL) AS is_liked,
           (bookmarked_at IS NOT NULL) AS is_bookmarked
    FROM articles WHERE id = ?
  `).get(id) as MeiliArticleDoc | undefined
  return row ?? null
}

// --- Score computation ---

const SCORE_DECAY_FACTOR = 0.05
const SEARCH_BOOST_FACTOR = 5.0

/**
 * Build the engagement × decay score SQL expression.
 * @param prefix - table alias (e.g. 'a.') for JOIN queries, or '' for single-table UPDATE
 */
export function scoreExpr(prefix: string, opts?: { searchBoost?: boolean }): string {
  const p = prefix
  const engagement = `(
    (CASE WHEN ${p}liked_at IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN ${p}bookmarked_at IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN ${p}full_text_translated IS NOT NULL THEN 3 ELSE 0 END)
    + (CASE WHEN ${p}read_at IS NOT NULL THEN 2 ELSE 0 END)
    + COALESCE(${p}rule_boost, 0)
  )`
  const decay = `(1.0 / (1.0 + (julianday('now') - julianday(
    COALESCE(${p}read_at, ${p}published_at, ${p}fetched_at)
  )) * ${SCORE_DECAY_FACTOR}))`
  const boost = opts?.searchBoost ? ` * ${SEARCH_BOOST_FACTOR}` : ''
  return `(${engagement} * ${decay}${boost})`
}

/** WHERE clause for articles that have engagement or a non-zero score. Shared with search sync. */
export const SCORED_ARTICLES_WHERE = `(
  liked_at IS NOT NULL
  OR bookmarked_at IS NOT NULL
  OR read_at IS NOT NULL
  OR full_text_translated IS NOT NULL
  OR rule_boost != 0
  OR score > 0
)`

/** Update score in DB and sync to search. Call within a transaction for atomicity. */
export function updateScoreDb(id: number): void {
  getDb().prepare(`UPDATE articles SET score = (${scoreExpr('')}) WHERE id = ?`).run(id)
}

export function syncScoreToSearch(id: number): void {
  const row = getDb().prepare('SELECT score FROM articles WHERE id = ?').get(id) as { score: number } | undefined
  if (row) syncArticleScoreToSearch(id, row.score)
}

export function updateScore(id: number): void {
  updateScoreDb(id)
  syncScoreToSearch(id)
}

export function recalculateScores(): { updated: number } {
  const result = getDb().prepare(`
    UPDATE articles SET score = (${scoreExpr('')})
    WHERE id IN (SELECT id FROM active_articles) AND ${SCORED_ARTICLES_WHERE}
  `).run()
  return { updated: result.changes }
}
