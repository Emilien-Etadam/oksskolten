import { JSDOM } from 'jsdom'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import type { RssItem } from './rss/types.js'
import { GENERIC_LINK_TEXT } from '../lib/cleaner/boilerplate-text.js'
import { logger } from '../logger.js'

const log = logger.child('fetcher')

export { GENERIC_LINK_TEXT }

export function isCssSelectorBridgeUrl(url: string): boolean {
  return url.includes('bridge=CssSelectorBridge')
}

export interface CssBridgeParams {
  homePage: string
  urlSelector: string
  titleSelector?: string
  contentSelector?: string
}

/**
 * Strip custom parameters (title_selector, content_selector) that are used
 * by our own code but not recognized by RSS-Bridge's CssSelectorBridge.
 */
export function stripCustomBridgeParams(bridgeUrl: string): string {
  try {
    const url = new URL(bridgeUrl)
    url.searchParams.delete('title_selector')
    url.searchParams.delete('content_selector')
    return url.toString()
  } catch {
    return bridgeUrl
  }
}

export function parseCssSelectorBridgeParams(bridgeUrl: string): CssBridgeParams | null {
  try {
    const url = new URL(bridgeUrl)
    const homePage = url.searchParams.get('home_page')
    const urlSelector = url.searchParams.get('url_selector')
    if (!homePage || !urlSelector) return null
    const titleSelector = url.searchParams.get('title_selector') ?? undefined
    const contentSelector = url.searchParams.get('content_selector') ?? undefined
    return { homePage, urlSelector, titleSelector, contentSelector }
  } catch {
    return null
  }
}

/**
 * Given an element, find the href of the nearest <a> in its context.
 * Walks up to 8 ancestor levels, at each level checking:
 * 1. The ancestor itself (if it's an <a>)
 * 2. Any <a[href]> descendants of the ancestor
 * Prefers hrefs that match the known article URL set.
 */
export function resolveHrefFromContext(el: Element, knownUrls: Set<string>, baseUrl: string): string | null {
  // If the element itself is an <a>
  if (el.tagName === 'A' && el.getAttribute('href')) {
    return el.getAttribute('href')
  }

  let ancestor: Element | null = el.parentElement
  for (let depth = 0; depth < 8 && ancestor; depth++) {
    // Check ancestor itself
    if (ancestor.tagName === 'A' && ancestor.getAttribute('href')) {
      return ancestor.getAttribute('href')
    }

    // Check all <a[href]> descendants of ancestor
    const anchors = ancestor.querySelectorAll('a[href]')
    let firstHref: string | null = null
    for (const a of anchors) {
      const href = a.getAttribute('href')
      if (!href || href === '#') continue
      if (!firstHref) firstHref = href
      // Prefer href that matches a known article URL
      try {
        const abs = new URL(href, baseUrl).toString()
        if (knownUrls.has(abs)) return href
      } catch { /* skip */ }
    }
    if (firstHref) return firstHref

    ancestor = ancestor.parentElement
  }

  return null
}

/**
 * Extract article title from a card element.
 * Strategy (in order):
 * 1. If the <a> text itself is a real title (not generic), use it
 * 2. Walk up the DOM to find another <a> with the same href but non-generic text
 * 3. Look for heading elements (h1-h6) in the card container
 * 4. Look for elements with common title-like class names
 * 5. Fall back to the original link text
 */
export function extractTitleFromCard(anchor: Element): string {
  const linkText = (anchor.textContent ?? '').trim()
  if (linkText && !GENERIC_LINK_TEXT.test(linkText)) {
    return linkText
  }

  const href = anchor.getAttribute('href')

  let el: Element | null = anchor.parentElement
  for (let depth = 0; depth < 8 && el; depth++) {
    // Strategy 2: sibling <a> with same href but different (title) text
    if (href) {
      const siblings = el.querySelectorAll(`a[href="${href}"]`)
      for (const sib of siblings) {
        if (sib === anchor) continue
        const sibText = (sib.textContent ?? '').trim()
        if (sibText && !GENERIC_LINK_TEXT.test(sibText)) {
          return sibText
        }
      }
    }

    // Strategy 3: heading elements
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6')
    if (heading) {
      const headingText = (heading.textContent ?? '').trim()
      if (headingText && !GENERIC_LINK_TEXT.test(headingText)) return headingText
    }

    // Strategy 4: common title class patterns
    const titleEl = el.querySelector('[class*="title"], [class*="heading"], [class*="name"]')
    if (titleEl && titleEl.tagName !== 'A') {
      const titleText = (titleEl.textContent ?? '').trim()
      if (titleText && !GENERIC_LINK_TEXT.test(titleText) && titleText.length > 5) return titleText
    }

    el = el.parentElement
  }

  return linkText
}

/**
 * Build URL→title and URL→excerpt maps from title_selector / content_selector.
 */
function buildSelectorMaps(
  doc: Document,
  params: CssBridgeParams,
  articleUrls: Set<string>,
): { titleMap: Map<string, string>; excerptMap: Map<string, string> } {
  const titleMap = new Map<string, string>()
  const excerptMap = new Map<string, string>()

  if (params.titleSelector) {
    try {
      const els = doc.querySelectorAll(params.titleSelector)
      for (const el of els) {
        const href = resolveHrefFromContext(el, articleUrls, params.homePage)
        if (!href) continue
        const text = (el.textContent ?? '').trim()
        if (!text || GENERIC_LINK_TEXT.test(text)) continue
        try {
          const abs = new URL(href, params.homePage).toString()
          if (!titleMap.has(abs)) titleMap.set(abs, text)
        } catch { /* skip */ }
      }
    } catch { /* invalid selector */ }
  }

  if (params.contentSelector) {
    try {
      const els = doc.querySelectorAll(params.contentSelector)
      for (const el of els) {
        const href = resolveHrefFromContext(el, articleUrls, params.homePage)
        if (!href) continue
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        try {
          const abs = new URL(href, params.homePage).toString()
          if (!excerptMap.has(abs)) excerptMap.set(abs, text.slice(0, 500))
        } catch { /* skip */ }
      }
    } catch { /* invalid selector */ }
  }

  return { titleMap, excerptMap }
}

export async function fetchCssSelectorViaFlareSolverr(bridgeUrl: string): Promise<RssItem[]> {
  const params = parseCssSelectorBridgeParams(bridgeUrl)
  if (!params) throw new Error('Invalid CssSelectorBridge URL')

  const flare = await fetchViaFlareSolverr(params.homePage)
  if (!flare) throw new Error('FlareSolverr failed for CssSelectorBridge home_page')

  const dom = new JSDOM(flare.body, { url: params.homePage })
  const doc = dom.window.document
  const anchors = doc.querySelectorAll(params.urlSelector)

  log.info(`CssSelectorBridge FlareSolverr: matched ${anchors.length} anchors with selector "${params.urlSelector}"`)

  // First pass: collect article URLs
  const articleUrls = new Set<string>()
  const rawItems: { anchor: Element; url: string }[] = []
  for (const a of anchors) {
    const href = a.getAttribute('href')
    if (!href || href === '#') continue
    try {
      const absoluteUrl = new URL(href, params.homePage).toString()
      articleUrls.add(absoluteUrl)
      rawItems.push({ anchor: a, url: absoluteUrl })
    } catch { continue }
  }

  // Build title/excerpt maps from selectors
  const { titleMap, excerptMap } = buildSelectorMaps(doc, params, articleUrls)

  const items: RssItem[] = []
  for (const { anchor, url } of rawItems) {
    const title = titleMap.get(url) ?? (extractTitleFromCard(anchor) || 'Untitled')
    const excerpt = excerptMap.get(url)
    items.push({ title, url, published_at: null, excerpt })
  }

  if (items.length === 0) throw new Error('CssSelectorBridge FlareSolverr fallback: no items found')
  log.info(`CssSelectorBridge FlareSolverr fallback: found ${items.length} items from ${params.homePage}`)
  return items
}

/**
 * Assign pseudo published_at dates to CssSelectorBridge items based on DOM order.
 * Pages typically list newest articles first, so index 0 = most recent.
 * Items that already have a published_at are left unchanged.
 */
export function assignCssBridgePseudoDates(items: RssItem[], bridgeUrl?: string): RssItem[] {
  // Filter out URLs that point back to the home page itself (e.g. "https://example.com/blog#")
  const params = bridgeUrl ? parseCssSelectorBridgeParams(bridgeUrl) : null
  let filtered = items
  if (params) {
    const homeOriginPath = (() => {
      try {
        const u = new URL(params.homePage)
        return u.origin + u.pathname.replace(/\/$/, '')
      } catch { return null }
    })()
    if (homeOriginPath) {
      filtered = items.filter(item => {
        try {
          const u = new URL(item.url)
          const itemOriginPath = u.origin + u.pathname.replace(/\/$/, '')
          return itemOriginPath !== homeOriginPath
        } catch { return false }
      })
    }
  }

  const now = new Date()
  return filtered.map((item, i) => {
    if (item.published_at) return item
    // Space items 1 second apart so DOM order is preserved
    const pseudo = new Date(now.getTime() - i * 1_000)
    return { ...item, published_at: pseudo.toISOString() }
  })
}

/**
 * Fetch home page HTML via FlareSolverr and return the parsed document + params.
 * Shared by fixGenericTitles and enrichExcerpts to avoid duplicate requests.
 */
async function fetchHomePageDom(rssUrl: string): Promise<{ doc: Document; params: CssBridgeParams } | null> {
  const params = parseCssSelectorBridgeParams(rssUrl)
  if (!params) return null

  try {
    const flare = await fetchViaFlareSolverr(params.homePage)
    if (!flare) return null
    const dom = new JSDOM(flare.body, { url: params.homePage })
    return { doc: dom.window.document, params }
  } catch {
    return null
  }
}

/**
 * Fix generic titles (e.g. "Read more") in CssSelectorBridge items by fetching
 * the home page via FlareSolverr and extracting headings from card elements.
 * Also enriches excerpts via content_selector if available.
 */
export async function fixGenericTitlesAndEnrichExcerpts(items: RssItem[], rssUrl: string): Promise<RssItem[]> {
  const needsTitleFix = items.some(item => GENERIC_LINK_TEXT.test(item.title))
  const params = parseCssSelectorBridgeParams(rssUrl)
  const needsExcerptEnrich = params?.contentSelector && items.some(item => !item.excerpt)

  if (!needsTitleFix && !needsExcerptEnrich) return items

  const result = await fetchHomePageDom(rssUrl)
  if (!result) return items

  const { doc, params: p } = result
  const articleUrls = new Set(items.map(item => item.url))

  // Build selector maps for title and excerpt
  const { titleMap, excerptMap } = buildSelectorMaps(doc, p, articleUrls)

  // Also build a fallback title map from DOM structure (existing extractTitleFromCard logic)
  const fallbackTitleMap = new Map<string, string>()
  if (needsTitleFix) {
    const anchors = doc.querySelectorAll(p.urlSelector)
    for (const a of anchors) {
      const href = a.getAttribute('href')
      if (!href || href === '#') continue
      try {
        const absUrl = new URL(href, p.homePage).toString()
        const heading = extractTitleFromCard(a)
        if (heading && !GENERIC_LINK_TEXT.test(heading) && !fallbackTitleMap.has(absUrl)) {
          fallbackTitleMap.set(absUrl, heading)
        }
      } catch { /* skip */ }
    }
  }

  return items.map(item => {
    let { title, excerpt } = item
    // Fix generic title: prefer title_selector, then fallback to DOM extraction
    if (GENERIC_LINK_TEXT.test(title)) {
      title = titleMap.get(item.url) ?? fallbackTitleMap.get(item.url) ?? title
    }
    // Enrich excerpt if not already set
    if (!excerpt && excerptMap.has(item.url)) {
      excerpt = excerptMap.get(item.url)
    }
    return title !== item.title || excerpt !== item.excerpt ? { ...item, title, excerpt } : item
  })
}
