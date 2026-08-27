/**
 * Recognising the video embedded in an article.
 *
 * The cleaning pipeline deliberately keeps player iframes (see the video
 * exception in `server/lib/cleaner/selectors.ts`), so by the time an article is
 * converted to Markdown the embed is still there — and until now was dropped on
 * the floor, because Turndown has no rule for <iframe> and the reader's
 * sanitizer forbids the tag outright. Readers ended up with the caption of a
 * video they could not see.
 *
 * One definition of "which URLs are videos", shared by the converter that
 * writes the card into the stored Markdown and the reader that renders it.
 */

export type VideoProvider = 'youtube' | 'vimeo'

export interface VideoEmbed {
  provider: VideoProvider
  id: string
  /** Where a click should land: the video's own page. */
  watchUrl: string
  /** Poster frame, when the provider serves one at a predictable URL. */
  poster: string | null
  /**
   * Fallback label when the embed carries no title. A brand name rather than a
   * phrase: this text is written into stored article content, where the app's
   * UI language is not known and cannot be re-applied later.
   */
  providerName: string
}

const YOUTUBE_ID = '[\\w-]{6,}'

const YOUTUBE_PATTERNS = [
  new RegExp(`^https?://(?:www\\.)?youtube(?:-nocookie)?\\.com/embed/(${YOUTUBE_ID})`, 'i'),
  new RegExp(`^https?://(?:www\\.)?youtube\\.com/v/(${YOUTUBE_ID})`, 'i'),
  new RegExp(`^https?://youtu\\.be/(${YOUTUBE_ID})`, 'i'),
]

const VIMEO_PATTERNS = [
  /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i,
  /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i,
]

function youtubeId(url: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const m = pattern.exec(url)
    if (m) return m[1]
  }
  // watch?v= carries the id in the query rather than the path
  try {
    const parsed = new URL(url)
    if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
      const v = parsed.searchParams.get('v')
      if (v && new RegExp(`^${YOUTUBE_ID}$`).test(v)) return v
    }
  } catch {
    // not an absolute URL — no id
  }
  return null
}

/** The video a URL points at, or null when it points at something else. */
export function parseVideoUrl(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null
  const trimmed = url.trim()
  // Protocol-relative embeds are still common in older articles.
  const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed

  const yt = youtubeId(absolute)
  if (yt) {
    return {
      provider: 'youtube',
      id: yt,
      watchUrl: `https://www.youtube.com/watch?v=${yt}`,
      poster: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      providerName: 'YouTube',
    }
  }

  for (const pattern of VIMEO_PATTERNS) {
    const m = pattern.exec(absolute)
    if (m) {
      return {
        provider: 'vimeo',
        id: m[1],
        watchUrl: `https://vimeo.com/${m[1]}`,
        // Vimeo's poster needs an API call, which the converter cannot make.
        poster: null,
        providerName: 'Vimeo',
      }
    }
  }

  return null
}
