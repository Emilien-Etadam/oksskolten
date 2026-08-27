/**
 * Finding the page that actually holds the text.
 *
 * Some URLs carry no article of their own. A Hugging Face Space, a document
 * viewer, a whitepaper reader: the outer page is a shell of markup whose words
 * live inside an iframe. Others are trampolines — a meta refresh, or an AMP
 * twin that holds the same article in far simpler HTML.
 *
 * Extraction on such a page returns a title and a hundred characters of chrome,
 * and the anti-bot solver cannot rescue it: rendering the shell still leaves the
 * text inside the frame. What helps is following the page's own pointer to
 * where the words are, which this module finds from the outer HTML alone.
 */

/** Where the pointer came from. Decides whether the target replaces the page's identity. */
export type EmbeddedContentKind = 'meta-refresh' | 'amphtml' | 'iframe'

export interface EmbeddedContent {
  url: string
  kind: EmbeddedContentKind
}

/**
 * Hosts that embed something other than article text. Following them costs a
 * fetch and can never pay off, so they are skipped rather than tried and
 * discarded. Matched on the host and any subdomain of it.
 */
const NON_CONTENT_HOSTS = [
  // Media players
  'youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
  'spotify.com', 'soundcloud.com', 'mixcloud.com', 'bandcamp.com', 'twitch.tv',
  // Social embeds
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'linkedin.com', 'reddit.com', 'bsky.app',
  // Ads, analytics, consent and captcha frames
  'google.com', 'googletagmanager.com', 'googlesyndication.com', 'google-analytics.com',
  'doubleclick.net', 'adnxs.com', 'criteo.com', 'taboola.com', 'outbrain.com',
  'recaptcha.net', 'hcaptcha.com', 'cloudflareinsights.com',
  // Comments, forms and newsletters
  'disqus.com', 'typeform.com', 'jotform.com', 'mailchimp.com', 'list-manage.com',
  // Code sandboxes — real content, but never prose
  'codepen.io', 'jsfiddle.net', 'codesandbox.io', 'stackblitz.com', 'replit.com',
  'gist.github.com',
  // Image and map embeds
  'giphy.com', 'imgur.com', 'openstreetmap.org',
]

/**
 * An iframe smaller than this in a declared dimension is chrome: a tracking
 * pixel, a consent strip, an ad slot. Frames that carry a document either
 * declare nothing (CSS sizes them) or declare something page-sized.
 */
const MIN_CONTENT_FRAME_PX = 200

const IFRAME_TAG_RE = /<iframe\b[^>]*>/gi
const AMP_LINK_RE = /<link\b[^>]*>/gi
const META_TAG_RE = /<meta\b[^>]*>/gi

/** Read one attribute off a tag, quoted or bare. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag)
  if (!m) return null
  return m[2] ?? m[3] ?? m[4] ?? null
}

/**
 * The tag with quoted attribute values blanked, so a bare attribute can be
 * tested without `class="a hidden b"` counting as one.
 */
function withoutValues(tag: string): string {
  return tag.replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''")
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** Resolve a candidate against the page and reject what can never be an article. */
function usableUrl(candidate: string, pageUrl: string): string | null {
  let resolved: URL
  try {
    resolved = new URL(decodeEntities(candidate.trim()), pageUrl)
  } catch {
    return null
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null

  const host = resolved.hostname.toLowerCase().replace(/^www\./, '')
  if (NON_CONTENT_HOSTS.some(deny => hostMatches(host, deny))) return null

  // Pointing at the page we just failed to extract: following it would fetch
  // the same shell again.
  const page = new URL(pageUrl)
  resolved.hash = ''
  page.hash = ''
  if (resolved.href === page.href) return null

  return resolved.href
}

/** `<meta http-equiv="refresh" content="0; url=...">` — the page saying where it went. */
function metaRefreshTarget(html: string): string | null {
  for (const tag of html.match(META_TAG_RE) ?? []) {
    if ((attr(tag, 'http-equiv') ?? '').toLowerCase() !== 'refresh') continue
    const content = attr(tag, 'content')
    if (!content) continue
    const target = /\burl\s*=\s*['"]?([^'";]+)/i.exec(content)
    if (target) return target[1]
  }
  return null
}

/** `<link rel="amphtml">` — the same article, in HTML built to be parsed. */
function ampTarget(html: string): string | null {
  for (const tag of html.match(AMP_LINK_RE) ?? []) {
    if ((attr(tag, 'rel') ?? '').toLowerCase().trim() !== 'amphtml') continue
    const href = attr(tag, 'href')
    if (href) return href
  }
  return null
}

/** Chrome rather than content: hidden, or declared too small to hold a document. */
function isChromeFrame(tag: string): boolean {
  if (/\shidden[\s>=]/i.test(withoutValues(tag))) return true
  if ((attr(tag, 'aria-hidden') ?? '').toLowerCase() === 'true') return true
  if (/display\s*:\s*none/i.test(attr(tag, 'style') ?? '')) return true

  for (const dimension of ['width', 'height'] as const) {
    const raw = (attr(tag, dimension) ?? '').trim().replace(/px$/i, '')
    // Only a plain number counts. A frame sized in % or by CSS declares nothing
    // about whether it holds a document.
    if (/^\d+$/.test(raw) && Number(raw) < MIN_CONTENT_FRAME_PX) return true
  }
  return false
}

/**
 * The one URL worth fetching instead of `pageUrl`, or null when the page keeps
 * its text to itself. Ordered by how explicit the pointer is: a meta refresh
 * and an AMP link name the article outright, an iframe merely holds it.
 */
export function findEmbeddedContentUrl(html: string, pageUrl: string): EmbeddedContent | null {
  const refresh = metaRefreshTarget(html)
  if (refresh) {
    const url = usableUrl(refresh, pageUrl)
    if (url) return { url, kind: 'meta-refresh' }
  }

  const amp = ampTarget(html)
  if (amp) {
    const url = usableUrl(amp, pageUrl)
    if (url) return { url, kind: 'amphtml' }
  }

  for (const tag of html.match(IFRAME_TAG_RE) ?? []) {
    if (isChromeFrame(tag)) continue
    const src = attr(tag, 'src')
    if (!src) continue
    const url = usableUrl(src, pageUrl)
    if (url) return { url, kind: 'iframe' }
  }

  return null
}
