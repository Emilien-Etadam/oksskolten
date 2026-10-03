# Oksskolten Spec — Git Backup

> [Back to Overview](./01_overview.md)

## Overview

Archive chosen GitHub repositories on a self-hosted Forgejo (or Gitea) instance, as a precaution against losing access to them. Oksskolten only drives Forgejo through its API: Forgejo clones each repository straight from GitHub and keeps the only copy. Syncs run only when the reader asks for one, and each is checked first: if it would delete or rewrite an archived version, it is held back until the reader decides.

## Motivation

- **Precaution, not use**: a handful of repositories are worth having locally in case they vanish from GitHub, or GitHub becomes unreachable. Forking them on GitHub protects against neither.
- **A plain mirror is not an archive**: a Forgejo pull mirror copies upstream refs as they are, deletions and force-pushes included. If upstream deletes the `3.5` tag, the next sync deletes it from the mirror too. Forgejo also syncs on its own schedule by default, so this can happen unattended.
- **No second copy**: the Oksskolten container is small. The repository data lives once, on Forgejo; Oksskolten stores a row per repository and never clones anything.

## Scope

Public GitHub repositories, code only: branches and tags. Issues, pull requests, release assets, wiki and LFS objects are not archived, as LFS objects in particular can outweigh the code many times over. Private repositories are refused, since Forgejo would need a GitHub credential of its own to clone them.

Removing a repository from the list never deletes its archive on Forgejo.

## Design

### Settings

Settings → Integration → Git backup holds the connection:

| Setting | Key | Notes |
|---|---|---|
| Forgejo URL | `git_backup.forgejo_url` | Base URL, e.g. `http://forgejo.lan:3000`. LAN addresses are expected, so calls use plain `fetch`, not `safeFetch` |
| Owner | `git_backup.forgejo_owner` | User or organisation archives are created under. Empty means the token's user |
| Token | `git_backup.forgejo_token` | Saved through `/api/settings/api-keys/forgejo`, like other provider keys. Needs read/write on repository and user, plus organization when archiving into one |

The GitHub token from the GitHub Releases section (`github.token`), when set, is reused for the GitHub API calls of the pre-sync check. It is optional: it lifts the unauthenticated limit of 60 requests an hour.

### Import

Adding a repository accepts any page inside it (root, release, file, issue): `shared/github-repo.ts` reduces the URL to `<owner>/<repo>`. GitHub's repository API then gives the canonical spelling and the default branch.

The row is created with status `importing`, and the import runs in the background, since Forgejo's migrate call returns only once the clone is done. The call to `POST /api/v1/repos/migrate` asks for:

- `mirror: true`, a pull mirror that Forgejo can later refresh from GitHub itself;
- `mirror_interval: "0"`, meaning no periodic sync. This is set again with `PATCH /repos/{owner}/{repo}` afterwards, because not every version honours it at migration time;
- `service: "git"`, `lfs: false` and `wiki: false`, for code only;
- `private: true`.

The Forgejo repository is named `<github owner>-<github repo>`, because two accounts often publish repositories under the same name. If a repository of that name already exists, Oksskolten adopts it only when it is a mirror of the same GitHub URL. That is the case after removal and re-adding. Otherwise the import fails rather than touch an unrelated repository.

### Pre-Sync Check

`POST /api/git-backups/:id/sync` compares refs before anything moves. No repository data is transferred: it reads two ref listings, from Forgejo (`git/refs`) and from GitHub (`git/matching-refs`).

Only refs worth archiving are watched (`isWatchedRef()` in `server/git-backup/check.ts`):

- **Version tags**: tags carrying a dotted number (`v3.5.0`, `3.5`, `mineru-2.5.4-released`). Floating tags such as `nightly`, `latest` or the major-only `v4` that GitHub Actions moves are ignored. Moving is their purpose, so watching them would block every sync.
- **The default branch** recorded at import. Pull-request and Dependabot branches come and go weekly and are left to the mirror's pruning.

For each watched ref the archive holds, `findRefLosses()` reports one of two losses:

| Upstream state | Loss |
|---|---|
| Ref gone | `deleted` |
| Tag points elsewhere | `rewritten` |
| Branch moved to a commit that does not descend from the archived one | `rewritten`, using GitHub's compare API (`ahead` or `identical` counts as a forward move) |

Refs only upstream has are additions, never losses. Ordinary development, including commits that delete code, only moves the branch forward. Git stores only new objects, and the archive grows at the same pace as the repository.

With no losses, Oksskolten calls `POST /repos/{owner}/{repo}/mirror-sync`, which queues the sync on Forgejo and answers at once. With losses, the row turns `blocked` and lists them, and no sync happens. A failed check (network, rate limit, repository gone from GitHub) sets `error` and never falls through to a sync.

The check compares against the default branch recorded at import, so a renamed default branch appears as the old one being deleted. After a successful sync, the stored default branch follows upstream's current one.

### Blocked Archives

A blocked archive offers two ways out:

- **Freeze** (`POST /api/git-backups/:id/freeze`): status `frozen`. The archive stays on Forgejo as it is and Oksskolten no longer syncs it, nor includes it in "sync all".
- **Accept** (`POST /api/git-backups/:id/accept`): sync without the check. The listed versions are lost. This is also how a frozen archive is synced again.

There is no third option that keeps the lost refs and still syncs. A mirror cannot hold refs upstream lacks, and keeping them in a second repository would duplicate the whole archive.

There is a short window between the check and Forgejo's sync, so an upstream rewrite landing in those seconds would not be caught.

### Status

| Status | Meaning |
|---|---|
| `importing` | Forgejo is cloning. The UI polls until it settles |
| `ok` | Last check found nothing to lose and a sync was triggered |
| `blocked` | A sync would lose the refs in `blocked_refs`, so it was held back |
| `frozen` | Kept as is, no longer synced |
| `error` | Import or check failed; `last_error` says why |

A sync on an archive missing from Forgejo (import never finished, or deleted there) clones it again, since nothing is left to lose. One import or sync runs at a time per repository. "Sync all" (`POST /api/git-backups/sync-all`) walks every non-frozen archive one after another in the background.

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings/git-backup` | `{ forgejo_url, forgejo_owner, token_configured }` |
| PATCH | `/api/settings/git-backup` | Set `forgejo_url` / `forgejo_owner`; an empty string clears |
| GET | `/api/git-backups` | `{ configured, forgejo_url, backups }` |
| POST | `/api/git-backups` | `{ url }` starts an import (201 with status `importing`). 400 for a bad URL, a private repository or missing settings; 404 for a repository unknown to GitHub; 409 for a duplicate |
| POST | `/api/git-backups/:id/sync` | Check, then sync or block |
| POST | `/api/git-backups/:id/accept` | Sync without the check |
| POST | `/api/git-backups/:id/freeze` | Stop syncing |
| POST | `/api/git-backups/sync-all` | 202 `{ queued }` |
| DELETE | `/api/git-backups/:id` | Remove from the list; the Forgejo archive is kept |

### Article Toolbar

An article whose URL is inside a GitHub repository, such as a starred release or a trending entry, shows an archive chip once Forgejo is configured. Clicking it starts the import; an archived repository shows the chip highlighted.

### Key Files

| File | Description |
|---|---|
| `server/git-backup/check.ts` | Watched refs and the loss check |
| `server/git-backup/service.ts` | Import, check-then-sync, freeze, sync all |
| `server/git-backup/forgejo.ts` | Forgejo API client |
| `server/git-backup/github.ts` | GitHub REST calls for the check |
| `server/git-backup/routes.ts` | Settings and archive endpoints |
| `server/git-backup/db.ts` | `git_backups` table access |
| `shared/github-repo.ts` | GitHub URL → `<owner>/<repo>` |
| `src/features/settings/sections/git-backup-section.tsx` | Settings section |
| `src/features/reading/components/git-backup-chip.tsx` | Article toolbar chip |
| `migrations/0021_git_backups.sql` | Table definition |
