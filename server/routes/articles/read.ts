import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logger } from '../../logger.js'
import {
  getArticles,
  getArticleByUrl,
  getArticlesByIds,
  getClipFeed,
} from '../../db.js'
import { getSimilarArticles } from '../../intelligence/index.js'
import { buildMeiliFilter, meiliSearch } from '../../search/client.js'
import { isSearchReady } from '../../search/sync.js'
import { isImageArchivingEnabled } from '../../fetcher/article-images.js'
import { isVideoArchivingEnabled } from '../../fetcher/article-videos.js'
import { NumericIdParams, parseOrBadRequest } from '../../lib/validation.js'

const log = logger.child('search')

const DEFAULT_ARTICLE_LIMIT = 20
const MAX_ARTICLE_LIMIT = 100
const MAX_SEARCH_LIMIT = 50

// Coerce to number, treating NaN as undefined to preserve existing behavior
const coerceOptionalNumber = z.preprocess(
  (val) => { const n = Number(val); return Number.isNaN(n) ? undefined : n },
  z.number().optional(),
)

const ArticlesQuery = z.object({
  feed_id: coerceOptionalNumber,
  category_id: coerceOptionalNumber,
  unread: z.string().optional(),
  bookmarked: z.string().optional(),
  liked: z.string().optional(),
  read: z.string().optional(),
  sort: z.string().optional(),
  no_floor: z.string().optional(),
  limit: coerceOptionalNumber,
  offset: coerceOptionalNumber,
})

const SearchQuery = z.object({
  q: z.string().min(1, 'q is required'),
  feed_id: coerceOptionalNumber,
  category_id: coerceOptionalNumber,
  unread: z.string().optional(),
  liked: z.string().optional(),
  bookmarked: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: coerceOptionalNumber,
  offset: coerceOptionalNumber,
})

const ByUrlQuery = z.object({
  url: z.string().min(1, 'url is required'),
})

export async function articleReadRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/articles', async (request, reply) => {
    const query = ArticlesQuery.parse(request.query)
    const limit = Math.min(Math.max(query.limit || DEFAULT_ARTICLE_LIMIT, 1), MAX_ARTICLE_LIMIT)
    const offset = Math.max(query.offset || 0, 0)
    const feedId = query.feed_id ?? undefined
    const categoryId = query.category_id ?? undefined
    const unread = query.unread === '1'
    const bookmarked = query.bookmarked === '1'
    const liked = query.liked === '1'
    const read = query.read === '1'
    const sort = query.sort === 'score' ? 'score' as const : query.sort === 'recommended' ? 'recommended' as const : undefined
    const noFloor = query.no_floor === '1'

    const isClipFeed = feedId != null && getClipFeed()?.id === feedId
    const smartFloor = !noFloor && !isClipFeed && !unread && !bookmarked && !liked && !read
    const { articles, total, totalWithoutFloor } = getArticles({ feedId, categoryId, unread, bookmarked, liked, read, sort, limit, offset, smartFloor })
    const hasMore = offset + articles.length < total

    // When unread filter yields 0 results, return total article count (without unread filter)
    // so the UI can distinguish "no articles" from "all read"
    let totalAll: number | undefined
    if (unread && total === 0 && offset === 0) {
      const allResult = getArticles({ feedId, categoryId, limit: 0, offset: 0 })
      totalAll = allResult.total
    }

    reply.send({ articles, total, has_more: hasMore, ...(totalWithoutFloor != null ? { total_without_floor: totalWithoutFloor } : {}), ...(totalAll != null ? { total_all: totalAll } : {}) })
  })

  api.get('/api/articles/search', async (request, reply) => {
    const query = parseOrBadRequest(SearchQuery, request.query, reply)
    if (!query) return

    if (!isSearchReady()) {
      reply.status(503).send({ error: 'Search index is building' })
      return
    }

    const limit = Math.min(Math.max(query.limit || DEFAULT_ARTICLE_LIMIT, 1), MAX_SEARCH_LIMIT)
    const offset = Math.max(query.offset || 0, 0)
    const unread = query.unread === '1' ? true : query.unread === '0' ? false : undefined
    const liked = query.liked === '1'
    const bookmarked = query.bookmarked === '1'

    try {
      const filter = buildMeiliFilter({
        feed_id: query.feed_id,
        category_id: query.category_id,
        since: query.since,
        until: query.until,
        unread,
        liked,
        bookmarked,
      })

      const { hits, estimatedTotalHits } = await meiliSearch(query.q, { limit, offset, filter })
      const ids = hits.map((h) => h.id)

      const articles = getArticlesByIds(ids)
      const hasMore = offset + hits.length < estimatedTotalHits
      reply.send({ articles, has_more: hasMore })
    } catch (err) {
      log.error('Meilisearch query failed:', err)
      reply.send({ articles: [] })
    }
  })

  api.get('/api/articles/by-url', async (request, reply) => {
    const query = parseOrBadRequest(ByUrlQuery, request.query, reply)
    if (!query) return
    const article = getArticleByUrl(query.url)
    if (!article) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }
    reply.send({
      ...article,
      imageArchivingEnabled: isImageArchivingEnabled(),
      videoArchivingEnabled: isVideoArchivingEnabled(),
    })
  })

  api.get(
    '/api/articles/:id/similar',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const similar = getSimilarArticles(params.id)
      reply.send({ similar })
    },
  )

}
