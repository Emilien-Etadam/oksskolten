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
 * Fetch a Reddit JSON document: direct request first, then FlareSolverr
 * (when configured) for IPs or user agents Reddit blocks.
 */
export async function fetchRedditJson(jsonUrl: string, requestLog: RedditLogger = log): Promise<RedditListing[] | null> {
  try {
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) return await res.json() as RedditListing[]
    requestLog.warn(`reddit responded ${res.status} for ${jsonUrl}, trying FlareSolverr`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    requestLog.warn(`reddit fetch failed (${msg}), trying FlareSolverr`)
  }

  const solved = await fetchViaFlareSolverr(jsonUrl)
  if (!solved) {
    requestLog.warn('FlareSolverr unavailable or failed for reddit request')
    return null
  }
  const parsed = parseJsonBody(solved.body)
  return Array.isArray(parsed) ? parsed as RedditListing[] : null
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
