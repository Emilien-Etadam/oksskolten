import { parseVideoUrl } from '../../shared/video'

/**
 * Turn a poster link into a play card.
 *
 * The extraction pipeline writes an embedded video into the stored Markdown as
 * a poster image wrapped in a link to the video (see the `videoEmbed` rule in
 * `server/fetcher/contentWorker.ts`). Rendered as-is that is just a large
 * picture: nothing tells the reader it plays, and clicking it would navigate
 * the reader away from the article.
 *
 * Runs on already-sanitized HTML and only adds presentation of our own, so it
 * cannot reintroduce anything the sanitizer removed.
 */
export function markVideoCards(html: string): string {
  // Cheap reject: most articles have no video at all, and parsing every one
  // of them to find that out would be wasteful.
  if (!/youtube\.com\/watch|vimeo\.com\//i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false

  for (const anchor of doc.querySelectorAll('a[href]')) {
    const video = parseVideoUrl(anchor.getAttribute('href'))
    if (!video) continue
    // A card is a poster and nothing else. A sentence that happens to link to
    // a video stays an ordinary link.
    const img = anchor.querySelector('img')
    if (!img || anchor.childElementCount !== 1) continue

    anchor.className = `${anchor.className} relative block w-fit max-w-full no-underline`.trim()
    // The video plays on the provider's site; keep the article where it is.
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
    anchor.setAttribute('data-video', video.provider)
    img.className = `${img.className} m-0 block w-full rounded`.trim()

    const overlay = doc.createElement('span')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.className = 'absolute inset-0 flex items-center justify-center'
    const disc = doc.createElement('span')
    disc.className = 'flex h-16 w-16 items-center justify-center rounded-full bg-black/60'
    // A bordered triangle rather than ▶, which renders as an emoji on some
    // platforms and as a hollow glyph on others.
    const triangle = doc.createElement('span')
    triangle.className = 'ml-1 border-y-[11px] border-l-[18px] border-y-transparent border-l-white'
    disc.appendChild(triangle)
    overlay.appendChild(disc)
    anchor.appendChild(overlay)
    changed = true
  }

  return changed ? doc.body.innerHTML : html
}
