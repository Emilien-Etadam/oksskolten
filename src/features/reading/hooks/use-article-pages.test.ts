import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ArticleListItem } from '../../../../shared/types'
import { useArticlePages, type ArticlePagesParams } from './use-article-pages'
import { refreshArticleLists } from '@/lib/article-list-refresh'

interface ArticlesResponse {
  articles: ArticleListItem[]
  total: number
  has_more: boolean
}

type GetKey = (pageIndex: number, previousPageData: ArticlesResponse | null) => string | null

let capturedGetKey: GetKey | undefined
let capturedRevalidateFirstPage: boolean | undefined

interface SwrInfiniteReturn {
  data: ArticlesResponse[] | undefined
  error: Error | undefined
  size: number
  setSize: ReturnType<typeof vi.fn>
  isLoading: boolean
  isValidating: boolean
  mutate: ReturnType<typeof vi.fn>
}

let swrInfiniteReturn: SwrInfiniteReturn

vi.mock('swr/infinite', () => ({
  default: (getKey: GetKey, _fetcher: unknown, options: { revalidateFirstPage: boolean }) => {
    capturedGetKey = getKey
    capturedRevalidateFirstPage = options.revalidateFirstPage
    return swrInfiniteReturn
  },
}))

vi.mock('@/lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(),
}))

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Test Feed',
    title: 'Test Article',
    title_translated: null,
    url: 'https://example.com/1',
    published_at: '2026-01-01T00:00:00Z',
    lang: 'en',
    summary: null,
    excerpt: 'Excerpt text',
    og_image: null,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

const defaultParams: ArticlePagesParams = {
  smartFolderId: undefined,
  isRecommended: false,
  feedId: undefined,
  categoryId: undefined,
  unreadOnly: false,
  bookmarkedOnly: false,
  likedOnly: false,
  readOnly: false,
  noFloor: false,
  isCollectionView: false,
}

describe('useArticlePages', () => {
  beforeEach(() => {
    capturedGetKey = undefined
    capturedRevalidateFirstPage = undefined
    swrInfiniteReturn = {
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    }
  })

  it('groups similar articles behind the first one and records absorbed ids', () => {
    swrInfiniteReturn = {
      ...swrInfiniteReturn,
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'Story on subreddit A', similar_ids: '2,3' }),
          makeArticle({ id: 2, title: 'Story on subreddit B', similar_ids: '1,3' }),
          makeArticle({ id: 3, title: 'Story on subreddit C', similar_ids: '1,2' }),
          makeArticle({ id: 4, title: 'Unrelated article' }),
        ],
        total: 4,
        has_more: false,
      }],
      isLoading: false,
    }

    const { result } = renderHook(() => useArticlePages(defaultParams))

    expect(result.current.articles.map(a => a.id)).toEqual([1, 4])
    expect(result.current.groupCounts.get(1)).toBe(3)
    expect(result.current.absorbedIds.get(1)).toEqual([2, 3])
    expect(result.current.absorbedIdsRef.current.get(1)).toEqual([2, 3])
  })

  it('does not group articles whose similar ids are not in the loaded list', () => {
    swrInfiniteReturn = {
      ...swrInfiniteReturn,
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'Solo leader', similar_ids: '99' }),
          makeArticle({ id: 2, title: 'Other article' }),
        ],
        total: 2,
        has_more: false,
      }],
      isLoading: false,
    }

    const { result } = renderHook(() => useArticlePages(defaultParams))

    expect(result.current.articles.map(a => a.id)).toEqual([1, 2])
    expect(result.current.groupCounts.size).toBe(0)
    expect(result.current.absorbedIds.size).toBe(0)
  })

  it('flattens pages into one article list before grouping', () => {
    swrInfiniteReturn = {
      ...swrInfiniteReturn,
      data: [
        { articles: [makeArticle({ id: 1, title: 'Page 1' })], total: 2, has_more: true },
        { articles: [makeArticle({ id: 2, title: 'Page 2' })], total: 2, has_more: false },
      ],
      isLoading: false,
    }

    const { result } = renderHook(() => useArticlePages(defaultParams))
    expect(result.current.articles.map(a => a.id)).toEqual([1, 2])
  })

  it('builds the articles URL from the list identity flags', () => {
    renderHook(() => useArticlePages({
      ...defaultParams,
      feedId: 7,
      unreadOnly: true,
      noFloor: true,
    }))

    expect(capturedGetKey).toBeDefined()
    const url = capturedGetKey!(0, null)
    expect(url).toContain('/api/articles?')
    expect(url).toContain('feed_id=7')
    expect(url).toContain('unread=1')
    expect(url).toContain('no_floor=1')
    expect(url).toContain('limit=20')
    expect(url).toContain('offset=0')
  })

  it('returns a smart-folder URL when a folder id is set', () => {
    renderHook(() => useArticlePages({
      ...defaultParams,
      smartFolderId: 3,
      isCollectionView: true,
    }))

    expect(capturedGetKey!(1, null)).toBe('/api/smart-folders/3/articles?limit=20&offset=20')
    expect(capturedRevalidateFirstPage).toBe(true)
  })

  it('returns null once the previous page has no more items', () => {
    renderHook(() => useArticlePages(defaultParams))
    expect(capturedGetKey!(1, { articles: [], total: 0, has_more: false })).toBeNull()
  })

  // A global mutate on the page keys leaves the cached pages untouched, so a
  // fetch that found new articles only reached the list after a page reload.
  it('reloads its pages through the bound mutate when the refresh bus fires', () => {
    const { unmount } = renderHook(() => useArticlePages(defaultParams))

    refreshArticleLists()
    expect(swrInfiniteReturn.mutate).toHaveBeenCalledTimes(1)

    unmount()
    refreshArticleLists()
    expect(swrInfiniteReturn.mutate).toHaveBeenCalledTimes(1)
  })
})
