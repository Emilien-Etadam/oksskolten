import { useState, useRef, useEffect, useCallback, type RefObject } from 'react'
import { useSWRConfig } from 'swr'
import { markSeenOnServer } from '@/lib/markSeenWithQueue'
import { trackRead } from '@/lib/readTracker'

/** How often (ms) to flush the batch of read article IDs to the server */
export const BATCH_FLUSH_INTERVAL = 1500

export function useReadOnScroll({ autoMarkRead, listRef, absorbedIdsRef, feedId, categoryId, smartFolderId }: {
  autoMarkRead: string; listRef: RefObject<HTMLElement | null>
  absorbedIdsRef: RefObject<Map<number, number[]>>
  feedId: number | undefined; categoryId: number | undefined; smartFolderId: number | undefined
}) {
  const { mutate: globalMutate } = useSWRConfig()
  const [autoReadIds, setAutoReadIds] = useState<Set<number>>(() => new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const batchQueue = useRef(new Set<number>())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBatch = useCallback(() => {
    if (batchQueue.current.size === 0) return
    const ids = [...batchQueue.current]
    batchQueue.current.clear()
    markSeenOnServer(ids)
      .then(() => globalMutate(
        (key: string) => typeof key === 'string' && key.startsWith('/api/feeds'),
      ))
      .catch(() => {})
  }, [globalMutate])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushBatch()
    }, BATCH_FLUSH_INTERVAL)
  }, [flushBatch])

  // Mark an article as read: instant UI update + queue for server batch
  const markRead = useCallback((articleId: number) => {
    setAutoReadIds(prev => {
      if (prev.has(articleId)) return prev
      const next = new Set(prev)
      next.add(articleId)
      return next
    })
    trackRead(articleId)
    batchQueue.current.add(articleId)
    scheduleFlush()
  }, [scheduleFlush])

  // Mark an article and its absorbed similar articles as read together
  const markReadWithGroup = useCallback((articleId: number) => {
    markRead(articleId)
    for (const id of absorbedIdsRef.current.get(articleId) ?? []) {
      markRead(id)
    }
  }, [markRead]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the observer callback always sees the latest markRead
  const markReadRef = useRef(markReadWithGroup)
  markReadRef.current = markReadWithGroup

  const isAutoMarkEnabled = autoMarkRead === 'on'

  // Create the IntersectionObserver once when auto-mark is enabled.
  // The observer instance is kept stable — new article nodes from infinite
  // scroll are added incrementally via a separate effect, avoiding the
  // disconnect/recreate race that caused missed or phantom read events.
  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!isAutoMarkEnabled) return

    // Measure actual header height in pixels — iOS Safari rejects rootMargin
    // values containing calc() or env() that getComputedStyle may return.
    const headerEl = document.querySelector('[data-header]') as HTMLElement | null
    const headerH = headerEl ? `${headerEl.offsetHeight}px` : '48px'

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const articleId = Number(el.dataset.articleId)
          if (!articleId) continue
          if (el.dataset.articleUnread !== '1') continue

          const rootTop = entry.rootBounds?.top ?? 0
          if (entry.boundingClientRect.top < rootTop) {
            markReadRef.current(articleId)
          }
        }
      },
      {
        rootMargin: `-${headerH} 0px 0px 0px`,
        threshold: [0, 1],
      },
    )

    observerRef.current = observer

    // Observe all article nodes already in the DOM
    if (listRef.current) {
      const nodes = listRef.current.querySelectorAll<HTMLElement>('[data-article-id]')
      nodes.forEach(node => observer.observe(node))
    }

    return () => observer.disconnect()
  }, [isAutoMarkEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Incrementally observe new article nodes added by infinite scroll.
  // Uses a MutationObserver to detect inserted DOM nodes so the
  // IntersectionObserver instance stays stable (no disconnect/recreate).
  useEffect(() => {
    const list = listRef.current
    const io = observerRef.current
    if (!list || !io || !isAutoMarkEnabled) return

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          // The node itself might be an article wrapper
          if (node.dataset.articleId) {
            io.observe(node)
          }
          // Or it might contain article wrappers (e.g. fragment insert)
          const children = node.querySelectorAll<HTMLElement>('[data-article-id]')
          children.forEach(child => io.observe(child))
        }
      }
    })

    mo.observe(list, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [isAutoMarkEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush remaining batch on unmount or feed/category change
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushBatch()
    }
  }, [feedId, categoryId, smartFolderId, flushBatch])
  return { autoReadIds, setAutoReadIds, markRead, markReadWithGroup, isAutoMarkEnabled }
}
