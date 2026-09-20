import type { FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../db.js'
import { validateApiKey } from './api-keys-db.js'
import { MEDIA_COOKIE } from './media-cookie.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: string
    apiKeyScopes?: string
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (process.env.AUTH_DISABLED === '1') {
    request.authUser = 'local'
    return
  }

  // Check for API key authentication (Bearer ok_...)
  const authHeader = request.headers.authorization
  if (authHeader?.startsWith('Bearer ok_')) {
    const key = authHeader.slice(7) // strip "Bearer "
    const result = validateApiKey(key)
    if (!result) {
      return reply.status(401).send({ error: 'Invalid API key' })
    }
    request.authUser = `apikey:${result.id}`
    request.apiKeyScopes = result.scopes
    return
  }

  try {
    await request.jwtVerify()
    const email = acceptSession(request.user as SessionPayload)
    if (!email) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    request.authUser = email
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
}

interface SessionPayload {
  email: string
  token_version: number
}

/**
 * The account behind a verified JWT, or null when the token is stale: our own
 * signature is not enough, since a password change or a sign-out-everywhere
 * bumps `token_version` precisely to retire the tokens issued before it.
 */
function acceptSession({ email, token_version }: SessionPayload): string | null {
  const user = getDb()
    .prepare('SELECT token_version FROM users WHERE email = ?')
    .get(email) as { token_version: number } | undefined

  if (!user || user.token_version !== token_version) return null
  return email
}

/**
 * Auth for archived images and videos. A browser loads those through <img>
 * and <video>, which send no `Authorization` header, so the session is read
 * from the media cookie instead (see media-cookie.ts). Callers that can set
 * the header — scripts, API keys — still authenticate the ordinary way.
 */
export async function requireMediaAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.headers.authorization || process.env.AUTH_DISABLED === '1') {
    return requireAuth(request, reply)
  }

  const token = request.cookies?.[MEDIA_COOKIE]
  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  try {
    const email = acceptSession(request.server.jwt.verify(token) as SessionPayload)
    if (!email) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    request.authUser = email
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
}

export function getAuthUser(request: FastifyRequest): string | null {
  return request.authUser ?? null
}

/**
 * Pre-handler that blocks API key requests without write scope on mutation methods.
 * JWT users (no apiKeyScopes) pass through unrestricted.
 */
export function requireWriteScope(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  if (
    request.apiKeyScopes &&
    request.method !== 'GET' &&
    !request.apiKeyScopes.includes('write')
  ) {
    reply.status(403).send({ error: 'API key does not have write scope' })
    return
  }
  done()
}

// --- Request origin helpers ---

type HeadersLike = { headers: Record<string, string | string[] | undefined> }

export function getOrigin(request: HeadersLike): string {
  const origin = request.headers['origin'] as string | undefined
  if (origin) return origin
  const referer = request.headers['referer'] as string | undefined
  if (referer) {
    try { return new URL(referer).origin } catch { /* fall through */ }
  }
  const proto = (request.headers['x-forwarded-proto'] as string) || 'http'
  const host = (request.headers['host'] as string) || 'localhost'
  return `${proto}://${host}`
}

export function getRpID(request: HeadersLike): string {
  const origin = request.headers['origin'] as string | undefined
  if (origin) {
    try { return new URL(origin).hostname } catch { /* fall through */ }
  }
  const referer = request.headers['referer'] as string | undefined
  if (referer) {
    try { return new URL(referer).hostname } catch { /* fall through */ }
  }
  const host = (request.headers['host'] as string) || 'localhost'
  return host.split(':')[0]
}

export function getCredentialCount(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM credentials').get() as { cnt: number }
  return row.cnt
}

export function requireJson(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const ct = request.headers['content-type'] || ''
  if (!ct.startsWith('application/json')) {
    reply.status(415).send({ error: 'Unsupported Media Type' })
    return
  }
  done()
}
