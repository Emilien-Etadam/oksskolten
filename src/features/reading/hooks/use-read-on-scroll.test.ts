import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import { markSeenOnServer } from '@/lib/markSeenWithQueue'
import { trackRead } from '@/lib/readTracker'
import { BATCH_FLUSH_INTERVAL, useReadOnScroll } from './use-read-on-scroll'

vi.mock('@/lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(),
}))

vi.mock('@/lib/markSeenWithQueue', () => ({
  markSeenOnServer: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/readTracker', () => ({
  trackRead: vi.fn(),
  isReadInSession: vi.fn(() => false),
}))

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }))

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr')
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mutateMock }),
  }
})

function params(overrides: Partial<Parameters<typeof useReadOnScroll>[0]> = {}): Parameters<typeof useReadOnScroll>[0] {
  return {
    autoMarkRead: 'off',
    listRef: createRef<HTMLElement>(),
    absorbedIdsRef: { current: new Map() },
    feedId: undefined,
    categoryId: undefined,
    smartFolderId: undefined,
    ...overrides,
  }
}

describe('useReadOnScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not flush the read batch before BATCH_FLUSH_INTERVAL', () => {
    const { result } = renderHook(() => useReadOnScroll(params()))

    act(() => { result.current.markRead(1) })
    act(() => { vi.advanceTimersByTime(BATCH_FLUSH_INTERVAL - 1) })

    expect(trackRead).toHaveBeenCalledWith(1)
    expect(result.current.autoReadIds.has(1)).toBe(true)
    expect(markSeenOnServer).not.toHaveBeenCalled()
  })

  it('flushes queued ids to the server after BATCH_FLUSH_INTERVAL', () => {
    const { result } = renderHook(() => useReadOnScroll(params()))

    act(() => { result.current.markRead(1) })
    act(() => { result.current.markRead(2) })
    act(() => { vi.advanceTimersByTime(BATCH_FLUSH_INTERVAL) })

    expect(markSeenOnServer).toHaveBeenCalledTimes(1)
    expect(markSeenOnServer).toHaveBeenCalledWith([1, 2])
  })

  it('marks absorbed similar articles together and flushes them in one batch', () => {
    const absorbedIdsRef = { current: new Map<number, number[]>([[10, [11, 12]]]) }
    const { result } = renderHook(() => useReadOnScroll(params({ absorbedIdsRef })))

    act(() => { result.current.markReadWithGroup(10) })
    act(() => { vi.advanceTimersByTime(BATCH_FLUSH_INTERVAL) })

    expect(trackRead).toHaveBeenCalledWith(10)
    expect(trackRead).toHaveBeenCalledWith(11)
    expect(trackRead).toHaveBeenCalledWith(12)
    expect(markSeenOnServer).toHaveBeenCalledWith([10, 11, 12])
    expect(result.current.autoReadIds.has(10)).toBe(true)
    expect(result.current.autoReadIds.has(11)).toBe(true)
    expect(result.current.autoReadIds.has(12)).toBe(true)
  })

  it('flushes leftover ids on unmount', () => {
    const { result, unmount } = renderHook(() => useReadOnScroll(params()))

    act(() => { result.current.markRead(5) })
    unmount()

    expect(markSeenOnServer).toHaveBeenCalledWith([5])
  })
})
