import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo, Fragment } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/fetcher'
import { useArticlePages } from '../hooks/use-article-pages'
import { useReadOnScroll } from '../hooks/use-read-on-scroll'
import { useLoadMoreSentinel } from '../hooks/use-load-more-sentinel'
import { useKeyboardListSync } from '../hooks/use-keyboard-list-sync'
import { useDayGroups } from '../hooks/use-day-groups'
import { useI18n } from '@/i18n'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'
import { useClipFeedId } from '@/hooks/use-clip-feed-id'
import { useAppLayout } from '@/app'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { FeedMetricsBar, FeedErrorBanner } from '@/features/feeds'
import { SwipeableArticleCard } from './swipeable-article-card'
import { DaySeparator, dayKeyOf } from './day-separator'
import { articleUrlToPath } from '@/lib/url'
import { ArticleOverlay } from './article-overlay'
import { PullToRefresh } from '@/components/layout/pull-to-refresh'
import { useFetchProgressContext } from '@/contexts/fetch-progress-context'
import { toast } from 'sonner'
import { Mascot } from '@/components/ui/mascot'
import { Skeleton } from '@/components/ui/skeleton'
import { useKeyboardNavigation } from '@/hooks/use-keyboard-navigation'
import { apiPatch } from '@/lib/fetcher'
import type { ArticleListItem, FeedWithCounts } from '../../../../shared/types'
import type { LayoutName } from '@/data/layouts'

export interface ArticleListHandle {
  revalidate: () => void
}

export const ArticleList = forwardRef<ArticleListHandle, object>(function ArticleList(_props, ref) {
  const location = useLocation()
  const navigate = useNavigate()
  const { feedId: feedIdParam, categoryId: categoryIdParam, folderId: folderIdParam } = useParams<{ feedId?: string; categoryId?: string; folderId?: string }>()
  const { settings } = useAppLayout()
  const clipFeedId = useClipFeedId()

  const isInbox = location.pathname === '/inbox'
  const isBookmarks = location.pathname === '/bookmarks'
  const isLikes = location.pathname === '/likes'
  const isHistory = location.pathname === '/history'
  const isClips = location.pathname === '/clips'
  // Fork: the Recommended list (interest profile) and smart folders (saved queries)
  const isRecommended = location.pathname === '/recommended'
  const smartFolderId = folderIdParam ? Number(folderIdParam) : undefined
  const isCollectionView = isBookmarks || isLikes || isHistory || isClips || isRecommended || !!smartFolderId

  const { data: feedsData } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)
  const feedId = feedIdParam ? Number(feedIdParam) : (isClips && clipFeedId ? clipFeedId : undefined)
  const currentFeed = feedId && feedsData ? feedsData.feeds.find(f => f.id === feedId) : undefined
  const categoryId = categoryIdParam ? Number(categoryIdParam) : undefined
  const [showReadArticles, setShowReadArticles] = useState(false)
  const categoryUnreadOnly = !!categoryId && settings.categoryUnreadOnly === 'on'
  const unreadOnly = isInbox || isRecommended || (categoryUnreadOnly && !showReadArticles)
  const bookmarkedOnly = isBookmarks
  const likedOnly = isLikes
  const readOnly = isHistory
  const { autoMarkRead, dateMode, indicatorStyle, layout, articleOpenMode, keyboardNavigation, keybindings } = settings
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null)
  const [noFloor, setNoFloor] = useState(false)
  const displayConfig: ArticleDisplayConfig = useMemo(() => ({
    dateMode,
    indicatorStyle,
    showUnreadIndicator: settings.showUnreadIndicator === 'on',
    showThumbnails: settings.showThumbnails === 'on',
  }), [dateMode, indicatorStyle, settings.showUnreadIndicator, settings.showThumbnails])
  const isGridLayout = layout === 'card' || layout === 'magazine'
  const { t } = useI18n()
  const { progress, startFeedFetch } = useFetchProgressContext()
  const { mutate: globalMutate } = useSWRConfig()
  const { articles, groupCounts, absorbedIdsRef, data, error, size, setSize, isLoading, isValidating, mutate } = useArticlePages({
    smartFolderId,
    isRecommended,
    feedId,
    categoryId,
    unreadOnly,
    bookmarkedOnly,
    likedOnly,
    readOnly,
    noFloor,
    isCollectionView,
  })

  useImperativeHandle(ref, () => ({
    revalidate: () => mutate(),
  }), [mutate])
  const hasMore = data ? data[data.length - 1]?.has_more ?? false : false
  const isEmpty = data?.[0]?.articles.length === 0
  const totalAll = data?.[0]?.total_all
  const allReadEmpty = isEmpty && categoryUnreadOnly && !showReadArticles && totalAll != null && totalAll > 0
  const hiddenByFloor = data?.[0]?.total_without_floor != null
    ? data[0].total_without_floor - (data[0].total ?? 0)
    : 0

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------
  const { focusedItemId, setFocusedItemId, articleIds, articleMap } = useKeyboardListSync(articles, location.pathname)
  const isKeyboardNavEnabled = keyboardNavigation === 'on' && !isGridLayout

  // /likes and /history are ordered by liked_at / read_at, so publication days
  // would not run in order there — no separators in those two lists.
  const showDaySeparators = !isLikes && !isHistory && !isRecommended && !smartFolderId

  const isOverlayMode = articleOpenMode === 'overlay'
  // Short debounce after overlay close to prevent Escape from immediately clearing focus
  const escapeDebounceRef = useRef(false)

  useKeyboardNavigation({
    items: articleIds,
    focusedItemId,
    onFocusChange: (id) => {
      setFocusedItemId(id)
      const el = document.querySelector(`[data-article-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Overlay mode: open article immediately on j/k
      if (isOverlayMode) {
        const article = articleMap.get(id)
        if (article) setOverlayUrl(article.url)
      }
    },
    onEnter: isOverlayMode ? undefined : (id) => {
      // Page mode: Enter to navigate
      const article = articleMap.get(id)
      if (article) {
        void navigate(articleUrlToPath(article.url))
      }
    },
    onEscape: () => {
      if (escapeDebounceRef.current) return
      setFocusedItemId(null)
    },
    onBookmarkToggle: (id) => {
      const article = articleMap.get(id)
      if (!article) return
      const next = !article.bookmarked_at
      // Optimistic update on the list's SWR cache
      void mutate(
        (pages) => pages?.map(page => ({
          ...page,
          articles: page.articles.map(a =>
            String(a.id) === id
              ? { ...a, bookmarked_at: next ? new Date().toISOString() : null }
              : a
          ),
        })),
        { revalidate: false },
      )
      // Also update the by-url cache so an open overlay (article-detail) reflects
      // the change immediately. ArticleDetail keys its SWR off the article URL,
      // which is a separate cache from the list and would otherwise stay stale.
      const byUrlKey = `/api/articles/by-url?url=${encodeURIComponent(article.url)}`
      void globalMutate(
        byUrlKey,
        (curr: { bookmarked_at: string | null } | undefined) =>
          curr ? { ...curr, bookmarked_at: next ? new Date().toISOString() : null } : curr,
        { revalidate: false },
      )
      apiPatch(`/api/articles/${article.id}/bookmark`, { bookmarked: next })
        .then(() => {
          void globalMutate((key: string) => typeof key === 'string' && key.startsWith('/api/feeds'))
        })
        .catch(() => {
          // Roll back on failure
          void mutate()
          void globalMutate(byUrlKey)
        })
    },
    onOpenExternal: (id) => {
      const article = articleMap.get(id)
      if (article?.url) window.open(article.url, '_blank')
    },
    onNearEnd: () => loadMoreRef.current(),
    enabled: isKeyboardNavEnabled,
    keyBindings: keybindings,
  })

  const { loadMoreRef, sentinelCallbackRef } = useLoadMoreSentinel({
    hasMore,
    isValidating,
    size,
    setSize,
  })

  const isTouchDevice = useIsTouchDevice()
  const listRef = useRef<HTMLElement>(null)

  const { autoReadIds, setAutoReadIds, markRead, markReadWithGroup, isAutoMarkEnabled } = useReadOnScroll({
    autoMarkRead,
    listRef,
    absorbedIdsRef,
    feedId,
    categoryId,
    smartFolderId,
  })

  // Reset autoReadIds, noFloor, showReadArticles, and keyboard focus when feed/category changes
  useEffect(() => {
    setAutoReadIds(new Set())
    setNoFloor(false)
    setShowReadArticles(false)
    setFocusedItemId(null)
  }, [feedId, categoryId, smartFolderId, setFocusedItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  function renderArticle(article: ArticleListItem, index: number) {
    const isAutoRead = autoReadIds.has(article.id)
    const effectiveArticle = isAutoRead
      ? { ...article, seen_at: article.seen_at ?? new Date().toISOString() }
      : article
    const handleOverlayOpen = articleOpenMode === 'overlay' ? (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.button === 1) return
      e.preventDefault()
      setOverlayUrl(article.url)
    } : undefined
    const cardProps = {
      article: effectiveArticle,
      layout,
      isFeatured: layout === 'magazine' && index === 0,
      onClick: handleOverlayOpen,
      onMarkRead: markReadWithGroup,
      groupCount: groupCounts.get(article.id),
      ...displayConfig,
    }
    const isKbFocused = focusedItemId === String(article.id)
    return (
      <div
        key={article.id}
        data-article-id={article.id}
        data-article-unread={article.seen_at == null && !isAutoRead ? '1' : '0'}
        aria-selected={isKbFocused || undefined}
        className={layout === 'magazine' && index === 0 ? 'col-span-full' : ''}
        style={isKbFocused ? {
          borderLeft: '2px solid var(--color-accent)',
          backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
        } : undefined}
        onClick={() => {
          if (!isGridLayout) {
            setFocusedItemId(String(article.id))
          }
          // Opening a grouped story marks the absorbed duplicates too
          for (const id of absorbedIdsRef.current.get(article.id) ?? []) {
            markRead(id)
          }
        }}
      >
        {isTouchDevice ? (
          <SwipeableArticleCard {...cardProps} />
        ) : (
          <ArticleCard {...cardProps} />
        )}
      </div>
    )
  }

  const dayGroups = useDayGroups(articles, showDaySeparators, isGridLayout)

  return (
    <main ref={listRef} className="max-w-2xl mx-auto" role={!isGridLayout ? 'listbox' : undefined}>
      {isTouchDevice && <PullToRefresh onRefresh={async () => {
        if (feedId) {
          const result = await startFeedFetch(feedId)
          const name = currentFeed?.name ?? ''
          if (result.error) toast.error(t('toast.fetchError', { name }))
          else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name }))
          else toast(t('toast.noNewArticles', { name }))
        } else {
          await mutate()
        }
      }} />}

      {currentFeed && currentFeed.type !== 'clip' && settings.showFeedActivity === 'on' && (
        <FeedMetricsBar feed={currentFeed} />
      )}

      {isLoading && <ArticleListSkeleton layout={layout} showThumbnails={displayConfig.showThumbnails} />}

      {error && (
        <div className="text-center py-12">
          <p className="text-muted mb-2">{t('articles.loadError')}</p>
          <button onClick={() => setSize(1)} className="text-accent text-sm">
            {t('articles.retry')}
          </button>
        </div>
      )}

      {allReadEmpty && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted mb-3">{t('articles.allRead')}</p>
          <button
            onClick={() => setShowReadArticles(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showReadArticles')}
          </button>
        </div>
      )}

      {isEmpty && !allReadEmpty && !isLoading && currentFeed && feedId && progress.has(feedId) && (
        <FeedErrorBanner
          lastError={currentFeed.last_error ?? ''}
          feedId={currentFeed.id}
          overridePhase="processing"
        />
      )}

      {isEmpty && !allReadEmpty && !isLoading && !(feedId && progress.has(feedId)) && (
        currentFeed?.last_error ? (
          <FeedErrorBanner
            lastError={currentFeed.last_error}
            feedId={currentFeed.id}
            onMutate={async () => {
              await globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds'))
            }}
            onFetch={currentFeed.type !== 'clip' ? async () => {
              const result = await startFeedFetch(currentFeed.id)
              const name = currentFeed.name
              if (result.error) toast.error(t('toast.fetchError', { name }))
              else if (result.totalNew > 0) { toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name })); void mutate() }
              else toast(t('toast.noNewArticles', { name }))
            } : undefined}
          />
        ) : (
          <p className="text-muted text-center py-12">{t(smartFolderId ? 'smart.empty' : 'articles.empty')}</p>
        )
      )}

      <div className={isGridLayout ? 'grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6' : ''}>
        {dayGroups
          ? dayGroups.map(group => (
              // One section per publication day: a sticky header only unsticks
              // when its own section scrolls away, otherwise every day's header
              // would pile up at the same offset.
              <section key={group.key}>
                <DaySeparator date={group.date} />
                {group.items.map(({ article, index }) => renderArticle(article, index))}
              </section>
            ))
          : articles.map((article, index) => {
              const previous = index > 0 ? articles[index - 1] : null
              const startsNewDay = showDaySeparators && (
                previous == null || dayKeyOf(article.published_at) !== dayKeyOf(previous.published_at)
              )
              const card = renderArticle(article, index)
              if (!startsNewDay) return card
              return (
                <Fragment key={`day-${article.id}`}>
                  <DaySeparator date={article.published_at} sticky={false} className="col-span-full" />
                  {card}
                </Fragment>
              )
            })}
      </div>

      {hasMore && (
        <div ref={sentinelCallbackRef} className="py-4">
          {isValidating && <ArticleListSkeleton layout={layout} count={2} showThumbnails={displayConfig.showThumbnails} />}
        </div>
      )}

      {!hasMore && hiddenByFloor > 0 && (
        <div className="text-center py-6">
          <button
            onClick={() => setNoFloor(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showOlder', { count: String(hiddenByFloor) })}
          </button>
        </div>
      )}

      {/* Scroll spacer: ensures the last article can scroll past the header for auto-mark-read */}
      {!hasMore && articles.length > 0 && isAutoMarkEnabled && !isCollectionView && (
        <div
          className="flex flex-col items-center justify-end select-none"
          style={{ minHeight: 'calc(100vh - var(--header-height))' }}
        >
          {settings.mascot !== 'off' && (
            <>
              <div>
                <Mascot choice={settings.mascot} />
              </div>
              <p className="text-muted/40 text-xs mt-4 pb-4">{t('articles.allCaughtUp')}</p>
            </>
          )}
        </div>
      )}

      <ArticleOverlay articleUrl={overlayUrl} onClose={() => {
        setOverlayUrl(null)
        escapeDebounceRef.current = true
        setTimeout(() => { escapeDebounceRef.current = false }, 100)
      }} />
    </main>
  )
})

function ArticleListSkeleton({ layout = 'list', count = 3, showThumbnails = true }: { layout?: LayoutName; count?: number; showThumbnails?: boolean }) {
  if (layout === 'compact') {
    return (
      <>
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border-b border-border py-1.5 px-4 md:px-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          </div>
        ))}
      </>
    )
  }

  if (layout === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6">
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            {showThumbnails && <Skeleton className="w-full aspect-video" />}
            <div className="p-3 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-1">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (layout === 'magazine') {
    return (
      <>
        {/* Hero skeleton */}
        <div className="border border-border rounded-lg overflow-hidden mb-4 mx-4 md:mx-6">
          {showThumbnails && <Skeleton className="w-full aspect-video" />}
          <div className="p-4 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <div className="flex items-center gap-1 mt-1">
              <Skeleton className="w-3.5 h-3.5 shrink-0" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
        {/* Small card skeletons */}
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-3 border-b border-border py-2 px-4 md:px-6">
            {showThumbnails && <Skeleton className="w-12 h-12 shrink-0" />}
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-0.5">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </>
    )
  }

  // Default: list layout
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-border py-3 px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="w-3 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-0.5">
                <Skeleton className="w-3.5 h-3.5 shrink-0" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            {showThumbnails && <Skeleton className="w-16 h-16 shrink-0" />}
          </div>
        </div>
      ))}
    </>
  )
}
