export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== new Date().getFullYear()) {
    opts.year = 'numeric'
  }
  return d.toLocaleDateString(locale, opts)
}

/**
 * Whole calendar days between a date and today, ignoring the time of day.
 * Counting rolling 24-hour windows instead would put two articles of the same
 * afternoon in different buckets, and disagree with the day separators.
 */
export function calendarDaysAgo(iso: string): number {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  const then = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((today - then) / (24 * 60 * 60 * 1000))
}

/**
 * Minutes and hours within today, calendar days beyond it. Yesterday evening
 * reads as "yesterday" rather than "14 hours ago", so a card never contradicts
 * the day separator above it.
 */
export function formatRelativeDate(iso: string | null, locale: string, opts?: { justNow?: string }): string {
  if (!iso) return ''
  const days = calendarDaysAgo(iso)
  if (days >= 30) return formatDate(iso, locale)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (days >= 1) return rtf.format(-days, 'day')
  const d = new Date(iso)
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return opts?.justNow ?? 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  return rtf.format(-Math.floor(diffMin / 60), 'hour')
}

export function formatDetailDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}
