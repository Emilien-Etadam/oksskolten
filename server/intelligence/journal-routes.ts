import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth/index.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import { markArticleLiked } from '../db.js'
import type { JournalOverview } from '../../shared/journal.js'
import { JournalBusyError, startEdition } from './journal.js'
import {
  countPendingArticles,
  failStaleEditions,
  getEdition,
  getFeedbackFor,
  getInstructions,
  getLatestEdition,
  listEditions,
  setFeedback,
  setInstruction,
} from './journal-db.js'

const MAX_INSTRUCTION_LENGTH = 1000

const InstructionBody = z.object({
  instruction: z.string().max(MAX_INSTRUCTION_LENGTH),
})

const ThemeParams = z.object({
  theme: z.string().min(1).max(64),
})

const FeedbackBody = z.object({
  article_id: z.number().int().positive(),
  vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
})

export async function journalRoutes(api: FastifyInstance): Promise<void> {
  /** The newest edition plus what the reader needs around it */
  api.get('/api/journal', async (_request, reply) => {
    failStaleEditions()
    const latest = getLatestEdition()
    const sourceIds = latest?.content?.sources.map(s => s.article_id) ?? []
    const overview: JournalOverview = {
      latest,
      pending_count: countPendingArticles(),
      instructions: getInstructions(),
      feedback: getFeedbackFor(sourceIds),
    }
    reply.send(overview)
  })

  api.get('/api/journal/editions', async (_request, reply) => {
    reply.send({ editions: listEditions() })
  })

  api.get('/api/journal/editions/:id', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const edition = getEdition(params.id)
    if (!edition) {
      reply.status(404).send({ error: 'Edition not found' })
      return
    }
    reply.send({
      edition,
      feedback: getFeedbackFor(edition.content?.sources.map(s => s.article_id) ?? []),
    })
  })

  api.post('/api/journal/generate', async (_request, reply) => {
    try {
      const started = startEdition()
      if (!started) {
        reply.status(422).send({ error: 'No new articles since the previous edition', code: 'no_articles' })
        return
      }
      reply.status(202).send({ id: started.id })
    } catch (err) {
      if (err instanceof JournalBusyError) {
        reply.status(409).send({ error: err.message, code: 'busy' })
        return
      }
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  api.put('/api/journal/instructions/:theme', { preHandler: [requireJson] }, async (request, reply) => {
    const params = parseOrBadRequest(ThemeParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(InstructionBody, request.body, reply)
    if (!body) return
    setInstruction(params.theme, body.instruction)
    reply.send({ instructions: getInstructions() })
  })

  api.post('/api/journal/feedback', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(FeedbackBody, request.body, reply)
    if (!body) return
    if (!setFeedback(body.article_id, body.vote)) {
      reply.status(404).send({ error: 'Article not found' })
      return
    }
    // "More like this" is a like: it also feeds the interest profile
    if (body.vote === 1) markArticleLiked(body.article_id, true)
    reply.send({ article_id: body.article_id, vote: body.vote })
  })
}
