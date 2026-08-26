import { meiliSearch } from './search/client.js'
import { isSearchReady } from './search/sync.js'
import { getArticlesByIds, markArticleSeen } from './db.js'
import { insertSimilarity } from './db/similarities.js'
import { logger } from './logger.js'

const log = logger.child('similarity')

const SIMILARITY_THRESHOLD = 0.4
const TIME_WINDOW_DAYS = 3
const MAX_CANDIDATES = 10

/**
 * Compute bigram Dice coefficient between two strings.
 * Returns a value between 0 (no overlap) and 1 (identical bigrams).
 */
export function computeTitleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()

  const bigrams = (s: string): Set<string> => {
    const words = normalize(s).split(/\s+/)
    const set = new Set<string>()
    for (const w of words) {
      for (let i = 0; i < w.length - 1; i++) set.add(w.slice(i, i + 2))
    }
    return set
  }

  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const bg of setA) if (setB.has(bg)) intersection++

  return (2 * intersection) / (setA.size + setB.size)
}

/** Subreddit an article URL belongs to, or null when it is not a Reddit post. */
function subredditOf(url: string | undefined): string | null {
  if (!url) return null
  const m = /^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/([^/]+)\/comments\//i.exec(url)
  return m ? m[1].toLowerCase() : null
}

/**
 * Whether two articles of the same feed may still be compared.
 *
 * Same-feed candidates are normally skipped: within one blog, "Weekly digest
 * #12" and "#13" share almost every bigram without being the same story.
 * Aggregator feeds break that assumption — a Reddit multi carries a crosspost
 * and its original side by side, same title, same feed. Those are compared,
 * but only across subreddits, so a thread posted under the same title in the
 * same subreddit every day stays separate.
 */
function comparableWithinFeed(url: string | undefined, candidateUrl: string | undefined): boolean {
  const a = subredditOf(url)
  const b = subredditOf(candidateUrl)
  return a !== null && b !== null && a !== b
}

/**
 * Detect and store similar articles for a newly inserted article.
 * Runs asynchronously (fire-and-forget) after article insertion.
 */
export async function detectAndStoreSimilarArticles(
  articleId: number,
  title: string,
  feedId: number,
  publishedAt: string | null,
  url?: string,
): Promise<void> {
  try {
    if (!isSearchReady()) return

    // Build time window filter: ±3 days around published_at. Also let through
    // candidates with no published_at at all — buildMeiliDoc() indexes those
    // as 0 (1970), which would otherwise never fall inside a real ±3-day
    // window and silently block undated articles from ever being matched.
    const refDate = publishedAt ? new Date(publishedAt) : new Date()
    const sinceTs = Math.floor((refDate.getTime() - TIME_WINDOW_DAYS * 86_400_000) / 1000)
    const untilTs = Math.floor((refDate.getTime() + TIME_WINDOW_DAYS * 86_400_000) / 1000)
    const filter = `(published_at >= ${sinceTs} AND published_at <= ${untilTs}) OR published_at = 0`

    const { hits } = await meiliSearch(title, {
      limit: MAX_CANDIDATES + 1,
      filter,
    })

    // Exclude self and same-feed articles
    const candidateIds = hits
      .map((h) => h.id)
      .filter((id) => id !== articleId)

    if (candidateIds.length === 0) return

    // Fetch candidate details to check feed_id and compute title similarity
    const candidates = getArticlesByIds(candidateIds)

    let markedSeen = false

    for (const candidate of candidates) {
      // Skip same-feed articles, unless they are Reddit posts from different
      // subreddits — a crosspost and its original land in the same multi feed
      if (candidate.feed_id === feedId && !comparableWithinFeed(url, candidate.url)) continue

      const score = computeTitleSimilarity(title, candidate.title)
      if (score < SIMILARITY_THRESHOLD) continue

      insertSimilarity(articleId, candidate.id, score)

      // Auto-mark-read: if similar article was read, mark new article as seen
      if (!markedSeen && candidate.read_at) {
        markArticleSeen(articleId, true)
        markedSeen = true
        log.info(`Auto-marked article ${articleId} as seen (similar to read article ${candidate.id})`)
      }
    }
  } catch (err) {
    // Non-critical: log and move on
    log.warn(`Similarity detection failed for article ${articleId}: ${err instanceof Error ? err.message : err}`)
  }
}
