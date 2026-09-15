import { JSDOM } from 'jsdom'
import type { RssItem } from '../../fetcher/rss/types.js'
import { fetchHtml } from '../../fetcher/http.js'
import { logger } from '../../logger.js'

const log = logger.child('github-trending')

/**
 * Turn the GitHub Trending page into a feed.
 *
 * GitHub publishes no feed for it — no Atom endpoint, no API — so the page
 * itself is the source: one `<article class="Box-row">` per repository, in
 * rank order. Pasting a trending URL into "add feed" would otherwise fall
 * through discovery to the LLM selector bridge, which costs a model call to
 * rediscover markup that is stable and known here.
 */

export const TRENDING_PERIODS = ['daily', 'weekly', 'monthly'] as const

export type TrendingPeriod = (typeof TRENDING_PERIODS)[number]

/** What GitHub itself falls back to when `since` is absent or unknown. */
const DEFAULT_PERIOD: TrendingPeriod = 'daily'

const PERIOD_LABELS: Record<TrendingPeriod, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
}

export interface GithubTrendingQuery {
  /**
   * Programming-language segment of the path, kept percent-encoded as GitHub
   * writes it (`c%2B%2B`), so the canonical URL round-trips. Null spans every
   * language.
   */
  language: string | null
  since: TrendingPeriod
  /** `spoken_language_code` filter (`fr`, `ja`, …), null when unfiltered. */
  spokenLanguage: string | null
}

/**
 * Parse a GitHub Trending URL, or return null when it is not one.
 *
 * `/trending/developers` lists people, not repositories, and its rows carry
 * different markup — it is not a repository feed and is rejected here.
 */
export function parseGithubTrendingUrl(url: string): GithubTrendingQuery | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.replace(/^www\./, '') !== 'github.com') return null

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segments[0] !== 'trending') return null
  if (segments.length > 2) return null

  const language = segments[1] ?? null
  if (language !== null && (language === '' || language.toLowerCase() === 'developers')) return null

  const since = parsed.searchParams.get('since')
  const spokenLanguage = parsed.searchParams.get('spoken_language_code')?.trim() || null

  return {
    language,
    since: TRENDING_PERIODS.includes(since as TrendingPeriod) ? (since as TrendingPeriod) : DEFAULT_PERIOD,
    spokenLanguage,
  }
}

export function isGithubTrendingUrl(url: string): boolean {
  return parseGithubTrendingUrl(url) !== null
}

/**
 * Canonical feed URL for a trending query. `since` is always spelled out, so
 * the same board cannot be subscribed to twice under `/trending` and
 * `/trending?since=daily`, and the stored URL stays a page a reader can open.
 */
export function githubTrendingFeedUrl(query: GithubTrendingQuery): string {
  const path = query.language ? `/trending/${query.language}` : '/trending'
  const params = new URLSearchParams({ since: query.since })
  if (query.spokenLanguage) params.set('spoken_language_code', query.spokenLanguage)
  return `https://github.com${path}?${params.toString()}`
}

export interface GithubTrendingFeed {
  feedUrl: string
  title: string
}

/** Resolve a pasted URL to a trending feed, or null when it is not one. */
export function resolveGithubTrendingFeed(url: string): GithubTrendingFeed | null {
  const query = parseGithubTrendingUrl(url)
  if (!query) return null

  const scope = [
    query.language ? decodeURIComponent(query.language) : null,
    query.spokenLanguage,
    PERIOD_LABELS[query.since],
  ].filter(Boolean)

  return { feedUrl: githubTrendingFeedUrl(query), title: `GitHub Trending (${scope.join(', ')})` }
}

function text(node: Element | null): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

/**
 * Read one trending row. Returns null for anything that is not a repository
 * row — the heading link is what identifies one.
 */
function rowItem(row: Element): { title: string; url: string; excerpt?: string } | null {
  const href = row.querySelector('h2 a[href]')?.getAttribute('href')
  if (!href) return null

  // "/owner/repo" and nothing else: the row's other links (stargazers, forks,
  // contributor avatars) live deeper in the path.
  const match = href.match(/^\/([^/\s]+)\/([^/\s]+)\/?$/)
  if (!match) return null
  const nameWithOwner = `${match[1]}/${match[2]}`

  const description = text(row.querySelector('p'))
  const language = text(row.querySelector('[itemprop="programmingLanguage"]'))
  // "1,234 stars this week" — the period's own count, next to the totals.
  const gained = text(row.querySelector('.float-sm-right'))

  const meta = [language, gained].filter(Boolean).join(' · ')
  const excerpt = [description, meta].filter(Boolean).join(' — ')

  return {
    title: nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    ...(excerpt ? { excerpt } : {}),
  }
}

/**
 * Fetch a trending board and return its repositories in rank order.
 *
 * The page carries no dates, so items are stamped a second apart from the
 * fetch — the same pseudo-dating the CSS-selector bridge uses to keep DOM
 * order in the reader. A repository that trends again is not re-stamped:
 * ingestion dedupes on URL, so each repository is one article, dated the
 * first time it showed up.
 */
export async function fetchGithubTrending(feedUrl: string): Promise<RssItem[]> {
  const query = parseGithubTrendingUrl(feedUrl)
  if (!query) throw new Error(`Not a GitHub trending URL: ${feedUrl}`)

  const { html } = await fetchHtml(githubTrendingFeedUrl(query))
  const doc = new JSDOM(html).window.document

  const rows = [...doc.querySelectorAll('article.Box-row')]
  if (rows.length === 0) {
    // GitHub answers a filter that matches nothing with a blankslate panel.
    // Anything else means the markup moved and the selectors need revisiting
    // — worth an error on the feed rather than a silently empty one.
    if (doc.querySelector('.blankslate')) {
      log.info(`${feedUrl}: no trending repositories for this filter`)
      return []
    }
    throw new Error('No trending repositories found — GitHub markup may have changed')
  }

  const now = Date.now()
  const items: RssItem[] = []
  for (const row of rows) {
    const item = rowItem(row)
    if (!item) continue
    // Space items a second apart so rank order survives in the reader.
    items.push({ ...item, published_at: new Date(now - items.length * 1_000).toISOString() })
  }

  log.info(`${feedUrl}: ${items.length} repositories`)
  return items
}
