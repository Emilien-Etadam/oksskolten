import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle, getFeedById } from '../db.js'
import type { Feed } from '../db.js'

// --- feedsmith mock (controllable) ---

let feedsmithShouldFail = false
let feedsmithOverride: unknown = null

vi.mock('feedsmith', async (importOriginal) => {
  const real = await importOriginal<typeof import('feedsmith')>()
  return {
    ...real,
    parseFeed: (...args: Parameters<typeof real.parseFeed>) => {
      if (feedsmithShouldFail) throw new Error('feedsmith parse error')
      if (feedsmithOverride) return feedsmithOverride
      return real.parseFeed(...args)
    },
  }
})

// --- FlareSolverr mock ---

const mockFlareSolverr = vi.fn<() => Promise<{ body: string; contentType: string } | null>>()

vi.mock('../fetcher/flaresolverr.js', () => ({
  fetchViaFlareSolverr: (...args: unknown[]) => mockFlareSolverr(...(args as Parameters<typeof mockFlareSolverr>)),
}))

// --- global.fetch mock ---

const mockFetch = vi.fn()

beforeEach(() => {
  setupTestDb()
  mockFetch.mockReset()
  mockFlareSolverr.mockReset()
  mockFlareSolverr.mockResolvedValue(null)
  feedsmithShouldFail = false
  feedsmithOverride = null
  vi.stubGlobal('fetch', mockFetch)
})

function rss20Xml(title: string, items: { title: string; link: string; pubDate?: string; description?: string }[]): string {
  const itemsXml = items
    .map(
      i => `<item>
      <title>${i.title}</title>
      <link>${i.link}</link>
      ${i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ''}
      ${i.description ? `<description><![CDATA[${i.description}]]></description>` : ''}
    </item>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    ${itemsXml}
  </channel>
</rss>`
}

function mockResponse(body: string, init?: { status?: number; headers?: Record<string, string> }): Response {
  const status = init?.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init?.headers || { 'content-type': 'text/html' }),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  } as Response
}

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}): Feed {
  return createFeed({
    name: 'Test Feed',
    url: 'https://example.com',
    rss_url: 'https://example.com/feed.xml',
    ...overrides,
  })
}

function serveRss(feed: Feed, xml: string): void {
  mockFetch.mockImplementation((url: string | URL) => {
    const u = url.toString()
    if (u === feed.rss_url) {
      return Promise.resolve(mockResponse(xml, { headers: { 'content-type': 'application/rss+xml' } }))
    }
    return Promise.resolve(mockResponse('', { status: 404 }))
  })
}

describe('collectFeedTasks', () => {
  let collectFeedTasks: typeof import('./feed-loop.js').collectFeedTasks

  beforeEach(async () => {
    const mod = await import('./feed-loop.js')
    collectFeedTasks = mod.collectFeedTasks
  })

  it('returns ok with new-article tasks for unseen RSS items', async () => {
    const feed = seedFeed()
    serveRss(
      feed,
      rss20Xml('Test', [
        { title: 'Article 1', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2024 12:00:00 GMT' },
        { title: 'Article 2', link: 'https://example.com/2' },
      ]),
    )

    const result = await collectFeedTasks(feed)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.itemCount).toBe(2)
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toMatchObject({
      kind: 'new',
      feed_id: feed.id,
      title: 'Article 1',
      url: 'https://example.com/1',
      published_at: '2024-01-01T12:00:00.000Z',
      requires_js_challenge: false,
    })
    expect(result.tasks[1]).toMatchObject({
      kind: 'new',
      feed_id: feed.id,
      title: 'Article 2',
      url: 'https://example.com/2',
    })

    const updated = getFeedById(feed.id)
    expect(updated!.last_error).toBeNull()
    expect(updated!.error_count).toBe(0)
    expect(updated!.check_interval).toBeTruthy()
  })

  it('omits existing URLs and removed Reddit posts from ok tasks', async () => {
    const feed = seedFeed()
    insertArticle({
      feed_id: feed.id,
      title: 'Existing',
      url: 'https://example.com/existing',
      published_at: '2024-01-01T00:00:00Z',
    })
    const removedUrl = 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/some_post/'
    serveRss(
      feed,
      rss20Xml('Test', [
        { title: 'Existing', link: 'https://example.com/existing' },
        { title: '[ Removed by Reddit ]', link: removedUrl },
        { title: 'New Article', link: 'https://example.com/new' },
      ]),
    )

    const result = await collectFeedTasks(feed)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.itemCount).toBe(3)
    expect(result.tasks).toEqual([
      expect.objectContaining({
        kind: 'new',
        url: 'https://example.com/new',
        title: 'New Article',
      }),
    ])
  })

  it('returns not-modified on HTTP 304 and reschedules with the stored interval', async () => {
    const feed = seedFeed()
    const { getDb } = await import('../db.js')
    getDb().prepare('UPDATE feeds SET etag = ?, check_interval = ? WHERE id = ?').run('"abc"', 1800, feed.id)
    const cached = getFeedById(feed.id)!

    mockFetch.mockImplementation(() => Promise.resolve(mockResponse('', { status: 304 })))

    const result = await collectFeedTasks(cached)

    expect(result).toEqual({ status: 'not-modified' })
    const updated = getFeedById(feed.id)
    expect(updated!.last_error).toBeNull()
    expect(updated!.check_interval).toBe(1800)
    expect(updated!.next_check_at).toBeTruthy()
  })

  it('returns rate-limited on HTTP 429 without incrementing error_count', async () => {
    const feed = seedFeed()
    mockFetch.mockImplementation(() =>
      Promise.resolve(mockResponse('', { status: 429, headers: { 'retry-after': '120' } })),
    )

    const result = await collectFeedTasks(feed)

    expect(result).toEqual({ status: 'rate-limited' })
    const updated = getFeedById(feed.id)
    expect(updated!.last_error).toBe('Rate limited, retry after 120s')
    expect(updated!.error_count).toBe(0)
    expect(updated!.next_check_at).toBeTruthy()
  })

  it('returns error on RSS fetch failure and records last_error', async () => {
    const feed = seedFeed()
    mockFetch.mockImplementation(() => Promise.resolve(mockResponse('Server Error', { status: 500 })))

    const result = await collectFeedTasks(feed)

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toContain('HTTP 500')
    const updated = getFeedById(feed.id)
    expect(updated!.last_error).toContain('HTTP 500')
    expect(updated!.error_count).toBe(1)
  })

  it('refreshes stale articles when current RSS has a richer excerpt', async () => {
    const feed = seedFeed()
    insertArticle({
      feed_id: feed.id,
      title: 'Stale Article',
      url: 'https://example.com/stale',
      published_at: '2024-01-01T00:00:00Z',
      full_text: 'Essay',
      summary: 'Old summary built from garbage',
      full_text_translated: 'Old translation built from garbage',
      translated_lang: 'ja',
    })

    const description =
      '<p>This is the proper article body that the RSS feed has all along. It is far longer than the stored garbage content and should replace it.</p>'
    serveRss(
      feed,
      rss20Xml('Test', [{ title: 'Stale Article', link: 'https://example.com/stale', description }]),
    )

    const result = await collectFeedTasks(feed)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.tasks).toHaveLength(0)

    const { getDb } = await import('../db.js')
    const row = getDb()
      .prepare('SELECT full_text, summary, full_text_translated, translated_lang FROM articles WHERE url = ?')
      .get('https://example.com/stale') as {
      full_text: string | null
      summary: string | null
      full_text_translated: string | null
      translated_lang: string | null
    }
    expect(row.full_text).toContain('proper article body')
    expect(row.full_text).not.toBe('Essay')
    expect(row.summary).toBeNull()
    expect(row.full_text_translated).toBeNull()
    expect(row.translated_lang).toBeNull()
  })
})
