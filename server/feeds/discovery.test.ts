import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discoverRssUrl } from './discovery.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSafeFetch = vi.fn()
vi.mock('../fetcher/ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

// Controllable feedsmith mock — set feedsmithShouldFail = true to force fast-xml-parser fallback
let feedsmithShouldFail = false
vi.mock('feedsmith', async (importOriginal) => {
  const real = await importOriginal<typeof import('feedsmith')>()
  return {
    ...real,
    parseFeed: (...args: Parameters<typeof real.parseFeed>) => {
      if (feedsmithShouldFail) throw new Error('feedsmith failed')
      return real.parseFeed(...args)
    },
  }
})

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>First Post</title>
      <link>https://example.com/post-1</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/post-2</link>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <entry>
    <title>Atom Post</title>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <published>2024-01-01T00:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Post 2</title>
    <link rel="alternate" href="https://example.com/atom-2"/>
    <link rel="self" href="https://example.com/atom-2.xml"/>
    <updated>2024-01-02T00:00:00Z</updated>
  </entry>
</feed>`

const HTML_WITH_RSS_LINK = `<!DOCTYPE html>
<html>
<head>
  <title>My Blog</title>
  <link rel="alternate" type="application/rss+xml" href="/feed.xml"/>
</head>
<body></body>
</html>`

const HTML_WITH_ATOM_LINK = `<!DOCTYPE html>
<html>
<head>
  <title>My Atom Blog</title>
  <link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml"/>
</head>
<body></body>
</html>`

const HTML_NO_FEED = `<!DOCTYPE html>
<html><head><title>No Feed</title></head><body></body></html>`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(body: string, ok = true, status = 200, contentType = 'application/xml') {
  return {
    ok,
    status,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: new Headers({ 'content-type': contentType }),
  }
}

// ---------------------------------------------------------------------------
// Tests — discoverRssUrl
// ---------------------------------------------------------------------------

describe('discoverRssUrl', () => {
  beforeEach(() => {
    mockSafeFetch.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('discovers RSS link from HTML page', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(mockResponse(HTML_WITH_RSS_LINK, true, 200, 'text/html'))  // page fetch
      .mockResolvedValueOnce(mockResponse(RSS_XML))  // feed title fetch

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBe('https://example.com/feed.xml')
    expect(result.title).toBe('Test Blog')
  })

  it('discovers Atom link from HTML page', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(mockResponse(HTML_WITH_ATOM_LINK, true, 200, 'text/html'))
      .mockResolvedValueOnce(mockResponse(ATOM_XML))

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBe('https://example.com/atom.xml')
  })

  it('falls back to path probing when no link tag found', async () => {
    // Page has no feed link
    mockSafeFetch.mockResolvedValueOnce(mockResponse(HTML_NO_FEED, true, 200, 'text/html'))

    const globalFetch = vi.fn()
    // Probe /feed → 404, /feed.xml → 200 with xml content-type
    globalFetch
      .mockResolvedValueOnce(mockResponse('', false, 404))  // HEAD /feed
      .mockResolvedValueOnce(mockResponse('', true, 200, 'application/xml'))  // HEAD /feed.xml

    vi.stubGlobal('fetch', globalFetch)

    // Feed title fetch
    mockSafeFetch.mockResolvedValueOnce(mockResponse(RSS_XML))

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBe('https://example.com/feed.xml')
  })

  it('retries with GET on 405 during path probing', async () => {
    mockSafeFetch.mockResolvedValueOnce(mockResponse(HTML_NO_FEED, true, 200, 'text/html'))

    const globalFetch = vi.fn()
    // HEAD /feed → 405, GET /feed → 200 xml
    globalFetch
      .mockResolvedValueOnce(mockResponse('', false, 405))  // HEAD
      .mockResolvedValueOnce(mockResponse('', true, 200, 'application/xml'))  // GET fallback

    vi.stubGlobal('fetch', globalFetch)

    mockSafeFetch.mockResolvedValueOnce(mockResponse(RSS_XML))

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBe('https://example.com/feed')
    expect(globalFetch).toHaveBeenCalledTimes(2)
    expect(globalFetch.mock.calls[0][1].method).toBe('HEAD')
    expect(globalFetch.mock.calls[1][1].method).toBe('GET')
  })

  it('returns null rssUrl when nothing found', async () => {
    mockSafeFetch.mockResolvedValueOnce(mockResponse(HTML_NO_FEED, true, 200, 'text/html'))

    const globalFetch = vi.fn().mockResolvedValue(mockResponse('', false, 404))
    vi.stubGlobal('fetch', globalFetch)

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBeNull()
    expect(result.title).toBe('No Feed')  // page <title>
  })

  it('returns page title even when feed discovery fails', async () => {
    mockSafeFetch.mockResolvedValueOnce(mockResponse(HTML_NO_FEED, true, 200, 'text/html'))
    const globalFetch = vi.fn().mockResolvedValue(mockResponse('', false, 404))
    vi.stubGlobal('fetch', globalFetch)

    const result = await discoverRssUrl('https://example.com')

    expect(result.title).toBe('No Feed')
  })

  it('handles page fetch failure gracefully', async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error('network error'))

    const globalFetch = vi.fn().mockResolvedValue(mockResponse('', false, 404))
    vi.stubGlobal('fetch', globalFetch)

    const result = await discoverRssUrl('https://example.com')

    // Falls through to path probing
    expect(result.rssUrl).toBeNull()
  })

  it('ignores non-xml content-types during path probing', async () => {
    mockSafeFetch.mockResolvedValueOnce(mockResponse(HTML_NO_FEED, true, 200, 'text/html'))

    const globalFetch = vi.fn()
    // All probes return 200 but with text/html content-type
    globalFetch.mockResolvedValue(mockResponse('', true, 200, 'text/html'))
    vi.stubGlobal('fetch', globalFetch)

    const result = await discoverRssUrl('https://example.com')

    expect(result.rssUrl).toBeNull()
  })

  it('prefers feed title over page title', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(mockResponse(HTML_WITH_RSS_LINK, true, 200, 'text/html'))
      .mockResolvedValueOnce(mockResponse(RSS_XML))

    const result = await discoverRssUrl('https://example.com')

    expect(result.title).toBe('Test Blog')  // feed title, not "My Blog" from HTML
  })
})
