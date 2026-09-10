import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth/index.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import {
  getSmartFolders,
  getSmartFolderById,
  createSmartFolder,
  updateSmartFolder,
  deleteSmartFolder,
  getSmartFolderArticles,
} from './smart-folders-db.js'
import { parseSmartQuery, smartQuerySince } from '../../shared/smart-query.js'
import { buildMeiliFilter, meiliSearch } from '../search/client.js'
import { isSearchReady } from '../search/sync.js'
import { logger } from '../logger.js'

const log = logger.child('smart-folders')

const MAX_NAME = 80
const MAX_QUERY = 500
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/** Search-index candidates fetched for a free-text folder before SQL filtering and paging */
const SEARCH_CANDIDATES = 500

const FolderBody = z.object({
  name: z.string({ error: 'name is required' }).trim().min(1, 'name is required').max(MAX_NAME),
  query: z.string({ error: 'query is required' }).trim().min(1, 'query is required').max(MAX_QUERY),
})

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(MAX_NAME).optional(),
  query: z.string().trim().min(1).max(MAX_QUERY).optional(),
  sort_order: z.number().int().optional(),
})

const coerceOptionalNumber = z.preprocess(
  (val) => { const n = Number(val); return Number.isNaN(n) ? undefined : n },
  z.number().optional(),
)

const ArticlesQuery = z.object({
  limit: coerceOptionalNumber,
  offset: coerceOptionalNumber,
})

export async function smartFolderRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/smart-folders', async (_request, reply) => {
    reply.send({ folders: getSmartFolders() })
  })

  api.post('/api/smart-folders', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(FolderBody, request.body, reply)
    if (!body) return
    reply.status(201).send(createSmartFolder(body.name, body.query))
  })

  api.patch('/api/smart-folders/:id', { preHandler: [requireJson] }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(UpdateBody, request.body, reply)
    if (!body) return
    const folder = updateSmartFolder(params.id, body)
    if (!folder) { reply.status(404).send({ error: 'Smart folder not found' }); return }
    reply.send(folder)
  })

  api.delete('/api/smart-folders/:id', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    if (!deleteSmartFolder(params.id)) { reply.status(404).send({ error: 'Smart folder not found' }); return }
    reply.status(204).send()
  })

  api.get('/api/smart-folders/:id/articles', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const q = parseOrBadRequest(ArticlesQuery, request.query, reply)
    if (!q) return
    const folder = getSmartFolderById(params.id)
    if (!folder) { reply.status(404).send({ error: 'Smart folder not found' }); return }

    const limit = Math.min(Math.max(q.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(q.offset || 0, 0)
    const query = parseSmartQuery(folder.query)

    // Free text goes through the search index when it is up; otherwise the
    // SQL LIKE fallback keeps the folder usable (and testable) without it.
    let restrictToIds: number[] | undefined
    if (query.text && isSearchReady()) {
      try {
        const filter = buildMeiliFilter({
          feed_id: query.feedId,
          category_id: query.categoryId,
          since: smartQuerySince(query),
          unread: query.unread,
          liked: query.liked,
          bookmarked: query.bookmarked,
        })
        const { hits } = await meiliSearch(query.text, { limit: SEARCH_CANDIDATES, filter })
        restrictToIds = hits.map(h => h.id)
      } catch (err) {
        log.warn(`Search failed for smart folder ${folder.id}, falling back to SQL: ${err instanceof Error ? err.message : err}`)
      }
    }

    const { articles, total } = getSmartFolderArticles(query, { limit, offset, restrictToIds })
    reply.send({ articles, total, has_more: offset + articles.length < total, folder })
  })
}
