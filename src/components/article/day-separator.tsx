import { useI18n } from '../../lib/i18n'

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

/** Days between two local calendar days, ignoring the time of day. */
function daysAgo(iso: string): number {
  const d = new Date(iso)
  const then = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((today - then) / (24 * 60 * 60 * 1000))
}

export function useDayLabel(): (iso: string | null | undefined) => string {
  const { t, locale } = useI18n()
  return (iso) => {
    if (!iso) return t('articles.dayUndated')
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return t('articles.dayUndated')
    const ago = daysAgo(iso)
    if (ago === 0) return t('articles.dayToday')
    if (ago === 1) return t('articles.dayYesterday')
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
    return d.toLocaleDateString(locale, opts)
  }
}

/** Row marking the start of a new publication day inside an article list. */
export function DaySeparator({ date, className = '' }: { date: string | null | undefined; className?: string }) {
  const dayLabel = useDayLabel()
  return (
    <div className={`flex items-center gap-3 px-4 md:px-6 pt-5 pb-2 select-none ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted shrink-0">{dayLabel(date)}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
