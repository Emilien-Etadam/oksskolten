import { describe, it, expect } from 'vitest'
import { isVersionTag, isWatchedRef, findRefLosses, type GitRef } from './check.js'

const tag = (name: string, sha: string): GitRef => ({ ref: `refs/tags/${name}`, sha })
const branch = (name: string, sha: string): GitRef => ({ ref: `refs/heads/${name}`, sha })

/** Ancestry as a list of [base, head] pairs that move forward. */
function ancestry(...forward: [string, string][]) {
  return async (base: string, head: string) => forward.some(([b, h]) => b === base && h === head)
}

describe('isVersionTag', () => {
  it('accepts tags that carry a dotted version', () => {
    for (const name of ['v3.5.0', '3.5', 'v1.2.3-rc1', 'mineru-2.5.4-released', 'release-10.0']) {
      expect(isVersionTag(name), name).toBe(true)
    }
  })

  it('rejects floating tags', () => {
    for (const name of ['nightly', 'latest', 'v4', 'stable', 'edge']) {
      expect(isVersionTag(name), name).toBe(false)
    }
  })
})

describe('isWatchedRef', () => {
  it('watches version tags and the default branch only', () => {
    expect(isWatchedRef('refs/tags/v3.5.0', 'main')).toBe(true)
    expect(isWatchedRef('refs/heads/main', 'main')).toBe(true)
    expect(isWatchedRef('refs/heads/dependabot/npm/foo', 'main')).toBe(false)
    expect(isWatchedRef('refs/heads/main-old', 'main')).toBe(false)
    expect(isWatchedRef('refs/tags/nightly', 'main')).toBe(false)
  })
})

describe('findRefLosses', () => {
  it('finds nothing when upstream only added refs', async () => {
    const archived = [tag('v3.5.0', 'a'), branch('main', 'c1')]
    const upstream = [tag('v3.5.0', 'a'), tag('v4.0.0', 'b'), branch('main', 'c2')]
    expect(await findRefLosses(archived, upstream, 'main', ancestry(['c1', 'c2']))).toEqual([])
  })

  it('reports a deleted version tag', async () => {
    const losses = await findRefLosses([tag('v3.5.0', 'a')], [], 'main', ancestry())
    expect(losses).toEqual([{ ref: 'refs/tags/v3.5.0', kind: 'deleted', archived_sha: 'a', upstream_sha: null }])
  })

  it('reports a moved version tag', async () => {
    const losses = await findRefLosses([tag('v3.5.0', 'a')], [tag('v3.5.0', 'b')], 'main', ancestry(['a', 'b']))
    expect(losses).toEqual([{ ref: 'refs/tags/v3.5.0', kind: 'rewritten', archived_sha: 'a', upstream_sha: 'b' }])
  })

  it('reports a force-pushed default branch', async () => {
    const losses = await findRefLosses([branch('main', 'c1')], [branch('main', 'x9')], 'main', ancestry())
    expect(losses).toEqual([{ ref: 'refs/heads/main', kind: 'rewritten', archived_sha: 'c1', upstream_sha: 'x9' }])
  })

  it('reports a deleted default branch', async () => {
    const losses = await findRefLosses([branch('master', 'c1')], [branch('main', 'c1')], 'master', ancestry())
    expect(losses.map(l => l.kind)).toEqual(['deleted'])
  })

  it('ignores floating tags and other branches', async () => {
    const archived = [tag('nightly', 'a'), tag('v4', 'b'), branch('feature/x', 'c'), branch('main', 'd')]
    const upstream = [tag('nightly', 'z'), branch('main', 'd')]
    expect(await findRefLosses(archived, upstream, 'main', ancestry())).toEqual([])
  })
})
