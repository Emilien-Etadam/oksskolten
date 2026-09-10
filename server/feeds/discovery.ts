import { JSDOM } from 'jsdom'
import { fetchHtml, USER_AGENT, DISCOVERY_TIMEOUT, PROBE_TIMEOUT } from '../fetcher/http.js'
import { fetchViaFlareSolverr } from '../fetcher/flaresolverr.js'
import { parseRssXml } from '../fetcher/rss/parse.js'

async function fetchFeedTitle(rssUrl: string): Promise<string | null> {
  try {
    const { html: xml } = await fetchHtml(rssUrl, { timeout: DISCOVERY_TIMEOUT })

    // Try feedsmith
    try {
      const { parseFeed } = await import('feedsmith')
      const parsed = parseFeed(xml) as Record<string, unknown>
      const feed = parsed.feed as Record<string, unknown> | undefined
      const title = parsed.title ?? feed?.title
      if (title && typeof title === 'string') return title
    } catch {
      // feedsmith failed, fall through
    }

    // Fallback: fast-xml-parser
    const { XMLParser } = await import('fast-xml-parser')
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const doc = parser.parse(xml)

    const rssTitle = doc?.rss?.channel?.title
    if (rssTitle && typeof rssTitle === 'string') return rssTitle

    const atomTitle = doc?.feed?.title
    if (atomTitle && typeof atomTitle === 'string') return atomTitle

    return null
  } catch {
    return null
  }
}

export interface DiscoverCallbacks {
  onFlareSolverr?: (status: 'running' | 'done', found?: boolean) => void
}

export async function discoverRssUrl(blogUrl: string, callbacks?: DiscoverCallbacks): Promise<{ rssUrl: string | null; title: string | null; usedFlareSolverr: boolean }> {
  let rssUrl: string | null = null
  let pageTitle: string | null = null
  let usedFlareSolverr = false

  // Step 1: Fetch page, check if it's a direct feed, otherwise look for <link rel="alternate">
  try {
    const result = await fetchHtml(blogUrl, { timeout: DISCOVERY_TIMEOUT })
    usedFlareSolverr = result.usedFlareSolverr
    if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('running')

    // If the URL itself is an RSS/Atom feed, return it directly
    const ct = result.contentType
    if (ct.includes('xml') || ct.includes('atom') || ct.includes('rss')) {
      if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('done', true)
      const feedTitle = await fetchFeedTitle(blogUrl)
      return { rssUrl: blogUrl, title: feedTitle, usedFlareSolverr }
    }

    // Otherwise treat as HTML and discover feed links
    const dom = new JSDOM(result.html, { url: blogUrl })
    const doc = dom.window.document

    pageTitle = doc.querySelector('title')?.textContent?.trim() || null

    const links = doc.querySelectorAll(
      'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]',
    )
    for (const link of links) {
      const href = link.getAttribute('href')
      if (href) {
        rssUrl = new URL(href, blogUrl).toString()
        break
      }
    }

    if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('done', !!rssUrl)
  } catch {
    // Page fetch failed, continue to path probing
  }

  // Step 2: Probe candidate paths (if Step 1 didn't find RSS)
  if (!rssUrl) {
    const rootCandidates = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml']
    const base = new URL(blogUrl)

    // Build probe URLs: root-relative paths + page-relative paths (treating input URL as directory)
    const pageBase = base.pathname.endsWith('/') ? base.href : base.href + '/'
    const seen = new Set<string>()
    const probeUrls: string[] = []
    for (const p of rootCandidates) {
      const fromRoot = new URL(p, base).toString()
      const fromPage = new URL(p.replace(/^\//, ''), pageBase).toString()
      if (!seen.has(fromRoot)) { seen.add(fromRoot); probeUrls.push(fromRoot) }
      if (!seen.has(fromPage)) { seen.add(fromPage); probeUrls.push(fromPage) }
    }

    for (const candidateUrl of probeUrls) {
      try {
        let probeRes = await fetch(candidateUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(PROBE_TIMEOUT),
        })
        if (!probeRes.ok && probeRes.status === 405) {
          probeRes = await fetch(candidateUrl, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(PROBE_TIMEOUT),
          })
        }
        if (probeRes.ok) {
          const ct = probeRes.headers.get('content-type') || ''
          if (ct.includes('xml') || ct.includes('atom') || ct.includes('rss')) {
            rssUrl = candidateUrl
            break
          }
        }
      } catch {
        // Probe failed, try next
      }
    }

    // Fallback: if all regular probes failed, try top candidates via FlareSolverr.
    // FlareSolverr returns Chromium-rendered content. We use multiple strategies:
    // 1. Redirect detection: if Chromium was redirected to a different host, skip
    // 2. Content-type / raw XML checks
    // 3. HTML-decoded body parsing (Chromium may HTML-encode XML tags)
    if (!rssUrl) {
      const topCandidates = ['rss.xml', 'feed.xml', 'atom.xml']
      for (const name of topCandidates) {
        const candidateUrl = new URL(name, pageBase).toString()
        try {
          const flare = await fetchViaFlareSolverr(candidateUrl)
          if (!flare) continue

          // Skip if Chromium was redirected to a different host (e.g. 404 → homepage)
          try {
            const reqHost = new URL(candidateUrl).host
            const resHost = new URL(flare.url).host
            if (reqHost !== resHost) continue
          } catch { /* ignore URL parse errors */ }

          // Check content-type from original response headers
          const ct = flare.contentType
          if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) {
            rssUrl = candidateUrl
            break
          }
          // If extractXmlFromBrowserViewer succeeded, body is raw XML
          if (/^\s*<(\?xml|rss|feed)\b/.test(flare.body)) {
            rssUrl = candidateUrl
            break
          }
          // Search anywhere in body for RSS/Atom elements (raw or HTML-encoded)
          if (/<rss[\s>]/.test(flare.body) || /&lt;rss[\s>]/.test(flare.body)) {
            rssUrl = candidateUrl
            break
          }
          if (/<feed[\s>]/.test(flare.body) || /&lt;feed[\s>]/.test(flare.body)) {
            rssUrl = candidateUrl
            break
          }
          // Try parsing body as RSS (works if extractXmlFromBrowserViewer succeeded)
          const items = await parseRssXml(flare.body)
          if (items.length > 0) {
            rssUrl = candidateUrl
            break
          }
          // Try HTML-decoding body and parsing (Chromium wraps XML in HTML with encoded entities)
          if (flare.body.includes('&lt;rss') || flare.body.includes('&lt;feed')) {
            const decoded = flare.body
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            const decodedItems = await parseRssXml(decoded)
            if (decodedItems.length > 0) {
              rssUrl = candidateUrl
              break
            }
          }
        } catch {
          // FlareSolverr probe failed, try next
        }
      }
    }
  }

  if (!rssUrl) return { rssUrl: null, title: pageTitle, usedFlareSolverr }

  // Step 3: Fetch the feed itself to get the canonical feed title
  const feedTitle = await fetchFeedTitle(rssUrl)
  return { rssUrl, title: feedTitle || pageTitle, usedFlareSolverr }
}
