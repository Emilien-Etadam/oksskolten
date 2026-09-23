import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, recordArticleRead, markArticleLiked, markArticleSeen, getArticles, getDb } from '../db.js'
import { tokenize, rebuildInterestProfile, scoreInterest, getInterestIslands, setInterestMuted, recalculateInterestScores, scoreNewArticle, rebuildClassAffinities, getInterestClasses, setInterestClassMuted, rescoreArticleInterest, _resetInterestsForTests } from './interests.js'

beforeEach(() => {
  setupTestDb()
  _resetInterestsForTests()
})

function article(feedId: number, title: string) {
  return insertArticle({ feed_id: feedId, title, url: `https://example.com/${Math.random()}`, published_at: new Date().toISOString() })
}

describe('tokenize', () => {
  it('lowercases, drops stopwords, digits and short words', () => {
    expect(tokenize('The Rust compiler is 10 years old, dit-il')).toEqual(['rust', 'compiler', 'old', 'dit'])
  })

  it('keeps accented words', () => {
    expect(tokenize('Élections européennes')).toEqual(['élections', 'européennes'])
  })
})

describe('rebuildInterestProfile', () => {
  it('is empty without feedback', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    article(f.id, 'Rust ships')
    expect(rebuildInterestProfile()).toEqual({ terms: 0, islands: 0 })
    expect(scoreInterest('Rust ships')).toBe(0)
  })

  it('learns terms from liked and read articles and scores new ones', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    const liked = [article(f.id, 'Rust async runtime released'), article(f.id, 'Rust borrow checker improved')]
    for (const id of liked) markArticleLiked(id, true)
    recordArticleRead(article(f.id, 'Rust embedded boards'))
    // Unread noise sharing a common word
    for (let i = 0; i < 20; i++) article(f.id, `Released weather report ${i}`)

    const result = rebuildInterestProfile()
    expect(result.terms).toBeGreaterThan(0)
    const islands = getInterestIslands()
    const terms = islands.flatMap(i => i.terms.map(t => t.term))
    expect(terms).toContain('rust')
    const rust = islands.flatMap(i => i.terms).find(t => t.term === 'rust')!
    const released = islands.flatMap(i => i.terms).find(t => t.term === 'released')
    // "rust" appears in every engaged article and rarely elsewhere → top weight
    expect(rust.weight).toBe(1)
    if (released) expect(released.weight).toBeLessThan(rust.weight)

    expect(scoreInterest('Rust 2.0 announced')).toBeGreaterThan(0)
    expect(scoreInterest('Weather tomorrow')).toBe(0)
  })

  it('keeps muted terms muted across rebuilds and scores them negatively', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (const id of [article(f.id, 'Rust news'), article(f.id, 'Rust again')]) markArticleLiked(id, true)
    rebuildInterestProfile()
    expect(setInterestMuted('rust', true)).toBe(true)
    expect(scoreInterest('Rust rocks')).toBeLessThan(0)
    rebuildInterestProfile()
    expect(getInterestIslands().flatMap(i => i.terms).find(t => t.term === 'rust')?.muted).toBe(1)
  })

  it('rescoring orders the recommended list', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (const id of [article(f.id, 'Rust news'), article(f.id, 'Rust again')]) { markArticleLiked(id, true); markArticleSeen(id, true) }
    const plain = article(f.id, 'Gardening tips')
    const match = article(f.id, 'Rust for gardeners')
    rebuildInterestProfile()
    recalculateInterestScores()
    const { articles } = getArticles({ unread: true, sort: 'recommended', limit: 10, offset: 0 })
    expect(articles.map(a => a.id)).toEqual([match, plain])
  })

  it('scores a new article at insert time', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (const id of [article(f.id, 'Rust news'), article(f.id, 'Rust again')]) markArticleLiked(id, true)
    rebuildInterestProfile()
    const id = article(f.id, 'Rust everywhere')
    scoreNewArticle(id, 'Rust everywhere')
    const row = getDb().prepare('SELECT interest_score FROM articles WHERE id = ?').get(id) as { interest_score: number }
    expect(row.interest_score).toBeGreaterThan(0)
  })
})

describe('class affinities', () => {
  /** A seen article of the given classes, optionally opened */
  function seenArticle(feedId: number, theme: string, format: string, opened: boolean) {
    const id = article(feedId, `Some title ${Math.random()}`)
    getDb().prepare("UPDATE articles SET theme = ?, format = ?, classified_at = datetime('now') WHERE id = ?").run(theme, format, id)
    markArticleSeen(id, true)
    if (opened) recordArticleRead(id)
    return id
  }

  it('rates classes the reader opens above those they scroll past', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (let i = 0; i < 8; i++) seenArticle(f.id, 'AI', 'QUESTION', true)
    for (let i = 0; i < 8; i++) seenArticle(f.id, 'SOCIETY', 'NEWS', i === 0)
    // Too few to judge
    for (let i = 0; i < 2; i++) seenArticle(f.id, 'GAMING', 'NEWS', true)

    expect(rebuildClassAffinities().classes).toBe(4)
    const byKey = new Map(getInterestClasses().map(c => [`${c.kind}:${c.class_id}`, c]))
    expect(byKey.get('theme:AI')!.affinity).toBeGreaterThan(0)
    expect(byKey.get('theme:SOCIETY')!.affinity).toBeLessThan(0)
    expect(byKey.get('format:QUESTION')!.affinity).toBeGreaterThan(0)
    expect(byKey.has('theme:GAMING')).toBe(false)
    for (const c of byKey.values()) {
      expect(c.affinity).toBeGreaterThanOrEqual(-1)
      expect(c.affinity).toBeLessThanOrEqual(1)
    }

    // No title term at all: the score comes from the classes alone
    expect(scoreInterest('Untitled', null, { theme: 'AI', format: 'QUESTION' })).toBeGreaterThan(0)
    expect(scoreInterest('Untitled', null, { theme: 'SOCIETY', format: 'NEWS' })).toBeLessThan(0)
    expect(scoreInterest('Untitled', null, { theme: 'UNKNOWN' })).toBe(0)
  })

  it('keeps a muted class muted, counting as fully not interested', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (let i = 0; i < 6; i++) seenArticle(f.id, 'AI', 'NEWS', true)
    rebuildClassAffinities()
    expect(setInterestClassMuted('theme', 'AI', true)).toBe(true)
    expect(scoreInterest('Untitled', null, { theme: 'AI' })).toBe(-1)
    rebuildClassAffinities()
    expect(getInterestClasses().find(c => c.class_id === 'AI')?.muted).toBe(1)
    expect(setInterestClassMuted('theme', 'NOPE', true)).toBe(false)
  })

  it('rescores one article once it is classified', () => {
    const f = createFeed({ name: 'A', url: 'https://a.example.com' })
    for (let i = 0; i < 6; i++) seenArticle(f.id, 'AI', 'QUESTION', true)
    for (let i = 0; i < 6; i++) seenArticle(f.id, 'AUTO', 'NEWS', false)
    rebuildClassAffinities()
    const id = article(f.id, 'Brand new')
    getDb().prepare("UPDATE articles SET theme = 'AI', format = 'QUESTION' WHERE id = ?").run(id)
    rescoreArticleInterest(id)
    const row = getDb().prepare('SELECT interest_score FROM articles WHERE id = ?').get(id) as { interest_score: number }
    expect(row.interest_score).toBeGreaterThan(0)
  })
})
