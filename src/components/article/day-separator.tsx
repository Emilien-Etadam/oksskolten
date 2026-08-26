import { useI18n } from '../../lib/i18n'
import { calendarDaysAgo } from '../../lib/dateFormat'

/**
 * Local calendar day of an ISO timestamp, as YYYY-MM-DD. Empty string when the
 * article carries no publication date — those group together, after the dated
 * ones, the way the server orders them.
 */
export function dayKeyOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useDayLabel(): (iso: string | null | undefined) => string {
  const { t, locale } = useI18n()
  return (iso) => {
    if (!iso) return t('articles.dayUndated')
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return t('articles.dayUndated')
    const ago = calendarDaysAgo(iso)
    if (ago === 0) return t('articles.dayToday')
    if (ago === 1) return t('articles.dayYesterday')
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
    return d.toLocaleDateString(locale, opts)
  }
}

/**
 * Header for a publication day inside an article list. It sticks under the app
 * header (and under the category tabs when those are mounted, which publish
 * their height as --category-tabs-height), so the day stays legible while
 * scrolling a long run of articles from it.
 */
export function DaySeparator({ date, sticky = true, className = '' }: {
  date: string | null | undefined
  /** Grid layouts pass false: sections would break the column flow, so there is nothing to unstick against */
  sticky?: boolean
  className?: string
}) {
  const dayLabel = useDayLabel()
  return (
    <div
      className={`flex items-center gap-3 px-4 md:px-6 py-2 bg-bg select-none ${sticky ? 'sticky z-10' : ''} ${className}`}
      style={sticky ? { top: 'calc(var(--header-height) + var(--category-tabs-height, 0px))' } : undefined}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted shrink-0">{dayLabel(date)}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
