import { getSetting } from '../db.js'
import type { GitRef } from './check.js'
import { GitBackupError, describeFailure } from './errors.js'

/**
 * Forgejo API calls. Forgejo does the actual Git work — the initial clone and
 * every later sync run on its side, straight from GitHub — so Oksskolten never
 * downloads nor stores repository data. Gitea exposes the same API, so a Gitea
 * instance works too.
 *
 * Plain `fetch` on purpose, not `safeFetch`: the instance usually sits on the
 * local network, which the SSRF guard exists to refuse. The URL comes from the
 * reader's own settings, not from feed content.
 */

const REQUEST_TIMEOUT_MS = 30_000

/**
 * The initial migration answers only once Forgejo has cloned the repository,
 * which for a large one takes minutes. It runs in the background, so a long
 * wait costs nothing.
 */
const MIGRATE_TIMEOUT_MS = 30 * 60_000

export interface ForgejoConfig {
  url: string
  token: string
  /** User or organisation the archives are created under; null = the token's user. */
  owner: string | null
}

export function getForgejoConfig(): ForgejoConfig | null {
  const url = getSetting('git_backup.forgejo_url')
  const token = getSetting('git_backup.forgejo_token')
  if (!url || !token) return null
  return { url: url.replace(/\/+$/, ''), token, owner: getSetting('git_backup.forgejo_owner') || null }
}

function forgejoFetch(
  config: ForgejoConfig,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `token ${config.token}`,
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(`${config.url}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new GitBackupError(`Forgejo unreachable at ${config.url}: ${err instanceof Error ? err.message : String(err)}`, 502)
  })
}

async function failure(res: Response): Promise<GitBackupError> {
  return new GitBackupError(await describeFailure('Forgejo', res), 502)
}

function repoPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

/** Login of the user the token belongs to. */
export async function getForgejoUser(config: ForgejoConfig): Promise<string> {
  const res = await forgejoFetch(config, '/user')
  if (!res.ok) throw await failure(res)
  return (await res.json() as { login: string }).login
}

export interface ForgejoRepoInfo {
  mirror: boolean
  original_url: string
  html_url: string
}

export async function getForgejoRepo(config: ForgejoConfig, owner: string, name: string): Promise<ForgejoRepoInfo | null> {
  const res = await forgejoFetch(config, repoPath(owner, name))
  if (res.status === 404) return null
  if (!res.ok) throw await failure(res)
  const body = await res.json() as Partial<ForgejoRepoInfo>
  return { mirror: !!body.mirror, original_url: body.original_url ?? '', html_url: body.html_url ?? '' }
}

/**
 * Create the archive: a private pull mirror of the GitHub repository, code
 * only. `service: 'git'` leaves out issues, pull requests, releases and wiki;
 * `lfs: false` leaves out large files, which can outweigh the code by far.
 */
export async function createForgejoMirror(
  config: ForgejoConfig,
  opts: { owner: string; name: string; cloneUrl: string; description: string },
): Promise<void> {
  const res = await forgejoFetch(config, '/repos/migrate', {
    method: 'POST',
    timeoutMs: MIGRATE_TIMEOUT_MS,
    body: {
      clone_addr: opts.cloneUrl,
      repo_owner: opts.owner,
      repo_name: opts.name,
      description: opts.description,
      service: 'git',
      mirror: true,
      mirror_interval: '0',
      private: true,
      lfs: false,
      wiki: false,
    },
  })
  if (!res.ok) throw await failure(res)
}

/**
 * Turn off Forgejo's own periodic sync: an unattended sync is exactly what
 * would carry an upstream deletion into the archive. Set again after the
 * migration because not every Forgejo version honours `mirror_interval` there.
 */
export async function disableForgejoPeriodicSync(config: ForgejoConfig, owner: string, name: string): Promise<void> {
  const res = await forgejoFetch(config, repoPath(owner, name), {
    method: 'PATCH',
    body: { mirror_interval: '0' },
  })
  if (!res.ok) throw await failure(res)
}

/** Refs under a prefix (`tags`, `heads/main`). Forgejo answers 404 for none. */
async function listRefs(config: ForgejoConfig, owner: string, name: string, prefix: string): Promise<GitRef[]> {
  const res = await forgejoFetch(config, `${repoPath(owner, name)}/git/refs/${prefix}`)
  if (res.status === 404) return []
  if (!res.ok) throw await failure(res)
  const body = await res.json() as { ref: string; object: { sha: string } }[]
  return body.map(r => ({ ref: r.ref, sha: r.object.sha }))
}

/** The archive's tags plus its copy of the default branch. */
export async function listForgejoRefs(config: ForgejoConfig, owner: string, name: string, defaultBranch: string): Promise<GitRef[]> {
  const tags = await listRefs(config, owner, name, 'tags')
  // A prefix match, like GitHub's: heads/main also returns heads/main-old.
  const branch = (await listRefs(config, owner, name, `heads/${defaultBranch.split('/').map(encodeURIComponent).join('/')}`))
    .filter(r => r.ref === `refs/heads/${defaultBranch}`)
  return [...tags, ...branch]
}

/** Ask Forgejo to sync the mirror now. It queues the sync and answers at once. */
export async function triggerForgejoSync(config: ForgejoConfig, owner: string, name: string): Promise<void> {
  const res = await forgejoFetch(config, `${repoPath(owner, name)}/mirror-sync`, { method: 'POST' })
  if (!res.ok) throw await failure(res)
}
