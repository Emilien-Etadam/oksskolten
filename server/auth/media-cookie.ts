import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireAuth } from './guards.js'

/**
 * Archived images and videos are loaded by <img> and <video> tags, which
 * cannot carry the `Authorization` header the rest of the API authenticates
 * with — the browser sends those requests on its own. Without this cookie an
 * archived picture answers 401 and the reader shows a broken image.
 *
 * It holds the very same JWT, so nothing new grants access, and it is scoped
 * tightly: HttpOnly (out of reach of scripts), SameSite=Lax, and a path that
 * only covers the media GETs. No mutating endpoint accepts it — `requireAuth`
 * still reads the header alone — so cookie auth adds no CSRF surface.
 */
export const MEDIA_COOKIE = 'media_token'

/** Both archived-media routes live under /api/articles/{images,videos}/. */
const MEDIA_COOKIE_PATH = '/api/articles'

export function clearMediaCookie(reply: FastifyReply): void {
  reply.clearCookie(MEDIA_COOKIE, { path: MEDIA_COOKIE_PATH })
}

export function mediaCookieRoutes(app: FastifyInstance): void {
  // Issued from the caller's own token rather than a fresh signature: the
  // cookie must die exactly when the session does. The client asks for it at
  // every boot, so sessions that predate this endpoint get one too.
  app.post('/api/auth/media-cookie', { preHandler: [requireAuth] }, async (request, reply) => {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const exp = (request.user as { exp?: number } | undefined)?.exp

    // No cookie to hand out when there is no session token behind the call:
    // an API key belongs to a script, which sets its own header, and
    // AUTH_DISABLED lets every request through anyway.
    if (!token || token.startsWith('ok_') || !exp) {
      reply.status(204).send()
      return
    }

    reply.setCookie(MEDIA_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https',
      path: MEDIA_COOKIE_PATH,
      maxAge: Math.max(0, exp - Math.floor(Date.now() / 1000)),
    })
    reply.status(204).send()
  })

  // Logout: dropping your own cookie needs no proof of who you are.
  app.delete('/api/auth/media-cookie', async (_request, reply) => {
    clearMediaCookie(reply)
    reply.status(204).send()
  })
}
