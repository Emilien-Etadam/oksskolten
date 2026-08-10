import { USER_AGENT } from './http.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { markdownToExcerpt } from './markdown-utils.js'
import { logger } from '../logger.js'

const log = logger.child('reddit')

const FETCH_TIMEOUT_MS = 10_000

/** Minimal logger surface accepted by the fetch helpers (module or request logger). */
export interface RedditLogger {
  warn: (msg: string) => void
}

export interface RedditListing {
  data?: { children?: unknown[] }
}

/**
 * Map a Reddit post URL to its public JSON endpoint, or null when the
 * article is not a Reddit post.
 */
export function redditJsonUrl(articleUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(articleUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^(www|old|new)\./, '')
  if (host !== 'reddit.com') return null
  if (!/^\/r\/[^/]+\/comments\//.test(parsed.pathname)) return null
  const path = parsed.pathname.replace(/\/+$/, '')
  return `https://www.reddit.com${path}.json?raw_json=1&sort=top&limit=50&depth=2`
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Parse a JSON body, unwrapping Chromium's <pre> JSON viewer when needed. */
function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch { /* possibly wrapped in an HTML viewer by a headless browser */ }
  const match = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  if (!match) return null
  try {
    return JSON.parse(decodeHtmlEntities(match[1]))
  } catch {
    return null
  }
}

/**
 * Reddit rejects bot-looking user agents on its .json endpoints with 403
 * (while accepting them on .rss), so retries escalate to a browser UA.
 */
const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'

/** Descriptive UA required by Reddit's API guidelines for OAuth clients */
const OAUTH_USER_AGENT = 'web:oksskolten:v0.5 (self-hosted RSS reader)'

let cachedOauthToken: { token: string; expiresAt: number } | null = null

/**
 * Application-only OAuth token (client_credentials) when REDDIT_CLIENT_ID /
 * REDDIT_CLIENT_SECRET are configured. oauth.reddit.com is the official API
 * host and is not subject to the anonymous-endpoint IP blocks.
 */
async function getOauthToken(requestLog: RedditLogger): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  if (cachedOauthToken && Date.now() < cachedOauthToken.expiresAt - 60_000) {
    return cachedOauthToken.token
  }

  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': OAUTH_USER_AGENT,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      requestLog.warn(`reddit oauth token request failed: ${res.status}`)
      return null
    }
    const data = await res.json() as { access_token?: string; expires_in?: number }
    if (!data.access_token) return null
    cachedOauthToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    }
    return data.access_token
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    requestLog.warn(`reddit oauth token request failed: ${msg}`)
    return null
  }
}

/** @internal test helper */
export function _resetRedditOauthForTests(): void {
  cachedOauthToken = null
}

/**
 * Fetch a Reddit JSON document. Attempt ladder: default UA, then a browser
 * UA, then old.reddit.com, then FlareSolverr (when configured) for IPs
 * Reddit blocks outright.
 */
export async function fetchRedditJson(jsonUrl: string, requestLog: RedditLogger = log): Promise<RedditListing[] | null> {
  // Preferred path: the official OAuth API when credentials are configured
  const token = await getOauthToken(requestLog)
  if (token) {
    try {
      const oauthUrl = jsonUrl.replace('https://www.reddit.com/', 'https://oauth.reddit.com/')
      const res = await fetch(oauthUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': OAUTH_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) return await res.json() as RedditListing[]
      requestLog.warn(`reddit oauth responded ${res.status} for ${oauthUrl}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      requestLog.warn(`reddit oauth fetch failed: ${msg}`)
    }
  }

  const attempts = [
    { url: jsonUrl, ua: USER_AGENT, label: 'default UA' },
    { url: jsonUrl, ua: BROWSER_USER_AGENT, label: 'browser UA' },
    { url: jsonUrl.replace('https://www.reddit.com/', 'https://old.reddit.com/'), ua: BROWSER_USER_AGENT, label: 'old.reddit.com' },
  ]

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: { 'User-Agent': attempt.ua, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) return await res.json() as RedditListing[]
      requestLog.warn(`reddit responded ${res.status} (${attempt.label}) for ${attempt.url}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      requestLog.warn(`reddit fetch failed (${attempt.label}): ${msg}`)
    }
  }

  const solved = await fetchViaFlareSolverr(jsonUrl)
  if (!solved) {
    requestLog.warn('FlareSolverr unavailable or failed for reddit request')
    return null
  }
  const parsed = parseJsonBody(solved.body)
  if (!Array.isArray(parsed)) {
    requestLog.warn(`solver returned a body for ${jsonUrl} but no JSON listing could be extracted (${solved.body.length} bytes, content-type: ${solved.contentType || 'unknown'})`)
    return null
  }
  return parsed as RedditListing[]
}

export interface RedditPostContent {
  fullText: string
  title: string | null
  ogImage: string | null
  excerpt: string | null
}

interface RedditPostData {
  title?: unknown
  selftext?: unknown
  subreddit_name_prefixed?: unknown
  crosspost_parent_list?: unknown
  preview?: { images?: Array<{ source?: { url?: unknown } }> }
}

function postSelftext(post: RedditPostData): string {
  return typeof post.selftext === 'string' ? post.selftext.trim() : ''
}

/**
 * Build article content for a Reddit post from its public JSON: the selftext
 * is already Markdown, and crossposts carry their embedded parent's selftext
 * (which HTML extraction cannot see reliably). Returns null for non-reddit
 * URLs, link posts without text, or when Reddit is unreachable — callers
 * fall back to the regular HTML extraction pipeline.
 */
export async function fetchRedditPostContent(articleUrl: string): Promise<RedditPostContent | null> {
  const jsonUrl = redditJsonUrl(articleUrl)
  if (!jsonUrl) return null

  const payload = await fetchRedditJson(jsonUrl)
  const post = (payload?.[0]?.data?.children?.[0] as { data?: RedditPostData } | undefined)?.data
  if (!post) return null

  let markdown = postSelftext(post)

  // Crosspost: the outer post has no text of its own — use the embedded parent
  if (!markdown && Array.isArray(post.crosspost_parent_list)) {
    const parent = post.crosspost_parent_list[0] as RedditPostData | undefined
    if (parent) {
      const parentText = postSelftext(parent)
      if (parentText) {
        const from = typeof parent.subreddit_name_prefixed === 'string' ? parent.subreddit_name_prefixed : 'reddit'
        markdown = `> Crossposted from ${from}\n\n${parentText}`
      }
    }
  }

  if (!markdown) return null

  const previewUrl = post.preview?.images?.[0]?.source?.url
  return {
    fullText: markdown,
    title: typeof post.title === 'string' ? post.title : null,
    ogImage: typeof previewUrl === 'string' ? decodeHtmlEntities(previewUrl) : null,
    excerpt: markdownToExcerpt(markdown),
  }
}
