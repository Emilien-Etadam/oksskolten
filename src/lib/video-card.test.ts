import { describe, it, expect } from 'vitest'
import { markVideoCards } from './video-card'
import { renderMarkdown } from './markdown'
import { sanitizeHtml } from './sanitize'

const POSTER = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function card(html: string): HTMLAnchorElement | null {
  const doc = new DOMParser().parseFromString(markVideoCards(html), 'text/html')
  return doc.querySelector('a[data-video]')
}

describe('markVideoCards', () => {
  it('marks a poster link as a video and opens it away from the article', () => {
    const anchor = card(`<p><a href="${WATCH}"><img src="${POSTER}" alt="Parasolid history"></a></p>`)

    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('data-video')).toBe('youtube')
    expect(anchor!.getAttribute('target')).toBe('_blank')
    expect(anchor!.getAttribute('rel')).toBe('noopener noreferrer')
    // The poster keeps its alt text: the badge is decoration and stays hidden
    // from assistive technology.
    expect(anchor!.querySelector('img')?.getAttribute('alt')).toBe('Parasolid history')
    const badge = anchor!.querySelector('[aria-hidden="true"]')
    expect(badge).not.toBeNull()
    // The scrim must carry its colour inline. Expressed as a Tailwind class it
    // silently produced no rule — the theme tokens are plain CSS variables, so
    // the opacity modifier generates nothing and the disc vanishes.
    expect(badge!.querySelector('[style*="background"]')).not.toBeNull()
  })

  it('leaves an ordinary link to a video alone', () => {
    const html = `<p>As covered in <a href="${WATCH}">this talk</a>.</p>`

    expect(markVideoCards(html)).toBe(html)
  })

  it('leaves images that are not videos alone', () => {
    const html = '<p><a href="https://example.com/post"><img src="https://example.com/cover.jpg"></a></p>'

    expect(markVideoCards(html)).toBe(html)
  })

  it('returns articles without any video untouched', () => {
    const html = '<p>No video here at all.</p>'

    expect(markVideoCards(html)).toBe(html)
  })
})

describe('archived video playback', () => {
  it('reaches the reader as a real player through marked, DOMPurify and markVideoCards', () => {
    // What archiveArticleVideos writes into full_text once the file is on disk.
    const md = [
      'Text before.',
      '',
      '<video controls preload="none" src="/api/articles/videos/33342_abc.mp4" poster="https://i.ytimg.com/vi/x/hqdefault.jpg" title="The power of Parasolid"></video>',
      '',
      'Text after.',
    ].join('\n')

    const html = markVideoCards(sanitizeHtml(renderMarkdown(md)))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    // Three modules can each silently drop this: marked does not treat <video>
    // as a block tag, DOMPurify allow-lists tags, and markVideoCards rewrites
    // the surrounding HTML.
    const video = doc.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toBe('/api/articles/videos/33342_abc.mp4')
    expect(video!.hasAttribute('controls')).toBe(true)
    expect(video!.getAttribute('poster')).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg')
    expect(doc.body.textContent).toContain('Text after.')
  })
})
