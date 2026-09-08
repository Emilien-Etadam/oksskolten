import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockMutate = vi.fn()
const mockUseSWR = vi.fn()
vi.mock('swr', () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
  useSWRConfig: () => ({ mutate: mockMutate }),
}))

vi.mock('../lib/fetcher', () => ({ fetcher: vi.fn() }))

import { useArticleAutoRefresh, AUTO_REFRESH_INTERVAL_MS } from './use-article-auto-refresh'

function feeds(counts: Record<number, number>) {
  return { feeds: Object.entries(counts).map(([id, article_count]) => ({ id: Number(id), article_count, unread_count: 0 })) }
}

describe('useArticleAutoRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('polls the feed counts on an interval', () => {
    mockUseSWR.mockReturnValue({ data: undefined })
    renderHook(() => useArticleAutoRefresh())
    const [key, , options] = mockUseSWR.mock.calls[0] as [string, unknown, { refreshInterval: number }]
    expect(key).toBe('/api/feeds')
    expect(options.refreshInterval).toBe(AUTO_REFRESH_INTERVAL_MS)
  })

  it('leaves the lists alone on the first load and while nothing changes', () => {
    mockUseSWR.mockReturnValue({ data: feeds({ 1: 10, 2: 5 }) })
    const { rerender } = renderHook(() => useArticleAutoRefresh())
    mockUseSWR.mockReturnValue({ data: feeds({ 1: 10, 2: 5 }) })
    rerender()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('refreshes the article lists when a feed gains articles', () => {
    mockUseSWR.mockReturnValue({ data: feeds({ 1: 10, 2: 5 }) })
    const { rerender } = renderHook(() => useArticleAutoRefresh())
    mockUseSWR.mockReturnValue({ data: feeds({ 1: 12, 2: 5 }) })
    rerender()
    expect(mockMutate).toHaveBeenCalledTimes(1)
    const matcher = mockMutate.mock.calls[0][0] as (key: unknown) => boolean
    expect(matcher('$inf$/api/articles?unread=1&limit=30&offset=0')).toBe(true)
    expect(matcher('/api/frontpage')).toBe(true)
    expect(matcher('/api/feeds')).toBe(false)
  })

  it('ignores unread counts, which move as the reader marks articles', () => {
    const base = feeds({ 1: 10 })
    mockUseSWR.mockReturnValue({ data: base })
    const { rerender } = renderHook(() => useArticleAutoRefresh())
    mockUseSWR.mockReturnValue({ data: { feeds: [{ ...base.feeds[0], unread_count: 3 }] } })
    rerender()
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
