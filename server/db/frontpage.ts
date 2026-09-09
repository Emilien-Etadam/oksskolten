import { getDb } from './connection.js'
import { getCategories } from './categories.js'
import type { ArticleListItem } from '../../shared/types.js'

export interface FrontPageSection {
  category: { id: number; name: string }
  articles: ArticleListItem[]
}

export interface FrontPageData {
  hero: ArticleListItem | null
  sections: FrontPageSection[]
}

const SECTION_LIMIT = 4

/**
 * Front page rank: engagement score, plus the trust of the source and the
 * article's heuristic quality so an unread article from a source the reader
 * values outranks a thin one from a source they never open.
 */
const RANK = '(a.score + f.trust_score * 2 + COALESCE(a.quality_score, 0.5))'

const SELECT_COLUMNS = `
  SELECT a.id, a.feed_id, f.name AS feed_name,
         a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
         a.score, a.quality_score, a.interest_score,
         (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
  FROM active_articles a
  JOIN feeds f ON a.feed_id = f.id`

/**
 * Newspaper front page: the highest-scored unread article (image-bearing
 * preferred) as hero, then the top unread articles of each category.
 * Categories without unread articles are omitted.
 */
export function getFrontPage(): FrontPageData {
  const db = getDb()

  const hero = db.prepare(`${SELECT_COLUMNS}
    WHERE a.seen_at IS NULL AND a.filtered_at IS NULL
    ORDER BY (a.og_image IS NOT NULL) DESC, ${RANK} DESC, a.published_at DESC
    LIMIT 1
  `).get() as ArticleListItem | undefined

  const sectionStmt = db.prepare(`${SELECT_COLUMNS}
    WHERE a.seen_at IS NULL AND a.filtered_at IS NULL AND f.category_id = ? AND a.id != ?
    ORDER BY ${RANK} DESC, a.published_at DESC
    LIMIT ${SECTION_LIMIT}
  `)

  const sections: FrontPageSection[] = []
  for (const category of getCategories()) {
    const articles = sectionStmt.all(category.id, hero?.id ?? -1) as ArticleListItem[]
    if (articles.length > 0) {
      sections.push({ category: { id: category.id, name: category.name }, articles })
    }
  }

  return { hero: hero ?? null, sections }
}
