import { getDb } from '../connection.js'
import { deleteArticleFromSearch } from '../../search/sync.js'

/**
 * Articles of a feed whose images have not been archived yet, newest first.
 * Feeds the per-feed auto-archive sweep; imageless articles are included on
 * purpose — one archiving pass marks them archived and off the queue.
 */
export function getUnarchivedArticlesByFeed(
  feedId: number,
  limit: number,
): Array<{ id: number; full_text: string }> {
  return getDb().prepare(`
    SELECT id, full_text FROM active_articles
    WHERE feed_id = ? AND images_archived_at IS NULL
      AND full_text IS NOT NULL AND full_text != ''
    ORDER BY id DESC LIMIT ?
  `).all(feedId, limit) as Array<{ id: number; full_text: string }>
}

export interface ArticleWithLocalImages {
  id: number
  feed_id: number
  url: string
  full_text: string | null
  full_text_translated: string | null
  og_image: string | null
}

/**
 * Archived articles whose text points at a locally stored image, in id
 * order after `afterId`. Feeds the repair of archives whose files are gone.
 */
export function getArticlesWithLocalImages(afterId: number, limit: number): ArticleWithLocalImages[] {
  return getDb().prepare(`
    SELECT id, feed_id, url, full_text, full_text_translated, og_image FROM active_articles
    WHERE id > ? AND images_archived_at IS NOT NULL
      AND (full_text LIKE '%/api/articles/images/%' OR full_text_translated LIKE '%/api/articles/images/%')
    ORDER BY id LIMIT ?
  `).all(afterId, limit) as ArticleWithLocalImages[]
}

export function markImagesArchived(articleId: number): void {
  getDb().prepare("UPDATE articles SET images_archived_at = datetime('now') WHERE id = ?").run(articleId)
}

export function clearImagesArchived(articleId: number): void {
  getDb().prepare('UPDATE articles SET images_archived_at = NULL WHERE id = ?').run(articleId)
}

export function markVideosArchived(articleId: number): void {
  getDb().prepare("UPDATE articles SET videos_archived_at = datetime('now') WHERE id = ?").run(articleId)
}

export function clearVideosArchived(articleId: number): void {
  getDb().prepare('UPDATE articles SET videos_archived_at = NULL WHERE id = ?').run(articleId)
}

export function deleteArticle(id: number): boolean {
  const result = getDb().prepare('DELETE FROM articles WHERE id = ?').run(id)
  if (result.changes > 0) deleteArticleFromSearch(id)
  return result.changes > 0
}
