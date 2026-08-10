import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getArticleById } from '../db/articles.js'
import { translateSnippet } from '../fetcher/ai.js'
import { USER_AGENT } from '../fetcher/http.js'

const NumericIdParams = z.object({ id: z.coerce.number().int() })

const TranslateBody = z.object({
  texts: z.array(z.string().min(1).max(8000)).min(1).max(32),
})

export interface ArticleComment {
  author: string
  score: number
  body: string
  replies: ArticleComment[]
}

const FETCH_TIMEOUT_MS = 10_000
const TOP_COMMENTS = 8
const TOP_REPLIES = 2

/**
 * Map a Reddit post URL to its public JSON endpoint, or null when the
 * article is not a Reddit post.
 */
export function redditJsonUrl(articleUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(articleUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^(www|old|new)\./, '')
  if (host !== 'reddit.com') return null
  if (!/^\/r\/[^/]+\/comments\//.test(parsed.pathname)) return null
  const path = parsed.pathname.replace(/\/+$/, '')
  return `https://www.reddit.com${path}.json?raw_json=1&sort=top&limit=50&depth=2`
}

interface RedditListing {
  data?: { children?: unknown[] }
}

function parseComments(children: unknown[], limit: number, depth: number): ArticleComment[] {
  const out: ArticleComment[] = []
  for (const child of children) {
    if (out.length >= limit) break
    const c = child as { kind?: string; data?: Record<string, unknown> }
    if (c.kind !== 't1' || !c.data) continue
    const body = typeof c.data.body === 'string' ? c.data.body : ''
    const author = typeof c.data.author === 'string' ? c.data.author : '[deleted]'
    // Skip empty, removed, moderator, and bot boilerplate comments
    if (!body.trim() || body === '[removed]' || body === '[deleted]') continue
    if (c.data.distinguished === 'moderator' || c.data.stickied === true || author === 'AutoModerator') continue

    const repliesListing = c.data.replies as RedditListing | '' | undefined
    const replies = depth > 0 && repliesListing && typeof repliesListing === 'object'
      ? parseComments(repliesListing.data?.children ?? [], TOP_REPLIES, depth - 1)
      : []

    out.push({
      author,
      score: typeof c.data.score === 'number' ? c.data.score : 0,
      body,
      replies,
    })
  }
  return out
}

export async function commentRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/articles/:id/comments', async (request, reply) => {
    const params = NumericIdParams.safeParse(request.params)
    if (!params.success) {
      reply.status(400).send({ error: 'Invalid article id' })
      return
    }
    const article = getArticleById(params.data.id)
    if (!article) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }

    const jsonUrl = redditJsonUrl(article.url)
    if (!jsonUrl) {
      return reply.send({ provider: null, comments: [] })
    }

    try {
      const res = await fetch(jsonUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`reddit responded ${res.status}`)
      const payload = await res.json() as RedditListing[]
      const comments = parseComments(payload?.[1]?.data?.children ?? [], TOP_COMMENTS, 1)
      reply.header('Cache-Control', 'private, max-age=300')
      return reply.send({ provider: 'reddit', comments })
    } catch (err) {
      request.log.warn(err, 'comments fetch failed')
      return reply.send({ provider: 'reddit', comments: [] })
    }
  })

  api.post('/api/comments/translate', async (request, reply) => {
    const body = TranslateBody.safeParse(request.body)
    if (!body.success) {
      reply.status(400).send({ error: 'texts must be 1-32 strings of at most 8000 chars' })
      return
    }

    // Per-item fallback: a failed translation returns the original text so
    // one bad comment never breaks the whole batch
    const translations = await Promise.all(body.data.texts.map(async (text) => {
      try {
        const result = await translateSnippet(text)
        return result.textTranslated.trim() || text
      } catch (err) {
        request.log.warn(err, 'comment translation failed')
        return text
      }
    }))

    return reply.send({ translations })
  })
}
