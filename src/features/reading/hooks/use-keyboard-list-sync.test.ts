import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { KeyboardNavigationProvider, useKeyboardNavigationContext } from '@/contexts/keyboard-navigation-context'
import type { ArticleListItem } from '../../../../shared/types'
import { useKeyboardListSync } from './use-keyboard-list-sync'

vi.mock('@/lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  return createElement(KeyboardNavigationProvider, null, children)
}

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

describe('useKeyboardListSync', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('publishes article ids, urls and dates to the keyboard-navigation context', () => {
    const articles = [
      makeArticle({ id: 1, url: 'https://example.com/1', published_at: '2026-01-01T00:00:00Z' }),
      makeArticle({ id: 2, url: 'https://example.com/2', published_at: '2026-01-02T00:00:00Z' }),
    ]

    const { result } = renderHook(
      () => {
        const sync = useKeyboardListSync(articles, '/inbox')
        const ctx = useKeyboardNavigationContext()
        return { sync, ctx }
      },
      { wrapper },
    )

    expect(result.current.sync.articleIds).toEqual(['1', '2'])
    expect(result.current.ctx.articleIds).toEqual(['1', '2'])
    expect(result.current.ctx.articleUrls).toEqual({
      '1': 'https://example.com/1',
      '2': 'https://example.com/2',
    })
    expect(result.current.ctx.articleDates).toEqual({
      '1': '2026-01-01T00:00:00Z',
      '2': '2026-01-02T00:00:00Z',
    })
    expect(result.current.ctx.lastListUrl).toBe('/inbox')
    expect(result.current.sync.articleMap.get('1')?.url).toBe('https://example.com/1')
  })

  it('updates lastListUrl when the list path changes', () => {
    const articles = [makeArticle({ id: 7 })]
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => {
        const sync = useKeyboardListSync(articles, url)
        const ctx = useKeyboardNavigationContext()
        return { sync, ctx }
      },
      { wrapper, initialProps: { url: '/inbox' } },
    )

    expect(result.current.ctx.lastListUrl).toBe('/inbox')
    rerender({ url: '/feeds/3' })
    expect(result.current.ctx.lastListUrl).toBe('/feeds/3')
  })

  it('exposes focusedItemId from the context', () => {
    const articles = [makeArticle({ id: 1 })]
    const { result } = renderHook(
      () => useKeyboardListSync(articles, '/inbox'),
      { wrapper },
    )

    expect(result.current.focusedItemId).toBeNull()
    act(() => { result.current.setFocusedItemId('1') })
    expect(result.current.focusedItemId).toBe('1')
  })
})
