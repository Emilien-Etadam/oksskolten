import { authHeaders } from '../../../lib/fetcher'
import { logoutClient } from '../../../lib/auth'
import type { Feed } from '../../../../shared/types'

/**
 * Create a feed from a pasted URL, the same call the Add Feed dialog makes.
 *
 * POST /api/feeds always answers as an SSE stream (it also drives the
 * multi-step RSS discovery UI in that dialog), even though a stars, trending
 * or Discord URL resolves immediately with no discovery steps. Read just far
 * enough to find the terminal `done` or `error` event.
 */
export async function createFeedFromUrl(url: string): Promise<{ feed?: Feed; error?: string }> {
  const res = await fetch('/api/feeds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url }),
  })

  if (res.status === 401) {
    logoutClient()
    return { error: 'Unauthorized' }
  }

  const contentType = res.headers.get('Content-Type') || ''
  if (!contentType.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}))
    return { error: data.error || res.statusText }
  }
  if (!res.body) return { error: 'Response body is null' }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (payload.type === 'error') return { error: String(payload.error) }
      if (payload.type === 'done') return { feed: payload.feed as Feed }
    }
  }
  return { error: 'No response from server' }
}
