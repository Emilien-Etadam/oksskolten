import TurndownService from 'turndown'

// Lightweight Turndown instance for converting RSS HTML excerpts to Markdown.
// Unlike the worker-thread instance in contentWorker.ts, this skips custom rules
// (barePreBlock, table keep) because RSS descriptions are simple HTML fragments.
const fallbackTurndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

/** Check if a string contains HTML tags (not just plain text or Markdown). */
const HTML_TAG_RE = /<[a-zA-Z][^>]*>/

/**
 * Convert RSS feed content to Markdown for use as article full_text.
 * Detects whether the input is HTML, Markdown/plain text, and only applies
 * Turndown conversion for HTML. Plain text and Markdown are returned as-is
 * because Turndown would mangle them (escaping Markdown syntax, collapsing newlines).
 */
export function convertHtmlToMarkdown(content: string): string {
  if (!HTML_TAG_RE.test(content)) return content
  return fallbackTurndown.turndown(content)
}

/**
 * How far into the markdown an existing image still counts as the article's
 * lead. An image within the opening paragraphs already fills the hero role;
 * one buried further down does not.
 */
const LEAD_IMAGE_WINDOW = 600

/**
 * og:image hosts that serve generated social cards (repo banners, share
 * cards) rather than article imagery. Prepending those would stamp the same
 * banner onto every article of the site.
 */
const GENERATED_CARD_HOSTS = new Set([
  'opengraph.githubassets.com',
  'repository-images.githubusercontent.com',
])

/**
 * Dedup key for an image URL: host + path, ignoring protocol, query, and
 * hash. CDN resize variants (`?w=400` vs `?w=800`) are the same picture.
 */
function imageUrlKey(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.host.toLowerCase() + url.pathname
  } catch {
    return null
  }
}

/**
 * Prepend the page's og:image when the extracted markdown has no lead image
 * of its own.
 *
 * Many WordPress-style themes (Hackaday among them) place the featured image
 * in the post header, outside the content block — a region the extraction
 * pipeline discards wholesale (stripHeavyTags drops `<header>` blocks, and
 * Readability keeps only the main text container). The same picture still
 * reaches us through `og:image`, which is read from the page's meta tags
 * before any cleaning, so restore it as the article's hero.
 *
 * Skipped when the body already opens with an image, when the og:image
 * already appears anywhere in the body (any resize variant), when it is a
 * generated social card, and for Reddit posts, whose markdown is composed
 * deliberately by fetchRedditPostContent.
 */
export function ensureLeadImage(fullText: string, ogImage: string | null, articleUrl: string): string {
  if (!ogImage) return fullText
  const ogKey = imageUrlKey(ogImage)
  if (!ogKey) return fullText

  try {
    if (GENERATED_CARD_HOSTS.has(new URL(ogImage).hostname.toLowerCase())) return fullText
    const articleHost = new URL(articleUrl).hostname.toLowerCase()
    if (articleHost === 'reddit.com' || articleHost.endsWith('.reddit.com')) return fullText
  } catch {
    return fullText
  }

  // ![alt](url) and ![alt](url "title") — capture the URL alone
  const imageRe = /!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g
  let match: RegExpExecArray | null
  while ((match = imageRe.exec(fullText)) !== null) {
    if (match.index < LEAD_IMAGE_WINDOW) return fullText
    if (imageUrlKey(match[1]) === ogKey) return fullText
  }

  return `![](${ogImage})\n\n${fullText}`
}

/**
 * Generate a plain-text excerpt from Markdown by stripping images and links.
 * Used by both contentWorker (page extraction) and fetcher (RSS fallback).
 */
export function markdownToExcerpt(md: string, maxLen = 200): string | null {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // strip ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // [text](url) → text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim() || null
}
