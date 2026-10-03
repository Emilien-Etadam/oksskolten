import { getGithubToken } from '../feeds/sources/github-releases.js'
import type { GithubRepoRef } from '../../shared/github-repo.js'
import type { GitRef } from './check.js'
import { GitBackupError, describeFailure } from './errors.js'

/**
 * The few GitHub REST calls the pre-sync check needs: repository metadata and
 * ref listings. No code is downloaded — Forgejo does that itself when it
 * syncs the mirror.
 *
 * A token is optional; it lifts the unauthenticated limit of 60 requests an
 * hour, which a "sync all" over a dozen repositories would otherwise exhaust.
 */

const API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 20_000

/** Cap on ref pages walked, at 100 refs a page. */
const MAX_REF_PAGES = 50

function githubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Oksskolten',
  }
  const token = getGithubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

function repoPath({ owner, repo }: GithubRepoRef): string {
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

async function failure(res: Response): Promise<GitBackupError> {
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    return new GitBackupError('GitHub rate limit reached; add a GitHub token in Settings → Integration or retry later', 429)
  }
  return new GitBackupError(await describeFailure('GitHub', res), 502)
}

export interface GithubRepoInfo {
  owner: string
  repo: string
  default_branch: string
  private: boolean
}

export async function getGithubRepo(ref: GithubRepoRef): Promise<GithubRepoInfo> {
  const res = await githubFetch(repoPath(ref))
  if (res.status === 404) {
    throw new GitBackupError(`Repository ${ref.owner}/${ref.repo} not found on GitHub`, 404)
  }
  if (!res.ok) throw await failure(res)
  const body = await res.json() as {
    name: string
    owner: { login: string }
    default_branch: string
    private: boolean
  }
  // GitHub answers with the canonical spelling, and follows renames.
  return {
    owner: body.owner.login,
    repo: body.name,
    default_branch: body.default_branch,
    private: body.private,
  }
}

function nextPage(res: Response): string | null {
  const link = res.headers.get('link')
  const match = link?.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

/** Refs under a prefix (`tags`, `heads/main`), following pagination. */
async function listMatchingRefs(ref: GithubRepoRef, prefix: string): Promise<GitRef[]> {
  const refs: GitRef[] = []
  let url: string | null = `${repoPath(ref)}/git/matching-refs/${prefix}?per_page=100`
  for (let page = 0; url && page < MAX_REF_PAGES; page++) {
    const res = await githubFetch(url)
    if (res.status === 404) {
      throw new GitBackupError(`Repository ${ref.owner}/${ref.repo} not found on GitHub; the archive is left as is`, 404)
    }
    if (!res.ok) throw await failure(res)
    const body = await res.json() as { ref: string; object: { sha: string } }[]
    for (const r of body) refs.push({ ref: r.ref, sha: r.object.sha })
    url = nextPage(res)
  }
  if (url) {
    throw new GitBackupError(`Too many refs on ${ref.owner}/${ref.repo} to check them all`, 502)
  }
  return refs
}

/** Upstream's tags plus its default branch — everything the check compares. */
export async function listGithubRefs(ref: GithubRepoRef, defaultBranch: string): Promise<GitRef[]> {
  const tags = await listMatchingRefs(ref, 'tags')
  // matching-refs is a prefix match: heads/main also returns heads/main-old.
  const branch = (await listMatchingRefs(ref, `heads/${defaultBranch.split('/').map(encodeURIComponent).join('/')}`))
    .filter(r => r.ref === `refs/heads/${defaultBranch}`)
  return [...tags, ...branch]
}

/**
 * Is `head` a descendant of `base` upstream — did the branch only move forward?
 * A commit GitHub no longer knows (rewritten away and collected) is not.
 */
export async function isGithubAncestor(ref: GithubRepoRef, base: string, head: string): Promise<boolean> {
  const res = await githubFetch(`${repoPath(ref)}/compare/${base}...${head}?per_page=1`)
  if (res.status === 404) return false
  if (!res.ok) throw await failure(res)
  const body = await res.json() as { status: string }
  return body.status === 'ahead' || body.status === 'identical'
}
