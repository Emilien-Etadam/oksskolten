import useSWR from 'swr'
import { fetcher } from './fetcher'

export type GitBackupStatus = 'importing' | 'ok' | 'blocked' | 'frozen' | 'error'

export interface GitBackupRefLoss {
  ref: string
  kind: 'deleted' | 'rewritten'
  archived_sha: string
  upstream_sha: string | null
}

export interface GitBackup {
  id: number
  github_owner: string
  github_repo: string
  forgejo_owner: string
  forgejo_repo: string
  default_branch: string
  status: GitBackupStatus
  blocked_refs: GitBackupRefLoss[]
  last_error: string | null
  last_checked_at: string | null
  last_synced_at: string | null
  created_at: string
}

interface GitBackupList {
  configured: boolean
  forgejo_url: string | null
  backups: GitBackup[]
}

export const GIT_BACKUPS_KEY = '/api/git-backups'

/**
 * The archived repositories, shared by the settings section and the article
 * toolbar. Polls while a Forgejo import runs in the background, or while the
 * caller expects background syncs to land (`pollWhile`). `enabled: false`
 * skips the request altogether.
 */
export function useGitBackups(opts: { pollWhile?: boolean; enabled?: boolean } = {}) {
  const { data, mutate } = useSWR<GitBackupList>(opts.enabled === false ? null : GIT_BACKUPS_KEY, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: latest =>
      opts.pollWhile || latest?.backups?.some(b => b.status === 'importing') ? 3000 : 0,
  })
  return {
    configured: !!data?.configured,
    forgejoUrl: data?.forgejo_url ?? null,
    backups: data?.backups ?? [],
    mutate,
  }
}

/** SQLite `datetime('now')` (UTC, no zone) as an ISO string. */
export function sqliteUtcToIso(value: string | null): string | null {
  if (!value) return null
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
}

/** `refs/tags/v3.5.0` → `v3.5.0`. */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(tags|heads)\//, '')
}
