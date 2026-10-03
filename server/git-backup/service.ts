import { logger } from '../logger.js'
import { parseGithubRepoUrl, githubRepoUrl, type GithubRepoRef } from '../../shared/github-repo.js'
import { findRefLosses } from './check.js'
import { GitBackupError } from './errors.js'
import { getGithubRepo, listGithubRefs, isGithubAncestor } from './github.js'
import {
  getForgejoConfig,
  getForgejoUser,
  getForgejoRepo,
  createForgejoMirror,
  disableForgejoPeriodicSync,
  listForgejoRefs,
  triggerForgejoSync,
  type ForgejoConfig,
  type ForgejoRepoInfo,
} from './forgejo.js'
import {
  listGitBackups,
  getGitBackup,
  findGitBackup,
  insertGitBackup,
  updateGitBackup,
  type GitBackup,
} from './db.js'

const log = logger.child('git-backup')

/**
 * Repositories with an import or a sync in flight. One at a time per
 * repository: two checks racing each other could each see a clean state and
 * both trigger a sync, or one could overwrite the other's verdict.
 */
const busy = new Set<number>()
let syncAllRunning = false

function requireConfig(): ForgejoConfig {
  const config = getForgejoConfig()
  if (!config) {
    throw new GitBackupError('Forgejo is not configured; set its URL and token in Settings → Integration')
  }
  return config
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function upstreamOf(backup: GitBackup): GithubRepoRef {
  return { owner: backup.github_owner, repo: backup.github_repo }
}

function sameUpstream(originalUrl: string, ref: GithubRepoRef): boolean {
  const normalize = (url: string) => url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
  return normalize(originalUrl) === normalize(githubRepoUrl(ref))
}

/**
 * Start archiving a GitHub repository. The row is created at once with status
 * `importing`; Forgejo's clone runs in the background and settles the status.
 */
export async function addGitBackup(url: string): Promise<GitBackup> {
  const config = requireConfig()
  const parsed = parseGithubRepoUrl(url)
  if (!parsed) throw new GitBackupError('Not a GitHub repository URL')

  const info = await getGithubRepo(parsed)
  if (info.private) {
    throw new GitBackupError('Private repositories are not supported: Forgejo would need a GitHub token of its own to clone them')
  }
  if (findGitBackup(info.owner, info.repo)) {
    throw new GitBackupError(`${info.owner}/${info.repo} is already archived`, 409)
  }

  const backup = insertGitBackup({
    github_owner: info.owner,
    github_repo: info.repo,
    forgejo_owner: config.owner ?? await getForgejoUser(config),
    // Prefixed with the GitHub owner: two accounts often publish a repository
    // under the same name, and both may be worth archiving.
    forgejo_repo: `${info.owner}-${info.repo}`,
    default_branch: info.default_branch,
  })
  startImport(config, backup)
  return backup
}

function startImport(config: ForgejoConfig, backup: GitBackup): void {
  busy.add(backup.id)
  void importMirror(config, backup).finally(() => busy.delete(backup.id))
}

async function importMirror(config: ForgejoConfig, backup: GitBackup): Promise<void> {
  const ref = upstreamOf(backup)
  try {
    const existing = await getForgejoRepo(config, backup.forgejo_owner, backup.forgejo_repo)
    if (existing) {
      // Left behind when the repository was removed from the list — removal
      // never touches Forgejo. Adopt it as is rather than cloning again.
      if (!existing.mirror || !sameUpstream(existing.original_url, ref)) {
        throw new GitBackupError(
          `${backup.forgejo_owner}/${backup.forgejo_repo} already exists on Forgejo and is not a mirror of ${githubRepoUrl(ref)}`,
          409,
        )
      }
    } else {
      await createForgejoMirror(config, {
        owner: backup.forgejo_owner,
        name: backup.forgejo_repo,
        cloneUrl: `${githubRepoUrl(ref)}.git`,
        description: `Archive of ${githubRepoUrl(ref)}, synced on demand from Oksskolten`,
      })
    }
    await disableForgejoPeriodicSync(config, backup.forgejo_owner, backup.forgejo_repo)
    updateGitBackup(backup.id, { status: 'ok', blocked_refs: null, last_error: null, synced: !existing })
    log.info(`${ref.owner}/${ref.repo}: archived as ${backup.forgejo_owner}/${backup.forgejo_repo}`)
  } catch (err) {
    log.warn(`${ref.owner}/${ref.repo}: import failed: ${messageOf(err)}`)
    updateGitBackup(backup.id, { status: 'error', last_error: messageOf(err) })
  }
}

/**
 * Check what a sync would lose and, if nothing, ask Forgejo to sync.
 *
 * `force` skips the check: the reader has seen what would be lost and
 * accepted it. A failed check never falls through to a sync — when in doubt,
 * the archive stays as it is.
 */
export async function syncGitBackup(id: number, opts: { force?: boolean } = {}): Promise<GitBackup> {
  const backup = getGitBackup(id)
  if (!backup) throw new GitBackupError('Git backup not found', 404)
  if (busy.has(id)) throw new GitBackupError('This repository is already being imported or synced', 409)
  if (backup.status === 'frozen' && !opts.force) {
    throw new GitBackupError('This archive is frozen; accept the loss to sync it again', 409)
  }
  const config = requireConfig()

  busy.add(id)
  try {
    const repo = await getForgejoRepo(config, backup.forgejo_owner, backup.forgejo_repo)
    if (repo) return await checkAndSync(config, backup, repo, !!opts.force)
  } catch (err) {
    log.warn(`${backup.github_owner}/${backup.github_repo}: sync failed: ${messageOf(err)}`)
    return updateGitBackup(id, { status: 'error', last_error: messageOf(err) })!
  } finally {
    busy.delete(id)
  }

  // No archive on Forgejo — the import never finished, or the repository was
  // deleted there. Nothing is left to lose, so clone it again.
  const importing = updateGitBackup(id, { status: 'importing', blocked_refs: null, last_error: null })!
  startImport(config, importing)
  return importing
}

async function checkAndSync(
  config: ForgejoConfig,
  backup: GitBackup,
  repo: ForgejoRepoInfo,
  force: boolean,
): Promise<GitBackup> {
  if (!repo.mirror) {
    throw new GitBackupError('The archive on Forgejo is no longer a mirror; Oksskolten cannot sync it')
  }
  const ref = upstreamOf(backup)
  const upstreamInfo = await getGithubRepo(ref)

  if (!force) {
    // Compared on the branch the archive was made from, not upstream's
    // current default: a renamed default branch shows up as the old one
    // being deleted.
    const branch = backup.default_branch
    const [archived, upstream] = await Promise.all([
      listForgejoRefs(config, backup.forgejo_owner, backup.forgejo_repo, branch),
      listGithubRefs(ref, branch),
    ])
    const losses = await findRefLosses(archived, upstream, branch, (base, head) => isGithubAncestor(ref, base, head))
    if (losses.length > 0) {
      log.info(`${ref.owner}/${ref.repo}: sync blocked, ${losses.length} ref(s) would be lost`)
      return updateGitBackup(backup.id, { status: 'blocked', blocked_refs: losses, last_error: null, checked: true })!
    }
  }

  await triggerForgejoSync(config, backup.forgejo_owner, backup.forgejo_repo)
  log.info(`${ref.owner}/${ref.repo}: sync triggered${force ? ' (losses accepted)' : ''}`)
  return updateGitBackup(backup.id, {
    status: 'ok',
    blocked_refs: null,
    last_error: null,
    default_branch: upstreamInfo.default_branch,
    checked: !force,
    synced: true,
  })!
}

/** Stop syncing an archive: it stays on Forgejo exactly as it is. */
export function freezeGitBackup(id: number): GitBackup {
  const backup = getGitBackup(id)
  if (!backup) throw new GitBackupError('Git backup not found', 404)
  if (busy.has(id)) throw new GitBackupError('This repository is already being imported or synced', 409)
  return updateGitBackup(id, { status: 'frozen' })!
}

/**
 * Sync every archive that is not frozen, one after another, in the background.
 * Returns how many were queued.
 */
export function startSyncAll(): number {
  if (syncAllRunning) throw new GitBackupError('A sync of all repositories is already running', 409)
  requireConfig()
  const ids = listGitBackups()
    .filter(b => b.status !== 'frozen' && !busy.has(b.id))
    .map(b => b.id)

  syncAllRunning = true
  void (async () => {
    for (const id of ids) {
      try {
        await syncGitBackup(id)
      } catch (err) {
        // Busy or removed since the list was read — the next one still runs.
        log.warn(`sync all: backup ${id} skipped: ${messageOf(err)}`)
      }
    }
  })().finally(() => { syncAllRunning = false })
  return ids.length
}

/** For tests: forget in-flight state between cases. */
export function _resetGitBackupState(): void {
  busy.clear()
  syncAllRunning = false
}
