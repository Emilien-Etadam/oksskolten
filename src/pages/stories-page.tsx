import { useState } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { fetcher } from '../lib/fetcher'
import { useI18n } from '../lib/i18n'
import { useAppLayout } from '../app'
import { ArticleCard } from '../components/article/article-card'
import { Skeleton } from '../components/ui/skeleton'
import { articleUrlToPath } from '../lib/url'
import { formatRelativeDate } from '../lib/dateFormat'
import type { ArticleListItem } from '../../shared/types'

export interface Story {
  id: number
  leader: ArticleListItem
  others: ArticleListItem[]
  sources: Array<{ feed_id: number; feed_name: string }>
  unread_count: number
  latest_published_at: string | null
}

const WINDOWS = [1, 3, 7] as const
type Window = (typeof WINDOWS)[number]

/**
 * Top stories: one card per event covered by several sources, ranked by
 * breadth of coverage. The leader article is the card; the other coverage
 * folds under it, with the list of sources as a chip row.
 */
export function StoriesPage() {
  const { settings } = useAppLayout()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [days, setDays] = useState<Window>(3)
  const { data } = useSWR<{ stories: Story[] }>(`/api/stories?days=${days}`, fetcher)

  const displayConfig = {
    dateMode: settings.dateMode,
    indicatorStyle: settings.indicatorStyle,
    showUnreadIndicator: settings.showUnreadIndicator === 'on',
    showThumbnails: settings.showThumbnails === 'on',
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-4">
      <div className="flex items-center gap-1.5 mb-3 select-none" role="tablist">
        {WINDOWS.map(w => (
          <button
            key={w}
            role="tab"
            aria-selected={days === w}
            onClick={() => setDays(w)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              days === w ? 'border-border bg-bg-subtle text-text' : 'border-border text-muted hover:text-text'
            }`}
          >
            {t(`stories.window${w}` as 'stories.window1')}
          </button>
        ))}
      </div>

      {!data && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}

      {data && data.stories.length === 0 && (
        <p className="text-muted text-center py-12 text-sm">{t('stories.empty')}</p>
      )}

      {data?.stories.map(story => (
        <article key={story.id} className="mb-6 border-b border-border pb-4" data-story-id={story.id}>
          <ArticleCard article={story.leader} layout="magazine" {...displayConfig} />
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-muted">
            <Layers size={12} className="text-accent shrink-0" />
            <span>{t('stories.sources', { count: String(story.sources.length) })}:</span>
            {story.sources.map(s => (
              <span key={s.feed_id} className="rounded-full bg-bg-subtle px-1.5 leading-4">{s.feed_name}</span>
            ))}
          </div>
          {story.others.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted cursor-pointer hover:text-text select-none">
                {t('stories.otherCoverage')} ({story.others.length})
              </summary>
              <ul className="mt-1.5 space-y-1">
                {story.others.map(o => {
                  const path = articleUrlToPath(o.url)
                  return (
                    <li key={o.id} className="text-xs">
                      <a
                        href={path}
                        onClick={e => { e.preventDefault(); void navigate(path) }}
                        className={`hover:underline ${o.seen_at ? 'text-muted' : 'text-text'}`}
                      >
                        {o.title_translated ?? o.title}
                      </a>
                      <span className="text-muted"> — {o.feed_name}</span>
                      {o.published_at && (
                        <span className="text-muted"> · {formatRelativeDate(o.published_at, locale, { justNow: t('date.justNow') })}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </article>
      ))}
    </div>
  )
}
