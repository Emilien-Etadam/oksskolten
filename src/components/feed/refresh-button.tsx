import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { fetcher } from '../../lib/fetcher'
import { fetchAllFeeds } from '../../lib/feed-refresh'
import { useI18n } from '../../lib/i18n'
import { useFetchProgressContext } from '../../contexts/fetch-progress-context'
import { IconButton } from '../ui/icon-button'
import type { FeedWithCounts } from '../../../shared/types'

/**
 * Fetch the feeds behind the list currently on screen. Until now the only way
 * to trigger a fetch on desktop was the sidebar context menu, which nothing
 * advertises; pull-to-refresh covered touch devices only.
 *
 * Scope follows the route: one feed on /feeds/:id, a category's feeds on
 * /categories/:id, and every enabled feed anywhere else (inbox, read later,
 * clips…), where a single server-side run beats firing one request per feed.
 */
export function RefreshButton() {
  const { t } = useI18n()
  const location = useLocation()
  const { startFeedFetch } = useFetchProgressContext()
  const { data: feedsData, mutate: mutateFeeds } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)
  const [running, setRunning] = useState(false)

  const refresh = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      const feedMatch = /^\/feeds\/(\d+)/.exec(location.pathname)
      const categoryMatch = /^\/categories\/(\d+)/.exec(location.pathname)
      let totalNew = 0

      if (feedMatch) {
        const result = await startFeedFetch(Number(feedMatch[1]))
        if (result.error) throw new Error('fetch failed')
        totalNew = result.totalNew
      } else if (categoryMatch) {
        const categoryId = Number(categoryMatch[1])
        const feeds = (feedsData?.feeds ?? []).filter(f => f.category_id === categoryId && !f.disabled && f.type !== 'clip')
        for (const feed of feeds) {
          const result = await startFeedFetch(feed.id)
          totalNew += result.totalNew
        }
      } else {
        totalNew = (await fetchAllFeeds()).totalNew
      }

      if (totalNew > 0) toast.success(t('refresh.done', { count: String(totalNew) }))
      else toast(t('refresh.upToDate'))
    } catch {
      toast.error(t('refresh.failed'))
    } finally {
      setRunning(false)
      void mutateFeeds()
    }
  }, [running, location.pathname, startFeedFetch, feedsData, mutateFeeds, t])

  return (
    <IconButton
      size="lg"
      onClick={() => void refresh()}
      disabled={running}
      className="text-text hover:text-text"
      aria-label={running ? t('refresh.running') : t('refresh.action')}
    >
      {running
        ? <Loader2 size={18} strokeWidth={1.5} className="animate-spin" />
        : <RefreshCw size={18} strokeWidth={1.5} />}
    </IconButton>
  )
}
