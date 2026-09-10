import type { FastifyInstance } from 'fastify'
import type { Feed } from '../../shared/types.js'
import { z } from 'zod'
import { startSSE } from '../lib/sse.js'
import { logger } from '../logger.js'

const log = logger.child('api')
import {
  getFeeds,
  getFeedById,
  getFeedByUrl,
  createFeed,
  updateFeed,
  deleteFeed,
  bulkMoveFeedsToCategory,
  markAllSeenByFeed,
  getBookmarkCount,
  getLikeCount,
  getClipFeed,
  getFeedMetrics,
  getCategories,
  createCategory,
} from '../db.js'
import { requireJson } from '../auth/index.js'
import { fetchSingleFeed } from '../fetcher.js'
import { discoverRssUrl } from './discovery.js'
import { sweepAutoArchiveFeeds, SWEEP_LIMIT_BACKLOG } from '../fetcher/article-images.js'
import { resolveFeedSource, type ResolveEvent } from './resolve.js'
import { parseOpml, generateOpml } from './opml.js'
import { categoryRoutes } from './categories-routes.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'

const httpOrHttpsUrl = z
  .string({ error: 'url is required' })
  .min(1, 'url is required')
  .url('must be a valid URL')
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), { message: 'Only http:// or https:// URLs are allowed' })

const DiscoverTitleQuery = z.object({
  url: httpOrHttpsUrl,
})

const CreateFeedBody = z
  .object({
    url: httpOrHttpsUrl,
    name: z.string().optional(),
    category_id: z.number().nullable().optional(),
    // Phase 2: user chose "whole site" — use this exact RSS URL
    discovered_rss_url: httpOrHttpsUrl.optional(),
    discovered_rss_title: z.string().optional(),
    // Phase 2: user chose "this page only" — skip to LLM inference
    force_page_selector: z.boolean().optional(),
  })
  .refine((data) => !(data.discovered_rss_url && data.force_page_selector), {
    message: 'discovered_rss_url and force_page_selector are mutually exclusive',
  })

type SseSend = ReturnType<typeof startSSE>['send']

function translateCreateResolveEvent(
  send: SseSend,
  event: ResolveEvent,
  state: { directSource: boolean },
): void {
  if (event.stage === 'github-stars' || event.stage === 'social') {
    if (event.status === 'done' && event.found) {
      state.directSource = true
      send({ type: 'step', step: 'rss-discovery', status: 'done', found: true })
    }
    return
  }
  if (state.directSource && event.stage === 'rss-discovery' && event.status === 'skipped') {
    return
  }
  if (event.status === 'start') {
    send({ type: 'step', step: event.stage, status: 'running' })
    return
  }
  if (event.status === 'done') {
    send({ type: 'step', step: event.stage, status: 'done', found: event.found })
    return
  }
  send({ type: 'step', step: event.stage, status: 'skipped' })
}

function translateRedetectResolveEvent(
  send: SseSend,
  event: ResolveEvent,
): void {
  if (event.stage === 'github-stars' || event.stage === 'social') {
    if (event.status === 'done' && event.found) {
      send({ type: 'stage', stage: 'discovery' })
      send({ type: 'stage-done', stage: 'discovery', found: true })
    }
    return
  }
  if (event.status === 'skipped') return
  const stage =
    event.stage === 'rss-discovery' ? 'discovery'
    : event.stage === 'rss-bridge' ? 'bridge'
    : event.stage === 'css-selector' ? 'bridge-llm'
    : null
  if (!stage) return
  if (event.status === 'start') {
    send({ type: 'stage', stage })
    return
  }
  send({ type: 'stage-done', stage, found: event.found })
}

const AI_FILTER_MAX_CHARS = 1000

const UpdateFeedBody = z.object({
  name: z.string().optional(),
  url: httpOrHttpsUrl.optional(),
  rss_url: httpOrHttpsUrl.nullable().optional(),
  rss_bridge_url: z.string().nullable().optional(),
  disabled: z.number().optional(),
  category_id: z.number().nullable().optional(),
  ai_filter: z.string().max(AI_FILTER_MAX_CHARS).nullable().optional(),
  archive_images: z.union([z.literal(0), z.literal(1)]).optional(),
})

export async function feedRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/feeds', async (_request, reply) => {
    const feeds = getFeeds()
    const bookmark_count = getBookmarkCount()
    const like_count = getLikeCount()
    const clipFeed = getClipFeed()
    const clip_feed_id = clipFeed?.id ?? null
    reply.send({ feeds, bookmark_count, like_count, clip_feed_id })
  })

  api.get('/api/discover-title', async (request, reply) => {
    const query = parseOrBadRequest(DiscoverTitleQuery, request.query, reply)
    if (!query) return
    try {
      const { title } = await discoverRssUrl(query.url)
      reply.send({ title })
    } catch {
      reply.send({ title: null })
    }
  })

  api.post(
    '/api/feeds',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(CreateFeedBody, request.body, reply)
      if (!body) return

      if (getFeedByUrl(body.url)) {
        reply.status(409).send({ error: 'Feed URL already exists' })
        return
      }

      // --- SSE starts here ---
      const sse = startSSE(reply)
      const send = sse.send

      try {
        let rssUrl: string | null = null
        let rssBridgeUrl: string | null = null
        let discoveredTitle: string | null = null
        let requiresJsChallenge = false

        if (body.discovered_rss_url) {
          // Phase 2: user chose "whole site" — use the provided RSS URL directly
          rssUrl = body.discovered_rss_url
          discoveredTitle = body.discovered_rss_title ?? null
          send({ type: 'step', step: 'rss-discovery', status: 'done', found: true })
          send({ type: 'step', step: 'rss-bridge', status: 'skipped' })
          send({ type: 'step', step: 'css-selector', status: 'skipped' })
        } else {
          const resolveState = { directSource: false }
          const resolved = await resolveFeedSource(body.url, {
            skipResolvers: !!body.force_page_selector,
            forcePageSelector: !!body.force_page_selector,
            discover: {
              onFlareSolverr: (status, found) => {
                send({ type: 'step', step: 'flaresolverr', status: status === 'running' ? 'running' : 'done', found })
              },
            },
            onEvent: (event) => translateCreateResolveEvent(send, event, resolveState),
          })
          rssUrl = resolved.rssUrl
          rssBridgeUrl = resolved.rssBridgeUrl
          discoveredTitle = resolved.title
          if (resolved.usedFlareSolverr) requiresJsChallenge = true

          // Discovery hit (not a GitHub/social shortcut): offer a choice instead of creating
          if (rssUrl && !resolveState.directSource && !body.force_page_selector) {
            send({ type: 'choice_needed', rss_url: rssUrl, rss_title: discoveredTitle })
            sse.end()
            return
          }
        }

        // If every strategy failed, do not create a feed.
        if (!rssUrl && !rssBridgeUrl) {
          const errorMsg = body.force_page_selector
            ? 'Could not extract content from this page'
            : 'RSS could not be detected for this URL'
          send({ type: 'error', error: errorMsg })
          sse.end()
          return
        }

        const feedName = body.name || discoveredTitle || new URL(body.url).hostname

        const feed = createFeed({
          name: feedName,
          url: body.url,
          rss_url: rssUrl,
          rss_bridge_url: rssBridgeUrl,
          category_id: body.category_id ?? null,
          requires_js_challenge: requiresJsChallenge ? 1 : 0,
        })

        // Fire-and-forget: fetch articles for the new feed
        if (feed.rss_url || feed.rss_bridge_url) {
          fetchSingleFeed(feed).catch(err => {
            log.error(`Initial fetch for ${feed.name} failed:`, err)
          })
        }

        send({ type: 'done', feed })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      }

      sse.end()
    },
  )

  api.patch(
    '/api/feeds/:id',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(UpdateFeedBody, request.body, reply)
      if (!body) return

      const before = getFeedById(params.id)
      const feed = updateFeed(params.id, body)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }

      // Switching a feed to auto-archive is a request to archive its backlog,
      // not only future articles — kick a full sweep in the background.
      if (body.archive_images === 1 && before?.archive_images !== 1) {
        void sweepAutoArchiveFeeds(feed.id, SWEEP_LIMIT_BACKLOG)
      }

      const feeds = getFeeds()
      const withCounts = feeds.find(f => f.id === feed.id)
      reply.send(withCounts || feed)
    },
  )

  const BulkMoveBody = z.object({
    feed_ids: z.array(z.number()).min(1, 'feed_ids must not be empty'),
    category_id: z.number().nullable(),
  })

  api.post(
    '/api/feeds/bulk-move',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BulkMoveBody, request.body, reply)
      if (!body) return
      bulkMoveFeedsToCategory(body.feed_ids, body.category_id)
      reply.status(204).send()
    },
  )

  api.delete(
    '/api/feeds/:id',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const feed = getFeedById(params.id)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      if (feed.type === 'clip') {
        reply.status(403).send({ error: 'Cannot delete the clip feed' })
        return
      }
      const deleted = deleteFeed(params.id)
      if (!deleted) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      reply.status(204).send()
    },
  )

  // --- Single feed fetch (SSE) ---

  api.post(
    '/api/feeds/:id/fetch',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const feed = getFeedById(params.id)
      if (!feed || feed.disabled) {
        reply.status(404).send({ error: 'Feed not found or disabled' })
        return
      }

      const sse = startSSE(reply)

      await fetchSingleFeed(feed, (event) => {
        sse.send(event)
      }, { skipCache: true })

      sse.end()
    },
  )

  // --- RSS re-detection ---

  api.post(
    '/api/feeds/:id/re-detect',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const feed = getFeedById(params.id)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }

      const sse = startSSE(reply)

      // GitHub stars pages and social search/hashtag URLs have no on-page RSS
      // link to discover — they resolve directly, the same way feed creation
      // does. Skipping this check here (unlike the create-feed route) used to
      // send these straight through generic discovery, which correctly finds
      // nothing on e.g. a GitHub stars page and then overwrites rss_url with
      // that nothing — permanently breaking an otherwise-working feed.
      const resolved = await resolveFeedSource(feed.url, {
        onEvent: (event) => translateRedetectResolveEvent(sse.send, event),
      })
      const rssUrl = resolved.rssUrl
      const rssBridgeUrl = resolved.rssBridgeUrl

      // Update feed with new URLs
      updateFeed(params.id, {
        rss_url: rssUrl,
        rss_bridge_url: rssBridgeUrl,
      })

      // Fire-and-forget: fetch articles with updated config
      const refreshedFeed = getFeedById(params.id)
      if (refreshedFeed && (rssUrl || rssBridgeUrl)) {
        fetchSingleFeed(refreshedFeed).catch(err => {
          log.error(`Re-detect fetch for ${refreshedFeed.name} failed:`, err)
        })
      }

      sse.send({ type: 'done', rss_url: rssUrl, rss_bridge_url: rssBridgeUrl })
      sse.end()
    },
  )

  api.get(
    '/api/feeds/:id/metrics',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const feed = getFeedById(params.id)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      const metrics = getFeedMetrics(params.id)
      reply.send(metrics ?? { avg_content_length: null })
    },
  )

  api.post(
    '/api/feeds/:id/mark-all-seen',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const result = markAllSeenByFeed(params.id)
      reply.send(result)
    },
  )

  // --- OPML export ---

  api.get('/api/opml', async (_request, reply) => {
    const feeds = getFeeds()
    const categories = getCategories()
    const xml = generateOpml(feeds, categories)
    reply
      .header('Content-Type', 'application/xml')
      .header('Content-Disposition', 'attachment; filename="oksskolten.opml"')
      .send(xml)
  })

  // --- OPML preview ---

  api.post('/api/opml/preview', async (request, reply) => {
    const file = await request.file()
    if (!file) {
      reply.status(400).send({ error: 'No file uploaded' })
      return
    }

    const buffer = await file.toBuffer()
    const xml = buffer.toString('utf-8')

    let parsed
    try {
      parsed = parseOpml(xml)
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid OPML' })
      return
    }

    const feeds = parsed.map((entry) => {
      const existing = getFeedByUrl(entry.url)
      return {
        name: entry.name,
        url: entry.url,
        rssUrl: entry.rssUrl,
        categoryName: entry.categoryName,
        isDuplicate: !!existing,
      }
    })

    reply.send({
      feeds,
      totalCount: feeds.length,
      duplicateCount: feeds.filter((f) => f.isDuplicate).length,
    })
  })

  // --- OPML import ---

  api.post('/api/opml', async (request, reply) => {
    const file = await request.file()
    if (!file) {
      reply.status(400).send({ error: 'No file uploaded' })
      return
    }

    const buffer = await file.toBuffer()
    const xml = buffer.toString('utf-8')

    let parsed
    try {
      parsed = parseOpml(xml)
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid OPML' })
      return
    }

    // Filter by selectedUrls if provided
    const selectedUrlsRaw = file.fields?.selectedUrls
    let selectedUrlSet: Set<string> | null = null
    if (selectedUrlsRaw && typeof selectedUrlsRaw === 'object' && 'value' in selectedUrlsRaw) {
      const urls: string[] = JSON.parse((selectedUrlsRaw as { value: string }).value)
      selectedUrlSet = new Set(urls)
    }

    const entries = selectedUrlSet
      ? parsed.filter((entry) => selectedUrlSet!.has(entry.url))
      : parsed

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const importedFeeds: Feed[] = []

    // Pre-fetch existing categories
    const existingCategories = getCategories()
    const categoryByName = new Map(existingCategories.map(c => [c.name.toLowerCase(), c]))

    for (const entry of entries) {
      try {
        // Check for duplicate by url or rss_url
        if (getFeedByUrl(entry.url)) {
          skipped++
          continue
        }

        // Resolve category
        let categoryId: number | null = null
        if (entry.categoryName) {
          const existing = categoryByName.get(entry.categoryName.toLowerCase())
          if (existing) {
            categoryId = existing.id
          } else {
            const created = createCategory(entry.categoryName)
            categoryByName.set(entry.categoryName.toLowerCase(), created)
            categoryId = created.id
          }
        }

        const feed = createFeed({
          name: entry.name,
          url: entry.url,
          rss_url: entry.rssUrl,
          category_id: categoryId,
        })
        importedFeeds.push(feed)
        imported++
      } catch (err) {
        errors.push(`${entry.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Fire-and-forget: fetch articles for newly imported feeds
    for (const feed of importedFeeds) {
      if (feed.rss_url) {
        fetchSingleFeed(feed).catch(err => {
          log.error(`OPML: Initial fetch for ${feed.name} failed:`, err)
        })
      }
    }

    reply.send({ imported, skipped, errors })
  })
}

export async function registerFeedRoutes(api: FastifyInstance): Promise<void> {
  await api.register(feedRoutes)
  await api.register(categoryRoutes)
}
