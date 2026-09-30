import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeTitleSimilarity,
  computeWordOverlap,
  titlesMatch,
  detectAndStoreSimilarArticles,
  pruneStaleSimilarities,
} from './similarity.js'

const {
  mockMeiliSearch,
  mockIsSearchReady,
  mockGetArticlesByIds,
  mockMarkArticleSeen,
  mockInsertSimilarity,
  mockGetFeedArticleIdsInWindow,
  mockGetSimilarityPairs,
  mockDeleteSimilarities,
  mockGetSetting,
  mockUpsertSetting,
} = vi.hoisted(() => ({
  mockMeiliSearch: vi.fn(),
  mockIsSearchReady: vi.fn(),
  mockGetArticlesByIds: vi.fn(),
  mockMarkArticleSeen: vi.fn(),
  mockInsertSimilarity: vi.fn(),
  mockGetFeedArticleIdsInWindow: vi.fn(),
  mockGetSimilarityPairs: vi.fn(),
  mockDeleteSimilarities: vi.fn(),
  mockGetSetting: vi.fn(),
  mockUpsertSetting: vi.fn(),
}))

// Two long, unrelated French titles that share only letter pairs: they
// cleared the bigram threshold and showed up as "also covered by".
const JEWELLER = 'Charles Broudarge, joaillier… mais aussi commanditaire, et en 49 ans de vie, quel parcours !'
const UNKNOWN = '« Équation à une inconnue » : tous les moyens sont bons pour retrouver celle qui a fait vibrer le cœur d\'Olivier !'
const COMICS = '« Histoire de la BD en bande dessinée » : des images pour raconter le 9e art…'

vi.mock('../search/client.js', () => ({
  meiliSearch: mockMeiliSearch,
}))
vi.mock('../search/sync.js', () => ({
  isSearchReady: mockIsSearchReady,
}))
vi.mock('../db.js', () => ({
  getArticlesByIds: mockGetArticlesByIds,
  markArticleSeen: mockMarkArticleSeen,
}))
vi.mock('./similarity-db.js', () => ({
  insertSimilarity: mockInsertSimilarity,
  getFeedArticleIdsInWindow: mockGetFeedArticleIdsInWindow,
  getSimilarityPairs: mockGetSimilarityPairs,
  deleteSimilarities: mockDeleteSimilarities,
}))
vi.mock('../db/settings.js', () => ({
  getSetting: mockGetSetting,
  upsertSetting: mockUpsertSetting,
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

  it('lets long unrelated French titles through on letter pairs alone', () => {
    // Why the word check exists: this is above the 0.4 threshold
    expect(computeTitleSimilarity(JEWELLER, UNKNOWN)).toBeGreaterThan(0.4)
    expect(computeTitleSimilarity(JEWELLER, COMICS)).toBeGreaterThan(0.4)
  })
})

describe('computeWordOverlap', () => {
  it('is 0 for titles with no word in common', () => {
    expect(computeWordOverlap(JEWELLER, UNKNOWN)).toBe(0)
    expect(computeWordOverlap(JEWELLER, COMICS)).toBe(0)
  })

  it('folds accents and stems, so inflected words still meet', () => {
    expect(computeWordOverlap(
      'Microsoft rachète Discord pour 12 milliards de dollars',
      'Discord racheté par Microsoft pour 12 milliards',
    )).toBeGreaterThan(0.8)
  })

  it('ignores stopwords and years', () => {
    // Left with {choisir, aspirateur, robot} against {choisir, box, internet}
    expect(computeWordOverlap(
      'Comment choisir son aspirateur robot en 2026',
      'Comment choisir sa box internet en 2026',
    )).toBeCloseTo(2 / 6)
  })

  it('keeps numbers as words', () => {
    expect(computeWordOverlap('Linux 7.2 est sorti', 'Linux 7.3 est sorti')).toBeLessThan(1)
  })

  it('stands aside for scripts written without spaces', () => {
    expect(computeWordOverlap('Appleが新型iPhone 17を発表', 'Apple、iPhone 17を正式発表')).toBeNull()
  })

  it('stands aside for titles made of stopwords alone', () => {
    expect(computeWordOverlap('What is it?', 'What is it?')).toBeNull()
  })
})

describe('titlesMatch', () => {
  it('rejects unrelated titles that only share letter pairs', () => {
    expect(titlesMatch(JEWELLER, UNKNOWN)).toBe(false)
    expect(titlesMatch(JEWELLER, COMICS)).toBe(false)
  })

  it('accepts the same story told by two sources', () => {
    expect(titlesMatch('Apple announces iPhone 17', 'Apple unveils new iPhone 17')).toBe(true)
    expect(titlesMatch(
      'Le Sénat adopte la réforme des retraites',
      'Réforme des retraites : le Sénat vote le texte',
    )).toBe(true)
    expect(titlesMatch(
      'Tesla recalls 2 million vehicles over Autopilot concerns',
      'Tesla to recall 2M cars over Autopilot safety concerns',
    )).toBe(true)
  })

  it('rejects titles that share a template but not a subject', () => {
    expect(titlesMatch(
      'Test du Pixel 11 Pro : un smartphone presque parfait',
      'Test de la Renault 5 électrique : une citadine presque parfaite',
    )).toBe(false)
  })

  it('keeps matching Japanese titles on characters alone', () => {
    expect(titlesMatch('Appleが新型iPhone 17を発表', 'Apple、iPhone 17を正式発表')).toBe(true)
  })
})

describe('detectAndStoreSimilarArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSearchReady.mockReturnValue(true)
    mockMeiliSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 })
    mockGetArticlesByIds.mockReturnValue([])
    mockGetFeedArticleIdsInWindow.mockReturnValue([])
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

  it('skips candidates close in letters but sharing no words', async () => {
    mockMeiliSearch.mockResolvedValue({ hits: [{ id: 2 }, { id: 3 }], estimatedTotalHits: 2 })
    mockGetArticlesByIds.mockReturnValue([
      { id: 2, feed_id: 20, title: UNKNOWN, published_at: null, read_at: '2026-01-01T00:00:00Z' },
      { id: 3, feed_id: 20, title: COMICS, published_at: null, read_at: null },
    ])
    await detectAndStoreSimilarArticles(1, JEWELLER, 10, '2026-01-01T00:00:00Z')
    expect(mockInsertSimilarity).not.toHaveBeenCalled()
    expect(mockMarkArticleSeen).not.toHaveBeenCalled()
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

  // A crosspost and its original arrive in the same fetch cycle; Meilisearch
  // indexes asynchronously, so neither is searchable when the other looks.
  it('finds a same-feed crosspost the search index does not have yet', async () => {
    mockGetFeedArticleIdsInWindow.mockReturnValue([2])
    mockGetArticlesByIds.mockReturnValue([
      {
        id: 2,
        feed_id: 10,
        title: 'mini-AGI: continual learning transformer grown by evolution',
        url: 'https://www.reddit.com/r/LocalLLM/comments/bbb222/miniagi/',
        published_at: '2026-01-01T00:00:00Z',
        read_at: null,
      },
    ])
    await detectAndStoreSimilarArticles(
      1,
      'mini-AGI: continual learning transformer growth by evolution',
      10,
      '2026-01-01T00:00:00Z',
      'https://www.reddit.com/r/LocalLLaMA/comments/aaa111/miniagi/',
    )
    expect(mockGetFeedArticleIdsInWindow).toHaveBeenCalledWith(
      10, 1, '2025-12-29T00:00:00.000Z', '2026-01-04T00:00:00.000Z', expect.any(Number),
    )
    expect(mockGetArticlesByIds).toHaveBeenCalledWith([2])
    expect(mockInsertSimilarity).toHaveBeenCalledWith(1, 2, expect.any(Number))
  })

  it('does not read same-feed siblings for articles outside Reddit', async () => {
    await detectAndStoreSimilarArticles(1, 'Some title', 10, '2026-01-01T00:00:00Z', 'https://example.com/post')
    expect(mockGetFeedArticleIdsInWindow).not.toHaveBeenCalled()
  })
})

describe('pruneStaleSimilarities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockReturnValue(undefined)
    mockGetSimilarityPairs.mockReturnValue([])
  })

  it('removes the links the current rule rejects, once per pair', () => {
    mockGetSimilarityPairs.mockReturnValue([
      { article_id: 1, similar_to_id: 2, title: JEWELLER, similar_title: UNKNOWN },
      { article_id: 2, similar_to_id: 1, title: UNKNOWN, similar_title: JEWELLER },
      { article_id: 3, similar_to_id: 4, title: 'Apple announces iPhone 17', similar_title: 'Apple unveils new iPhone 17' },
      { article_id: 4, similar_to_id: 3, title: 'Apple unveils new iPhone 17', similar_title: 'Apple announces iPhone 17' },
    ])
    expect(pruneStaleSimilarities()).toBe(1)
    expect(mockDeleteSimilarities).toHaveBeenCalledWith([[1, 2]])
    expect(mockUpsertSetting).toHaveBeenCalledWith('similarity.rule_version', expect.any(String))
  })

  it('does nothing once the stored links were checked under the current rule', () => {
    pruneStaleSimilarities()
    const version = mockUpsertSetting.mock.calls[0][1]
    vi.clearAllMocks()
    mockGetSetting.mockReturnValue(version)

    expect(pruneStaleSimilarities()).toBe(0)
    expect(mockGetSimilarityPairs).not.toHaveBeenCalled()
    expect(mockUpsertSetting).not.toHaveBeenCalled()
  })
})
