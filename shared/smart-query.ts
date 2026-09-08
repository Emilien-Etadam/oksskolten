/**
 * Smart folder query language.
 *
 * A smart folder is a saved query such as `rust unread:true @week` — free
 * text plus a handful of `key:value` filters and `@period` shortcuts. The same
 * parser runs on the server (to build the article query) and in the client
 * (to preview what a query means before saving it).
 *
 *   unread:true|false      is:unread | is:read
 *   bookmarked:true        is:bookmarked
 *   liked:true             is:liked
 *   feed:<id>              category:<id>
 *   @today @yesterday @week @month   since:3d | since:2w | since:1m
 *   sort:score | sort:date
 *
 * Anything else, quoted phrases included, is kept as free text.
 */
export interface SmartQuery {
  text: string
  unread?: boolean
  bookmarked?: boolean
  liked?: boolean
  feedId?: number
  categoryId?: number
  /** Relative window in days; 1 = today (calendar day), 2 = since yesterday */
  sinceDays?: number
  sort?: 'score' | 'date'
}

const PERIODS: Record<string, number> = { today: 1, yesterday: 2, week: 7, month: 30 }

function parseBool(value: string): boolean | undefined {
  const v = value.toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return undefined
}

function parseSince(value: string): number | undefined {
  const m = /^(\d+)\s*([dwm])?$/i.exec(value.trim())
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = (m[2] ?? 'd').toLowerCase()
  return unit === 'w' ? n * 7 : unit === 'm' ? n * 30 : n
}

/** Split on whitespace while keeping "quoted phrases" together. */
function tokenize(raw: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1] !== undefined ? `"${m[1]}"` : m[2])
  }
  return tokens
}

export function parseSmartQuery(raw: string): SmartQuery {
  const query: SmartQuery = { text: '' }
  const text: string[] = []

  for (const token of tokenize(raw.trim())) {
    if (token.startsWith('@') && token.length > 1) {
      const days = PERIODS[token.slice(1).toLowerCase()]
      if (days) { query.sinceDays = days; continue }
    }
    const colon = token.indexOf(':')
    if (colon > 0 && !token.startsWith('"')) {
      const key = token.slice(0, colon).toLowerCase()
      const value = token.slice(colon + 1)
      let handled = true
      switch (key) {
        case 'unread': {
          const b = parseBool(value)
          if (b === undefined) handled = false; else query.unread = b
          break
        }
        case 'bookmarked': {
          const b = parseBool(value)
          if (b === undefined) handled = false; else query.bookmarked = b
          break
        }
        case 'liked': {
          const b = parseBool(value)
          if (b === undefined) handled = false; else query.liked = b
          break
        }
        case 'is': {
          const v = value.toLowerCase()
          if (v === 'unread') query.unread = true
          else if (v === 'read') query.unread = false
          else if (v === 'bookmarked') query.bookmarked = true
          else if (v === 'liked') query.liked = true
          else handled = false
          break
        }
        case 'feed': {
          const n = Number(value)
          if (Number.isInteger(n) && n > 0) query.feedId = n; else handled = false
          break
        }
        case 'category': {
          const n = Number(value)
          if (Number.isInteger(n) && n > 0) query.categoryId = n; else handled = false
          break
        }
        case 'since': {
          const d = parseSince(value)
          if (d === undefined) handled = false; else query.sinceDays = d
          break
        }
        case 'sort': {
          const v = value.toLowerCase()
          if (v === 'score' || v === 'desc') query.sort = 'score'
          else if (v === 'date' || v === 'asc' || v === 'newest') query.sort = 'date'
          else handled = false
          break
        }
        default:
          handled = false
      }
      if (handled) continue
    }
    text.push(token.startsWith('"') ? token.slice(1, -1) : token)
  }

  query.text = text.join(' ').trim()
  return query
}

/**
 * ISO timestamp for the query's relative window, or undefined without one.
 * Day 1 is the start of today (local time), day N the start of N-1 days ago,
 * so `@today` never hides an article published a few minutes ago.
 */
export function smartQuerySince(query: SmartQuery, now: Date = new Date()): string | undefined {
  if (!query.sinceDays) return undefined
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - (query.sinceDays - 1))
  return d.toISOString()
}

/** Whether the query names filters the client can preview without a search index. */
export function smartQueryHasFilters(query: SmartQuery): boolean {
  return query.unread !== undefined || !!query.bookmarked || !!query.liked
    || !!query.feedId || !!query.categoryId || !!query.sinceDays
}
