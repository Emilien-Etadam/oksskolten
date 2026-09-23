import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth/index.js'
import { parseOrBadRequest } from '../lib/validation.js'
import { getInterestIslands, getInterestClasses, setInterestMuted, setInterestClassMuted, maybeRebuildInterestProfile } from './interests.js'

const TermParams = z.object({ term: z.string().min(1) })
const ClassParams = z.object({ kind: z.enum(['theme', 'format']), classId: z.string().min(1).max(40) })
const MuteBody = z.object({ muted: z.boolean({ message: 'muted must be a boolean' }) })

export async function interestRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/interests', async (_request, reply) => {
    reply.send({ islands: getInterestIslands(), classes: getInterestClasses() })
  })

  api.post('/api/interests/rebuild', async (_request, reply) => {
    maybeRebuildInterestProfile(true)
    reply.send({ islands: getInterestIslands(), classes: getInterestClasses() })
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

  api.patch('/api/interests/classes/:kind/:classId', { preHandler: [requireJson] }, async (request, reply) => {
    const params = parseOrBadRequest(ClassParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(MuteBody, request.body, reply)
    if (!body) return
    if (!setInterestClassMuted(params.kind, params.classId, body.muted)) {
      reply.status(404).send({ error: 'Class not found' })
      return
    }
    reply.send({ kind: params.kind, class_id: params.classId, muted: body.muted })
  })
}
