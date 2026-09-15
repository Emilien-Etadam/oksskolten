import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchHtml = vi.fn()

vi.mock('../../fetcher/http.js', () => ({
  fetchHtml: (url: string) => mockFetchHtml(url),
}))

import {
  parseGithubTrendingUrl,
  isGithubTrendingUrl,
  githubTrendingFeedUrl,
  resolveGithubTrendingFeed,
  fetchGithubTrending,
} from './github-trending.js'

function row(opts: {
  nameWithOwner?: string
  href?: string
  description?: string
  language?: string
  gained?: string
} = {}) {
  const href = opts.href ?? `/${opts.nameWithOwner ?? 'acme/widget'}`
  return `
    <article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="${href}">
          <span class="text-normal">acme /</span>
          widget
        </a>
      </h2>
      ${opts.description === undefined ? '<p class="col-9 my-1 pr-4">Widgets, but\n        faster.</p>' : opts.description ? `<p class="col-9 my-1 pr-4">${opts.description}</p>` : ''}
      <div class="f6 mt-2">
        ${opts.language === undefined ? '<span itemprop="programmingLanguage">TypeScript</span>' : opts.language ? `<span itemprop="programmingLanguage">${opts.language}</span>` : ''}
        <a href="${href}/stargazers" class="Link--muted">12,345</a>
        <span class="d-inline-block float-sm-right">${opts.gained ?? '1,234 stars this week'}</span>
      </div>
    </article>`
}

function page(rows: string): string {
  return `<html><body><div class="Box">${rows}</div></body></html>`
}

describe('parseGithubTrendingUrl', () => {
  it('parses the bare trending page, defaulting to daily', () => {
    expect(parseGithubTrendingUrl('https://github.com/trending')).toEqual({
      language: null,
      since: 'daily',
      spokenLanguage: null,
    })
  })

  it('parses period, language and spoken language', () => {
    expect(
      parseGithubTrendingUrl('https://github.com/trending/rust?since=weekly&spoken_language_code=fr'),
    ).toEqual({ language: 'rust', since: 'weekly', spokenLanguage: 'fr' })
  })

  it('keeps the language segment percent-encoded', () => {
    expect(parseGithubTrendingUrl('https://github.com/trending/c%2B%2B')?.language).toBe('c%2B%2B')
  })

  it('tolerates www and a trailing slash', () => {
    expect(parseGithubTrendingUrl('https://www.github.com/trending/go/?since=monthly')).toEqual({
      language: 'go',
      since: 'monthly',
      spokenLanguage: null,
    })
  })

  it('falls back to daily on an unknown period, as GitHub does', () => {
    expect(parseGithubTrendingUrl('https://github.com/trending?since=yearly')?.since).toBe('daily')
  })

  it('rejects the developers board, other GitHub pages and other hosts', () => {
    expect(parseGithubTrendingUrl('https://github.com/trending/developers')).toBeNull()
    expect(parseGithubTrendingUrl('https://github.com/trending/developers/rust')).toBeNull()
    expect(parseGithubTrendingUrl('https://github.com/acme/widget')).toBeNull()
    expect(parseGithubTrendingUrl('https://gitlab.com/trending')).toBeNull()
    expect(parseGithubTrendingUrl('not a url')).toBeNull()
  })

  it('exposes an isGithubTrendingUrl guard', () => {
    expect(isGithubTrendingUrl('https://github.com/trending?since=weekly')).toBe(true)
    expect(isGithubTrendingUrl('https://github.com/stars/acme')).toBe(false)
  })
})

describe('githubTrendingFeedUrl', () => {
  it('spells out the period so one board has one URL', () => {
    expect(resolveGithubTrendingFeed('https://github.com/trending')?.feedUrl).toBe(
      'https://github.com/trending?since=daily',
    )
    expect(resolveGithubTrendingFeed('https://github.com/trending?since=daily')?.feedUrl).toBe(
      'https://github.com/trending?since=daily',
    )
  })

  it('round-trips language and spoken language', () => {
    const url = 'https://github.com/trending/c%2B%2B?since=weekly&spoken_language_code=fr'
    const query = parseGithubTrendingUrl(url)!
    expect(githubTrendingFeedUrl(query)).toBe(
      'https://github.com/trending/c%2B%2B?since=weekly&spoken_language_code=fr',
    )
  })
})

describe('resolveGithubTrendingFeed', () => {
  it('names the feed after its scope', () => {
    expect(resolveGithubTrendingFeed('https://github.com/trending?since=weekly')?.title).toBe(
      'GitHub Trending (this week)',
    )
    expect(
      resolveGithubTrendingFeed('https://github.com/trending/c%2B%2B?since=monthly&spoken_language_code=fr')?.title,
    ).toBe('GitHub Trending (c++, fr, this month)')
  })

  it('returns null for a URL it does not own', () => {
    expect(resolveGithubTrendingFeed('https://github.com/stars/acme')).toBeNull()
  })
})

describe('fetchGithubTrending', () => {
  beforeEach(() => {
    mockFetchHtml.mockReset()
  })

  it('fetches the canonical URL and reads one item per row', async () => {
    mockFetchHtml.mockResolvedValue({ html: page(row()), usedFlareSolverr: false })

    const items = await fetchGithubTrending('https://github.com/trending/rust')

    expect(mockFetchHtml).toHaveBeenCalledWith('https://github.com/trending/rust?since=daily')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('acme/widget')
    expect(items[0].url).toBe('https://github.com/acme/widget')
    expect(items[0].excerpt).toBe('Widgets, but faster. — TypeScript · 1,234 stars this week')
  })

  it('keeps rank order by spacing pseudo-dates a second apart', async () => {
    const html = page([
      row({ nameWithOwner: 'acme/first' }),
      row({ nameWithOwner: 'acme/second' }),
      row({ nameWithOwner: 'acme/third' }),
    ].join(''))
    mockFetchHtml.mockResolvedValue({ html, usedFlareSolverr: false })

    const items = await fetchGithubTrending('https://github.com/trending?since=weekly')

    expect(items.map(i => i.url)).toEqual([
      'https://github.com/acme/first',
      'https://github.com/acme/second',
      'https://github.com/acme/third',
    ])
    const dates = items.map(i => new Date(i.published_at!).getTime())
    expect(dates[0] - dates[1]).toBe(1_000)
    expect(dates[1] - dates[2]).toBe(1_000)
  })

  it('skips rows whose heading is not a repository link', async () => {
    const html = page(row() + row({ href: '/acme/widget/issues/1' }))
    mockFetchHtml.mockResolvedValue({ html, usedFlareSolverr: false })

    const items = await fetchGithubTrending('https://github.com/trending')

    expect(items.map(i => i.url)).toEqual(['https://github.com/acme/widget'])
  })

  it('omits the excerpt when the row carries no description or stats', async () => {
    const html = page(row({ description: '', language: '', gained: '' }))
    mockFetchHtml.mockResolvedValue({ html, usedFlareSolverr: false })

    const items = await fetchGithubTrending('https://github.com/trending')

    expect(items[0].excerpt).toBeUndefined()
  })

  it('returns nothing for a filter GitHub has no results for', async () => {
    mockFetchHtml.mockResolvedValue({
      html: '<html><body><div class="blankslate">It looks like we don\'t have any trending repositories.</div></body></html>',
      usedFlareSolverr: false,
    })

    await expect(fetchGithubTrending('https://github.com/trending/cobol')).resolves.toEqual([])
  })

  it('errors when the page has neither rows nor a blankslate', async () => {
    mockFetchHtml.mockResolvedValue({ html: '<html><body><main>Something else</main></body></html>', usedFlareSolverr: false })

    await expect(fetchGithubTrending('https://github.com/trending')).rejects.toThrow(/markup may have changed/)
  })

  it('refuses a URL that is not a trending board', async () => {
    await expect(fetchGithubTrending('https://github.com/stars/acme')).rejects.toThrow(/Not a GitHub trending URL/)
    expect(mockFetchHtml).not.toHaveBeenCalled()
  })
})
