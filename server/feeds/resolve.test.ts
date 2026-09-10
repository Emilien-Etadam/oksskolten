import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockResolveGithubStarsFeed,
  mockResolveSocialSearchFeed,
  mockDiscoverRssUrl,
  mockQueryRssBridge,
  mockInferCssSelectorBridge,
} = vi.hoisted(() => ({
  mockResolveGithubStarsFeed: vi.fn(),
  mockResolveSocialSearchFeed: vi.fn(),
  mockDiscoverRssUrl: vi.fn(),
  mockQueryRssBridge: vi.fn(),
  mockInferCssSelectorBridge: vi.fn(),
}))

vi.mock('./sources/github-releases.js', () => ({
  resolveGithubStarsFeed: (url: string) => mockResolveGithubStarsFeed(url),
}))

vi.mock('./sources/social-search.js', () => ({
  resolveSocialSearchFeed: (url: string) => mockResolveSocialSearchFeed(url),
}))

vi.mock('../fetcher.js', () => ({
  discoverRssUrl: (url: string, opts?: { onFlareSolverr?: (status: string, found?: boolean) => void }) =>
    mockDiscoverRssUrl(url, opts),
}))

vi.mock('./discovery.js', () => ({
  discoverRssUrl: (url: string, opts?: { onFlareSolverr?: (status: string, found?: boolean) => void }) =>
    mockDiscoverRssUrl(url, opts),
}))

vi.mock('./rss-bridge.js', () => ({
  queryRssBridge: (url: string) => mockQueryRssBridge(url),
  inferCssSelectorBridge: (url: string) => mockInferCssSelectorBridge(url),
}))

import { resolveFeedSource, type ResolveEvent, type ResolvedSource } from './resolve.js'

const PAGE = 'https://example.com/blog'

function source(overrides: Partial<ResolvedSource> = {}): ResolvedSource {
  return { rssUrl: null, rssBridgeUrl: null, title: null, usedFlareSolverr: false, ...overrides }
}

async function resolve(
  url: string,
  opts: Parameters<typeof resolveFeedSource>[1] = {},
): Promise<{ result: ResolvedSource; events: ResolveEvent[] }> {
  const events: ResolveEvent[] = []
  const result = await resolveFeedSource(url, {
    ...opts,
    onEvent: (event) => {
      events.push(event)
      opts.onEvent?.(event)
    },
  })
  return { result, events }
}

beforeEach(() => {
  mockResolveGithubStarsFeed.mockReset().mockReturnValue(null)
  mockResolveSocialSearchFeed.mockReset().mockResolvedValue(null)
  mockDiscoverRssUrl.mockReset().mockResolvedValue({ rssUrl: null, title: null, usedFlareSolverr: false })
  mockQueryRssBridge.mockReset().mockResolvedValue(null)
  mockInferCssSelectorBridge.mockReset().mockResolvedValue(null)
})

describe('resolveFeedSource', () => {
  it('returns a GitHub-stars feed and skips the rest of the chain', async () => {
    mockResolveGithubStarsFeed.mockReturnValue({
      feedUrl: 'https://github.com/stars/octocat',
      title: 'GitHub Releases (octocat)',
    })

    const { result, events } = await resolve('https://github.com/stars/octocat')

    expect(result).toEqual(source({
      rssUrl: 'https://github.com/stars/octocat',
      title: 'GitHub Releases (octocat)',
    }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: true },
      { stage: 'social', status: 'skipped' },
      { stage: 'rss-discovery', status: 'skipped' },
      { stage: 'rss-bridge', status: 'skipped' },
      { stage: 'css-selector', status: 'skipped' },
    ])
    expect(mockResolveSocialSearchFeed).not.toHaveBeenCalled()
    expect(mockDiscoverRssUrl).not.toHaveBeenCalled()
    expect(mockQueryRssBridge).not.toHaveBeenCalled()
    expect(mockInferCssSelectorBridge).not.toHaveBeenCalled()
  })

  it('returns a social-search feed and skips discovery and bridges', async () => {
    mockResolveSocialSearchFeed.mockResolvedValue('https://bsky.app/search?q=rust')

    const { result, events } = await resolve('https://bsky.app/search?q=rust')

    expect(result).toEqual(source({ rssUrl: 'https://bsky.app/search?q=rust' }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: false },
      { stage: 'social', status: 'start' },
      { stage: 'social', status: 'done', found: true },
      { stage: 'rss-discovery', status: 'skipped' },
      { stage: 'rss-bridge', status: 'skipped' },
      { stage: 'css-selector', status: 'skipped' },
    ])
    expect(mockDiscoverRssUrl).not.toHaveBeenCalled()
    expect(mockQueryRssBridge).not.toHaveBeenCalled()
    expect(mockInferCssSelectorBridge).not.toHaveBeenCalled()
  })

  it('returns a discovered RSS URL and does not run the bridges', async () => {
    mockDiscoverRssUrl.mockResolvedValue({
      rssUrl: 'https://example.com/feed.xml',
      title: 'Blog',
      usedFlareSolverr: true,
    })

    const { result, events } = await resolve(PAGE)

    expect(result).toEqual(source({
      rssUrl: 'https://example.com/feed.xml',
      title: 'Blog',
      usedFlareSolverr: true,
    }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: false },
      { stage: 'social', status: 'start' },
      { stage: 'social', status: 'done', found: false },
      { stage: 'rss-discovery', status: 'start' },
      { stage: 'rss-discovery', status: 'done', found: true },
    ])
    expect(mockQueryRssBridge).not.toHaveBeenCalled()
    expect(mockInferCssSelectorBridge).not.toHaveBeenCalled()
  })

  it('falls back to RSS-Bridge when discovery finds nothing', async () => {
    mockQueryRssBridge.mockResolvedValue('https://bridge.example.com/rss')

    const { result, events } = await resolve(PAGE)

    expect(result).toEqual(source({ rssBridgeUrl: 'https://bridge.example.com/rss' }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: false },
      { stage: 'social', status: 'start' },
      { stage: 'social', status: 'done', found: false },
      { stage: 'rss-discovery', status: 'start' },
      { stage: 'rss-discovery', status: 'done', found: false },
      { stage: 'rss-bridge', status: 'start' },
      { stage: 'rss-bridge', status: 'done', found: true },
      { stage: 'css-selector', status: 'skipped' },
    ])
    expect(mockInferCssSelectorBridge).not.toHaveBeenCalled()
  })

  it('falls back to the CSS-selector bridge when RSS-Bridge finds nothing', async () => {
    mockInferCssSelectorBridge.mockResolvedValue('https://bridge.example.com/css')

    const { result, events } = await resolve(PAGE)

    expect(result).toEqual(source({ rssBridgeUrl: 'https://bridge.example.com/css' }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: false },
      { stage: 'social', status: 'start' },
      { stage: 'social', status: 'done', found: false },
      { stage: 'rss-discovery', status: 'start' },
      { stage: 'rss-discovery', status: 'done', found: false },
      { stage: 'rss-bridge', status: 'start' },
      { stage: 'rss-bridge', status: 'done', found: false },
      { stage: 'css-selector', status: 'start' },
      { stage: 'css-selector', status: 'done', found: true },
    ])
  })

  it('returns an empty source when every stage finds nothing', async () => {
    const { result, events } = await resolve(PAGE)

    expect(result).toEqual(source())
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'start' },
      { stage: 'github-stars', status: 'done', found: false },
      { stage: 'social', status: 'start' },
      { stage: 'social', status: 'done', found: false },
      { stage: 'rss-discovery', status: 'start' },
      { stage: 'rss-discovery', status: 'done', found: false },
      { stage: 'rss-bridge', status: 'start' },
      { stage: 'rss-bridge', status: 'done', found: false },
      { stage: 'css-selector', status: 'start' },
      { stage: 'css-selector', status: 'done', found: false },
    ])
  })

  it('skipResolvers skips GitHub-stars and social, then runs discovery', async () => {
    mockDiscoverRssUrl.mockResolvedValue({
      rssUrl: 'https://example.com/feed.xml',
      title: 'Blog',
      usedFlareSolverr: false,
    })

    const { result, events } = await resolve(PAGE, { skipResolvers: true })

    expect(result).toEqual(source({ rssUrl: 'https://example.com/feed.xml', title: 'Blog' }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'skipped' },
      { stage: 'social', status: 'skipped' },
      { stage: 'rss-discovery', status: 'start' },
      { stage: 'rss-discovery', status: 'done', found: true },
    ])
    expect(mockResolveGithubStarsFeed).not.toHaveBeenCalled()
    expect(mockResolveSocialSearchFeed).not.toHaveBeenCalled()
    expect(mockDiscoverRssUrl).toHaveBeenCalledWith(PAGE, undefined)
  })

  it('forcePageSelector skips discovery and RSS-Bridge and runs CSS inference', async () => {
    mockInferCssSelectorBridge.mockResolvedValue('https://bridge.example.com/css')

    const { result, events } = await resolve(PAGE, { forcePageSelector: true })

    expect(result).toEqual(source({ rssBridgeUrl: 'https://bridge.example.com/css' }))
    expect(events).toEqual<ResolveEvent[]>([
      { stage: 'github-stars', status: 'skipped' },
      { stage: 'social', status: 'skipped' },
      { stage: 'rss-discovery', status: 'skipped' },
      { stage: 'rss-bridge', status: 'skipped' },
      { stage: 'css-selector', status: 'start' },
      { stage: 'css-selector', status: 'done', found: true },
    ])
    expect(mockResolveGithubStarsFeed).not.toHaveBeenCalled()
    expect(mockResolveSocialSearchFeed).not.toHaveBeenCalled()
    expect(mockDiscoverRssUrl).not.toHaveBeenCalled()
    expect(mockQueryRssBridge).not.toHaveBeenCalled()
    expect(mockInferCssSelectorBridge).toHaveBeenCalledWith(PAGE)
  })
})
