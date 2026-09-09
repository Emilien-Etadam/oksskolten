import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLoadMoreSentinel, type LoadMoreSentinelParams } from './use-load-more-sentinel'

vi.mock('@/lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(),
}))

type IoCallback = (entries: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void

let ioCallback: IoCallback | undefined
const observe = vi.fn()
const disconnect = vi.fn()

function params(overrides: Partial<LoadMoreSentinelParams> = {}): LoadMoreSentinelParams {
  return {
    hasMore: true,
    isValidating: false,
    size: 1,
    setSize: vi.fn(),
    ...overrides,
  }
}

describe('useLoadMoreSentinel', () => {
  beforeEach(() => {
    ioCallback = undefined
    observe.mockReset()
    disconnect.mockReset()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IoCallback) {
        ioCallback = cb
      }
      observe = observe
      unobserve = vi.fn()
      disconnect = disconnect
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls setSize once per intersecting observation', () => {
    const setSize = vi.fn()
    const { result } = renderHook(() => useLoadMoreSentinel(params({ setSize })))
    const node = document.createElement('div')

    act(() => { result.current.sentinelCallbackRef(node) })
    expect(observe).toHaveBeenCalledWith(node)

    act(() => { ioCallback?.([{ isIntersecting: true }]) })
    expect(setSize).toHaveBeenCalledTimes(1)
    expect(setSize).toHaveBeenCalledWith(2)

    act(() => { ioCallback?.([{ isIntersecting: true }]) })
    expect(setSize).toHaveBeenCalledTimes(2)
  })

  it('does not call setSize when the sentinel is not intersecting', () => {
    const setSize = vi.fn()
    const { result } = renderHook(() => useLoadMoreSentinel(params({ setSize })))

    act(() => { result.current.sentinelCallbackRef(document.createElement('div')) })
    act(() => { ioCallback?.([{ isIntersecting: false }]) })

    expect(setSize).not.toHaveBeenCalled()
  })

  it('does not load more while a fetch is in flight or there is no next page', () => {
    const setSize = vi.fn()
    const { result, rerender } = renderHook(
      (p: LoadMoreSentinelParams) => useLoadMoreSentinel(p),
      { initialProps: params({ setSize, isValidating: true }) },
    )

    act(() => { result.current.sentinelCallbackRef(document.createElement('div')) })
    act(() => { ioCallback?.([{ isIntersecting: true }]) })
    expect(setSize).not.toHaveBeenCalled()

    rerender(params({ setSize, hasMore: false, isValidating: false }))
    act(() => { ioCallback?.([{ isIntersecting: true }]) })
    expect(setSize).not.toHaveBeenCalled()
  })

  it('keeps sentinelCallbackRef identity across renders', () => {
    const { result, rerender } = renderHook(
      (p: LoadMoreSentinelParams) => useLoadMoreSentinel(p),
      { initialProps: params() },
    )
    const first = result.current.sentinelCallbackRef
    rerender(params({ size: 2 }))
    expect(result.current.sentinelCallbackRef).toBe(first)
  })
})
