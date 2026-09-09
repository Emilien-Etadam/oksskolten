import { getDb, runNamed, getNamed, allNamed } from '../db/connection.js'
import type { ArticleListItem } from '../db/types.js'
import { parseSmartQuery, smartQuerySince, type SmartQuery } from '../../shared/smart-query.js'

export interface SmartFolder {
  id: number
  name: string
  query: string
  sort_order: number
  created_at: string
}

export interface SmartFolderWithCount extends SmartFolder {
  /** Unread matches; null when the query has free text (needs the search index) */
  unread_count: number | null
}

export function getSmartFolders(): SmartFolderWithCount[] {
  const folders = getDb()
    .prepare('SELECT * FROM smart_folders ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
    .all() as SmartFolder[]
  return folders.map(folder => ({ ...folder, unread_count: countSmartFolderUnread(folder.query) }))
}

export function getSmartFolderById(id: number): SmartFolder | undefined {
  return getDb().prepare('SELECT * FROM smart_folders WHERE id = ?').get(id) as SmartFolder | undefined
}

export function createSmartFolder(name: string, query: string): SmartFolder {
  const next = getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM smart_folders').get() as { next: number }
  const info = getDb().prepare('INSERT INTO smart_folders (name, query, sort_order) VALUES (?, ?, ?)').run(name, query, next.next)
  return getSmartFolderById(info.lastInsertRowid as number)!
}

export function updateSmartFolder(
  id: number,
  data: { name?: string; query?: string; sort_order?: number },
): SmartFolder | undefined {
  const existing = getSmartFolderById(id)
  if (!existing) return undefined
  const fields: string[] = []
  const params: Record<string, unknown> = { id }
  if (data.name !== undefined) { fields.push('name = @name'); params.name = data.name }
  if (data.query !== undefined) { fields.push('query = @query'); params.query = data.query }
  if (data.sort_order !== undefined) { fields.push('sort_order = @sort_order'); params.sort_order = data.sort_order }
  if (fields.length === 0) return existing
  runNamed(`UPDATE smart_folders SET ${fields.join(', ')} WHERE id = @id`, params)
  return getSmartFolderById(id)
}

export function deleteSmartFolder(id: number): boolean {
  return getDb().prepare('DELETE FROM smart_folders WHERE id = ?').run(id).changes > 0
}

// --- Query execution ---

function buildConditions(query: SmartQuery, opts?: { likeText?: boolean }): { where: string; params: Record<string, unknown> } {
  const conditions: string[] = ['a.filtered_at IS NULL']
  const params: Record<string, unknown> = {}
  if (query.unread !== undefined) conditions.push(query.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  if (query.bookmarked) conditions.push('a.bookmarked_at IS NOT NULL')
  if (query.liked) conditions.push('a.liked_at IS NOT NULL')
  if (query.feedId) { conditions.push('a.feed_id = @feedId'); params.feedId = query.feedId }
  if (query.categoryId) { conditions.push('a.category_id = @categoryId'); params.categoryId = query.categoryId }
  const since = smartQuerySince(query)
  if (since) { conditions.push('COALESCE(a.published_at, a.fetched_at) >= @since'); params.since = since }
  if (opts?.likeText && query.text) {
    // Every word must appear in the title or body (case-insensitive LIKE);
    // the fallback path when the search index is unavailable.
    query.text.split(/\s+/).filter(Boolean).forEach((word, i) => {
      conditions.push(`(a.title LIKE @word${i} OR a.title_translated LIKE @word${i} OR a.full_text LIKE @word${i})`)
      params[`word${i}`] = `%${word}%`
    })
  }
  return { where: 'WHERE ' + conditions.join(' AND '), params }
}

/**
 * Unread articles matching a smart folder, for the sidebar badge. Queries
 * with free text return null: their matches come from the search index and
 * counting them per sidebar render would be too costly on large archives.
 */
export function countSmartFolderUnread(rawQuery: string): number | null {
  const query = parseSmartQuery(rawQuery)
  if (query.text) return null
  const { where, params } = buildConditions({ ...query, unread: true })
  return getNamed<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM active_articles a ${where}`, params).cnt
}

const SELECT_COLUMNS = `
  SELECT a.id, a.feed_id, f.name AS feed_name,
         a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
         a.seen_at, a.read_at, a.bookmarked_at, a.liked_at, a.score,
         (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count,
         (SELECT GROUP_CONCAT(similar_to_id) FROM article_similarities WHERE article_id = a.id) AS similar_ids
  FROM active_articles a
  JOIN feeds f ON a.feed_id = f.id`

/**
 * Run a smart folder query in SQL. Free text falls back to LIKE matching;
 * the route prefers the search index for that part when it is available
 * and passes the resulting ids through `restrictToIds`.
 */
export function getSmartFolderArticles(
  query: SmartQuery,
  opts: { limit: number; offset: number; restrictToIds?: number[] },
): { articles: ArticleListItem[]; total: number } {
  const restrict = opts.restrictToIds
  const { where, params } = buildConditions(query, { likeText: restrict === undefined })
  let fullWhere = where
  if (restrict !== undefined) {
    if (restrict.length === 0) return { articles: [], total: 0 }
    fullWhere += ` AND a.id IN (${restrict.map(id => Number(id)).join(',')})`
  }
  const orderBy = restrict !== undefined && query.sort !== 'date' && query.sort !== 'score'
    ? `CASE a.id ${restrict.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ')} END`
    : query.sort === 'score'
      ? 'a.score DESC, a.published_at DESC'
      : 'a.published_at DESC'

  const total = getNamed<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM active_articles a ${fullWhere}`, params).cnt
  const articles = allNamed<ArticleListItem>(`
    ${SELECT_COLUMNS}
    ${fullWhere}
    ORDER BY ${orderBy}
    LIMIT @_limit OFFSET @_offset
  `, { ...params, _limit: Number(opts.limit), _offset: Number(opts.offset) })
  return { articles, total }
}
