import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR, { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, CheckCheck, FolderInput, Plus, Power, RefreshCw, Search, Trash2 } from 'lucide-react'
import { fetcher } from '../../../lib/fetcher'
import { useI18n } from '../../../lib/i18n'
import { formatRelativeDate } from '../../../lib/dateFormat'
import { extractDomain } from '../../../lib/url'
import { useFetchProgressContext } from '../../../contexts/fetch-progress-context'
import { useFeedSelection } from '../../../hooks/use-feed-selection'
import { useFeedBulkActions } from '../../../hooks/use-feed-bulk-actions'
import { FeedModal } from '../../../components/feed/feed-modal'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { FeedWithCounts, Category } from '../../../../shared/types'

type FeedsData = { feeds: FeedWithCounts[]; bookmark_count: number; like_count: number; clip_feed_id: number | null }

/** Number of days without new articles before a feed is considered inactive (same rule as the sidebar) */
const STALE_FEED_DAYS = 90

type FeedStatus = 'ok' | 'error' | 'disabled' | 'inactive'

const STATUS_ORDER: Record<FeedStatus, number> = { error: 0, disabled: 1, inactive: 2, ok: 3 }

function getStatus(feed: FeedWithCounts): FeedStatus {
  if (feed.disabled) return 'disabled'
  if (feed.last_error) return 'error'
  const staleMs = STALE_FEED_DAYS * 24 * 60 * 60 * 1000
  if (feed.article_count > 0 && (!feed.latest_published_at || Date.now() - new Date(feed.latest_published_at).getTime() >= staleMs)) {
    return 'inactive'
  }
  return 'ok'
}

function formatPerWeek(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)
}

type SortKey = 'name' | 'category' | 'articles' | 'unread' | 'perWeek' | 'latest' | 'status'
type SortDir = 'asc' | 'desc'

/** Sort keys that read most naturally as "largest first" on the initial click */
const DESC_FIRST: SortKey[] = ['articles', 'unread', 'perWeek', 'latest']

function compare(a: FeedWithCounts, b: FeedWithCounts, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'category':
      return (a.category_name ?? '').localeCompare(b.category_name ?? '')
    case 'articles':
      return a.article_count - b.article_count
    case 'unread':
      return a.unread_count - b.unread_count
    case 'perWeek':
      return a.articles_per_week - b.articles_per_week
    case 'latest':
      return new Date(a.latest_published_at ?? 0).getTime() - new Date(b.latest_published_at ?? 0).getTime()
    case 'status':
      return STATUS_ORDER[getStatus(b)] - STATUS_ORDER[getStatus(a)]
  }
}

const STATUS_STYLE: Record<FeedStatus, string> = {
  ok: 'text-accent',
  error: 'text-error',
  disabled: 'text-muted',
  inactive: 'text-warning',
}

function StatusBadge({ status, title }: { status: FeedStatus; title?: string }) {
  const { t } = useI18n()
  const labelKey = {
    ok: 'settings.feedsStatusOk',
    error: 'settings.feedsStatusError',
    disabled: 'settings.feedsStatusDisabled',
    inactive: 'settings.feedsStatusInactive',
  }[status] as 'settings.feedsStatusOk'

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${STATUS_STYLE[status]}`} title={title}>
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {t(labelKey)}
    </span>
  )
}

interface SortableHeaderProps {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}

function SortableHeader({ label, sortKey, active, dir, onSort, className = '' }: SortableHeaderProps) {
  const isActive = active === sortKey
  return (
    <th scope="col" className={`px-3 py-2 font-medium ${className}`} aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-text transition-colors ${isActive ? 'text-text' : ''}`}
      >
        {label}
        {isActive && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )
}

export function FeedManagementSection() {
  const { t, locale } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const { data, mutate: mutateFeeds, isLoading } = useSWR<FeedsData>('/api/feeds', fetcher)
  const { data: categoriesData } = useSWR<{ categories: Category[] }>('/api/categories', fetcher)
  const { startFeedFetch, subscribeFeedFetch } = useFetchProgressContext()

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const categories = useMemo(() => categoriesData?.categories ?? [], [categoriesData])
  const feeds = useMemo(() => (data?.feeds ?? []).filter(f => f.type !== 'clip'), [data])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = feeds.filter(feed => {
      if (needle && !feed.name.toLowerCase().includes(needle) && !feed.url.toLowerCase().includes(needle)) return false
      if (categoryFilter === 'none' && feed.category_id !== null) return false
      if (categoryFilter !== 'all' && categoryFilter !== 'none' && String(feed.category_id) !== categoryFilter) return false
      if (statusFilter !== 'all' && getStatus(feed) !== statusFilter) return false
      return true
    })
    const sign = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => compare(a, b, sortKey) * sign || a.name.localeCompare(b.name))
  }, [feeds, query, categoryFilter, statusFilter, sortKey, sortDir])

  const visibleIds = useMemo(() => visible.map(f => f.id), [visible])
  const { selectedFeedIds, toggleSelect, clearSelection, isSelected } = useFeedSelection({ orderedFeedIds: visibleIds })

  // Only feeds currently visible can be acted on, so hidden leftovers from an
  // earlier filter never get silently deleted or moved.
  const actionableIds = useMemo(
    () => new Set(visibleIds.filter(id => selectedFeedIds.has(id))),
    [visibleIds, selectedFeedIds],
  )
  const selectedCount = actionableIds.size
  const hasDisabledSelected = useMemo(
    () => visible.some(f => actionableIds.has(f.id) && f.disabled),
    [visible, actionableIds],
  )

  function revalidateArticles() {
    void globalMutate((key: unknown) => typeof key === 'string' && key.includes('/api/articles'))
  }

  function handleFetchComplete(result: { totalNew: number; error?: boolean; name?: string }) {
    const name = result.name ?? ''
    if (result.error) toast.error(t('toast.fetchError', { name }))
    else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name }))
    else toast(t('toast.noNewArticles', { name }))
  }

  const {
    bulkDeleteConfirm,
    setBulkDeleteConfirm,
    handleBulkMoveToCategory,
    handleBulkMarkAllRead,
    handleBulkFetch,
    handleBulkEnable,
    handleBulkDelete,
    handleBulkDeleteConfirm,
  } = useFeedBulkActions({
    feeds,
    selectedFeedIds: actionableIds,
    mutateFeeds,
    clearSelection,
    startFeedFetch,
    onMarkAllRead: revalidateArticles,
    onFetchComplete: handleFetchComplete,
    onDeleted: revalidateArticles,
  })

  async function runBulk(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(DESC_FIRST.includes(key) ? 'desc' : 'asc')
  }

  function toggleAllVisible() {
    if (selectedCount === visible.length) {
      clearSelection()
      return
    }
    for (const feed of visible) {
      if (!isSelected(feed.id)) toggleSelect(feed.id, true, false)
    }
  }

  const errorCount = useMemo(() => feeds.filter(f => getStatus(f) === 'error' || f.disabled).length, [feeds])
  const unreadTotal = useMemo(() => feeds.reduce((sum, f) => sum + f.unread_count, 0), [feeds])

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-text">{t('settings.feedsManage')}</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors"
        >
          <Plus size={14} />
          {t('modal.addFeed')}
        </button>
      </div>
      <p className="text-xs text-muted mb-4">{t('settings.feedsManageDesc')}</p>

      <p className="text-xs text-muted mb-3 tabular-nums">
        {t('settings.feedsSummary', {
          count: String(feeds.length),
          unread: String(unreadTotal),
          errors: String(errorCount),
        })}
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('settings.feedsSearchPlaceholder')}
            aria-label={t('settings.feedsSearchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="sm:w-44" aria-label={t('settings.feedsAllCategories')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('settings.feedsAllCategories')}</SelectItem>
            <SelectItem value="none">{t('settings.feedsNoCategory')}</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-40" aria-label={t('settings.feedsAllStatuses')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('settings.feedsAllStatuses')}</SelectItem>
            <SelectItem value="ok">{t('settings.feedsStatusOk')}</SelectItem>
            <SelectItem value="error">{t('settings.feedsStatusError')}</SelectItem>
            <SelectItem value="disabled">{t('settings.feedsStatusDisabled')}</SelectItem>
            <SelectItem value="inactive">{t('settings.feedsStatusInactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-border bg-bg-card">
          <span className="text-xs text-muted px-1 tabular-nums">
            {t('feeds.selectedCount', { count: String(selectedCount) })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors outline-none disabled:opacity-50"
              >
                <FolderInput size={14} />
                {t('feeds.bulkMoveToCategory')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void runBulk(() => handleBulkMoveToCategory(null))}>
                {t('settings.feedsNoCategory')}
              </DropdownMenuItem>
              {categories.map(cat => (
                <DropdownMenuItem key={cat.id} onSelect={() => void runBulk(() => handleBulkMoveToCategory(cat.id))}>
                  {cat.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk(handleBulkMarkAllRead)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
          >
            <CheckCheck size={14} />
            {t('feeds.bulkMarkAllRead')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk(handleBulkFetch)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            {t('feeds.bulkFetch')}
          </button>
          {hasDisabledSelected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBulk(handleBulkEnable)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
            >
              <Power size={14} />
              {t('feeds.enable')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={handleBulkDelete}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-error hover:bg-hover transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {t('feeds.bulkDelete', { count: String(selectedCount) })}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-xs text-accent hover:underline px-1"
          >
            {t('settings.feedsClearSelection')}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : feeds.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">{t('settings.feedsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-xs text-muted border-b border-border">
              <tr className="text-left">
                <th scope="col" className="w-9 px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-accent align-middle"
                    checked={visible.length > 0 && selectedCount === visible.length}
                    onChange={toggleAllVisible}
                    aria-label={selectedCount === visible.length ? t('settings.deselectAll') : t('settings.selectAll')}
                  />
                </th>
                <SortableHeader label={t('settings.feedsColName')} sortKey="name" active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortableHeader label={t('settings.feedsColCategory')} sortKey="category" active={sortKey} dir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                <SortableHeader label={t('settings.feedsColArticles')} sortKey="articles" active={sortKey} dir={sortDir} onSort={handleSort} className="hidden sm:table-cell text-right" />
                <SortableHeader label={t('settings.feedsColUnread')} sortKey="unread" active={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortableHeader label={t('settings.feedsColPerWeek')} sortKey="perWeek" active={sortKey} dir={sortDir} onSort={handleSort} className="hidden md:table-cell text-right" />
                <SortableHeader label={t('settings.feedsColLatest')} sortKey="latest" active={sortKey} dir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableHeader label={t('settings.feedsColStatus')} sortKey="status" active={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map(feed => {
                const status = getStatus(feed)
                const domain = extractDomain(feed.url)
                return (
                  <tr key={feed.id} className={`border-b border-border last:border-b-0 ${actionableIds.has(feed.id) ? 'bg-hover' : ''}`}>
                    <td className="px-3 py-2 align-top">
                      {/* Selection is driven from onClick so Shift + Click can extend a
                          range; onChange would fire a second, conflicting toggle. */}
                      <input
                        type="checkbox"
                        className="accent-accent mt-1"
                        checked={actionableIds.has(feed.id)}
                        readOnly
                        onClick={e => toggleSelect(feed.id, !e.shiftKey, e.shiftKey)}
                        aria-label={feed.name}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[18rem]">
                      <Link to={`/feeds/${feed.id}`} className="block text-text hover:text-accent truncate">
                        {feed.name}
                      </Link>
                      {domain && (
                        <a
                          href={feed.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-xs text-muted hover:text-accent truncate"
                        >
                          {domain}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell text-muted truncate max-w-[10rem]">
                      {feed.category_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell text-right text-muted tabular-nums">{feed.article_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {feed.unread_count > 0 ? <span className="text-accent">{feed.unread_count}</span> : <span className="text-muted">0</span>}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell text-right text-muted tabular-nums">
                      {feed.articles_per_week > 0 ? formatPerWeek(feed.articles_per_week) : '—'}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell text-muted whitespace-nowrap">
                      {feed.latest_published_at
                        ? formatRelativeDate(feed.latest_published_at, locale, { justNow: t('date.justNow') })
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={status} title={feed.last_error ?? undefined} />
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">
                    {t('settings.feedsNoMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <FeedModal
          initialStep="feed"
          onClose={() => setAddOpen(false)}
          onCreated={() => void mutateFeeds()}
          onFetchStarted={feedId => void subscribeFeedFetch(feedId)}
          categories={categories}
        />
      )}

      {bulkDeleteConfirm && (
        <ConfirmDialog
          title={t('feeds.deleteFeed')}
          message={t('feeds.bulkDeleteConfirm', { count: String(selectedCount) })}
          confirmLabel={t('feeds.delete')}
          danger
          onConfirm={() => void runBulk(handleBulkDeleteConfirm)}
          onCancel={() => setBulkDeleteConfirm(false)}
        />
      )}
    </section>
  )
}
