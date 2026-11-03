/**
 * Recognising the GitHub repository a URL belongs to.
 *
 * Shared by the Git backup routes, which archive the repository, and the
 * article toolbar, which offers to archive it when an article points at one.
 * Any page inside a repository counts — the repository root, a release, a
 * file, an issue — since all of them name the same `<owner>/<repo>`.
 */

export interface GithubRepoRef {
  owner: string
  repo: string
}

/**
 * First path segments that are GitHub's own pages, not an account. A URL
 * such as `github.com/stars/<user>` has two segments like a repository does,
 * but names no repository.
 */
const RESERVED_OWNERS = new Set([
  'about', 'apps', 'codespaces', 'collections', 'contact', 'customer-stories',
  'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'marketplace',
  'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search',
  'security', 'settings', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users',
])

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]+$/

export function parseGithubRepoUrl(url: string): GithubRepoRef | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.hostname.replace(/^www\./, '') !== 'github.com') return null

  const [owner, rawRepo] = parsed.pathname.replace(/^\/+/, '').split('/')
  if (!owner || !rawRepo) return null
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null

  const repo = rawRepo.replace(/\.git$/, '')
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null

  return { owner, repo }
}

export function githubRepoUrl({ owner, repo }: GithubRepoRef): string {
  return `https://github.com/${owner}/${repo}`
}
