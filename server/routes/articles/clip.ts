import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logger } from '../../logger.js'
import {
  getArticleByUrl,
  getArticleById,
  updateArticleContent,
  getExistingArticleUrls,
  getClipFeed,
  insertArticle,
  getDb,
} from '../../db.js'
import type { MeiliArticleDoc } from '../../search/client.js'
import { syncArticleToSearch } from '../../search/sync.js'
import { requireJson } from '../../auth.js'
import { fetchArticleContent, enrichArticle, clipContext } from '../../fetcher.js'
import { parseOrBadRequest } from '../../lib/validation.js'

const clipLog = logger.child('clip')

/**
 * How long the clip endpoint waits for the content pipeline before answering.
 *
 * The browser aborts the request after 30s (DEFAULT_TIMEOUT_MS in
 * src/lib/fetcher.ts), while the pipeline can legitimately run far longer:
 * a page timeout, then a browser-UA retry, then the anti-bot solver's own
 * budget. Racing it to the end shows the user a timeout for a clip that
 * lands anyway a minute later — and greets their next attempt with an
 * "already exists" conflict. Stay well under the browser's patience.
 */
function clipFetchBudgetMs(): number {
  return Number(process.env.CLIP_FETCH_BUDGET_MS) || 20_000
}

const MAX_CHECK_URLS = 200
const CheckUrlsBody = z.object({
  urls: z.array(z.string()).min(1, 'urls must be a non-empty array').max(MAX_CHECK_URLS, `Maximum ${MAX_CHECK_URLS} urls per request`),
})

const httpOrHttpsUrl = z
  .string({ error: 'url is required' })
  .min(1, 'url is required')
  .url('must be a valid URL')
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), { message: 'Only http:// or https:// URLs are allowed' })

const FromUrlBody = z.object({
  url: httpOrHttpsUrl,
  title: z.string().optional(),
  force: z.boolean().optional(),
})

export async function articleClipRoutes(api: FastifyInstance): Promise<void> {
  api.post('/api/articles/check-urls', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(CheckUrlsBody, request.body, reply)
    if (!body) return
    const existing = getExistingArticleUrls(body.urls)
    reply.send({ existing: [...existing] })
  })

  api.post(
    '/api/articles/from-url',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(FromUrlBody, request.body, reply)
      if (!body) return

      // Check if article already exists
      const existing = getArticleByUrl(body.url)
      if (existing) {
        if (existing.feed_type === 'clip') {
          // Already in clips — block
          reply.status(409).send({ error: 'Article already exists', article: existing })
          return
        }
        // Exists in RSS feed — prompt or force-move
        if (!body.force) {
          reply.status(409).send({
            error: 'Article exists in feed',
            article: existing,
            can_force: true,
          })
          return
        }
        // force=true → move article to clip feed
        const clipFeed = getClipFeed()
        if (!clipFeed) {
          reply.status(500).send({ error: 'Clip feed not found' })
          return
        }
        const moved = getDb().transaction(() => {
          getDb().prepare('UPDATE articles SET feed_id = ?, category_id = NULL WHERE id = ?').run(clipFeed.id, existing.id)
          return getArticleById(existing.id)
        })()
        // Sync clip move to Meilisearch (best-effort, outside transaction)
        const movedDoc = getDb().prepare(`
          SELECT id, feed_id, category_id, title,
                 COALESCE(full_text, '') AS full_text,
                 COALESCE(full_text_translated, '') AS full_text_translated,
                 lang,
                 COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
                 COALESCE(score, 0) AS score
          FROM active_articles WHERE id = ?
        `).get(existing.id) as MeiliArticleDoc | undefined
        if (movedDoc) syncArticleToSearch(movedDoc)
        reply.status(200).send({ article: moved, moved: true })
        return
      }

      // Get clip feed
      const clipFeed = getClipFeed()
      if (!clipFeed) {
        reply.status(500).send({ error: 'Clip feed not found' })
        return
      }

      // Fetch content (same pipeline as RSS feeds), but only for as long as
      // the browser is still listening — see clipFetchBudgetMs. This promise
      // is written to never reject, so the background continuation below
      // cannot raise an unhandled rejection after the reply is sent.
      const settled = fetchArticleContent(body.url).then(
        content => ({ content, error: null as string | null }),
        (err: unknown) => ({ content: null, error: err instanceof Error ? err.message : String(err) }),
      )
      let budgetTimer: NodeJS.Timeout | undefined
      const budget = new Promise<null>(resolve => {
        budgetTimer = setTimeout(() => resolve(null), clipFetchBudgetMs())
      })
      const early = await Promise.race([settled, budget])
      clearTimeout(budgetTimer)

      if (!early) {
        // Still fetching. Save the article now so the clip is not lost, and
        // let the same in-flight fetch fill the body in when it finishes —
        // no work is thrown away and nothing is fetched twice. last_error is
        // set so the retry pass picks the row up if the server dies first.
        const title = body.title || new URL(body.url).hostname
        const published_at = new Date().toISOString()
        const articleId = insertArticle({
          feed_id: clipFeed.id,
          title,
          url: body.url,
          published_at,
          lang: null,
          full_text: null,
          excerpt: null,
          og_image: null,
          last_error: 'content fetch still running when the clip was saved',
        })
        const task = { kind: 'clip' as const, feed_id: clipFeed.id, title, url: body.url, published_at }
        clipLog.info({ url: body.url, articleId }, 'clip saved before its content arrived; filling in the background')
        void settled.then(async ({ content, error }) => {
          if (!content) {
            updateArticleContent(articleId, { last_error: error })
            return
          }
          // The placeholder title was the hostname: take the real one once
          // the page hands it over, unless the caller supplied their own.
          const effectiveTitle = !body.title && content.title ? content.title : title
          updateArticleContent(articleId, {
            title: effectiveTitle !== title ? effectiveTitle : undefined,
            lang: content.lang,
            full_text: content.fullText,
            excerpt: content.excerpt,
            og_image: content.ogImage,
            last_error: content.lastError,
          })
          clipLog.info({ url: body.url, articleId, chars: content.fullText?.length ?? 0 }, 'background clip fetch finished')
          // Enrich on the title the row now carries: rules, interests and
          // similarity all read it, and the hostname placeholder would match
          // nothing the reader wrote a rule for.
          await enrichArticle(clipContext(articleId, { ...task, title: effectiveTitle }, content, content.lang))
        })
        reply.status(201).send({ article: getArticleById(articleId), created: true, content_pending: true })
        return
      }

      const { content, error } = early
      const title = body.title || content?.title || new URL(body.url).hostname
      const published_at = new Date().toISOString()
      const articleId = insertArticle({
        feed_id: clipFeed.id,
        title,
        url: body.url,
        published_at,
        lang: content?.lang ?? null,
        full_text: content?.fullText ?? null,
        excerpt: content?.excerpt ?? null,
        og_image: content?.ogImage ?? null,
        last_error: content ? content.lastError : error,
      })

      const task = { kind: 'clip' as const, feed_id: clipFeed.id, title, url: body.url, published_at }
      await enrichArticle(clipContext(articleId, task, content, content?.lang ?? null))

      const article = getArticleById(articleId)
      reply.status(201).send({ article, created: true })
    },
  )

}
