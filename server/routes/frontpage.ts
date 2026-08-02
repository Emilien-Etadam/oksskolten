import type { FastifyInstance } from 'fastify'
import { getFrontPage } from '../db/frontpage.js'

export async function frontPageRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/frontpage', async () => getFrontPage())
}
