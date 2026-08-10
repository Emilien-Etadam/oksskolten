import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSafeFetch = vi.fn()

vi.mock('./ssrf.js', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}))

import {
  parseBlueskySearchUrl,
  isBlueskySearchUrl,
  fetchBlueskySearch,
  parseBlueskyFeedUrl,
  fetchBlueskyFeed,
  mastodonTagRssCandidate,
  blueskyProfileRssCandidate,
  resolveSocialSearchFeed,
  _resetBlueskySessionForTests,
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
  _resetBlueskySessionForTests()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('names the missing credentials when unauthenticated search is refused', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 })
    await expect(fetchBlueskySearch('https://bsky.app/search?q=x'))
      .rejects.toThrow('BLUESKY_IDENTIFIER')
  })

  it('returns nothing without fetching for a non-search URL', async () => {
    expect(await fetchBlueskySearch('https://example.com/')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('parseBlueskyFeedUrl', () => {
  it('parses a custom-feed URL', () => {
    expect(parseBlueskyFeedUrl('https://bsky.app/profile/skyfeed.xyz/feed/tech'))
      .toEqual({ actor: 'skyfeed.xyz', rkey: 'tech' })
  })

  it('rejects profile, search and foreign URLs', () => {
    expect(parseBlueskyFeedUrl('https://bsky.app/profile/alice.bsky.social')).toBeNull()
    expect(parseBlueskyFeedUrl('https://bsky.app/search?q=x')).toBeNull()
    expect(parseBlueskyFeedUrl('https://example.com/profile/a/feed/b')).toBeNull()
  })
})

describe('fetchBlueskyFeed', () => {
  it('resolves the handle and fetches the feed anonymously', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      if (String(url).includes('resolveHandle')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ did: 'did:plc:xyz' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ feed: [{ post: post() }] }) })
    })

    const items = await fetchBlueskyFeed('https://bsky.app/profile/skyfeed.xyz/feed/tech')
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://bsky.app/profile/alice.bsky.social/post/3kxyz')

    const getFeed = new URL(String(mockFetch.mock.calls[1][0]))
    expect(getFeed.pathname).toBe('/xrpc/app.bsky.feed.getFeed')
    expect(getFeed.searchParams.get('feed')).toBe('at://did:plc:xyz/app.bsky.feed.generator/tech')
    // No Authorization header — custom feeds are public
    expect((mockFetch.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('Authorization')
  })

  it('skips handle resolution when the URL already carries a DID', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ feed: [] }) })

    await fetchBlueskyFeed('https://bsky.app/profile/did:plc:abc/feed/news')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toContain('at%3A%2F%2Fdid%3Aplc%3Aabc')
  })

  it('throws when the handle cannot be resolved', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 })
    await expect(fetchBlueskyFeed('https://bsky.app/profile/ghost.invalid/feed/x'))
      .rejects.toThrow('Could not resolve')
  })

  it('throws on an API error', async () => {
    mockFetch.mockImplementation((url: string | URL) => String(url).includes('resolveHandle')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ did: 'did:plc:xyz' }) })
      : Promise.resolve({ ok: false, status: 500 }))

    await expect(fetchBlueskyFeed('https://bsky.app/profile/a.bsky.social/feed/x'))
      .rejects.toThrow('HTTP 500')
  })

  it('returns nothing without fetching for a non-feed URL', async () => {
    expect(await fetchBlueskyFeed('https://bsky.app/search?q=x')).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('fetchBlueskySearch with an app password', () => {
  beforeEach(() => {
    vi.stubEnv('BLUESKY_IDENTIFIER', 'alice.bsky.social')
    vi.stubEnv('BLUESKY_APP_PASSWORD', 'abcd-efgh-ijkl-mnop')
  })

  function mockLoginAndSearch(searchResponses: Array<Record<string, unknown>>) {
    let searchCall = 0
    mockFetch.mockImplementation((url: string | URL) => {
      if (String(url).includes('com.atproto.server.createSession')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ accessJwt: `jwt-${++loginCount}` }) })
      }
      return Promise.resolve(searchResponses[Math.min(searchCall++, searchResponses.length - 1)])
    })
  }

  let loginCount = 0
  beforeEach(() => { loginCount = 0 })

  it('logs in and searches through the PDS with a bearer token', async () => {
    mockLoginAndSearch([{ ok: true, status: 200, json: () => Promise.resolve({ posts: [post()] }) }])

    const items = await fetchBlueskySearch('https://bsky.app/search?q=selfhosted')
    expect(items).toHaveLength(1)

    const login = mockFetch.mock.calls[0]
    expect(String(login[0])).toBe('https://bsky.social/xrpc/com.atproto.server.createSession')
    expect(JSON.parse((login[1] as RequestInit).body as string)).toEqual({
      identifier: 'alice.bsky.social', password: 'abcd-efgh-ijkl-mnop',
    })

    const search = mockFetch.mock.calls[1]
    expect(String(search[0])).toContain('https://bsky.social/xrpc/app.bsky.feed.searchPosts')
    expect((search[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-1' })
  })

  it('reuses the session across searches', async () => {
    mockLoginAndSearch([{ ok: true, status: 200, json: () => Promise.resolve({ posts: [] }) }])

    await fetchBlueskySearch('https://bsky.app/search?q=a')
    await fetchBlueskySearch('https://bsky.app/search?q=b')
    expect(loginCount).toBe(1)
  })

  it('logs in again once when the token has expired', async () => {
    mockLoginAndSearch([
      { ok: false, status: 401 },
      { ok: true, status: 200, json: () => Promise.resolve({ posts: [post()] }) },
    ])

    expect(await fetchBlueskySearch('https://bsky.app/search?q=a')).toHaveLength(1)
    expect(loginCount).toBe(2)
  })

  it('falls back to the public AppView when the authenticated search fails', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      if (String(url).includes('com.atproto.server.createSession')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ accessJwt: 'jwt' }) })
      }
      if (String(url).startsWith('https://bsky.social/')) return Promise.resolve({ ok: false, status: 500 })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ posts: [post()] }) })
    })

    expect(await fetchBlueskySearch('https://bsky.app/search?q=a')).toHaveLength(1)
    expect(mockFetch.mock.calls.some(c => String(c[0]).startsWith('https://public.api.bsky.app/'))).toBe(true)
  })

  it('falls back to the public AppView when the login is rejected', async () => {
    mockFetch.mockImplementation((url: string | URL) => {
      if (String(url).includes('com.atproto.server.createSession')) {
        return Promise.resolve({ ok: false, status: 401 })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ posts: [post()] }) })
    })

    expect(await fetchBlueskySearch('https://bsky.app/search?q=a')).toHaveLength(1)
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

describe('blueskyProfileRssCandidate', () => {
  it('builds the native RSS URL for a profile', () => {
    expect(blueskyProfileRssCandidate('https://bsky.app/profile/alice.bsky.social'))
      .toBe('https://bsky.app/profile/alice.bsky.social/rss')
    expect(blueskyProfileRssCandidate('https://bsky.app/profile/alice.bsky.social/rss'))
      .toBe('https://bsky.app/profile/alice.bsky.social/rss')
  })

  it('returns null for other Bluesky pages and other hosts', () => {
    expect(blueskyProfileRssCandidate('https://bsky.app/search?q=x')).toBeNull()
    expect(blueskyProfileRssCandidate('https://bsky.app/profile/alice/post/3k')).toBeNull()
    expect(blueskyProfileRssCandidate('https://example.com/profile/alice')).toBeNull()
  })
})

describe('resolveSocialSearchFeed', () => {
  it('accepts a Bluesky profile URL when the probe returns a feed', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<?xml version="1.0"?><rss version="2.0"><channel/></rss>'),
    })

    expect(await resolveSocialSearchFeed('https://bsky.app/profile/alice.bsky.social'))
      .toBe('https://bsky.app/profile/alice.bsky.social/rss')
  })

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
