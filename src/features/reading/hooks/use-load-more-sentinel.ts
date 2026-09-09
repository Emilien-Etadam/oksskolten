import { useRef, useEffect, useCallback } from 'react'

export interface LoadMoreSentinelParams {
  hasMore: boolean
  isValidating: boolean
  size: number
  setSize: (size: number | ((size: number) => number)) => void
}

export function useLoadMoreSentinel({
  hasMore,
  isValidating,
  size,
  setSize,
}: LoadMoreSentinelParams) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Keep loadMore in a stable ref so the IntersectionObserver callback
  // always sees the latest values without needing to recreate the observer.
  const loadMoreRef = useRef(() => {})
  loadMoreRef.current = () => {
    if (hasMore && !isValidating) {
      void setSize(size + 1)
    }
  }

  // Stable observer — created once via ref callback when sentinel mounts.
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null)
  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous
    sentinelObserverRef.current?.disconnect()
    sentinelObserverRef.current = null
    sentinelRef.current = node

    if (!node) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreRef.current() },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    sentinelObserverRef.current = observer
  }, [])

  // Re-trigger loading when a fetch completes while sentinel is still visible.
  // IntersectionObserver only fires on threshold crossings, so if the sentinel
  // stays within the viewport after new articles render, no event fires and
  // pagination stalls. This effect covers that gap.
  useEffect(() => {
    if (!isValidating && hasMore && sentinelRef.current) {
      const rect = sentinelRef.current.getBoundingClientRect()
      if (rect.top < window.innerHeight + 200) {
        void setSize(prev => prev + 1)
      }
    }
  }, [isValidating, hasMore, setSize])

  return { sentinelRef, loadMoreRef, sentinelCallbackRef }
}
