import { describe, it, expect } from 'vitest'
import { scoreArticleQuality } from './quality.js'

const body = (n: number) => 'word '.repeat(n)

describe('scoreArticleQuality', () => {
  it('rates a long, plain article well', () => {
    const r = scoreArticleQuality({ title: 'Rust 2.0 ships a new borrow checker', text: body(800) })
    expect(r.score).toBeGreaterThanOrEqual(0.8)
    expect(r.flags).toEqual([])
  })

  it('flags a thin body', () => {
    const r = scoreArticleQuality({ title: 'Short note', text: 'Just a link.' })
    expect(r.flags).toContain('thin')
    expect(r.score).toBeLessThan(0.6)
  })

  it('flags clickbait titles in English and French', () => {
    expect(scoreArticleQuality({ title: "You won't believe what happened next", text: body(300) }).flags).toContain('clickbait')
    expect(scoreArticleQuality({ title: '10 raisons de quitter Paris', text: body(300) }).flags).toContain('clickbait')
  })

  it('flags shouting titles', () => {
    const r = scoreArticleQuality({ title: 'BREAKING NEWS ABOUT EVERYTHING', text: body(300) })
    expect(r.flags).toContain('shouting')
  })

  it('flags promotional content', () => {
    const r = scoreArticleQuality({ title: 'Great headphones', text: 'Sponsored: use promo code SAVE20 for 20% off. ' + body(300) })
    expect(r.flags).toContain('promotional')
  })

  it('flags link-heavy bodies', () => {
    const links = Array.from({ length: 40 }, (_, i) => `[l${i}](https://x.y/${i})`).join(' ')
    const r = scoreArticleQuality({ title: 'Links roundup', text: links + ' ' + body(100) })
    expect(r.flags).toContain('link-heavy')
  })

  it('stays within 0..1', () => {
    const r = scoreArticleQuality({ title: 'SHOCKING!!! 10 things you won\'t believe! Sponsored', text: '' })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
  })
})
