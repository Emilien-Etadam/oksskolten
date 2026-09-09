import { errorMessage } from '../fetcher/util.js'
import { fetchFullText, isBotBlockPage, convertHtmlToMarkdown, markdownToExcerpt, ensureLeadImage, MIN_EXTRACTED_LENGTH } from '../fetcher/content.js'
import { isGoogleNewsUrl } from '../fetcher/google-news.js'
import { detectLanguage } from '../ai/index.js'
import { logger } from '../logger.js'

const log = logger.child('fetcher')

// --- Article content fetching (shared by feed pipeline & clip) ---

export interface FetchedContent {
  fullText: string | null
  ogImage: string | null
  excerpt: string | null
  lang: string | null
  lastError: string | null
  /** Title extracted by fetchFullText (from OGP etc.) */
  title: string | null
}

export async function fetchArticleContent(
  url: string,
  options?: {
    requiresJsChallenge?: boolean
    /** CSS Bridge listing-page excerpt, used as fullText fallback */
    listingExcerpt?: string
    /** Existing article data for retry (skips fetch if a real body is already stored) */
    existingArticle?: { full_text: string | null; og_image: string | null; lang: string | null }
  },
): Promise<FetchedContent> {
  let fullText: string | null = null
  let ogImage: string | null = null
  let excerpt: string | null = null
  let lang: string | null = null
  let lastError: string | null = null
  let title: string | null = null

  const existing = options?.existingArticle

  // Step 1: Fetch full text (skip if retry article already has a real body).
  // A handful of shell chrome is not a body: it is what a Hugging Face Space
  // leaves behind when the iframe hop fails, and skipping the fetch would
  // freeze that chrome in place.
  const isAnchorLink = url.includes('#')
  const existingBodyLen = existing?.full_text?.replace(/\s+/g, ' ').trim().length ?? 0

  if (existing && existingBodyLen >= MIN_EXTRACTED_LENGTH) {
    fullText = existing.full_text
    ogImage = existing.og_image
  } else if (isAnchorLink && options?.listingExcerpt) {
    fullText = convertHtmlToMarkdown(options.listingExcerpt)
    excerpt = markdownToExcerpt(fullText)
  } else {
    try {
      const result = await fetchFullText(url, { requiresJsChallenge: options?.requiresJsChallenge })
      fullText = result.fullText
      ogImage = result.ogImage
      excerpt = result.excerpt
      title = result.title
    } catch (err) {
      lastError = `fetchFullText: ${errorMessage(err)}`
    }
  }

  // Fallback: use RSS inline content when page fetch failed, returned bot-block page,
  // or extracted text is too short (e.g. SPA sites where content is in display:none for SEO).
  // This is the last resort after fetchFullText and its internal FlareSolverr retry
  // (which also uses MIN_EXTRACTED_LENGTH) have both failed to produce enough content.
  //
  // Not for Google News items: their description is a link to the wrapper
  // plus the publisher's name. Storing that as the body would clear the
  // error and freeze the article, when a retry could still reach the page.
  if (options?.listingExcerpt && !isGoogleNewsUrl(url)) {
    const extractedLen = fullText?.replace(/\s+/g, ' ').trim().length ?? 0
    const shouldFallback = !fullText || isBotBlockPage(fullText) || extractedLen < MIN_EXTRACTED_LENGTH
    if (shouldFallback) {
      const md = convertHtmlToMarkdown(options.listingExcerpt)
      const mdLen = md.replace(/\s+/g, ' ').trim().length
      // Only use RSS content if it's more substantial than what we extracted
      if (mdLen > extractedLen) {
        log.info({ url, extractedLen, rssLen: mdLen }, 'using RSS feed content as fallback')
        fullText = md
        excerpt = markdownToExcerpt(md)
        lastError = null
      }
    }
  }

  // Step 2: Detect language (local, no API call)
  if (fullText && !(existing?.lang)) {
    lang = detectLanguage(fullText)
  } else if (existing) {
    lang = existing.lang
  }

  // Step 3: Hero-image fallback — restore a lead image the extraction lost.
  // Only for bodies that already pass the length bar: prepending a markdown
  // image inflates full_text length, which would otherwise mask a too-short
  // extraction from the stale-article repair loop (countStaleArticlesByFeed).
  if (fullText && fullText.replace(/\s+/g, ' ').trim().length >= MIN_EXTRACTED_LENGTH) {
    fullText = ensureLeadImage(fullText, ogImage, url)
  }

  return { fullText, ogImage, excerpt, lang, lastError, title }
}
