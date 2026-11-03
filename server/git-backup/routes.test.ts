import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { upsertSetting } from '../db.js'
import { getGitBackup } from './db.js'
import { _resetGitBackupState } from './service.js'
import type { GitRef } from './check.js'

const FORGEJO = 'http://forgejo.lan:3000'
const json = { 'content-type': 'application/json' }
const REPO_URL = 'https://github.com/opendatalab/MinerU'

interface FakeRepo { mirror: boolean; original_url: string; html_url: string }

/** In-memory GitHub and Forgejo, enough for the calls the feature makes. */
let gh: {
  missing: boolean
  failing: boolean
  private: boolean
  defaultBranch: string
  refs: GitRef[]
  /** `base...head` pairs where head is ahead of base. */
  forward: Set<string>
}
let fj: {
  repos: Map<string, FakeRepo>
  refs: GitRef[]
  migrations: Record<string, unknown>[]
  patches: Record<string, unknown>[]
  syncs: number
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function refsResponse(refs: GitRef[], prefix: string, emptyStatus: number): Response {
  const matching = refs.filter(r => r.ref.startsWith(`refs/${prefix}`))
  if (matching.length === 0 && emptyStatus === 404) return jsonResponse({ message: 'Not Found' }, 404)
  return jsonResponse(matching.map(r => ({ ref: r.ref, object: { sha: r.sha, type: 'commit' } })))
}

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  const method = init?.method ?? 'GET'

  if (url.host === 'api.github.com') {
    if (gh.failing) return jsonResponse({ message: 'Server Error' }, 500)
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/)
    if (!m || gh.missing) return jsonResponse({ message: 'Not Found' }, 404)
    const rest = m[3] ?? ''
    if (rest === '') {
      return jsonResponse({ name: 'MinerU', owner: { login: 'opendatalab' }, default_branch: gh.defaultBranch, private: gh.private })
    }
    const refs = rest.match(/^\/git\/matching-refs\/(.+)$/)
    if (refs) return refsResponse(gh.refs, decodeURIComponent(refs[1]), 200)
    const compare = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/)
    if (compare) {
      const [, base, head] = compare
      return jsonResponse({ status: gh.forward.has(`${base}...${head}`) ? 'ahead' : 'diverged' })
    }
  }

  if (url.origin === FORGEJO) {
    const path = url.pathname.replace(/^\/api\/v1/, '')
    if (path === '/user') return jsonResponse({ login: 'archiver' })
    if (path === '/repos/migrate' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, string>
      fj.migrations.push(body)
      fj.repos.set(`${body.repo_owner}/${body.repo_name}`, {
        mirror: true,
        original_url: body.clone_addr,
        html_url: `${FORGEJO}/${body.repo_owner}/${body.repo_name}`,
      })
      fj.refs = gh.refs.map(r => ({ ...r }))
      return jsonResponse({}, 201)
    }
    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/)
    if (m) {
      const repo = fj.repos.get(`${m[1]}/${m[2]}`)
      if (!repo) return jsonResponse({ message: 'Not Found' }, 404)
      const rest = m[3] ?? ''
      if (rest === '' && method === 'GET') return jsonResponse(repo)
      if (rest === '' && method === 'PATCH') {
        fj.patches.push(JSON.parse(String(init?.body)))
        return jsonResponse(repo)
      }
      const refs = rest.match(/^\/git\/refs\/(.+)$/)
      if (refs) return refsResponse(fj.refs, decodeURIComponent(refs[1]), 404)
      if (rest === '/mirror-sync' && method === 'POST') {
        fj.syncs++
        fj.refs = gh.refs.map(r => ({ ...r }))
        return jsonResponse({})
      }
    }
  }

  throw new Error(`Unexpected request: ${method} ${url}`)
}

let app: FastifyInstance

function configure() {
  upsertSetting('git_backup.forgejo_url', FORGEJO)
  upsertSetting('git_backup.forgejo_token', 'forgejo-token')
}

async function addRepo(url = REPO_URL) {
  const res = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url } })
  expect(res.statusCode).toBe(201)
  const id = res.json().id as number
  await vi.waitFor(() => expect(getGitBackup(id)?.status).not.toBe('importing'))
  return id
}

function sync(id: number, action: 'sync' | 'accept' | 'freeze' = 'sync') {
  return app.inject({ method: 'POST', url: `/api/git-backups/${id}/${action}` })
}

beforeEach(async () => {
  setupTestDb()
  _resetGitBackupState()
  gh = {
    missing: false,
    failing: false,
    private: false,
    defaultBranch: 'master',
    refs: [
      { ref: 'refs/heads/master', sha: 'c1' },
      { ref: 'refs/tags/mineru-3.5.0-released', sha: 't35' },
      { ref: 'refs/tags/nightly', sha: 'n1' },
    ],
    forward: new Set(),
  }
  fj = { repos: new Map(), refs: [], migrations: [], patches: [], syncs: 0 }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  app = await buildApp()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Forgejo settings', () => {
  it('stores the URL and owner, and the token through the API-key route', async () => {
    let res = await app.inject({ method: 'PATCH', url: '/api/settings/git-backup', headers: json, payload: { forgejo_url: `${FORGEJO}/`, forgejo_owner: 'backups' } })
    expect(res.statusCode).toBe(200)
    res = await app.inject({ method: 'POST', url: '/api/settings/api-keys/forgejo', headers: json, payload: { apiKey: 'secret' } })
    expect(res.json().configured).toBe(true)

    res = await app.inject({ method: 'GET', url: '/api/settings/git-backup' })
    expect(res.json()).toEqual({ forgejo_url: FORGEJO, forgejo_owner: 'backups', token_configured: true })

    res = await app.inject({ method: 'GET', url: '/api/git-backups' })
    expect(res.json()).toMatchObject({ configured: true, forgejo_url: FORGEJO, backups: [] })
  })

  it('rejects a URL that is not http(s)', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/git-backup', headers: json, payload: { forgejo_url: 'forgejo.lan' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('adding a repository', () => {
  it('refuses to start before Forgejo is configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url: REPO_URL } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not configured/)
  })

  it('creates a private, code-only mirror whose periodic sync is off', async () => {
    configure()
    const id = await addRepo(`${REPO_URL}/releases/tag/mineru-3.5.0-released`)

    expect(fj.migrations).toEqual([expect.objectContaining({
      clone_addr: `${REPO_URL}.git`,
      repo_owner: 'archiver',
      repo_name: 'opendatalab-MinerU',
      service: 'git',
      mirror: true,
      mirror_interval: '0',
      private: true,
      lfs: false,
    })])
    expect(fj.patches).toEqual([{ mirror_interval: '0' }])
    expect(getGitBackup(id)).toMatchObject({ status: 'ok', default_branch: 'master', last_error: null })
    expect(getGitBackup(id)?.last_synced_at).not.toBeNull()
  })

  it('uses the configured owner', async () => {
    configure()
    upsertSetting('git_backup.forgejo_owner', 'backups')
    await addRepo()
    expect(fj.migrations[0].repo_owner).toBe('backups')
  })

  it('rejects duplicates, private repositories and non-repository URLs', async () => {
    configure()
    await addRepo()
    const dup = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url: 'https://github.com/OpenDataLab/mineru' } })
    expect(dup.statusCode).toBe(409)

    const notRepo = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url: 'https://github.com/stars/someone' } })
    expect(notRepo.statusCode).toBe(400)

    setupTestDb()
    configure()
    gh.private = true
    const priv = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url: REPO_URL } })
    expect(priv.statusCode).toBe(400)
  })

  it('reports a repository GitHub does not know', async () => {
    configure()
    gh.missing = true
    const res = await app.inject({ method: 'POST', url: '/api/git-backups', headers: json, payload: { url: REPO_URL } })
    expect(res.statusCode).toBe(404)
  })

  it('adopts the archive left on Forgejo after removal instead of cloning again', async () => {
    configure()
    const id = await addRepo()
    expect((await app.inject({ method: 'DELETE', url: `/api/git-backups/${id}` })).statusCode).toBe(204)
    expect(fj.repos.size).toBe(1)

    const again = await addRepo()
    expect(fj.migrations).toHaveLength(1)
    expect(getGitBackup(again)?.status).toBe('ok')
  })

  it('refuses to adopt a Forgejo repository that is not this mirror', async () => {
    configure()
    fj.repos.set('archiver/opendatalab-MinerU', { mirror: false, original_url: '', html_url: '' })
    const id = await addRepo()
    expect(getGitBackup(id)).toMatchObject({ status: 'error' })
    expect(getGitBackup(id)?.last_error).toMatch(/already exists/)
    expect(fj.migrations).toHaveLength(0)
  })
})

describe('syncing', () => {
  beforeEach(() => configure())

  it('syncs when upstream only added versions and moved the branch forward', async () => {
    const id = await addRepo()
    gh.refs = [
      { ref: 'refs/heads/master', sha: 'c2' },
      { ref: 'refs/tags/mineru-3.5.0-released', sha: 't35' },
      { ref: 'refs/tags/mineru-4.0.0-released', sha: 't40' },
    ]
    gh.forward.add('c1...c2')

    const res = await sync(id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', blocked_refs: [] })
    expect(fj.syncs).toBe(1)
  })

  it('ignores a moved floating tag', async () => {
    const id = await addRepo()
    gh.refs = gh.refs.map(r => r.ref === 'refs/tags/nightly' ? { ...r, sha: 'n2' } : r)
    expect((await sync(id)).json().status).toBe('ok')
    expect(fj.syncs).toBe(1)
  })

  it('blocks when a version tag was deleted upstream, then freezes or accepts', async () => {
    const id = await addRepo()
    gh.refs = gh.refs.filter(r => r.ref !== 'refs/tags/mineru-3.5.0-released')

    const blocked = (await sync(id)).json()
    expect(blocked.status).toBe('blocked')
    expect(blocked.blocked_refs).toEqual([
      { ref: 'refs/tags/mineru-3.5.0-released', kind: 'deleted', archived_sha: 't35', upstream_sha: null },
    ])
    expect(fj.syncs).toBe(0)

    expect((await sync(id, 'freeze')).json().status).toBe('frozen')
    expect((await sync(id)).statusCode).toBe(409)
    expect(fj.syncs).toBe(0)

    const accepted = (await sync(id, 'accept')).json()
    expect(accepted).toMatchObject({ status: 'ok', blocked_refs: [] })
    expect(fj.syncs).toBe(1)
  })

  it('blocks when the default branch was force-pushed', async () => {
    const id = await addRepo()
    gh.refs = gh.refs.map(r => r.ref === 'refs/heads/master' ? { ...r, sha: 'x9' } : r)
    const res = (await sync(id)).json()
    expect(res.status).toBe('blocked')
    expect(res.blocked_refs[0]).toMatchObject({ ref: 'refs/heads/master', kind: 'rewritten' })
    expect(fj.syncs).toBe(0)
  })

  it('never syncs when the check itself fails', async () => {
    const id = await addRepo()
    gh.failing = true
    const res = (await sync(id)).json()
    expect(res.status).toBe('error')
    expect(res.last_error).toMatch(/GitHub answered 500/)
    expect(fj.syncs).toBe(0)
  })

  it('clones again when the archive is missing on Forgejo', async () => {
    const id = await addRepo()
    fj.repos.clear()
    expect((await sync(id)).json().status).toBe('importing')
    await vi.waitFor(() => expect(getGitBackup(id)?.status).toBe('ok'))
    expect(fj.migrations).toHaveLength(2)
  })

  it('syncs every archive that is not frozen', async () => {
    const id = await addRepo()
    const res = await app.inject({ method: 'POST', url: '/api/git-backups/sync-all' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ queued: 1 })
    await vi.waitFor(() => expect(fj.syncs).toBe(1))
    expect(getGitBackup(id)?.status).toBe('ok')
  })

  it('answers 404 for an unknown backup', async () => {
    expect((await sync(999)).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/git-backups/999' })).statusCode).toBe(404)
  })
})
