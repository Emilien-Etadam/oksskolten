import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFlareSolverr = vi.fn()

vi.mock('./flaresolverr.js', () => ({
  fetchViaFlareSolverr: (url: string) => mockFlareSolverr(url),
}))

import { fetchRedditPostContent, redditJsonUrl } from './reddit.js'

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
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
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
