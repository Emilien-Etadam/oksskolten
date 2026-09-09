import { getDb, runNamed } from '../connection.js'
import { syncArticleToSearch, syncArticleFiltersToSearch } from '../../search/sync.js'
import { buildMeiliDoc, updateScoreDb, syncScoreToSearch, updateScore } from './scoring.js'

export function markArticleSeen(
  id: number,
  seen: boolean,
): { seen_at: string | null; read_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (seen) {
      getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ? AND seen_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET seen_at = NULL, read_at = NULL WHERE id = ?').run(id)
      updateScoreDb(id)
    }
    return getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(id) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  if (!seen) syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_unread: !seen }])
  if (!row) return undefined
  return { seen_at: row.seen_at, read_at: row.read_at }
}

export function markArticlesSeen(ids: number[]): { updated: number } {
  if (ids.length === 0) return { updated: 0 }
  const placeholders = ids.map(() => '?').join(',')
  const result = getDb().prepare(
    `UPDATE articles SET seen_at = datetime('now') WHERE id IN (${placeholders}) AND seen_at IS NULL`,
  ).run(...ids)
  if (result.changes > 0) {
    syncArticleFiltersToSearch(ids.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

export function markAllSeenByFeed(feedId: number): { updated: number } {
  // Collect affected IDs before update for search sync
  const affectedIds = (getDb().prepare(
    'SELECT id FROM active_articles WHERE feed_id = ? AND seen_at IS NULL',
  ).all(feedId) as { id: number }[]).map(r => r.id)
  const result = getDb().prepare("UPDATE articles SET seen_at = datetime('now') WHERE feed_id = ? AND seen_at IS NULL AND purged_at IS NULL").run(feedId)
  if (affectedIds.length > 0) {
    syncArticleFiltersToSearch(affectedIds.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

export function markArticleLiked(
  id: number,
  liked: boolean,
): { liked_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (liked) {
      getDb().prepare("UPDATE articles SET liked_at = datetime('now') WHERE id = ? AND liked_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET liked_at = NULL WHERE id = ?').run(id)
    }
    updateScoreDb(id)
    return getDb().prepare('SELECT liked_at FROM articles WHERE id = ?').get(id) as { liked_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_liked: liked }])
  if (!row) return undefined
  return { liked_at: row.liked_at }
}

export function getLikeCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM active_articles WHERE liked_at IS NOT NULL').get() as { cnt: number }
  return row.cnt
}

export function markArticleBookmarked(
  id: number,
  bookmarked: boolean,
): { bookmarked_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    if (bookmarked) {
      getDb().prepare("UPDATE articles SET bookmarked_at = datetime('now') WHERE id = ? AND bookmarked_at IS NULL").run(id)
    } else {
      getDb().prepare('UPDATE articles SET bookmarked_at = NULL WHERE id = ?').run(id)
    }
    updateScoreDb(id)
    return getDb().prepare('SELECT bookmarked_at FROM articles WHERE id = ?').get(id) as { bookmarked_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_bookmarked: bookmarked }])
  if (!row) return undefined
  return { bookmarked_at: row.bookmarked_at }
}

export function getBookmarkCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM active_articles WHERE bookmarked_at IS NOT NULL').get() as { cnt: number }
  return row.cnt
}

export function recordArticleRead(
  id: number,
): { seen_at: string | null; read_at: string | null } | undefined {
  const row = getDb().transaction(() => {
    getDb().prepare(
      "UPDATE articles SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now')) WHERE id = ?",
    ).run(id)
    updateScoreDb(id)
    return getDb().prepare('SELECT seen_at, read_at FROM articles WHERE id = ?').get(id) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_unread: false }])
  return row ? { seen_at: row.seen_at, read_at: row.read_at } : undefined
}

export function insertArticle(data: {
  feed_id: number
  title: string
  url: string
  published_at: string | null
  lang?: string | null
  full_text?: string | null
  full_text_translated?: string | null
  translated_lang?: string | null
  summary?: string | null
  excerpt?: string | null
  og_image?: string | null
  last_error?: string | null
}): number {
  const info = runNamed(`
    INSERT INTO articles (feed_id, category_id, title, url, published_at, lang, full_text, full_text_translated, translated_lang, summary, excerpt, og_image, last_error)
    VALUES (@feed_id, (SELECT category_id FROM feeds WHERE id = @feed_id), @title, @url, @published_at, @lang, @full_text, @full_text_translated, @translated_lang, @summary, @excerpt, @og_image, @last_error)
  `, {
    feed_id: data.feed_id,
    title: data.title,
    url: data.url,
    published_at: data.published_at,
    lang: data.lang ?? null,
    full_text: data.full_text ?? null,
    full_text_translated: data.full_text_translated ?? null,
    translated_lang: data.translated_lang ?? null,
    summary: data.summary ?? null,
    excerpt: data.excerpt ?? null,
    og_image: data.og_image ?? null,
    last_error: data.last_error ?? null,
  })
  const articleId = info.lastInsertRowid as number
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
  return articleId
}

/**
 * Mark the refresh attempt timestamp without touching content or triggering
 * a Meilisearch resync. Used by the fetcher to record "we tried to repair
 * this stale article but couldn't improve it" so the backoff window kicks
 * in and we don't keep bypassing the RSS HTTP cache forever.
 */
export function markArticleRefreshAttempted(articleId: number, when: string): void {
  runNamed('UPDATE articles SET last_refresh_attempt_at = @when WHERE id = @id', { id: articleId, when })
}

/** Add a rule-driven score boost (may be negative) and refresh the score. */
export function addRuleBoost(articleId: number, delta: number): void {
  getDb().prepare('UPDATE articles SET rule_boost = rule_boost + ? WHERE id = ?').run(delta, articleId)
  updateScore(articleId)
}

/** Store the heuristic quality score (0..1) of an article. */
export function setArticleQuality(articleId: number, score: number): void {
  getDb().prepare('UPDATE articles SET quality_score = ? WHERE id = ?').run(score, articleId)
}

/** Store the interest-profile match of an article. */
export function setArticleInterestScore(articleId: number, score: number): void {
  getDb().prepare('UPDATE articles SET interest_score = ? WHERE id = ?').run(score, articleId)
}

export function updateArticleContent(
  articleId: number,
  data: {
    title?: string
    lang?: string | null
    full_text?: string | null
    full_text_translated?: string | null
    translated_lang?: string | null
    title_translated?: string | null
    translate_pending_at?: string | null
    summarize_pending_at?: string | null
    filter_pending_at?: string | null
    filtered_at?: string | null
    summary?: string | null
    excerpt?: string | null
    og_image?: string | null
    last_error?: string | null
    retry_count?: number
    last_retry_at?: string | null
    last_refresh_attempt_at?: string | null
  },
): void {
  const fields: string[] = []
  const params: Record<string, unknown> = { id: articleId }

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = @${key}`)
      params[key] = val
    }
  }
  if (fields.length === 0) return
  runNamed(`UPDATE articles SET ${fields.join(', ')} WHERE id = @id`, params)
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
}
