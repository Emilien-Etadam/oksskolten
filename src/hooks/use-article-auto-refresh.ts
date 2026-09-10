import { useEffect, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '../lib/fetcher'
import { isArticleListKey } from './use-fetch-progress'
import { refreshArticleLists } from '../lib/article-list-refresh'
import type { FeedWithCounts } from '../../shared/types'

export const AUTO_REFRESH_INTERVAL_MS = 60_000

/**
 * Keep a tab that stays open current.
 *
 * Revalidation is off app-wide, so a list never refetches on its own, and the
 * server's scheduled fetch has no way to tell the client it found something.
 * A tab left on the inbox showed the same articles until the page was
 * reloaded.
 *
 * Poll the feed counts while the tab is visible (SWR pauses the interval in a
 * background tab). When a feed's article count moves, revalidate the lists.
 * Unread counts are left out on purpose: they change as the reader marks
 * articles, and refetching an unread-only list on that would pull articles
 * out from under them.
 */
export function useArticleAutoRefresh(intervalMs = AUTO_REFRESH_INTERVAL_MS): void {
  const { mutate } = useSWRConfig()
  const { data } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher, {
    refreshInterval: intervalMs,
  })
  const lastSignature = useRef<string | null>(null)

  useEffect(() => {
    if (!data?.feeds) return
    const signature = data.feeds.map(f => `${f.id}:${f.article_count}`).join(',')
    if (lastSignature.current !== null && signature !== lastSignature.current) {
      void mutate(isArticleListKey)
      refreshArticleLists()
    }
    lastSignature.current = signature
  }, [data, mutate])
}
