import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import {
  getFeedRules,
  getFeedRuleById,
  createFeedRule,
  updateFeedRule,
  deleteFeedRule,
  RULE_FIELDS,
  RULE_ACTIONS,
} from '../db/feed-rules.js'
import { isValidPattern, applyRuleToExisting, previewRule, MAX_PATTERN_LENGTH } from '../rules.js'

const FieldSchema = z.enum(RULE_FIELDS as [string, ...string[]])
const ActionSchema = z.enum(RULE_ACTIONS as [string, ...string[]])
const PatternSchema = z.string({ error: 'pattern is required' }).trim().min(1, 'pattern is required').max(MAX_PATTERN_LENGTH)
  .refine(isValidPattern, { message: 'pattern is not a valid regular expression' })

const CreateBody = z.object({
  feed_id: z.number().int().positive().nullable().optional(),
  field: FieldSchema.default('title'),
  pattern: PatternSchema,
  action: ActionSchema,
  value: z.number().finite().nullable().optional(),
  enabled: z.boolean().optional(),
})

const UpdateBody = z.object({
  feed_id: z.number().int().positive().nullable().optional(),
  field: FieldSchema.optional(),
  pattern: PatternSchema.optional(),
  action: ActionSchema.optional(),
  value: z.number().finite().nullable().optional(),
  enabled: z.boolean().optional(),
})

const PreviewBody = z.object({
  feed_id: z.number().int().positive().nullable().optional(),
  field: FieldSchema.default('title'),
  pattern: PatternSchema,
})

type Field = (typeof RULE_FIELDS)[number]
type Action = (typeof RULE_ACTIONS)[number]

export async function ruleRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/rules', async (_request, reply) => {
    reply.send({ rules: getFeedRules() })
  })

  api.post('/api/rules', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(CreateBody, request.body, reply)
    if (!body) return
    if (body.action === 'score' && !body.value) {
      reply.status(400).send({ error: 'value is required for the score action' })
      return
    }
    const rule = createFeedRule({
      feed_id: body.feed_id ?? null,
      field: body.field as Field,
      pattern: body.pattern,
      action: body.action as Action,
      value: body.action === 'score' ? body.value : null,
      enabled: body.enabled,
    })
    reply.status(201).send(rule)
  })

  api.post('/api/rules/preview', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(PreviewBody, request.body, reply)
    if (!body) return
    reply.send(previewRule({ feed_id: body.feed_id ?? null, field: body.field as Field, pattern: body.pattern }))
  })

  api.patch('/api/rules/:id', { preHandler: [requireJson] }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(UpdateBody, request.body, reply)
    if (!body) return
    const rule = updateFeedRule(params.id, {
      ...body,
      field: body.field as Field | undefined,
      action: body.action as Action | undefined,
    })
    if (!rule) { reply.status(404).send({ error: 'Rule not found' }); return }
    reply.send(rule)
  })

  api.delete('/api/rules/:id', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    if (!deleteFeedRule(params.id)) { reply.status(404).send({ error: 'Rule not found' }); return }
    reply.status(204).send()
  })

  /** Run a rule over the latest articles of its scope (newest 500). */
  api.post('/api/rules/:id/apply', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const rule = getFeedRuleById(params.id)
    if (!rule) { reply.status(404).send({ error: 'Rule not found' }); return }
    reply.send(applyRuleToExisting(rule))
  })
}
