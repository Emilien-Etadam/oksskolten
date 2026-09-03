/** A Reddit-hosted image URL as it appears in raw markdown (raw_json=1: no entities) */
const REDDIT_IMAGE_URL_SOURCE = String.raw`https://(?:preview\.redd\.it|i\.redd\.it)/`

// [caption](https://preview.redd.it/…) — but not ![caption](…), and not
// links carrying a "title" part (the URL must run straight to the paren)
const LINKED_IMAGE_RE = new RegExp(String.raw`(?<!!)\[([^\]]*)\]\((${REDDIT_IMAGE_URL_SOURCE}[^)\s]+)\)`, 'g')
// A bare URL — not one already inside a link target `](…)`, an autolink `<…>`,
// or an opening bracket; trailing sentence punctuation stays outside the image
const BARE_IMAGE_RE = new RegExp(String.raw`(?<![(\[<])\b(${REDDIT_IMAGE_URL_SOURCE}[^\s)\]]*[^\s)\].,;:!?])`, 'g')

/**
 * Reddit markdown (selftext and comments) references uploaded images as plain
 * links — a bare `https://preview.redd.it/…` URL or `[caption](https://…)` —
 * so a rendered article shows a signed URL instead of the picture. Rewrite
 * both forms to image syntax; URLs already in image syntax are left alone.
 *
 * Shared between the fetcher (post bodies at ingestion), the comments route,
 * and the reader (articles stored before the rewrite existed).
 */
export function redditImageLinksToMarkdown(markdown: string): string {
  return markdown
    .replace(LINKED_IMAGE_RE, '![$1]($2)')
    .replace(BARE_IMAGE_RE, '![]($1)')
}

/** True for URLs on reddit.com (any subdomain) — the host whose markdown needs the rewrite. */
export function isRedditArticleUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^(www|old|new)\./, '')
    return host === 'reddit.com'
  } catch {
    return false
  }
}
