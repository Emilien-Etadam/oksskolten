import { getDb } from '../db/connection.js'
import type { ArticleListItem } from '../db/types.js'

export interface StorySource {
  feed_id: number
  feed_name: string
}

export interface Story {
  /** Leader article id, stable while the cluster keeps the same members */
  id: number
  leader: ArticleListItem
  /** Other coverage of the same event, newest first */
  others: ArticleListItem[]
  sources: StorySource[]
  unread_count: number
  latest_published_at: string | null
}

const DEFAULT_DAYS = 3
const MAX_DAYS = 14
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

interface StoryRow extends ArticleListItem {
  trust_score: number
}

function find(parent: Map<number, number>, x: number): number {
  let root = x
  while (parent.get(root) !== root) root = parent.get(root)!
  // Path compression
  let cur = x
  while (parent.get(cur) !== root) {
    const next = parent.get(cur)!
    parent.set(cur, root)
    cur = next
  }
  return root
}

function union(parent: Map<number, number>, a: number, b: number): void {
  const ra = find(parent, a)
  const rb = find(parent, b)
  if (ra !== rb) parent.set(ra, rb)
}

/**
 * Top stories: events covered by several sources in the recent window.
 *
 * Similarity pairs (see `server/similarity.ts`) are joined transitively into
 * clusters; a cluster needs at least two distinct feeds to count as a story.
 * Stories are ranked by breadth of coverage (distinct sources), then by the
 * trust of those sources and the leader's quality, then by recency.
 */
export function getTopStories(opts?: { days?: number; limit?: number }): Story[] {
  const days = Math.min(Math.max(opts?.days ?? DEFAULT_DAYS, 1), MAX_DAYS)
  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const db = getDb()

  const pairs = db.prepare(`
    SELECT s.article_id AS a, s.similar_to_id AS b
    FROM article_similarities s
    JOIN active_articles x ON x.id = s.article_id
    JOIN active_articles y ON y.id = s.similar_to_id
    WHERE s.article_id < s.similar_to_id
      AND x.filtered_at IS NULL AND y.filtered_at IS NULL
      AND COALESCE(x.published_at, x.fetched_at) >= datetime('now', '-${days} days')
      AND COALESCE(y.published_at, y.fetched_at) >= datetime('now', '-${days} days')
  `).all() as Array<{ a: number; b: number }>
  if (pairs.length === 0) return []

  const parent = new Map<number, number>()
  for (const { a, b } of pairs) {
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    union(parent, a, b)
  }
  const clusters = new Map<number, number[]>()
  for (const id of parent.keys()) {
    const root = find(parent, id)
    const members = clusters.get(root)
    if (members) members.push(id); else clusters.set(root, [id])
  }

  const ids = [...parent.keys()]
  const rows = new Map<number, StoryRow>()
  const CHUNK = 500
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const fetched = db.prepare(`
      SELECT a.id, a.feed_id, f.name AS feed_name, f.trust_score,
             a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
             a.seen_at, a.read_at, a.bookmarked_at, a.liked_at, a.score, a.quality_score, a.interest_score
      FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      WHERE a.id IN (${chunk.map(() => '?').join(',')})
    `).all(...chunk) as StoryRow[]
    for (const row of fetched) rows.set(row.id, row)
  }

  const stories: Array<Story & { rank: number }> = []
  for (const memberIds of clusters.values()) {
    const members = memberIds.map(id => rows.get(id)).filter((r): r is StoryRow => !!r)
    const sourcesById = new Map<number, StorySource>()
    for (const m of members) sourcesById.set(m.feed_id, { feed_id: m.feed_id, feed_name: m.feed_name })
    if (sourcesById.size < 2) continue

    // Leader: unread before read, an image before none, then the most
    // trusted source and the best quality, then the newest.
    const sorted = [...members].sort((a, b) =>
      Number(!b.seen_at) - Number(!a.seen_at)
      || Number(!!b.og_image) - Number(!!a.og_image)
      || (b.trust_score + (b.quality_score ?? 0.5)) - (a.trust_score + (a.quality_score ?? 0.5))
      || (b.published_at ?? '').localeCompare(a.published_at ?? ''),
    )
    const [leader, ...others] = sorted
    others.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    const latest = members.reduce<string | null>((max, m) => (m.published_at && (!max || m.published_at > max) ? m.published_at : max), null)
    const avgTrust = members.reduce((sum, m) => sum + m.trust_score, 0) / members.length
    const strip = ({ trust_score: _t, ...rest }: StoryRow): ArticleListItem => rest

    stories.push({
      id: leader.id,
      leader: strip(leader),
      others: others.map(strip),
      sources: [...sourcesById.values()].sort((a, b) => a.feed_name.localeCompare(b.feed_name)),
      unread_count: members.filter(m => !m.seen_at).length,
      latest_published_at: latest,
      rank: sourcesById.size * 10 + avgTrust * 3 + (leader.quality_score ?? 0.5),
    })
  }

  stories.sort((a, b) => b.rank - a.rank || (b.latest_published_at ?? '').localeCompare(a.latest_published_at ?? ''))
  return stories.slice(0, limit).map(({ rank: _rank, ...story }) => story)
}
