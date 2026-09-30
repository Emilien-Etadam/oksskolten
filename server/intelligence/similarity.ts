import { meiliSearch } from '../search/client.js'
import { isSearchReady } from '../search/sync.js'
import { getArticlesByIds, markArticleSeen } from '../db.js'
import { getSetting, upsertSetting } from '../db/settings.js'
import { insertSimilarity, getFeedArticleIdsInWindow, getSimilarityPairs, deleteSimilarities } from './similarity-db.js'
import { STOPWORDS } from './stopwords.js'
import { logger } from '../logger.js'

const log = logger.child('similarity')

const SIMILARITY_THRESHOLD = 0.4
/**
 * Share of significant words two titles must also have in common (Dice over
 * their word sets). Character bigrams alone saturate on long titles: two
 * unrelated French sentences share "es", "de", "ou", "re"… and clear 0.4
 * without a single word in common.
 */
const WORD_OVERLAP_THRESHOLD = 0.5
/** Words are compared on their first letters, so "annonce" meets "annoncées". */
const STEM_LENGTH = 6
/** Scripts written without spaces, where a "word" would be a whole clause. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u
/** A year tells no story apart: "Best films of 2026", "Best games of 2026". */
const YEAR = /^(?:19|20)\d\d$/
const TIME_WINDOW_DAYS = 3
const MAX_CANDIDATES = 10
/** Cap on same-feed siblings read from the database (see below). */
const MAX_FEED_SIBLINGS = 200

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

const foldAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
const FOLDED_STOPWORDS = new Set([...STOPWORDS].map(foldAccents))

/**
 * The words of a title that can say what it is about: accents folded,
 * stopwords and years dropped, long words cut to their stem. Numbers stay
 * whatever their length: the "17" of "iPhone 17" is as telling as a word.
 */
function significantWords(title: string): Set<string> {
  const words = new Set<string>()
  for (const word of foldAccents(title).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue
    if (/^\p{N}+$/u.test(word)) {
      if (!YEAR.test(word)) words.add(word)
      continue
    }
    if (word.length < 2 || FOLDED_STOPWORDS.has(word)) continue
    words.add(word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word)
  }
  return words
}

/**
 * Dice coefficient over the titles' significant words, or null where words
 * cannot be compared: a script written without spaces, or a title made of
 * stopwords alone.
 */
export function computeWordOverlap(a: string, b: string): number | null {
  if (UNSPACED_SCRIPT.test(a) || UNSPACED_SCRIPT.test(b)) return null
  const wordsA = significantWords(a)
  const wordsB = significantWords(b)
  if (wordsA.size === 0 || wordsB.size === 0) return null

  let shared = 0
  for (const w of wordsA) if (wordsB.has(w)) shared++
  return (2 * shared) / (wordsA.size + wordsB.size)
}

function sharesEnoughWords(a: string, b: string): boolean {
  const overlap = computeWordOverlap(a, b)
  return overlap === null || overlap >= WORD_OVERLAP_THRESHOLD
}

/**
 * Whether two titles tell the same story: close in characters, and sharing
 * enough of their words wherever words can be compared.
 */
export function titlesMatch(a: string, b: string): boolean {
  return computeTitleSimilarity(a, b) >= SIMILARITY_THRESHOLD && sharesEnoughWords(a, b)
}

/** Bumped whenever titlesMatch changes, so links stored under the old rule are re-checked once. */
const RULE_VERSION = '2'
const RULE_VERSION_KEY = 'similarity.rule_version'

/**
 * Drop the stored links the current rule rejects, once per rule change.
 * Links made before titles had to share words join long unrelated titles,
 * and the "also covered by" banner keeps showing them until they are gone.
 * Returns the number of links removed.
 */
export function pruneStaleSimilarities(): number {
  if (getSetting(RULE_VERSION_KEY) === RULE_VERSION) return 0

  const stale: Array<[number, number]> = []
  const checked = new Set<string>()
  for (const pair of getSimilarityPairs()) {
    const low = Math.min(pair.article_id, pair.similar_to_id)
    const high = Math.max(pair.article_id, pair.similar_to_id)
    const key = `${low}:${high}`
    if (checked.has(key)) continue
    checked.add(key)
    if (!titlesMatch(pair.title, pair.similar_title)) stale.push([low, high])
  }

  deleteSimilarities(stale)
  upsertSetting(RULE_VERSION_KEY, RULE_VERSION)
  if (stale.length > 0) log.info(`Removed ${stale.length} similar-article links the current rule rejects`)
  return stale.length
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
    const candidateIds = new Set(hits
      .map((h) => h.id)
      .filter((id) => id !== articleId))

    // Meilisearch indexes asynchronously, so a crosspost and its original
    // inserted in the same fetch cycle never find each other there: each one
    // searches before the other is indexed. The database is already current,
    // so read the same-feed siblings from it. Only Reddit posts can match
    // within their own feed (see comparableWithinFeed), so only they pay for it.
    if (subredditOf(url)) {
      const since = new Date(refDate.getTime() - TIME_WINDOW_DAYS * 86_400_000).toISOString()
      const until = new Date(refDate.getTime() + TIME_WINDOW_DAYS * 86_400_000).toISOString()
      for (const id of getFeedArticleIdsInWindow(feedId, articleId, since, until, MAX_FEED_SIBLINGS)) {
        candidateIds.add(id)
      }
    }

    if (candidateIds.size === 0) return

    // Fetch candidate details to check feed_id and compute title similarity
    const candidates = getArticlesByIds([...candidateIds])

    let markedSeen = false

    for (const candidate of candidates) {
      // Skip same-feed articles, unless they are Reddit posts from different
      // subreddits — a crosspost and its original land in the same multi feed
      if (candidate.feed_id === feedId && !comparableWithinFeed(url, candidate.url)) continue

      const score = computeTitleSimilarity(title, candidate.title)
      if (score < SIMILARITY_THRESHOLD || !sharesEnoughWords(title, candidate.title)) continue

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
