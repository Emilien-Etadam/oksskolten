import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth.js'
import { parseOrBadRequest } from '../lib/validation.js'
import { getInterestIslands, setInterestMuted, maybeRebuildInterestProfile } from './interests.js'

const TermParams = z.object({ term: z.string().min(1) })
const MuteBody = z.object({ muted: z.boolean({ message: 'muted must be a boolean' }) })

export async function interestRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/interests', async (_request, reply) => {
    reply.send({ islands: getInterestIslands() })
  })

  api.post('/api/interests/rebuild', async (_request, reply) => {
    maybeRebuildInterestProfile(true)
    reply.send({ islands: getInterestIslands() })
  })

  api.patch('/api/interests/:term', { preHandler: [requireJson] }, async (request, reply) => {
    const params = parseOrBadRequest(TermParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(MuteBody, request.body, reply)
    if (!body) return
    if (!setInterestMuted(decodeURIComponent(params.term), body.muted)) {
      reply.status(404).send({ error: 'Term not found' })
      return
    }
    reply.send({ term: params.term, muted: body.muted })
  })
}
