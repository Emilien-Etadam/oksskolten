import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseOrBadRequest } from '../lib/validation.js'
import { getTopStories } from './stories-db.js'

const coerceOptionalNumber = z.preprocess(
  (val) => { const n = Number(val); return Number.isNaN(n) ? undefined : n },
  z.number().optional(),
)

const StoriesQuery = z.object({
  days: coerceOptionalNumber,
  limit: coerceOptionalNumber,
})

export async function storyRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/stories', async (request, reply) => {
    const query = parseOrBadRequest(StoriesQuery, request.query, reply)
    if (!query) return
    reply.send({ stories: getTopStories({ days: query.days, limit: query.limit }) })
  })
}
