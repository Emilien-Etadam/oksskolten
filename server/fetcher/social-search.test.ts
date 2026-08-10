import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSafeFetch = vi.fn()

vi.mock('./ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

import {
  parseBlueskySearchUrl,
  isBlueskySearchUrl,
  fetchBlueskySearch,
  mastodonTagRssCandidate,
  resolveSocialSearchFeed,
} from './social-search.js'

const mockFetch = vi.fn()

function post(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'at://did:plc:abc123/app.bsky.feed.post/3kxyz',
    indexedAt: '2026-08-01T10:00:00Z',
    author: { handle: 'alice.bsky.social' },
    record: { text: 'Self-hosting my RSS reader', createdAt: '2026-08-01T09:30:00Z' },
    ...overrides,
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  mockSafeFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseBlueskySearchUrl', () => {
  it('parses a search URL copied from the web app', () => {
    expect(parseBlueskySearchUrl('https://bsky.app/search?q=selfhosted')).toEqual({
      q: 'selfhosted', sort: null, lang: null,
    })
  })

  it('keeps the sort and lang filters', () => {
    expect(parseBlueskySearchUrl('https://bsky.app/search?q=rust&sort=latest&lang=fr')).toEqual({
      q: 'rust', sort: 'latest', lang: 'fr',
    })
  })

  it('rejects non-search and query-less URLs', () => {
    expect(parseBlueskySearchUrl('https://bsky.app/profile/alice.bsky.social')).toBeNull()
    expect(parseBlueskySearchUrl('https://bsky.app/search')).toBeNull()
    expect(parseBlueskySearchUrl('https://example.com/search?q=x')).toBeNull()
    expect(parseBlueskySearchUrl('not a url')).toBeNull()
  })

  it('exposes a boolean helper', () => {
    expect(isBlueskySearchUrl('https://bsky.app/search?q=a')).toBe(true)
    expect(isBlueskySearchUrl('https://bsky.app/')).toBe(false)
  })
})

describe('fetchBlueskySearch', () => {
  it('queries the public AppView and maps posts to feed items', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ posts: [post()] }),
    })

    const items = await fetchBlueskySearch('https://bsky.app/search?q=selfhosted&sort=latest')

    const requested = new URL(String(mockFetch.mock.calls[0][0]))
    expect(requested.origin + requested.pathname).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts')
    expect(requested.searchParams.get('q')).toBe('selfhosted')
    expect(requested.searchParams.get('sort')).toBe('latest')

    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://bsky.app/profile/alice.bsky.social/post/3kxyz')
    expect(items[0].title).toBe('Self-hosting my RSS reader')
    expect(items[0].excerpt).toBe('Self-hosting my RSS reader')
    expect(items[0].published_at).toContain('2026-08-01')
  })

  it('derives a title from the first line and truncates long posts', async () => {
    const long = 'a'.repeat(200)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        posts: [
          post({ record: { text: 'First line\nSecond line', createdAt: '2026-08-01T09:30:00Z' } }),
          post({ uri: 'at://did:plc:abc/app.bsky.feed.post/long', record: { text: long, createdAt: '2026-08-01T09:30:00Z' } }),
        ],
      }),
    })

    const items = await fetchBlueskySearch('https://bsky.app/search?q=x')
    expect(items[0].title).toBe('First line')
    expect(items[1].title.endsWith('…')).toBe(true)
    expect(items[1].title.length).toBeLessThanOrEqual(121)
  })

  it('falls back to a handle-based title for posts without text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ posts: [post({ record: { text: '', createdAt: '2026-08-01T09:30:00Z' } })] }),
    })

    const items = await fetchBlueskySearch('https://bsky.app/search?q=x')
    expect(items[0].title).toBe('Post by @alice.bsky.social')
  })

  it('skips posts whose URL cannot be built', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ posts: [post({ author: {} }), post()] }),
    })

    expect(await fetchBlueskySearch('https://bsky.app/search?q=x')).toHaveLength(1)
  })

  it('throws on an API error so the feed records the failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 })
    await expect(fetchBlueskySearch('https://bsky.app/search?q=x')).rejects.toThrow('HTTP 502')
  })

  it('returns nothing without fetching for a non-search URL', async () => {
    expect(await fetchBlueskySearch('https://example.com/')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('mastodonTagRssCandidate', () => {
  it('builds the native RSS URL for a hashtag timeline', () => {
    expect(mastodonTagRssCandidate('https://mastodon.social/tags/selfhosted'))
      .toBe('https://mastodon.social/tags/selfhosted.rss')
    expect(mastodonTagRssCandidate('https://mastodon.social/tags/selfhosted/'))
      .toBe('https://mastodon.social/tags/selfhosted.rss')
  })

  it('is idempotent when the URL already ends in .rss', () => {
    expect(mastodonTagRssCandidate('https://mastodon.social/tags/rust.rss'))
      .toBe('https://mastodon.social/tags/rust.rss')
  })

  it('returns null for non-hashtag paths', () => {
    expect(mastodonTagRssCandidate('https://mastodon.social/@alice')).toBeNull()
    expect(mastodonTagRssCandidate('https://blog.example.com/tags/rust/page/2')).toBeNull()
  })
})

describe('resolveSocialSearchFeed', () => {
  it('returns Bluesky search URLs unchanged, without probing', async () => {
    expect(await resolveSocialSearchFeed('https://bsky.app/search?q=rust'))
      .toBe('https://bsky.app/search?q=rust')
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('accepts a Mastodon hashtag URL when the probe returns a feed', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<?xml version="1.0"?><rss version="2.0"><channel/></rss>'),
    })

    expect(await resolveSocialSearchFeed('https://mastodon.social/tags/selfhosted'))
      .toBe('https://mastodon.social/tags/selfhosted.rss')
  })

  it('rejects a look-alike /tags/ URL that does not serve a feed', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<!doctype html><html><body>Tag page</body></html>'),
    })

    expect(await resolveSocialSearchFeed('https://blog.example.com/tags/rust')).toBeNull()
  })

  it('rejects when the probe fails', async () => {
    mockSafeFetch.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await resolveSocialSearchFeed('https://blog.example.com/tags/rust')).toBeNull()
  })

  it('returns null for ordinary URLs', async () => {
    expect(await resolveSocialSearchFeed('https://example.com/blog')).toBeNull()
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })
})
