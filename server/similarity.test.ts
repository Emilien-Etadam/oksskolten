import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeTitleSimilarity, detectAndStoreSimilarArticles } from './similarity.js'

const {
  mockMeiliSearch,
  mockIsSearchReady,
  mockGetArticlesByIds,
  mockMarkArticleSeen,
  mockInsertSimilarity,
} = vi.hoisted(() => ({
  mockMeiliSearch: vi.fn(),
  mockIsSearchReady: vi.fn(),
  mockGetArticlesByIds: vi.fn(),
  mockMarkArticleSeen: vi.fn(),
  mockInsertSimilarity: vi.fn(),
}))

vi.mock('./search/client.js', () => ({
  meiliSearch: mockMeiliSearch,
}))
vi.mock('./search/sync.js', () => ({
  isSearchReady: mockIsSearchReady,
}))
vi.mock('./db.js', () => ({
  getArticlesByIds: mockGetArticlesByIds,
  markArticleSeen: mockMarkArticleSeen,
}))
vi.mock('./db/similarities.js', () => ({
  insertSimilarity: mockInsertSimilarity,
}))

describe('computeTitleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    expect(computeTitleSimilarity('Hello World', 'Hello World')).toBe(1)
  })

  it('returns 1.0 for case-insensitive identical titles', () => {
    expect(computeTitleSimilarity('Hello World', 'hello world')).toBe(1)
  })

  it('returns high score for very similar titles', () => {
    const score = computeTitleSimilarity(
      'Apple announces iPhone 17',
      'Apple unveils new iPhone 17',
    )
    expect(score).toBeGreaterThan(0.5)
  })

  it('returns score above threshold for same-news titles', () => {
    const score = computeTitleSimilarity(
      'Google releases Gemini 3.0 with major improvements',
      'Google launches Gemini 3.0 AI model update',
    )
    expect(score).toBeGreaterThan(0.4)
  })

  it('returns low score for unrelated titles', () => {
    const score = computeTitleSimilarity(
      'Apple announces iPhone 17',
      'How to bake a chocolate cake',
    )
    expect(score).toBeLessThan(0.2)
  })

  it('returns 0 for empty strings', () => {
    expect(computeTitleSimilarity('', '')).toBe(0)
    expect(computeTitleSimilarity('Hello', '')).toBe(0)
    expect(computeTitleSimilarity('', 'World')).toBe(0)
  })

  it('ignores punctuation', () => {
    const score = computeTitleSimilarity(
      'Breaking: Apple announces iPhone!',
      'Breaking Apple announces iPhone',
    )
    expect(score).toBeGreaterThan(0.9)
  })

  it('handles single-character words gracefully', () => {
    // Single-char words produce no bigrams
    const score = computeTitleSimilarity('A B C', 'X Y Z')
    expect(score).toBe(0)
  })

  it('handles Japanese titles', () => {
    const score = computeTitleSimilarity(
      'Appleが新型iPhone 17を発表',
      'Apple、iPhone 17を正式発表',
    )
    expect(score).toBeGreaterThan(0.4)
  })
})

describe('detectAndStoreSimilarArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSearchReady.mockReturnValue(true)
    mockMeiliSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 })
    mockGetArticlesByIds.mockReturnValue([])
  })

  it('does nothing when search is not ready', async () => {
    mockIsSearchReady.mockReturnValue(false)
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockMeiliSearch).not.toHaveBeenCalled()
  })

  it('lets undated candidates through the search filter', async () => {
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockMeiliSearch).toHaveBeenCalledWith('Some title', expect.objectContaining({
      filter: expect.stringContaining('OR published_at = 0'),
    }))
  })

  it('matches a candidate that has no published_at at all', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 20, title: 'Some title', published_at: null, read_at: null },
    ])
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockInsertSimilarity).toHaveBeenCalledWith(1, 2, 1)
  })

  it('skips same-feed candidates', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 10, title: 'Some title', published_at: null, read_at: null },
    ])
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockInsertSimilarity).not.toHaveBeenCalled()
  })

  it('links a crosspost to its original inside the same aggregator feed', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      {
        id: 2,
        feed_id: 10,
        title: 'I built a free cross-platform client for open-weight models',
        url: 'https://www.reddit.com/r/LocalLLaMA/comments/aaa111/i_built_a_free_client/',
        published_at: null,
        read_at: null,
      },
    ])
    await detectAndStoreSimilarArticles(
      1,
      'I built a free cross-platform client for open-weight models',
      10,
      '2026-01-01T00:00:00Z',
      'https://www.reddit.com/r/LocalLLM/comments/bbb222/i_built_a_free_client/',
    )
    expect(mockInsertSimilarity).toHaveBeenCalledWith(1, 2, 1)
  })

  it('keeps a recurring thread of one subreddit separate', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      {
        id: 2,
        feed_id: 10,
        title: 'Daily Discussion Thread',
        url: 'https://www.reddit.com/r/LocalLLaMA/comments/aaa111/daily_discussion_thread/',
        published_at: null,
        read_at: null,
      },
    ])
    await detectAndStoreSimilarArticles(
      1,
      'Daily Discussion Thread',
      10,
      '2026-01-01T00:00:00Z',
      'https://www.reddit.com/r/LocalLLaMA/comments/bbb222/daily_discussion_thread/',
    )
    expect(mockInsertSimilarity).not.toHaveBeenCalled()
  })

  it('still skips same-feed candidates outside Reddit', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 10, title: 'Weekly digest #13', url: 'https://blog.example.com/digest-13', published_at: null, read_at: null },
    ])
    await detectAndStoreSimilarArticles(1, 'Weekly digest #12', 10, '2026-01-01T00:00:00Z', 'https://blog.example.com/digest-12')
    expect(mockInsertSimilarity).not.toHaveBeenCalled()
  })

  it('skips candidates below the similarity threshold', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 20, title: 'Completely unrelated text here', published_at: null, read_at: null },
    ])
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockInsertSimilarity).not.toHaveBeenCalled()
  })

  it('marks the new article as seen when a similar article was already read', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }], estimatedTotalHits: 1 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 20, title: 'Some title', published_at: null, read_at: '2026-01-01T00:00:00Z' },
    ])
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockMarkArticleSeen).toHaveBeenCalledWith(1, true)
  })

  it('excludes the article itself from the candidates, short-circuiting when none remain', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 1 }], estimatedTotalHits: 1 })
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z')
    expect(mockGetArticlesByIds).not.toHaveBeenCalled()
  })
})
