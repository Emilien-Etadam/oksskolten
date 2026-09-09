import type { FastifyInstance } from 'fastify'
import { getFrontPage } from './frontpage-db.js'

export async function frontPageRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/frontpage', async () => getFrontPage())
}
