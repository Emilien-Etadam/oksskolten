import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { getDb, upsertSetting } from '../db.js'
import { MEDIA_COOKIE } from '../auth/index.js'

// Archived media is loaded by <img> and <video>, which cannot send the
// Authorization header the rest of the API authenticates with. These tests
// run with AUTH_DISABLED off — the whole point is what an authenticated
// deployment does with a header-less request.

let app: FastifyInstance
let savedAuthDisabled: string | undefined
let tmpDir: string

const EMAIL = 'reader@example.com'
const FILENAME = '1_abc123.png'

function seedUser(): void {
  getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(EMAIL, 'x')
}

function sessionToken(app: FastifyInstance, tokenVersion = 0): string {
  return app.jwt.sign({ email: EMAIL, token_version: tokenVersion })
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-test-media-auth-'))
  upsertSetting('images.storage_path', tmpDir)
  fs.writeFileSync(path.join(tmpDir, FILENAME), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  seedUser()
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/articles/images/:filename authentication', () => {
  it('401: no credentials at all', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/articles/images/${FILENAME}` })
    expect(res.statusCode).toBe(401)
  })

  it('200: media cookie only, as a browser <img> load sends it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${FILENAME}`,
      cookies: { [MEDIA_COOKIE]: sessionToken(app) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('announces the format the bytes hold, not the one the name claims', async () => {
    // Archived before download-time sniffing: a Blogger `.png` that is a JPEG
    fs.writeFileSync(path.join(tmpDir, '1_jpegnamedpng.png'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const res = await app.inject({
      method: 'GET',
      url: '/api/articles/images/1_jpegnamedpng.png',
      cookies: { [MEDIA_COOKIE]: sessionToken(app) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
  })

  it('200: Authorization header still works', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${FILENAME}`,
      headers: { authorization: `Bearer ${sessionToken(app)}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('401: cookie retired by a token_version bump', async () => {
    getDb().prepare('UPDATE users SET token_version = 1 WHERE email = ?').run(EMAIL)
    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${FILENAME}`,
      cookies: { [MEDIA_COOKIE]: sessionToken(app, 0) },
    })
    expect(res.statusCode).toBe(401)
  })

  it('401: a cookie we never signed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/images/${FILENAME}`,
      cookies: { [MEDIA_COOKIE]: 'not.a.jwt' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('/api/auth/media-cookie', () => {
  it('sets an HttpOnly cookie scoped to the media routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/media-cookie',
      headers: { authorization: `Bearer ${sessionToken(app)}` },
    })

    expect(res.statusCode).toBe(204)
    const cookie = res.cookies.find(c => c.name === MEDIA_COOKIE)!
    expect(cookie).toBeDefined()
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.path).toBe('/api/articles')
    expect(cookie.sameSite?.toLowerCase()).toBe('lax')
    // Same session, same expiry: the cookie must not outlive the token.
    expect(cookie.maxAge).toBeGreaterThan(0)
  })

  it('401 without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/media-cookie' })
    expect(res.statusCode).toBe(401)
  })

  it('hands no cookie to an API key, which sends its own header', async () => {
    const { createApiKey } = await import('../auth/api-keys-db.js')
    const { key } = createApiKey('script', 'read')

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/media-cookie',
      headers: { authorization: `Bearer ${key}` },
    })

    expect(res.statusCode).toBe(204)
    expect(res.cookies.find(c => c.name === MEDIA_COOKIE)).toBeUndefined()
  })

  it('DELETE expires the cookie without asking who you are', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/auth/media-cookie' })
    expect(res.statusCode).toBe(204)
    const cookie = res.cookies.find(c => c.name === MEDIA_COOKIE)!
    expect(cookie.value).toBe('')
  })
})
