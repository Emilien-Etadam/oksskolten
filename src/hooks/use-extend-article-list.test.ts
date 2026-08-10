import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { KeyboardNavigationProvider } from '../contexts/keyboard-navigation-context'
import { useExtendArticleList } from './use-extend-article-list'

const mockFetcher = vi.fn()
let mockCategoryUnreadOnly = 'off'

vi.mock('../lib/fetcher', () => ({
  fetcher: (url: string) => mockFetcher(url),
}))

vi.mock('../app', () => ({
  useAppLayout: () => ({ settings: { categoryUnreadOnly: mockCategoryUnreadOnly } }),
}))

vi.mock('./use-clip-feed-id', () => ({
  useClipFeedId: () => 42,
}))

function wrapper({ children }: { children: ReactNode }) {
  return createElement(KeyboardNavigationProvider, null, children)
}

function seedList(ids: string[], lastListUrl: string) {
  sessionStorage.setItem('kb_article_ids', JSON.stringify(ids))
  sessionStorage.setItem('kb_article_urls', JSON.stringify(
    Object.fromEntries(ids.map(id => [id, `https://example.com/${id}`])),
  ))
  sessionStorage.setItem('kb_last_list_url', lastListUrl)
}

describe('useExtendArticleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCategoryUnreadOnly = 'off'
    sessionStorage.clear()
  })

  it('fetches the inbox window and appends unknown articles', async () => {
    seedList(['1', '2'], '/inbox')
    mockFetcher.mockResolvedValue({
      articles: [
        { id: 2, url: 'https://example.com/2' },
        { id: 3, url: 'https://example.com/3' },
      ],
      has_more: true,
    })

    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    let extended: Awaited<ReturnType<ReturnType<typeof useExtendArticleList>>> = null
    await act(async () => { extended = await result.current() })

    const url = mockFetcher.mock.calls[0][0] as string
    expect(url).toContain('unread=1')
    expect(url).toContain('limit=100')
    expect(url).toContain('offset=0')
    expect(extended).toEqual({
      ids: ['1', '2', '3'],
      urls: {
        '1': 'https://example.com/1',
        '2': 'https://example.com/2',
        '3': 'https://example.com/3',
      },
    })
  })

  it('returns null when every fetched article is already known', async () => {
    seedList(['1', '2'], '/inbox')
    mockFetcher.mockResolvedValue({
      articles: [{ id: 1, url: 'https://example.com/1' }],
      has_more: false,
    })

    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    let extended: unknown
    await act(async () => { extended = await result.current() })
    expect(extended).toBeNull()
  })

  it('does not fetch for non-list routes', async () => {
    seedList(['1'], '/settings/general')
    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    let extended: unknown
    await act(async () => { extended = await result.current() })
    expect(extended).toBeNull()
    expect(mockFetcher).not.toHaveBeenCalled()
  })

  it('builds category queries respecting the unread-only setting', async () => {
    mockCategoryUnreadOnly = 'on'
    seedList(['1'], '/categories/7')
    mockFetcher.mockResolvedValue({ articles: [], has_more: false })

    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    await act(async () => { await result.current() })

    const url = mockFetcher.mock.calls[0][0] as string
    expect(url).toContain('category_id=7')
    expect(url).toContain('unread=1')
  })

  it('uses the clip feed id for the clips route', async () => {
    seedList(['1'], '/clips')
    mockFetcher.mockResolvedValue({ articles: [], has_more: false })

    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    await act(async () => { await result.current() })

    expect(mockFetcher.mock.calls[0][0]).toContain('feed_id=42')
  })

  it('backs the fetch window off into the known list', async () => {
    seedList(Array.from({ length: 100 }, (_, i) => String(i + 1)), '/feeds/3')
    mockFetcher.mockResolvedValue({ articles: [], has_more: false })

    const { result } = renderHook(() => useExtendArticleList(), { wrapper })
    await act(async () => { await result.current() })

    const url = mockFetcher.mock.calls[0][0] as string
    expect(url).toContain('feed_id=3')
    expect(url).toContain('offset=20')
  })
})
