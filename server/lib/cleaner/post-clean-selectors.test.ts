import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { postClean } from './index.js'
import type { CleanerConfig } from './selectors.js'

/** Parse HTML snippet as a document for post-clean (simulates Readability output) */
function doc(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document
}

function postCleanAndGetText(html: string, config?: CleanerConfig): string {
  const d = doc(html)
  postClean(d, config)
  return d.body.textContent || ''
}

function postCleanAndGetHtml(html: string, config?: CleanerConfig): string {
  const d = doc(html)
  postClean(d, config)
  return d.body.innerHTML
}

describe('postClean — exact selectors', () => {
  it('removes ad elements by class', () => {
    const text = postCleanAndGetText(
      '<div class="ad-wrapper">Buy now!</div><p>Article content here.</p>',
    )
    expect(text).not.toContain('Buy now!')
    expect(text).toContain('Article content here.')
  })

  it('removes ad elements by id', () => {
    const text = postCleanAndGetText(
      '<div id="ad-top">Sponsored</div><p>Real content.</p>',
    )
    expect(text).not.toContain('Sponsored')
    expect(text).toContain('Real content.')
  })

  it('removes banner role', () => {
    const text = postCleanAndGetText(
      '<div role="banner">Site banner</div><p>Content.</p>',
    )
    expect(text).not.toContain('Site banner')
  })

  it('removes promo elements', () => {
    const text = postCleanAndGetText(
      '<div class="promo">Subscribe now!</div><p>Article text.</p>',
    )
    expect(text).not.toContain('Subscribe now!')
  })

  it('removes comments section', () => {
    const text = postCleanAndGetText(
      '<p>Article.</p><div id="comments"><h3>Comments</h3><p>Nice post!</p></div>',
    )
    expect(text).not.toContain('Nice post!')
    expect(text).toContain('Article.')
  })

  it('removes header and nav', () => {
    const html = postCleanAndGetHtml(
      '<header><nav><a href="/">Home</a></nav></header><p>Content.</p>',
    )
    expect(html).not.toContain('<header>')
    expect(html).not.toContain('<nav>')
    expect(html).toContain('Content.')
  })

  it('removes footer', () => {
    const text = postCleanAndGetText(
      '<p>Content.</p><footer><p>Copyright 2024</p></footer>',
    )
    expect(text).not.toContain('Copyright 2024')
  })

  it('removes sidebar', () => {
    const text = postCleanAndGetText(
      '<p>Article.</p><div class="sidebar"><h3>Popular Posts</h3></div>',
    )
    expect(text).not.toContain('Popular Posts')
  })

  it('removes newsletter/subscribe', () => {
    const text = postCleanAndGetText(
      '<p>Article.</p><div id="newsletter"><h3>Subscribe</h3><form><input type="email"></form></div>',
    )
    expect(text).not.toContain('Subscribe')
  })

  it('removes author section', () => {
    const text = postCleanAndGetText(
      '<p>Article.</p><div class="author"><img src="/avatar.jpg"><span>John Doe</span></div>',
    )
    expect(text).not.toContain('John Doe')
  })

  it('removes date elements', () => {
    const text = postCleanAndGetText(
      '<span class="date">March 1, 2024</span><p>Article content.</p>',
    )
    expect(text).not.toContain('March 1, 2024')
  })

  it('removes tags section', () => {
    const html = postCleanAndGetHtml(
      '<p>Content.</p><div class="tags"><a href="/tag/js">JavaScript</a></div>',
    )
    expect(html).not.toContain('JavaScript')
  })

  it('removes TOC', () => {
    const text = postCleanAndGetText(
      '<div class="toc"><ul><li><a href="#s1">Section 1</a></li></ul></div><p>Content.</p>',
    )
    expect(text).not.toContain('Section 1')
  })

  it('removes form elements', () => {
    const html = postCleanAndGetHtml(
      '<p>Content.</p><form><input type="email"><button>Submit</button></form>',
    )
    expect(html).not.toContain('<form>')
    expect(html).not.toContain('<button>')
  })

  it('removes aside (non-callout)', () => {
    const html = postCleanAndGetHtml(
      '<aside><p>Related info</p></aside><p>Content.</p>',
    )
    expect(html).not.toContain('<aside')
  })

  it('preserves aside with callout class', () => {
    const html = postCleanAndGetHtml(
      '<aside class="callout-info"><p>Important note</p></aside><p>Content.</p>',
    )
    expect(html).toContain('Important note')
  })

  it('removes aria-hidden elements (non-math)', () => {
    const text = postCleanAndGetText(
      '<span aria-hidden="true">icon</span><p>Content.</p>',
    )
    expect(text).not.toContain('icon')
  })

  it('preserves aria-hidden with math class', () => {
    const text = postCleanAndGetText(
      '<span aria-hidden="true" class="math-inline">x²</span><p>Content.</p>',
    )
    expect(text).toContain('x²')
  })
})

describe('postClean — partial patterns', () => {
  it('removes newsletter-signup by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="newsletter-signup"><h3>Join our list</h3></div><p>Content.</p>',
    )
    expect(text).not.toContain('Join our list')
  })

  it('removes share-icons by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="share-icons"><a href="#">Twitter</a></div><p>Content.</p>',
    )
    expect(text).not.toContain('Twitter')
  })

  it('removes related articles by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="related-articles"><h3>Related</h3></div><p>Content.</p>',
    )
    expect(text).not.toContain('Related')
  })

  it('removes breadcrumb by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="breadcrumb"><a href="/">Home</a> &gt; <a href="/blog">Blog</a></div><p>Content.</p>',
    )
    expect(text).not.toContain('Home')
  })

  it('removes byline by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="byline">By John Smith</div><p>Content.</p>',
    )
    expect(text).not.toContain('By John Smith')
  })

  it('removes comment-thread by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="comment-thread"><p>Great post!</p></div><p>Content.</p>',
    )
    expect(text).not.toContain('Great post!')
  })

  it('removes sidebar-content by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="sidebar-content"><h3>Archives</h3></div><p>Content.</p>',
    )
    expect(text).not.toContain('Archives')
  })

  it('removes advert elements by class pattern', () => {
    const text = postCleanAndGetText(
      '<div class="advert-container">Ad here</div><p>Content.</p>',
    )
    expect(text).not.toContain('Ad here')
  })

  it('removes by data-component attribute', () => {
    const text = postCleanAndGetText(
      '<div data-component="share-icons">Share this</div><p>Content.</p>',
    )
    expect(text).not.toContain('Share this')
  })

  it('removes by data-module attribute', () => {
    const text = postCleanAndGetText(
      '<div data-module="related-articles">More stories</div><p>Content.</p>',
    )
    expect(text).not.toContain('More stories')
  })

  it('removes sponsor elements', () => {
    const text = postCleanAndGetText(
      '<div class="sponsor-banner">Sponsored by Corp</div><p>Content.</p>',
    )
    expect(text).not.toContain('Sponsored by Corp')
  })

  it('removes read-time elements', () => {
    const text = postCleanAndGetText(
      '<span class="read-time">5 min read</span><p>Content.</p>',
    )
    expect(text).not.toContain('5 min read')
  })

  it('is case-insensitive', () => {
    const text = postCleanAndGetText(
      '<div class="NewsletterSignup">Sign up!</div><p>Content.</p>',
    )
    expect(text).not.toContain('Sign up!')
  })

  it('does not remove content-bearing elements', () => {
    const text = postCleanAndGetText(
      '<div class="article-body"><p>This is the main article content that should be preserved.</p></div>',
    )
    expect(text).toContain('This is the main article content')
  })
})

describe('postClean — config options', () => {
  it('disablePostCleanSelectors skips exact removal', () => {
    const text = postCleanAndGetText(
      '<div class="sidebar">Side content</div><p>Main.</p>',
      { disablePostCleanSelectors: true },
    )
    expect(text).toContain('Side content')
  })

  it('disablePartialSelectors skips partial removal', () => {
    const text = postCleanAndGetText(
      '<div class="newsletter-signup">Subscribe</div><p>Main.</p>',
      { disablePartialSelectors: true },
    )
    expect(text).toContain('Subscribe')
  })

  it('excludeExact prevents specific selectors', () => {
    const text = postCleanAndGetText(
      '<footer><p>Footer content</p></footer><p>Main.</p>',
      { excludeExact: ['footer'] },
    )
    expect(text).toContain('Footer content')
  })

  it('additionalExact adds custom selectors', () => {
    const text = postCleanAndGetText(
      '<div class="custom-noise">noise</div><p>Main.</p>',
      { additionalExact: ['.custom-noise'] },
    )
    expect(text).not.toContain('noise')
  })

  it('excludePartial prevents specific patterns', () => {
    const text = postCleanAndGetText(
      '<div class="sidebar-content">Side stuff</div><p>Main.</p>',
      { excludePartial: ['sidebar-content'] },
    )
    expect(text).toContain('Side stuff')
  })

  it('additionalPartial adds custom patterns', () => {
    const text = postCleanAndGetText(
      '<div class="my-custom-widget">widget</div><p>Main.</p>',
      { additionalPartial: ['my-custom-widget'] },
    )
    expect(text).not.toContain('widget')
  })

  it('both disables together skip all removal', () => {
    const d = doc(
      '<div class="sidebar">Side</div><div class="newsletter-signup">News</div><p>Main.</p>',
    )
    postClean(d, { disablePostCleanSelectors: true, disablePartialSelectors: true })
    const text = d.body.textContent || ''
    expect(text).toContain('Side')
    expect(text).toContain('News')
    expect(text).toContain('Main.')
  })
})

describe('postClean — next/prev navigation patterns', () => {
  /** Long enough to clear MIN_SURVIVING_TEXT so the guard stays out of the way. */
  const body = `<p>${'Article body text that runs well past the guard threshold. '.repeat(6)}</p>`

  it('removes next-post navigation links', () => {
    const text = postCleanAndGetText(`<div class="next-post"><a href="/2">Next up</a></div>${body}`)
    expect(text).not.toContain('Next up')
    expect(text).toContain('Article body text')
  })

  it('removes next-article and next-story navigation links', () => {
    const text = postCleanAndGetText(
      `<div class="next-article">Following</div><div id="next-story">After that</div>${body}`,
    )
    expect(text).not.toContain('Following')
    expect(text).not.toContain('After that')
  })

  it('removes combined next/prev widgets in either spelling', () => {
    const text = postCleanAndGetText(
      `<div class="nextprev">Pager</div><div class="next-prev">Pager2</div>` +
      `<div class="prevnext">Pager3</div>${body}`,
    )
    expect(text).not.toContain('Pager')
    expect(text).not.toContain('Pager2')
    expect(text).not.toContain('Pager3')
  })

  it('keeps a body whose id merely starts with the site namespace "next"', () => {
    // next.ink wraps every article in id="next-single-post". A bare 'next-'
    // pattern matched it and deleted the entire post.
    const text = postCleanAndGetText(`<div id="next-single-post">${body}</div>`)
    expect(text).toContain('Article body text')
  })
})

describe('postClean — all-content-removed guard', () => {
  const longBody = 'Substantial article prose that comfortably clears the threshold. '.repeat(6)

  it('restores the document when a pattern would delete the whole body', () => {
    const text = postCleanAndGetText(
      `<div class="newsletter-signup"><p>${longBody}</p></div>`,
    )
    expect(text).toContain('Substantial article prose')
  })

  it('still removes noise when enough content survives', () => {
    const text = postCleanAndGetText(
      `<div class="newsletter-signup">Join our list</div><p>${longBody}</p>`,
    )
    expect(text).not.toContain('Join our list')
    expect(text).toContain('Substantial article prose')
  })

  it('leaves genuinely short documents alone', () => {
    // Below the threshold before cleaning, so there is nothing to protect and
    // the guard must not resurrect removed noise.
    const text = postCleanAndGetText('<div class="newsletter-signup">Join our list</div><p>Tiny.</p>')
    expect(text).not.toContain('Join our list')
    expect(text).toContain('Tiny.')
  })
})

describe('postClean — fail-open', () => {
  it('does not throw on empty document', () => {
    const d = doc('')
    expect(() => postClean(d)).not.toThrow()
  })

  it('does not throw on malformed HTML', () => {
    const d = new JSDOM('not really html').window.document
    expect(() => postClean(d)).not.toThrow()
  })
})
