import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  markAllSeenByCategory,
} from '../db.js'
import { requireJson } from '../auth.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'

const CreateCategoryBody = z.object({
  name: z.string({ error: 'name is required' }).trim().min(1, 'name is required'),
})

const UpdateCategoryBody = z.object({
  name: z.string().optional(),
  sort_order: z.number().optional(),
  collapsed: z.number().optional(),
})

export async function categoryRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/categories', async (_request, reply) => {
    const categories = getCategories()
    reply.send({ categories })
  })

  api.post(
    '/api/categories',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(CreateCategoryBody, request.body, reply)
      if (!body) return
      const category = createCategory(body.name.trim())
      reply.status(201).send(category)
    },
  )

  api.patch(
    '/api/categories/:id',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(UpdateCategoryBody, request.body, reply)
      if (!body) return
      const category = updateCategory(params.id, body)
      if (!category) {
        reply.status(404).send({ error: 'Category not found' })
        return
      }
      reply.send(category)
    },
  )

  api.delete(
    '/api/categories/:id',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const deleted = deleteCategory(params.id)
      if (!deleted) {
        reply.status(404).send({ error: 'Category not found' })
        return
      }
      reply.status(204).send()
    },
  )

  api.post(
    '/api/categories/:id/mark-all-seen',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const result = markAllSeenByCategory(params.id)
      reply.send(result)
    },
  )
}
