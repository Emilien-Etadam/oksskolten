import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetSetting = vi.fn()

vi.mock('../db.js', () => ({
  getSetting: (key: string) => mockGetSetting(key),
}))

import {
  parseGithubStarsUrl,
  isGithubStarsUrl,
  resolveGithubStarsFeed,
  getReleaseTypes,
  fetchGithubStarredReleases,
} from './github-releases.js'

const mockFetch = vi.fn()

function release(overrides: Record<string, unknown> = {}) {
  return {
    name: 'v1.2.0',
    tagName: 'v1.2.0',
    url: 'https://github.com/acme/widget/releases/tag/v1.2.0',
    publishedAt: '2026-08-01T10:00:00Z',
    isPrerelease: false,
    isDraft: false,
    description: 'Fixed the thing.',
    ...overrides,
  }
}

function repo(overrides: Record<string, unknown> = {}) {
  return {
    nameWithOwner: 'acme/widget',
    url: 'https://github.com/acme/widget',
    releases: { nodes: [release()] },
    ...overrides,
  }
}

/** One GraphQL page; hasNextPage defaults to false so fetches terminate. */
function page(nodes: unknown[], pageInfo: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        user: {
          starredRepositories: {
            pageInfo: { hasNextPage: false, endCursor: null, ...pageInfo },
            nodes,
          },
        },
      },
    }),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  mockGetSetting.mockReset()
  mockGetSetting.mockReturnValue('stable')
  vi.stubGlobal('fetch', mockFetch)
  process.env.GITHUB_TOKEN = 'ghp_test'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GITHUB_TOKEN
})

describe('parseGithubStarsUrl', () => {
  it('accepts the stars page', () => {
    expect(parseGithubStarsUrl('https://github.com/stars/octocat')).toBe('octocat')
  })

  it('accepts the profile stars tab', () => {
    expect(parseGithubStarsUrl('https://github.com/octocat?tab=stars')).toBe('octocat')
  })

  it('tolerates www and a trailing slash', () => {
    expect(parseGithubStarsUrl('https://www.github.com/stars/octocat/')).toBe('octocat')
  })

  it('accepts logins containing hyphens', () => {
    expect(parseGithubStarsUrl('https://github.com/stars/some-user')).toBe('some-user')
  })

  it('rejects a profile without the stars tab', () => {
    expect(parseGithubStarsUrl('https://github.com/octocat')).toBeNull()
  })

  it('rejects a repository URL', () => {
    expect(parseGithubStarsUrl('https://github.com/acme/widget')).toBeNull()
  })

  it('rejects another host', () => {
    expect(parseGithubStarsUrl('https://gitlab.com/stars/octocat')).toBeNull()
  })

  it('rejects a non-URL', () => {
    expect(parseGithubStarsUrl('not a url')).toBeNull()
  })

  it('backs isGithubStarsUrl', () => {
    expect(isGithubStarsUrl('https://github.com/stars/octocat')).toBe(true)
    expect(isGithubStarsUrl('https://github.com/acme/widget')).toBe(false)
  })
})

describe('resolveGithubStarsFeed', () => {
  it('collapses both input forms to one canonical feed URL', () => {
    const fromTab = resolveGithubStarsFeed('https://github.com/octocat?tab=stars')
    const fromPage = resolveGithubStarsFeed('https://github.com/stars/octocat')
    expect(fromTab?.feedUrl).toBe('https://github.com/stars/octocat')
    expect(fromPage?.feedUrl).toBe(fromTab?.feedUrl)
  })

  it('names the feed after the account', () => {
    expect(resolveGithubStarsFeed('https://github.com/stars/octocat')?.title)
      .toBe('GitHub Releases (octocat)')
  })

  it('returns null for anything else', () => {
    expect(resolveGithubStarsFeed('https://github.com/acme/widget')).toBeNull()
  })
})

describe('getReleaseTypes', () => {
  it('defaults to stable when unset', () => {
    mockGetSetting.mockReturnValue(undefined)
    expect(getReleaseTypes()).toBe('stable')
  })

  it('defaults to stable when the stored value is unknown', () => {
    mockGetSetting.mockReturnValue('everything')
    expect(getReleaseTypes()).toBe('stable')
  })

  it('honours a valid stored value', () => {
    mockGetSetting.mockReturnValue('tags')
    expect(getReleaseTypes()).toBe('tags')
  })
})

describe('fetchGithubStarredReleases', () => {
  it('converts releases to feed items', async () => {
    mockFetch.mockResolvedValue(page([repo()]))

    const items = await fetchGithubStarredReleases('https://github.com/stars/octocat')

    expect(items).toEqual([{
      title: 'acme/widget v1.2.0',
      url: 'https://github.com/acme/widget/releases/tag/v1.2.0',
      published_at: '2026-08-01T10:00:00.000Z',
      excerpt: 'Fixed the thing.',
    }])
  })

  it('sends the token and the login', async () => {
    mockFetch.mockResolvedValue(page([]))
    await fetchGithubStarredReleases('https://github.com/stars/octocat')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer ghp_test')
    expect(JSON.parse(init.body).variables.login).toBe('octocat')
  })

  it('fails loudly when no token is configured', async () => {
    delete process.env.GITHUB_TOKEN
    await expect(fetchGithubStarredReleases('https://github.com/stars/octocat'))
      .rejects.toThrow(/GITHUB_TOKEN/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('drops drafts', async () => {
    mockFetch.mockResolvedValue(page([
      repo({ releases: { nodes: [release({ isDraft: true })] } }),
    ]))
    expect(await fetchGithubStarredReleases('https://github.com/stars/octocat')).toEqual([])
  })

  it('drops pre-releases under the stable setting', async () => {
    mockFetch.mockResolvedValue(page([
      repo({ releases: { nodes: [release({ isPrerelease: true })] } }),
    ]))
    expect(await fetchGithubStarredReleases('https://github.com/stars/octocat')).toEqual([])
  })

  it('keeps pre-releases under the prerelease setting', async () => {
    mockGetSetting.mockReturnValue('prerelease')
    mockFetch.mockResolvedValue(page([
      repo({ releases: { nodes: [release({ isPrerelease: true })] } }),
    ]))
    const items = await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(items).toHaveLength(1)
  })

  it('uses tags only for repositories that publish no releases', async () => {
    mockGetSetting.mockReturnValue('tags')
    mockFetch.mockResolvedValue(page([
      // Publishes releases: its tags would duplicate them, so they are ignored.
      repo({
        refs: { nodes: [{ name: 'v9.9.9', target: { committedDate: '2026-08-02T00:00:00Z' } }] },
      }),
      repo({
        nameWithOwner: 'acme/tagged',
        url: 'https://github.com/acme/tagged',
        releases: { nodes: [] },
        refs: { nodes: [{ name: 'v0.3.0', target: { committedDate: '2026-07-01T00:00:00Z' } }] },
      }),
    ]))

    const items = await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(items.map(i => i.title)).toEqual(['acme/widget v1.2.0', 'acme/tagged v0.3.0'])
    expect(items[1].url).toBe('https://github.com/acme/tagged/releases/tag/v0.3.0')
  })

  it('reads the commit date through an annotated tag', async () => {
    mockGetSetting.mockReturnValue('tags')
    mockFetch.mockResolvedValue(page([
      repo({
        releases: { nodes: [] },
        refs: { nodes: [{ name: 'v1.0.0', target: { target: { committedDate: '2026-06-01T00:00:00Z' } } }] },
      }),
    ]))
    const items = await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(items[0].published_at).toBe('2026-06-01T00:00:00.000Z')
  })

  it('omits the tags block from the query unless tags are wanted', async () => {
    mockFetch.mockResolvedValue(page([]))
    await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).query).not.toContain('refs(')

    mockFetch.mockReset()
    mockGetSetting.mockReturnValue('tags')
    mockFetch.mockResolvedValue(page([]))
    await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).query).toContain('refs(')
  })

  it('follows pagination and sorts newest first', async () => {
    mockFetch
      .mockResolvedValueOnce(page(
        [repo({ releases: { nodes: [release({ publishedAt: '2026-01-01T00:00:00Z' })] } })],
        { hasNextPage: true, endCursor: 'CURSOR1' },
      ))
      .mockResolvedValueOnce(page([
        repo({
          nameWithOwner: 'acme/other',
          releases: { nodes: [release({ publishedAt: '2026-09-01T00:00:00Z' })] },
        }),
      ]))

    const items = await fetchGithubStarredReleases('https://github.com/stars/octocat')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).variables.cursor).toBe('CURSOR1')
    expect(items.map(i => i.title)).toEqual(['acme/other v1.2.0', 'acme/widget v1.2.0'])
  })

  it('stops after the page cap even when more pages remain', async () => {
    mockFetch.mockResolvedValue(page([], { hasNextPage: true, endCursor: 'MORE' }))
    await fetchGithubStarredReleases('https://github.com/stars/octocat')
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('surfaces a rejected token', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    await expect(fetchGithubStarredReleases('https://github.com/stars/octocat'))
      .rejects.toThrow(/401/)
  })

  it('surfaces GraphQL errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'Bad credentials' }] }),
    })
    await expect(fetchGithubStarredReleases('https://github.com/stars/octocat'))
      .rejects.toThrow(/Bad credentials/)
  })

  it('surfaces an unknown account rather than returning an empty feed', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { user: null } }) })
    await expect(fetchGithubStarredReleases('https://github.com/stars/nope'))
      .rejects.toThrow(/not found/)
  })

  it('rejects a URL that is not a stars page', async () => {
    await expect(fetchGithubStarredReleases('https://github.com/acme/widget'))
      .rejects.toThrow(/Not a GitHub stars URL/)
  })
})
