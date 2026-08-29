import { describe, it, expect } from 'vitest'
import { ensureLeadImage } from './markdown-utils.js'

// --- ensureLeadImage ---

const ARTICLE_URL = 'https://hackaday.com/2026/08/29/wear-your-way-out-of-ai-surveilance/'
const OG_IMAGE = 'https://hackadaycom.files.wordpress.com/2026/08/hero.jpg?w=800'

/** Body text long enough that any image inside sits beyond LEAD_IMAGE_WINDOW. */
const LONG_INTRO = 'For decades now many of us have lived in surveillance societies. '.repeat(12)

describe('ensureLeadImage', () => {
  it('prepends the og:image when the body has no image', () => {
    const body = 'Some article text without any image at all, spanning a paragraph.'
    const result = ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)
    expect(result).toBe(`![](${OG_IMAGE})\n\n${body}`)
  })

  it('returns the body unchanged when og:image is null', () => {
    const body = 'Some article text.'
    expect(ensureLeadImage(body, null, ARTICLE_URL)).toBe(body)
  })

  it('is idempotent: a body opening with an image is left alone', () => {
    const once = ensureLeadImage('Text only.', OG_IMAGE, ARTICLE_URL)
    expect(ensureLeadImage(once, OG_IMAGE, ARTICLE_URL)).toBe(once)
  })

  it('keeps a body that already opens with its own image', () => {
    const body = `![lead](https://example.com/own-lead.jpg)\n\nThen the text follows.`
    expect(ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)).toBe(body)
  })

  it('treats a linked lead image (video poster card) as a lead image', () => {
    const body = `[![Watch](https://img.youtube.com/vi/abc/0.jpg)](https://youtube.com/watch?v=abc)\n\nText.`
    expect(ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)).toBe(body)
  })

  it('prepends when the only body image sits far below the opening', () => {
    const body = `${LONG_INTRO}\n\n![mid](https://example.com/mid-article.jpg)\n\nMore text.`
    const result = ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)
    expect(result.startsWith(`![](${OG_IMAGE})`)).toBe(true)
  })

  it('skips when the og:image already appears in the body as a resize variant', () => {
    const body = `${LONG_INTRO}\n\n![same picture](https://hackadaycom.files.wordpress.com/2026/08/hero.jpg?w=400)\n\nMore text.`
    expect(ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)).toBe(body)
  })

  it('matches body images written with a markdown title', () => {
    const body = `${LONG_INTRO}\n\n![same](https://hackadaycom.files.wordpress.com/2026/08/hero.jpg?w=400 "The hero")\n\nMore.`
    expect(ensureLeadImage(body, OG_IMAGE, ARTICLE_URL)).toBe(body)
  })

  it('skips Reddit posts, whose markdown is composed deliberately', () => {
    const body = 'A reddit selftext post without images.'
    for (const url of [
      'https://www.reddit.com/r/electronics/comments/abc/post/',
      'https://old.reddit.com/r/electronics/comments/abc/post/',
      'https://reddit.com/r/electronics/comments/abc/post/',
    ]) {
      expect(ensureLeadImage(body, 'https://external-preview.redd.it/x.jpg', url)).toBe(body)
    }
  })

  it('skips generated social-card og:images', () => {
    const body = 'Release notes for v2.0 with plenty of text in them.'
    expect(ensureLeadImage(body, 'https://opengraph.githubassets.com/abc123/owner/repo', 'https://github.com/owner/repo/releases/tag/v2.0')).toBe(body)
    expect(ensureLeadImage(body, 'https://repository-images.githubusercontent.com/1234/banner.png', 'https://github.com/owner/repo/releases/tag/v2.0')).toBe(body)
  })

  it('skips non-http(s) and unparsable og:image values', () => {
    const body = 'Some text.'
    expect(ensureLeadImage(body, 'data:image/gif;base64,R0lGOD', ARTICLE_URL)).toBe(body)
    expect(ensureLeadImage(body, 'not a url', ARTICLE_URL)).toBe(body)
  })
})
