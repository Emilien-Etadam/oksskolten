import { getDb } from '../db.js'
import type { RefLoss } from './check.js'

export type GitBackupStatus = 'importing' | 'ok' | 'blocked' | 'frozen' | 'error'

interface GitBackupRow {
  id: number
  github_owner: string
  github_repo: string
  forgejo_owner: string
  forgejo_repo: string
  default_branch: string
  status: GitBackupStatus
  blocked_refs: string | null
  last_error: string | null
  last_checked_at: string | null
  last_synced_at: string | null
  created_at: string
}

export interface GitBackup extends Omit<GitBackupRow, 'blocked_refs'> {
  blocked_refs: RefLoss[]
}

function toBackup(row: GitBackupRow): GitBackup {
  let blocked: RefLoss[] = []
  if (row.blocked_refs) {
    try {
      blocked = JSON.parse(row.blocked_refs) as RefLoss[]
    } catch {
      // A corrupt value only loses the detail; the status still says blocked.
    }
  }
  return { ...row, blocked_refs: blocked }
}

export function listGitBackups(): GitBackup[] {
  const rows = getDb().prepare(
    'SELECT * FROM git_backups ORDER BY github_owner COLLATE NOCASE, github_repo COLLATE NOCASE',
  ).all() as GitBackupRow[]
  return rows.map(toBackup)
}

export function getGitBackup(id: number): GitBackup | undefined {
  const row = getDb().prepare('SELECT * FROM git_backups WHERE id = ?').get(id) as GitBackupRow | undefined
  return row && toBackup(row)
}

export function findGitBackup(owner: string, repo: string): GitBackup | undefined {
  const row = getDb().prepare(
    'SELECT * FROM git_backups WHERE github_owner = ? AND github_repo = ?',
  ).get(owner, repo) as GitBackupRow | undefined
  return row && toBackup(row)
}

export function insertGitBackup(data: {
  github_owner: string
  github_repo: string
  forgejo_owner: string
  forgejo_repo: string
  default_branch: string
}): GitBackup {
  const info = getDb().prepare(`
    INSERT INTO git_backups (github_owner, github_repo, forgejo_owner, forgejo_repo, default_branch)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.github_owner, data.github_repo, data.forgejo_owner, data.forgejo_repo, data.default_branch)
  return getGitBackup(Number(info.lastInsertRowid))!
}

export function updateGitBackup(id: number, data: {
  status?: GitBackupStatus
  blocked_refs?: RefLoss[] | null
  last_error?: string | null
  default_branch?: string
  checked?: boolean
  synced?: boolean
}): GitBackup | undefined {
  const fields: string[] = []
  const params: unknown[] = []
  if (data.status !== undefined) {
    fields.push('status = ?')
    params.push(data.status)
  }
  if (data.blocked_refs !== undefined) {
    fields.push('blocked_refs = ?')
    params.push(data.blocked_refs && data.blocked_refs.length > 0 ? JSON.stringify(data.blocked_refs) : null)
  }
  if (data.last_error !== undefined) {
    fields.push('last_error = ?')
    params.push(data.last_error)
  }
  if (data.default_branch !== undefined) {
    fields.push('default_branch = ?')
    params.push(data.default_branch)
  }
  if (data.checked) fields.push("last_checked_at = datetime('now')")
  if (data.synced) fields.push("last_synced_at = datetime('now')")
  if (fields.length > 0) {
    getDb().prepare(`UPDATE git_backups SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
  }
  return getGitBackup(id)
}

export function deleteGitBackup(id: number): boolean {
  return getDb().prepare('DELETE FROM git_backups WHERE id = ?').run(id).changes > 0
}
