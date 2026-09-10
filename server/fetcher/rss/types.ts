export interface RssItem {
  title: string
  url: string
  published_at: string | null
  excerpt?: string
}

export interface FetchRssResult {
  items: RssItem[]
  notModified: boolean
  etag: string | null
  lastModified: string | null
  contentHash: string | null
  httpCacheSeconds: number | null
  rssTtlSeconds: number | null
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number | null
  constructor(status: number, retryAfter: string | null) {
    let seconds: number | null = null
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!isNaN(parsed)) {
        seconds = parsed
      } else {
        const date = new Date(retryAfter).getTime()
        if (!isNaN(date)) {
          seconds = Math.max(0, Math.floor((date - Date.now()) / 1000))
        }
      }
    }
    super(`HTTP ${status} (rate limited${seconds ? `, retry after ${seconds}s` : ''})`)
    this.retryAfterSeconds = seconds
  }
}
