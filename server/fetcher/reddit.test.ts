import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFlareSolverr = vi.fn()

vi.mock('./flaresolverr.js', () => ({
  fetchViaFlareSolverr: (url: string) => mockFlareSolverr(url),
}))

import { fetchRedditPostContent, fetchRedditJson, redditJsonUrl, _resetRedditOauthForTests } from './reddit.js'

const mockFetch = vi.fn()

function postPayload(data: Record<string, unknown>) {
  return [
    { data: { children: [{ kind: 't3', data }] } },
    { data: { children: [] } },
  ]
}

beforeEach(() => {
  mockFetch.mockReset()
  mockFlareSolverr.mockReset()
  mockFlareSolverr.mockResolvedValue(null)
  _resetRedditOauthForTests()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('redditJsonUrl', () => {
  it('is null for non-post URLs', () => {
    expect(redditJsonUrl('https://www.reddit.com/r/ollama/')).toBeNull()
    expect(redditJsonUrl('https://example.com/a')).toBeNull()
  })
})

describe('fetchRedditPostContent', () => {
  it('returns the selftext as markdown with title, excerpt, and preview image', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(postPayload({
        title: 'My post',
        selftext: 'Hello **world**',
        preview: { images: [{ source: { url: 'https://preview.redd.it/x.jpg?width=640&amp;s=abc' } }] },
      })),
    })

    const content = await fetchRedditPostContent('https://www.reddit.com/r/ollama/comments/abc/my_post/')
    expect(content).toEqual({
      fullText: 'Hello **world**',
      title: 'My post',
      ogImage: 'https://preview.redd.it/x.jpg?width=640&s=abc',
      excerpt: expect.any(String),
    })
  })

  it('uses the crossposted parent selftext when the outer post has none', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(postPayload({
        title: 'Crosspost title',
        selftext: '',
        crosspost_parent_list: [{
          selftext: 'Original body text',
          subreddit_name_prefixed: 'r/OpenaiCodex',
        }],
      })),
    })

    const content = await fetchRedditPostContent('https://www.reddit.com/r/ollama/comments/abc/xpost/')
    expect(content?.fullText).toBe('> Crossposted from r/OpenaiCodex\n\nOriginal body text')
    expect(content?.title).toBe('Crosspost title')
  })

  it('returns null for link posts without text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(postPayload({ title: 'Link post', selftext: '' })),
    })

    expect(await fetchRedditPostContent('https://www.reddit.com/r/ollama/comments/abc/link/')).toBeNull()
  })

  it('returns null without fetching for non-reddit URLs', async () => {
    expect(await fetchRedditPostContent('https://example.com/article')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when reddit and FlareSolverr are unavailable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 })
    expect(await fetchRedditPostContent('https://www.reddit.com/r/ollama/comments/abc/post/')).toBeNull()
    expect(mockFlareSolverr).toHaveBeenCalled()
  })
})

describe('fetchRedditJson via OAuth', () => {
  const jsonUrl = 'https://www.reddit.com/r/ollama/comments/abc/post.json?raw_json=1&sort=top&limit=50&depth=2'

  beforeEach(() => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'client-id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'client-secret')
  })

  it('uses the official API with a client_credentials token when configured', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/v1/access_token')) {
        expect((init?.headers as Record<string, string>).Authorization.startsWith('Basic ')).toBe(true)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) })
      }
      if (String(url).startsWith('https://oauth.reddit.com/')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ data: { children: [] } }]) })
      }
      return Promise.resolve({ ok: false, status: 403 })
    })

    const payload = await fetchRedditJson(jsonUrl)
    expect(payload).toEqual([{ data: { children: [] } }])
    // Direct anonymous attempts were never needed
    expect(mockFetch.mock.calls.filter(c => String(c[0]).startsWith('https://www.reddit.com/r/'))).toHaveLength(0)
  })

  it('caches the token across calls', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/access_token')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })

    await fetchRedditJson(jsonUrl)
    await fetchRedditJson(jsonUrl)
    expect(mockFetch.mock.calls.filter(c => String(c[0]).includes('/api/v1/access_token'))).toHaveLength(1)
  })

  it('uses an anonymous Android-app OAuth token when no credentials are set', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '')
    vi.stubEnv('REDDIT_CLIENT_SECRET', '')
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/v2/oauth/access-token/loid')) {
        expect((init?.headers as Record<string, string>).Authorization.startsWith('Basic ')).toBe(true)
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'x-reddit-loid': 'loid1', 'x-reddit-session': 'sess1' }),
          json: () => Promise.resolve({ access_token: 'android-tok', expires_in: 86400 }),
        })
      }
      if (String(url).startsWith('https://oauth.reddit.com/')) {
        const headers = init?.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer android-tok')
        expect(headers['x-reddit-loid']).toBe('loid1')
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ data: { children: [] } }]) })
      }
      return Promise.resolve({ ok: false, status: 403 })
    })

    const payload = await fetchRedditJson(jsonUrl)
    expect(payload).toEqual([{ data: { children: [] } }])
    // No anonymous www.reddit.com/r/ requests were needed
    expect(mockFetch.mock.calls.filter(c => String(c[0]).startsWith('https://www.reddit.com/r/'))).toHaveLength(0)
  })

  it('tries the session cookie first in the anonymous ladder when REDDIT_COOKIE is set', async () => {
    vi.stubEnv('REDDIT_CLIENT_ID', '')
    vi.stubEnv('REDDIT_CLIENT_SECRET', '')
    vi.stubEnv('REDDIT_COOKIE', 'reddit_session=abc')
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      if (String(url).startsWith('https://www.reddit.com/r/') && headers.Cookie === 'reddit_session=abc') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ data: { children: [] } }]) })
      }
      return Promise.resolve({ ok: false, status: 403 })
    })

    const payload = await fetchRedditJson(jsonUrl)
    expect(payload).toEqual([{ data: { children: [] } }])
    // Exactly one request carried the session cookie, and it succeeded
    const cookieCalls = mockFetch.mock.calls.filter(c => (c[1]?.headers as Record<string, string>)?.Cookie === 'reddit_session=abc')
    expect(cookieCalls).toHaveLength(1)
  })

  it('falls back to the anonymous ladder when the token request fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/access_token')) {
        return Promise.resolve({ ok: false, status: 401 })
      }
      if (String(url).startsWith('https://www.reddit.com/r/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ data: { children: [] } }]) })
      }
      return Promise.resolve({ ok: false, status: 403 })
    })

    const payload = await fetchRedditJson(jsonUrl)
    expect(payload).toEqual([{ data: { children: [] } }])
  })
})
