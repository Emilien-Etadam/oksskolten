/**
 * Would a mirror sync lose anything worth keeping?
 *
 * A Forgejo pull mirror copies upstream's refs as they are, deletions and
 * force-pushes included: a tag removed on GitHub disappears from the archive
 * at the next sync. Before triggering one, the refs the archive holds are
 * compared with upstream's, and any that would vanish or be rewritten block
 * the sync instead.
 *
 * Only refs worth archiving are compared. Pull-request and Dependabot branches
 * come and go every week, and floating tags (`nightly`, `latest`, `v4`) are
 * moved by design; watching them would block every sync for nothing.
 */

export interface GitRef {
  /** Full ref name, e.g. `refs/tags/v3.5.0` or `refs/heads/main`. */
  ref: string
  /** Object the ref points at — the tag object for an annotated tag. */
  sha: string
}

export type RefLossKind = 'deleted' | 'rewritten'

export interface RefLoss {
  ref: string
  kind: RefLossKind
  /** What the archive holds today. */
  archived_sha: string
  /** What upstream holds instead, or null when the ref is gone. */
  upstream_sha: string | null
}

/**
 * A tag that names a release: it carries a dotted version number somewhere
 * (`v3.5.0`, `3.5`, `mineru-2.5.4-released`). Floating tags have none —
 * `nightly`, `latest`, and the major-only `v4` that GitHub Actions moves on
 * every minor release.
 */
export function isVersionTag(name: string): boolean {
  return /\d+\.\d+/.test(name)
}

const TAG_PREFIX = 'refs/tags/'

export function isWatchedRef(ref: string, defaultBranch: string): boolean {
  if (ref === `refs/heads/${defaultBranch}`) return true
  return ref.startsWith(TAG_PREFIX) && isVersionTag(ref.slice(TAG_PREFIX.length))
}

/**
 * Refs the archive holds that a sync would delete or move.
 *
 * A tag must keep pointing where it did. The default branch may move, but
 * only forward: `isAncestor(archived, upstream)` must hold, otherwise upstream
 * rewrote history the archive still has. Refs upstream added are not losses.
 */
export async function findRefLosses(
  archived: GitRef[],
  upstream: GitRef[],
  defaultBranch: string,
  isAncestor: (archivedSha: string, upstreamSha: string) => Promise<boolean>,
): Promise<RefLoss[]> {
  const upstreamByRef = new Map(upstream.map(r => [r.ref, r.sha]))
  const losses: RefLoss[] = []

  for (const { ref, sha } of archived) {
    if (!isWatchedRef(ref, defaultBranch)) continue
    const upstreamSha = upstreamByRef.get(ref)
    if (upstreamSha === undefined) {
      losses.push({ ref, kind: 'deleted', archived_sha: sha, upstream_sha: null })
      continue
    }
    if (upstreamSha === sha) continue
    if (ref.startsWith(TAG_PREFIX) || !(await isAncestor(sha, upstreamSha))) {
      losses.push({ ref, kind: 'rewritten', archived_sha: sha, upstream_sha: upstreamSha })
    }
  }

  return losses
}
