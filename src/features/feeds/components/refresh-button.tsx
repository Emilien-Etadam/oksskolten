import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { fetcher } from '@/lib/fetcher'
import { fetchAllFeeds } from '@/lib/feed-refresh'
import { useI18n } from '@/i18n'
import { useFetchProgressContext } from '@/contexts/fetch-progress-context'
import { IconButton } from '@/components/ui/icon-button'
import type { FeedWithCounts } from '../../../../shared/types'

type FeedsData = { feeds: FeedWithCounts[] }

/** Articles held by the feeds a refresh covers, as of the given payload. */
function countArticles(feeds: FeedWithCounts[] | undefined, inScope: (feed: FeedWithCounts) => boolean): number | null {
  if (!feeds) return null
  return feeds.filter(inScope).reduce((sum, feed) => sum + feed.article_count, 0)
}

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
  const { startFeedFetch, revalidate } = useFetchProgressContext()
  const { mutate: globalMutate } = useSWRConfig()
  const { data: feedsData } = useSWR<FeedsData>('/api/feeds', fetcher)
  const [running, setRunning] = useState(false)

  const refresh = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      const feedMatch = /^\/feeds\/(\d+)/.exec(location.pathname)
      const categoryMatch = /^\/categories\/(\d+)/.exec(location.pathname)
      const inScope = feedMatch
        ? (feed: FeedWithCounts) => feed.id === Number(feedMatch[1])
        : categoryMatch
          ? (feed: FeedWithCounts) => feed.category_id === Number(categoryMatch[1]) && feed.type !== 'clip'
          : (feed: FeedWithCounts) => feed.type !== 'clip'
      const before = countArticles(feedsData?.feeds, inScope)
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

      // What the run pulled from the sources is not what reaches the list: the
      // scheduled fetch may have brought articles in since this tab last looked,
      // and those are new to the reader even though this run found nothing. Read
      // the counts back and report whichever number is larger.
      const fresh = await globalMutate<FeedsData>('/api/feeds')
      const after = countArticles(fresh?.feeds, inScope)
      const appeared = before != null && after != null ? Math.max(0, after - before) : 0
      const count = Math.max(totalNew, appeared)

      if (count > 0) toast.success(t('refresh.done', { count: String(count) }))
      else toast(t('refresh.upToDate'))
    } catch {
      toast.error(t('refresh.failed'))
    } finally {
      setRunning(false)
      // A single-feed fetch revalidates on its own; the server-side pass
      // does not, and without this the list stayed as it was while the
      // toast announced new articles.
      revalidate()
    }
  }, [running, location.pathname, startFeedFetch, feedsData, globalMutate, revalidate, t])

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
