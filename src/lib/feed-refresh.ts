import { authHeaders } from './fetcher'

/** Progress events the server streams while fetching every feed. */
type FetchAllEvent =
  | { type: 'feed-articles-found'; feed_id: number; total: number }
  | { type: 'article-done'; feed_id: number; fetched: number; total: number }
  | { type: 'feed-complete'; feed_id: number }

/**
 * Fetch every enabled feed through POST /api/admin/fetch-all, which streams
 * progress as SSE. Returns how many new articles the run found.
 *
 * Resolves quietly when the response is not an event stream — demo mode
 * intercepts fetch and answers with plain JSON.
 */
export async function fetchAllFeeds(onEvent?: (event: FetchAllEvent) => void): Promise<{ totalNew: number }> {
  const res = await fetch('/api/admin/fetch-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: '{}',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body || !(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
    return { totalNew: 0 }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let totalNew = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let event: FetchAllEvent
      try {
        event = JSON.parse(line.slice(6)) as FetchAllEvent
      } catch {
        continue
      }
      // One event per feed announces how many new articles it turned up
      if (event.type === 'feed-articles-found') totalNew += event.total
      onEvent?.(event)
    }
  }

  return { totalNew }
}
