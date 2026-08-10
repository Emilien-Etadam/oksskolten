import type { RssItem } from './rss.js'
import { safeFetch } from './ssrf.js'
import { USER_AGENT, PROBE_TIMEOUT } from './http.js'
import { normalizeDate } from './util.js'
import { logger } from '../logger.js'

const log = logger.child('social-search')

/**
 * Turn a social-network search into a feed.
 *
 * Bluesky exposes an unauthenticated search API but no RSS for it, so search
 * results are converted to feed items here. Mastodon already serves RSS for
 * hashtag timelines, so those only need a URL rewrite.
 */

/** Unauthenticated AppView — serves profiles and author feeds, but no longer search */
const BLUESKY_PUBLIC_APPVIEW = 'https://public.api.bsky.app'
const DEFAULT_BLUESKY_PDS = 'https://bsky.social'
const BLUESKY_SEARCH_LIMIT = 40
const SEARCH_TIMEOUT_MS = 10_000

/** createSession does not report a lifetime; re-authenticating is cheap. */
const SESSION_TTL_MS = 60 * 60_000
const AUTH_BACKOFF_MS = 10 * 60_000

/** Posts have no title, so one is derived from the opening line of the text. */
const TITLE_MAX_CHARS = 120

export interface BlueskySearchQuery {
  q: string
  sort: string | null
  lang: string | null
}

/**
 * Parse a Bluesky search URL as copied from the web app
 * (`https://bsky.app/search?q=...`), or null when it is not one.
 */
export function parseBlueskySearchUrl(url: string): BlueskySearchQuery | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.replace(/^www\./, '') !== 'bsky.app') return null
  if (parsed.pathname.replace(/\/+$/, '') !== '/search') return null

  const q = parsed.searchParams.get('q')?.trim()
  if (!q) return null

  return {
    q,
    sort: parsed.searchParams.get('sort'),
    lang: parsed.searchParams.get('lang'),
  }
}

export function isBlueskySearchUrl(url: string): boolean {
  return parseBlueskySearchUrl(url) !== null
}

interface BlueskyPost {
  uri?: unknown
  indexedAt?: unknown
  author?: { handle?: unknown }
  record?: { text?: unknown; createdAt?: unknown }
}

/** at://did:plc:xxx/app.bsky.feed.post/<rkey> → https://bsky.app/profile/<handle>/post/<rkey> */
function postUrl(post: BlueskyPost): string | null {
  const uri = typeof post.uri === 'string' ? post.uri : null
  const handle = typeof post.author?.handle === 'string' ? post.author.handle : null
  if (!uri || !handle) return null
  const rkey = uri.split('/').pop()
  return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null
}

function postTitle(text: string, handle: string): string {
  const firstLine = text.split('\n').map(line => line.trim()).find(Boolean)
  if (!firstLine) return `Post by @${handle}`
  if (firstLine.length <= TITLE_MAX_CHARS) return firstLine

  const truncated = firstLine.slice(0, TITLE_MAX_CHARS)
  const lastSpace = truncated.lastIndexOf(' ')
  const cut = lastSpace > TITLE_MAX_CHARS / 2 ? truncated.slice(0, lastSpace) : truncated
  return `${cut.trimEnd()}…`
}

function toRssItem(post: BlueskyPost): RssItem | null {
  const url = postUrl(post)
  if (!url) return null

  const handle = typeof post.author?.handle === 'string' ? post.author.handle : 'unknown'
  const text = typeof post.record?.text === 'string' ? post.record.text : ''
  const createdAt = typeof post.record?.createdAt === 'string' ? post.record.createdAt : null
  const indexedAt = typeof post.indexedAt === 'string' ? post.indexedAt : null

  return {
    title: postTitle(text, handle),
    url,
    published_at: normalizeDate(createdAt ?? indexedAt ?? ''),
    excerpt: text || undefined,
  }
}

interface BlueskySession {
  accessJwt: string
  pdsUrl: string
}

let cachedSession: { session: BlueskySession; expiresAt: number } | null = null
let authFailedAt = 0

/**
 * Log in with an app password (Settings → App Passwords on bsky.app). Bluesky
 * requires authentication for searchPosts, while profiles and author feeds stay
 * open on the public AppView. Returns null when no credentials are configured.
 */
async function getBlueskySession(): Promise<BlueskySession | null> {
  const identifier = process.env.BLUESKY_IDENTIFIER
  const password = process.env.BLUESKY_APP_PASSWORD
  if (!identifier || !password) return null

  if (cachedSession && Date.now() < cachedSession.expiresAt) return cachedSession.session
  if (Date.now() - authFailedAt < AUTH_BACKOFF_MS) return null

  const pdsUrl = process.env.BLUESKY_PDS_URL || DEFAULT_BLUESKY_PDS
  try {
    const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      log.warn(`Bluesky login failed: HTTP ${res.status}`)
      authFailedAt = Date.now()
      return null
    }
    const data = await res.json() as { accessJwt?: unknown }
    if (typeof data.accessJwt !== 'string') {
      authFailedAt = Date.now()
      return null
    }
    const session = { accessJwt: data.accessJwt, pdsUrl }
    cachedSession = { session, expiresAt: Date.now() + SESSION_TTL_MS }
    return session
  } catch (err) {
    log.warn(`Bluesky login failed: ${err instanceof Error ? err.message : String(err)}`)
    authFailedAt = Date.now()
    return null
  }
}

/** @internal test helper */
export function _resetBlueskySessionForTests(): void {
  cachedSession = null
  authFailedAt = 0
}

function searchRequest(host: string, query: BlueskySearchQuery, token: string | null): Promise<Response> {
  const endpoint = new URL(`${host}/xrpc/app.bsky.feed.searchPosts`)
  endpoint.searchParams.set('q', query.q)
  endpoint.searchParams.set('limit', String(BLUESKY_SEARCH_LIMIT))
  if (query.sort) endpoint.searchParams.set('sort', query.sort)
  if (query.lang) endpoint.searchParams.set('lang', query.lang)

  return fetch(endpoint, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
}

function toItems(data: { posts?: unknown }, query: BlueskySearchQuery): RssItem[] {
  const posts = Array.isArray(data.posts) ? data.posts as BlueskyPost[] : []
  const items = posts.map(toRssItem).filter((item): item is RssItem => item !== null)
  log.info(`Bluesky search "${query.q}": ${items.length} items`)
  return items
}

/**
 * Run a Bluesky search and return its posts as feed items. Uses the app-password
 * session when configured (searchPosts requires authentication), and otherwise
 * falls back to the public AppView.
 */
export async function fetchBlueskySearch(searchUrl: string): Promise<RssItem[]> {
  const query = parseBlueskySearchUrl(searchUrl)
  if (!query) return []

  const session = await getBlueskySession()
  if (session) {
    let res = await searchRequest(session.pdsUrl, query, session.accessJwt)
    if (res.status === 401) {
      // Access token expired — log in again once before giving up
      cachedSession = null
      const renewed = await getBlueskySession()
      if (renewed) res = await searchRequest(renewed.pdsUrl, query, renewed.accessJwt)
    }
    if (res.ok) return toItems(await res.json() as { posts?: unknown }, query)
    log.warn(`Bluesky authenticated search responded ${res.status}, falling back to the public AppView`)
  }

  const res = await searchRequest(BLUESKY_PUBLIC_APPVIEW, query, null)
  if (!res.ok) {
    // Bluesky restricts unauthenticated search — point at the way out
    if (res.status === 401 || res.status === 403) {
      throw new Error(`HTTP ${res.status} — Bluesky search requires BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD`)
    }
    throw new Error(`HTTP ${res.status}`)
  }
  return toItems(await res.json() as { posts?: unknown }, query)
}

/**
 * Candidate RSS URL for a Bluesky profile (`bsky.app/profile/<handle>`).
 * Unlike search, profile feeds are served anonymously.
 */
export function blueskyProfileRssCandidate(pageUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return null
  }
  if (parsed.hostname.replace(/^www\./, '') !== 'bsky.app') return null

  const match = parsed.pathname.match(/^\/profile\/([^/]+)(?:\/rss)?\/?$/)
  if (!match) return null
  return `https://bsky.app/profile/${match[1]}/rss`
}

/**
 * Candidate RSS URL for a Mastodon hashtag timeline (`/tags/<tag>`). Many
 * ordinary sites also use `/tags/<something>` paths, so the candidate must be
 * verified before it is trusted — see resolveMastodonTagFeed.
 */
export function mastodonTagRssCandidate(pageUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const match = parsed.pathname.match(/^\/tags\/([^/]+?)(?:\.rss)?\/?$/)
  if (!match) return null
  return `${parsed.origin}/tags/${match[1]}.rss`
}

/** Accept a candidate only when it really serves a feed. */
async function probeFeedUrl(candidate: string): Promise<string | null> {
  try {
    const res = await safeFetch(candidate, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    })
    if (!res.ok) return null
    const head = (await res.text()).slice(0, 2000)
    return /<(?:rss|feed)[\s>]/i.test(head) ? candidate : null
  } catch {
    return null
  }
}

/**
 * Resolve a Mastodon hashtag page to its native RSS feed, or null when the URL
 * is not a hashtag timeline that actually serves a feed.
 */
export async function resolveMastodonTagFeed(pageUrl: string): Promise<string | null> {
  const candidate = mastodonTagRssCandidate(pageUrl)
  return candidate ? probeFeedUrl(candidate) : null
}

/**
 * Feed URL for a social search, hashtag, or profile page, or null when the URL
 * is not one. Bluesky search URLs are returned unchanged — fetchAndParseRss
 * recognizes them and queries the API directly.
 */
export async function resolveSocialSearchFeed(pageUrl: string): Promise<string | null> {
  if (isBlueskySearchUrl(pageUrl)) return pageUrl

  const blueskyProfile = blueskyProfileRssCandidate(pageUrl)
  if (blueskyProfile) return probeFeedUrl(blueskyProfile)

  return resolveMastodonTagFeed(pageUrl)
}
