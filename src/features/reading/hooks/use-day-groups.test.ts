import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ArticleListItem } from '../../../../shared/types'
import { useDayGroups } from './use-day-groups'

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

describe('useDayGroups', () => {
  it('heads each publication day with its own group, keeping source indices', () => {
    const articles = [
      makeArticle({ id: 1, title: 'Late on day one', published_at: '2026-01-02T20:00:00Z' }),
      makeArticle({ id: 2, title: 'Early on day one', published_at: '2026-01-02T06:00:00Z' }),
      makeArticle({ id: 3, title: 'Day two', published_at: '2026-01-01T22:00:00Z' }),
    ]

    const { result } = renderHook(() => useDayGroups(articles, true, false))

    expect(result.current).not.toBeNull()
    expect(result.current).toHaveLength(2)
    expect(result.current![0].items.map(i => i.article.id)).toEqual([1, 2])
    expect(result.current![0].items.map(i => i.index)).toEqual([0, 1])
    expect(result.current![1].items.map(i => i.article.id)).toEqual([3])
    expect(result.current![1].items[0].index).toBe(2)
  })

  it('returns null when separators are off, as on likes/history lists', () => {
    const articles = [
      makeArticle({ id: 1, published_at: '2026-01-02T20:00:00Z' }),
      makeArticle({ id: 2, published_at: '2026-01-01T06:00:00Z' }),
    ]
    const { result } = renderHook(() => useDayGroups(articles, false, false))
    expect(result.current).toBeNull()
  })

  it('returns null for grid layouts so sections do not break column flow', () => {
    const articles = [
      makeArticle({ id: 1, published_at: '2026-01-02T20:00:00Z' }),
      makeArticle({ id: 2, published_at: '2026-01-01T06:00:00Z' }),
    ]
    const { result } = renderHook(() => useDayGroups(articles, true, true))
    expect(result.current).toBeNull()
  })

  it('groups undated articles together after dated ones when keys match', () => {
    const articles = [
      makeArticle({ id: 1, published_at: '2026-01-02T20:00:00Z' }),
      makeArticle({ id: 2, published_at: null }),
      makeArticle({ id: 3, published_at: null }),
    ]
    const { result } = renderHook(() => useDayGroups(articles, true, false))
    expect(result.current).toHaveLength(2)
    expect(result.current![1].key).toBe('')
    expect(result.current![1].items.map(i => i.article.id)).toEqual([2, 3])
  })
})
