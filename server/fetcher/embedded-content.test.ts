import { describe, it, expect } from 'vitest'
import { findEmbeddedContentUrl } from './embedded-content.js'

const PAGE = 'https://huggingface.co/spaces/AdithyaSK/rl-environments-guide'

function page(body: string, head = ''): string {
  return `<!DOCTYPE html><html><head><title>Guide</title>${head}</head><body>${body}</body></html>`
}

describe('findEmbeddedContentUrl', () => {
  it('finds the app an iframe holds', () => {
    const html = page('<iframe src="https://adithyask-rl-environments-guide.hf.space" title="app"></iframe>')

    expect(findEmbeddedContentUrl(html, PAGE)).toEqual({
      url: 'https://adithyask-rl-environments-guide.hf.space/',
      kind: 'iframe',
    })
  })

  it('resolves a relative iframe src against the page', () => {
    const html = page('<iframe src="/embed/reader.html"></iframe>')

    expect(findEmbeddedContentUrl(html, PAGE)?.url).toBe('https://huggingface.co/embed/reader.html')
  })

  it('decodes entities in the src', () => {
    const html = page('<iframe src="https://viewer.example.com/read?doc=7&amp;page=1"></iframe>')

    expect(findEmbeddedContentUrl(html, PAGE)?.url).toBe('https://viewer.example.com/read?doc=7&page=1')
  })

  it('prefers an AMP twin over an iframe', () => {
    const html = page(
      '<iframe src="https://viewer.example.com/embed"></iframe>',
      '<link rel="amphtml" href="https://news.example.com/story/amp">',
    )

    expect(findEmbeddedContentUrl(html, PAGE)).toEqual({
      url: 'https://news.example.com/story/amp',
      kind: 'amphtml',
    })
  })

  it('prefers a meta refresh over everything else', () => {
    const html = page(
      '<iframe src="https://viewer.example.com/embed"></iframe>',
      '<meta http-equiv="refresh" content="0; url=https://news.example.com/story">' +
        '<link rel="amphtml" href="https://news.example.com/story/amp">',
    )

    expect(findEmbeddedContentUrl(html, PAGE)).toEqual({
      url: 'https://news.example.com/story',
      kind: 'meta-refresh',
    })
  })

  it('skips media and ad frames and keeps looking', () => {
    const html = page(`
      <iframe src="https://www.youtube.com/embed/abc123"></iframe>
      <iframe src="https://td.doubleclick.net/slot"></iframe>
      <iframe src="https://reader.example.com/document/9"></iframe>
    `)

    expect(findEmbeddedContentUrl(html, PAGE)).toEqual({
      url: 'https://reader.example.com/document/9',
      kind: 'iframe',
    })
  })

  it('skips frames declared too small to hold a document', () => {
    const html = page(`
      <iframe src="https://pixel.example.com/t" width="1" height="1"></iframe>
      <iframe src="https://reader.example.com/document/9" width="100%" height="800"></iframe>
    `)

    expect(findEmbeddedContentUrl(html, PAGE)?.url).toBe('https://reader.example.com/document/9')
  })

  it('skips hidden frames', () => {
    const cases = [
      '<iframe src="https://hidden.example.com/a" hidden></iframe>',
      '<iframe src="https://hidden.example.com/b" aria-hidden="true"></iframe>',
      '<iframe src="https://hidden.example.com/c" style="display: none"></iframe>',
    ]

    for (const frame of cases) {
      expect(findEmbeddedContentUrl(page(frame), PAGE)).toBeNull()
    }
  })

  it('does not mistake a class value for a bare hidden attribute', () => {
    const html = page('<iframe class="frame hidden-until-loaded" src="https://reader.example.com/doc"></iframe>')

    expect(findEmbeddedContentUrl(html, PAGE)?.url).toBe('https://reader.example.com/doc')
  })

  it('ignores frames that are not fetchable pages', () => {
    const html = page(`
      <iframe src="about:blank"></iframe>
      <iframe src="javascript:void(0)"></iframe>
      <iframe src="data:text/html,<p>hi</p>"></iframe>
      <iframe></iframe>
    `)

    expect(findEmbeddedContentUrl(html, PAGE)).toBeNull()
  })

  it('ignores a pointer back at the page itself', () => {
    const html = page(`<iframe src="${PAGE}#introduction"></iframe>`)

    expect(findEmbeddedContentUrl(html, PAGE)).toBeNull()
  })

  it('returns null when the page keeps its text to itself', () => {
    expect(findEmbeddedContentUrl(page('<article><p>All the words are right here.</p></article>'), PAGE)).toBeNull()
  })
})
