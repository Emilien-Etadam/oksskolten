import type { RssItem } from './rss.js'
import { normalizeDate } from './util.js'
import { getSetting } from '../db.js'
import { logger } from '../logger.js'

const log = logger.child('github-releases')

/**
 * Turn "the repositories I starred" into a release feed.
 *
 * GitHub serves an Atom feed of releases per repository
 * (`/<owner>/<repo>/releases.atom`) but nothing that spans a user's stars, and
 * the star list is itself a moving target. One GraphQL query returns a page of
 * starred repositories together with their latest releases, so the whole feed
 * costs a handful of requests per cycle instead of one per repository.
 */

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'
const REQUEST_TIMEOUT_MS = 20_000

/** Repositories per GraphQL page. 100 is the maximum GitHub accepts. */
const REPOS_PER_PAGE = 100

/**
 * Cap on pages walked per fetch. Bounds both the query cost and the work done
 * on a very large star list; the newest stars are read first, so the cut falls
 * on the oldest ones.
 */
const MAX_PAGES = 5

/** Recent entries kept per repository. Older ones have already been ingested. */
const ENTRIES_PER_REPO = 3

/** Release bodies are long; the excerpt only has to seed the article. */
const EXCERPT_MAX_CHARS = 2000

/**
 * What counts as a release, from the `github.release_types` setting.
 *
 * - `stable`     — published, non-prerelease releases only
 * - `prerelease` — the above plus betas and release candidates
 * - `tags`       — the above plus tags, but only from repositories that
 *                  publish no releases at all. Repositories that do publish
 *                  releases tag every one of them, so including their tags
 *                  would duplicate every item.
 */
export type ReleaseTypes = 'stable' | 'prerelease' | 'tags'

export const RELEASE_TYPE_VALUES: ReleaseTypes[] = ['stable', 'prerelease', 'tags']

const DEFAULT_RELEASE_TYPES: ReleaseTypes = 'stable'

export function getReleaseTypes(): ReleaseTypes {
  const raw = getSetting('github.release_types')
  return RELEASE_TYPE_VALUES.includes(raw as ReleaseTypes)
    ? (raw as ReleaseTypes)
    : DEFAULT_RELEASE_TYPES
}

/**
 * Token used for the GraphQL request. The `github.token` DB setting (Settings
 * → Integration) takes precedence over `GITHUB_TOKEN` so a token entered in
 * the UI does not require a container restart to take effect; the env var
 * remains for deployments that prefer configuring it outside the app.
 */
export function getGithubToken(): string | null {
  return getSetting('github.token') || process.env.GITHUB_TOKEN || null
}

/**
 * Parse a GitHub stars URL and return the account whose stars it lists.
 *
 * Accepts the two forms GitHub itself produces: the stars page
 * (`github.com/stars/<user>`) and the profile tab
 * (`github.com/<user>?tab=stars`).
 */
export function parseGithubStarsUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.replace(/^www\./, '') !== 'github.com') return null

  const path = parsed.pathname.replace(/\/+$/, '')

  const starsPage = path.match(/^\/stars\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)$/)
  if (starsPage) return starsPage[1]

  if (parsed.searchParams.get('tab') === 'stars') {
    const profile = path.match(/^\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)$/)
    if (profile) return profile[1]
  }

  return null
}

export function isGithubStarsUrl(url: string): boolean {
  return parseGithubStarsUrl(url) !== null
}

/**
 * Canonical feed URL for an account's stars. Both accepted input forms collapse
 * to this one, so the same star list cannot be subscribed to twice under two
 * spellings, and the stored URL stays a page a reader can actually open.
 */
export function githubStarsFeedUrl(user: string): string {
  return `https://github.com/stars/${user}`
}

export interface GithubStarsFeed {
  feedUrl: string
  title: string
}

/** Resolve a pasted URL to a stars feed, or null when it is not one. */
export function resolveGithubStarsFeed(url: string): GithubStarsFeed | null {
  const user = parseGithubStarsUrl(url)
  if (!user) return null
  return { feedUrl: githubStarsFeedUrl(user), title: `GitHub Releases (${user})` }
}

interface GraphqlRelease {
  name?: unknown
  tagName?: unknown
  url?: unknown
  publishedAt?: unknown
  isPrerelease?: unknown
  isDraft?: unknown
  description?: unknown
}

interface GraphqlTag {
  name?: unknown
  target?: {
    committedDate?: unknown
    target?: { committedDate?: unknown }
  }
}

interface GraphqlRepo {
  nameWithOwner?: unknown
  url?: unknown
  releases?: { nodes?: unknown }
  refs?: { nodes?: unknown }
}

interface GraphqlPage {
  pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }
  nodes?: unknown
}

/**
 * Tags are requested only when the setting asks for them: the `refs` block
 * roughly doubles the cost of the query and is discarded otherwise.
 */
function buildQuery(withTags: boolean): string {
  const tagBlock = withTags
    ? `
        refs(refPrefix: "refs/tags/", first: ${ENTRIES_PER_REPO},
             orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
          nodes {
            name
            target {
              ... on Commit { committedDate }
              ... on Tag { target { ... on Commit { committedDate } } }
            }
          }
        }`
    : ''

  return `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        starredRepositories(first: ${REPOS_PER_PAGE}, after: $cursor,
                            orderBy: {field: STARRED_AT, direction: DESC}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            nameWithOwner
            url
            releases(first: ${ENTRIES_PER_REPO},
                     orderBy: {field: CREATED_AT, direction: DESC}) {
              nodes { name tagName url publishedAt isPrerelease isDraft description }
            }${tagBlock}
          }
        }
      }
    }`
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function excerptOf(description: unknown): string | undefined {
  const body = str(description)
  if (!body) return undefined
  return body.length > EXCERPT_MAX_CHARS ? `${body.slice(0, EXCERPT_MAX_CHARS)}…` : body
}

function releaseItem(repo: string, release: GraphqlRelease): RssItem | null {
  const url = str(release.url)
  if (!url) return null
  const label = str(release.name) || str(release.tagName) || 'release'
  return {
    title: `${repo} ${label}`,
    url,
    published_at: normalizeDate(str(release.publishedAt) ?? ''),
    excerpt: excerptOf(release.description),
  }
}

function tagItem(repo: string, repoUrl: string | null, tag: GraphqlTag): RssItem | null {
  const name = str(tag.name)
  if (!name || !repoUrl) return null
  // Lightweight tags point straight at a Commit; annotated tags wrap one.
  const date = str(tag.target?.committedDate) ?? str(tag.target?.target?.committedDate)
  return {
    title: `${repo} ${name}`,
    url: `${repoUrl}/releases/tag/${encodeURIComponent(name)}`,
    published_at: normalizeDate(date ?? ''),
  }
}

function repoItems(repo: GraphqlRepo, types: ReleaseTypes): RssItem[] {
  const name = str(repo.nameWithOwner)
  if (!name) return []

  const releaseNodes = Array.isArray(repo.releases?.nodes)
    ? (repo.releases.nodes as GraphqlRelease[])
    : []

  const releases = releaseNodes
    .filter(r => r.isDraft !== true)
    .filter(r => types !== 'stable' || r.isPrerelease !== true)
    .map(r => releaseItem(name, r))
    .filter((item): item is RssItem => item !== null)

  // Only repositories that publish no releases at all fall back to tags —
  // otherwise every release would arrive twice, once under each shape.
  if (types !== 'tags' || releaseNodes.length > 0) return releases

  const tagNodes = Array.isArray(repo.refs?.nodes) ? (repo.refs.nodes as GraphqlTag[]) : []
  return tagNodes
    .map(t => tagItem(name, str(repo.url), t))
    .filter((item): item is RssItem => item !== null)
}

async function queryPage(
  login: string,
  cursor: string | null,
  token: string,
  withTags: boolean,
): Promise<GraphqlPage | null> {
  // api.github.com resolves publicly, so this bypasses safeFetch's private-range
  // guard the same way the other API-backed feed sources do.
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: buildQuery(withTags), variables: { login, cursor } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (res.status === 401) throw new Error('GITHUB_TOKEN was rejected by GitHub (401)')
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}`)

  const json = await res.json() as {
    data?: { user?: { starredRepositories?: GraphqlPage } | null }
    errors?: { message?: string }[]
  }

  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map(e => e.message ?? '?').join('; ')}`)
  }
  // A null user means the login does not exist, which is worth surfacing as an
  // error rather than as a silently empty feed.
  if (!json.data?.user) throw new Error(`GitHub user not found: ${login}`)

  return json.data.user.starredRepositories ?? null
}

/**
 * Fetch releases across every repository the account has starred.
 *
 * Requires `GITHUB_TOKEN`: the GraphQL API rejects unauthenticated requests
 * outright, and a token is what makes one request per 100 repositories
 * possible instead of one per repository.
 */
export async function fetchGithubStarredReleases(feedUrl: string): Promise<RssItem[]> {
  const login = parseGithubStarsUrl(feedUrl)
  if (!login) throw new Error(`Not a GitHub stars URL: ${feedUrl}`)

  const token = getGithubToken()
  if (!token) {
    throw new Error(
      'No GitHub token configured — set one in Settings → Integration, or GITHUB_TOKEN',
    )
  }

  const types = getReleaseTypes()
  const items: RssItem[] = []
  let cursor: string | null = null
  let repoCount = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const result: GraphqlPage | null = await queryPage(login, cursor, token, types === 'tags')
    if (!result) break

    const repos = Array.isArray(result.nodes) ? (result.nodes as GraphqlRepo[]) : []
    repoCount += repos.length
    for (const repo of repos) items.push(...repoItems(repo, types))

    const hasNext = result.pageInfo?.hasNextPage === true
    cursor = str(result.pageInfo?.endCursor)
    if (!hasNext || !cursor) break

    if (page === MAX_PAGES - 1) {
      log.warn(
        `${login} has more than ${MAX_PAGES * REPOS_PER_PAGE} starred repositories; ` +
        'the oldest stars beyond that are not checked for releases',
      )
    }
  }

  // Newest first, so the per-feed article cap keeps the most recent releases.
  items.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  log.info(`${login}: ${items.length} entries across ${repoCount} starred repositories (${types})`)
  return items
}
