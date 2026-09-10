import { createHash } from 'node:crypto'
import type { Feed } from '../../db.js'
import { decodeResponse, USER_AGENT, DEFAULT_TIMEOUT, DISCOVERY_TIMEOUT } from '../http.js'
import { safeFetch } from '../ssrf.js'
import { fetchViaFlareSolverr } from '../flaresolverr.js'
import { parseHttpCacheInterval, parseRssTtl } from '../schedule.js'
import {
  isCssSelectorBridgeUrl,
  stripCustomBridgeParams,
  fetchCssSelectorViaFlareSolverr,
  assignCssBridgePseudoDates,
  fixGenericTitlesAndEnrichExcerpts,
} from '../css-bridge.js'
// Ingestion depends on source definitions, never on routes. Importing from
// feeds/index.js would cycle: rss.ts → feeds/index → feeds/routes → fetcher.js → ingest → rss.ts.
import { isBlueskyApiUrl, isBlueskyFeedUrl, fetchBlueskySearch, fetchBlueskyFeed } from '../../feeds/sources/social-search.js'
import { isGithubStarsUrl, fetchGithubStarredReleases } from '../../feeds/sources/github-releases.js'
import { type FetchRssResult, type RssItem, RateLimitError } from './types.js'
import { cleanItems, parseRssXml } from './parse.js'

function throwIfRateLimited(res: Response): void {
  if (res.status === 429 || res.status === 503) {
    throw new RateLimitError(res.status, res.headers.get('retry-after'))
  }
}

const RSS_BRIDGE_URL = process.env.RSS_BRIDGE_URL

/**
 * Decode HTML entities in a string.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/**
 * Extract usable RSS/Atom XML from a FlareSolverr response body.
 * FlareSolverr returns Chromium-rendered content which may be:
 *   1. Raw XML (if extractXmlFromBrowserViewer succeeded in flaresolverr.ts)
 *   2. Chromium HTML with HTML-encoded XML entities (&lt;rss&gt; etc.)
 *   3. Chromium HTML wrapping raw XML in <pre> tags
 *   4. Unrelated HTML (e.g. a redirect to a non-feed page)
 */
function extractRssFromFlareSolverr(body: string): string {
  // Case 1: already raw XML
  if (/^\s*<(\?xml|rss|feed)\b/.test(body)) return body

  // Case 2: HTML-encoded XML — decode and extract just the RSS/Atom root element
  if (body.includes('&lt;rss') || body.includes('&lt;feed') || body.includes('&lt;?xml')) {
    const decoded = decodeHtmlEntities(body)
    return extractXmlRoot(decoded) || decoded
  }

  // Case 3: Chromium might wrap raw XML in <body><pre>...</pre>
  const preMatch = body.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
  if (preMatch) {
    const inner = decodeHtmlEntities(preMatch[1])
    if (/^\s*<(\?xml|rss|feed)\b/.test(inner)) {
      return extractXmlRoot(inner) || inner
    }
  }

  // Case 4: body contains raw <rss> or <feed> embedded in HTML
  const xmlRoot = extractXmlRoot(body)
  if (xmlRoot) return xmlRoot

  return body
}

/**
 * Extract the RSS/Atom root element from a string that may contain surrounding HTML.
 * Returns the matched XML string or null.
 */
function extractXmlRoot(s: string): string | null {
  // Try <?xml...?> preamble + RSS/Atom
  const xmlDeclMatch = s.match(/<\?xml[\s\S]*?<\/(?:rss|feed)>/)
  if (xmlDeclMatch) return xmlDeclMatch[0]

  // Try <rss ...>...</rss>
  const rssMatch = s.match(/<rss[\s>][\s\S]*<\/rss>/)
  if (rssMatch) return rssMatch[0]

  // Try <feed ...>...</feed> (Atom)
  const feedMatch = s.match(/<feed[\s>][\s\S]*<\/feed>/)
  if (feedMatch) return feedMatch[0]

  return null
}

export async function fetchAndParseRss(feed: Feed, opts?: { skipCache?: boolean }): Promise<FetchRssResult> {
  const skipCache = opts?.skipCache ?? false
  const rssUrl = feed.rss_url || feed.rss_bridge_url
  if (!rssUrl) throw new Error('No RSS URL')

  // Bluesky searches and custom feeds, and GitHub stars, have no RSS endpoint
  // — query the API
  if (isBlueskyApiUrl(rssUrl) || isGithubStarsUrl(rssUrl)) {
    const items = isGithubStarsUrl(rssUrl)
      ? await fetchGithubStarredReleases(rssUrl)
      : isBlueskyFeedUrl(rssUrl)
        ? await fetchBlueskyFeed(rssUrl)
        : await fetchBlueskySearch(rssUrl)
    return {
      items: cleanItems(items),
      notModified: false,
      etag: null,
      lastModified: null,
      contentHash: null,
      httpCacheSeconds: null,
      rssTtlSeconds: null,
    }
  }

  const isCssBridge = isCssSelectorBridgeUrl(rssUrl)

  let xml: string
  let responseEtag: string | null = null
  let responseLastModified: string | null = null
  let responseHeaders: Headers | null = null

  if (feed.requires_js_challenge) {
    // Site requires JS challenge — go straight to FlareSolverr (no conditional request support)
    const flare = await fetchViaFlareSolverr(rssUrl)
    if (!flare) throw new Error('FlareSolverr failed')
    xml = extractRssFromFlareSolverr(flare.body)
  } else {
    const isRssBridgeUrl = RSS_BRIDGE_URL && rssUrl.startsWith(RSS_BRIDGE_URL)
    if (isRssBridgeUrl) {
      // RSS Bridge internal URL: use plain fetch (no SSRF check needed)
      // Strip title_selector/content_selector — these are used by our own code,
      // not recognized by RSS-Bridge's CssSelectorBridge.
      const bridgeFetchUrl = isCssBridge ? stripCustomBridgeParams(rssUrl) : rssUrl
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
      if (!skipCache && feed.etag) headers['If-None-Match'] = feed.etag
      if (!skipCache && feed.last_modified) headers['If-Modified-Since'] = feed.last_modified

      const res = await fetch(bridgeFetchUrl, {
        headers,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
      })

      if (res.status === 304) {
        return { items: [], notModified: true, etag: feed.etag, lastModified: feed.last_modified, contentHash: feed.last_content_hash, httpCacheSeconds: null, rssTtlSeconds: null }
      }

      responseEtag = res.headers.get('etag')
      responseLastModified = res.headers.get('last-modified')
      responseHeaders = res.headers

      if (!res.ok) {
        throwIfRateLimited(res)
        if (isCssBridge) {
          const items = cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl))
          return { items, notModified: false, etag: responseEtag, lastModified: responseLastModified, contentHash: null, httpCacheSeconds: null, rssTtlSeconds: null }
        }
        const flare = await fetchViaFlareSolverr(rssUrl)
        if (!flare) throw new Error(`HTTP ${res.status}`)
        xml = extractRssFromFlareSolverr(flare.body)
      } else {
        xml = await decodeResponse(res)
      }
    } else {
      // External URL: use safeFetch with conditional headers
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
      if (!skipCache && feed.etag) headers['If-None-Match'] = feed.etag
      if (!skipCache && feed.last_modified) headers['If-Modified-Since'] = feed.last_modified

      try {
        const res = await safeFetch(rssUrl, {
          headers,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        })

        if (res.status === 304) {
          return { items: [], notModified: true, etag: feed.etag, lastModified: feed.last_modified, contentHash: feed.last_content_hash, httpCacheSeconds: null, rssTtlSeconds: null }
        }

        responseEtag = res.headers.get('etag')
        responseLastModified = res.headers.get('last-modified')
        responseHeaders = res.headers

        if (!res.ok) {
          throwIfRateLimited(res)
          // Non-200: try FlareSolverr fallback (no conditional request support)
          const flare = await fetchViaFlareSolverr(rssUrl)
          if (!flare) throw new Error(`HTTP ${res.status}`)
          xml = extractRssFromFlareSolverr(flare.body)
        } else {
          xml = await decodeResponse(res)
        }
      } catch (err) {
        if (isCssBridge) {
          const items = cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl))
          return { items, notModified: false, etag: null, lastModified: null, contentHash: null, httpCacheSeconds: null, rssTtlSeconds: null }
        }
        // Network-level failure (ECONNRESET, DNS, timeout, etc.) — try FlareSolverr
        const flare = await fetchViaFlareSolverr(rssUrl)
        if (!flare) throw err
        xml = extractRssFromFlareSolverr(flare.body)
      }
    }
  }

  // Content hash check: skip parsing if body is identical to last fetch
  const contentHash = createHash('sha256').update(xml).digest('hex')
  const httpCacheSeconds = responseHeaders ? parseHttpCacheInterval(responseHeaders) : null
  const rssTtlSeconds = parseRssTtl(xml)

  if (!skipCache && feed.last_content_hash && feed.last_content_hash === contentHash) {
    return { items: [], notModified: true, etag: responseEtag, lastModified: responseLastModified, contentHash, httpCacheSeconds, rssTtlSeconds }
  }

  const result = { notModified: false as const, etag: responseEtag, lastModified: responseLastModified, contentHash, httpCacheSeconds, rssTtlSeconds }

  // Parse XML and collect items — wrapped in try/catch for Fallback C
  let items: RssItem[]
  try {
    items = await parseRssXml(xml)
  } catch (err) {
    // Fallback C: CssSelectorBridge parse failure → FlareSolverr direct scrape
    if (isCssBridge) {
      return { ...result, items: cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl)) }
    }
    throw err
  }

  // Fallback B: CssSelectorBridge returned 0 items → FlareSolverr direct scrape
  if (items.length === 0 && isCssBridge) {
    return { ...result, items: cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl)) }
  }

  if (!isCssBridge) return { ...result, items: cleanItems(items) }

  // CssSelectorBridge: fix generic titles + enrich excerpts, then assign pseudo dates
  items = await fixGenericTitlesAndEnrichExcerpts(items, rssUrl)
  return { ...result, items: cleanItems(assignCssBridgePseudoDates(items, rssUrl)) }
}
