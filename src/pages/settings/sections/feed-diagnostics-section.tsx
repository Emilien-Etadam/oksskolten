import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Power, PowerOff, RefreshCw, Search, ShieldAlert, TriangleAlert, Waypoints } from 'lucide-react'
import { fetcher, apiPatch } from '../../../lib/fetcher'
import { useI18n } from '../../../lib/i18n'
import { classifyError, reDetectSSE } from '../../../lib/feed-error'
import { formatRelativeDate } from '../../../lib/dateFormat'
import { extractDomain } from '../../../lib/url'
import { useFetchProgressContext } from '../../../contexts/fetch-progress-context'
import type { FeedWithCounts } from '../../../../shared/types'

type FeedsData = { feeds: FeedWithCounts[]; bookmark_count: number; like_count: number; clip_feed_id: number | null }

type BusyPhase = 'detecting' | 'fetching'

/** Cards shown before the list collapses behind a "show all" button */
const COLLAPSED_LIMIT = 5

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted bg-hover select-none">
      {children}
    </span>
  )
}

export function FeedDiagnosticsSection() {
  const { t, locale } = useI18n()
  const { data, mutate: mutateFeeds } = useSWR<FeedsData>('/api/feeds', fetcher)
  const { startFeedFetch } = useFetchProgressContext()
  const [busy, setBusy] = useState<{ id: number; phase: BusyPhase } | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Disabled feeds first, then the ones failing most persistently.
  const broken = useMemo(
    () => (data?.feeds ?? [])
      .filter(f => f.type !== 'clip' && (f.disabled === 1 || f.last_error))
      .sort((a, b) => b.disabled - a.disabled || b.error_count - a.error_count || a.name.localeCompare(b.name)),
    [data],
  )

  const shown = expanded ? broken : broken.slice(0, COLLAPSED_LIMIT)
  const locked = busy !== null || retryingAll

  function notifyFetch(feed: FeedWithCounts, result: { totalNew: number; error?: boolean }) {
    if (result.error) toast.error(t('toast.fetchError', { name: feed.name }))
    else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name: feed.name }))
    else toast(t('toast.noNewArticles', { name: feed.name }))
  }

  async function handleFetch(feed: FeedWithCounts) {
    if (locked) return
    setBusy({ id: feed.id, phase: 'fetching' })
    try {
      notifyFetch(feed, await startFeedFetch(feed.id))
    } finally {
      setBusy(null)
      void mutateFeeds()
    }
  }

  async function handleReDetect(feed: FeedWithCounts) {
    if (locked) return
    setBusy({ id: feed.id, phase: 'detecting' })
    try {
      await reDetectSSE(feed.id, () => {})
      await mutateFeeds()
      setBusy({ id: feed.id, phase: 'fetching' })
      notifyFetch(feed, await startFeedFetch(feed.id))
    } catch {
      toast.error(t('toast.fetchError', { name: feed.name }))
    } finally {
      setBusy(null)
      void mutateFeeds()
    }
  }

  async function handleEnable(feed: FeedWithCounts) {
    if (locked) return
    setBusy({ id: feed.id, phase: 'fetching' })
    try {
      await apiPatch(`/api/feeds/${feed.id}`, { disabled: 0 })
    } finally {
      setBusy(null)
      void mutateFeeds()
    }
  }

  /**
   * Re-enable and re-fetch every listed feed. Re-detection is deliberately left
   * out: it can rewrite a feed's RSS URL, which is not something to trigger in
   * bulk without looking at the result.
   */
  async function handleRetryAll() {
    if (locked || broken.length === 0) return
    const targets = broken
    setRetryingAll(true)
    let recovered = 0
    try {
      for (const feed of targets) {
        if (feed.disabled) {
          try {
            await apiPatch(`/api/feeds/${feed.id}`, { disabled: 0 })
          } catch {
            continue
          }
        }
        const result = await startFeedFetch(feed.id)
        if (!result.error) recovered++
      }
      toast.success(t('settings.feedsRetryAllResult', { recovered: String(recovered), total: String(targets.length) }))
    } finally {
      setRetryingAll(false)
      void mutateFeeds()
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-text">{t('settings.feedsDiagnostics')}</h2>
        {broken.length > 0 && (
          <button
            type="button"
            onClick={() => void handleRetryAll()}
            disabled={locked}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
          >
            {retryingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('settings.feedsRetryAll')}
          </button>
        )}
      </div>
      <p className="text-xs text-muted mb-4">{t('settings.feedsDiagnosticsDesc')}</p>

      {broken.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CheckCircle2 size={16} className="text-accent shrink-0" />
          {t('settings.feedsAllHealthy')}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map(feed => {
            const classification = feed.last_error ? classifyError(feed.last_error) : null
            const domain = extractDomain(feed.url)
            const phase = busy?.id === feed.id ? busy.phase : null
            const actions = classification?.actions ?? ['fetch']

            return (
              <article key={feed.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {feed.disabled === 1 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted shrink-0">
                      <PowerOff size={13} />
                      {t('settings.feedsStatusDisabled')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-error shrink-0">
                      <TriangleAlert size={13} />
                      {t('settings.feedsStatusError')}
                    </span>
                  )}
                  <Link to={`/feeds/${feed.id}`} className="text-sm text-text hover:text-accent truncate">
                    {feed.name}
                  </Link>
                  {domain && <span className="text-xs text-muted truncate">{domain}</span>}
                </div>

                <p className="text-sm text-text mt-2">
                  {classification
                    ? t(classification.i18nKey, classification.i18nParams)
                    : t('settings.feedsDisabledNoError')}
                </p>

                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  {classification && (
                    <Chip>{t(`feedError.stage.${classification.failedStage}` as 'feedError.stage.fetch')}</Chip>
                  )}
                  {feed.error_count > 0 && <Chip>{t('settings.feedsFailureCount', { count: String(feed.error_count) })}</Chip>}
                  {feed.rss_bridge_url && <Chip><Waypoints size={10} />{t('settings.feedsViaBridge')}</Chip>}
                  {feed.requires_js_challenge === 1 && <Chip><ShieldAlert size={10} />{t('settings.feedsJsChallenge')}</Chip>}
                  <Chip>
                    {t('settings.feedsColLatest')}:{' '}
                    {feed.latest_published_at
                      ? formatRelativeDate(feed.latest_published_at, locale, { justNow: t('date.justNow') })
                      : t('settings.feedsNoArticleYet')}
                  </Chip>
                </div>

                {feed.last_error && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted cursor-pointer select-none hover:text-text">
                      {t('settings.feedsRawError')}
                    </summary>
                    <code className="block mt-1 text-xs text-muted font-mono break-all whitespace-pre-wrap">
                      {feed.last_error}
                    </code>
                  </details>
                )}

                <div className="flex items-center gap-2 flex-wrap mt-3">
                  {actions.map(action => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void (action === 'reDetect' ? handleReDetect(feed) : handleFetch(feed))}
                      disabled={locked}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
                    >
                      {phase ? <Loader2 size={14} className="animate-spin" /> : action === 'reDetect' ? <Search size={14} /> : <RefreshCw size={14} />}
                      {action === 'reDetect' ? t('feedError.reDetect') : t('feedError.retry')}
                    </button>
                  ))}
                  {feed.disabled === 1 && (
                    <button
                      type="button"
                      onClick={() => void handleEnable(feed)}
                      disabled={locked}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
                    >
                      <Power size={14} />
                      {t('feeds.enable')}
                    </button>
                  )}
                  {phase && (
                    <span className="text-xs text-muted">
                      {phase === 'detecting' ? t('settings.feedsDetecting') : t('settings.feedsFetching')}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
          {!expanded && broken.length > COLLAPSED_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs text-accent hover:underline"
            >
              {t('settings.feedsShowAll', { count: String(broken.length) })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
