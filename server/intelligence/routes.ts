import type { FastifyInstance } from 'fastify'
import { frontPageRoutes } from './frontpage-routes.js'
import { smartFolderRoutes } from './smart-folders-routes.js'
import { ruleRoutes } from './rules-routes.js'
import { storyRoutes } from './stories-routes.js'
import { interestRoutes } from './interests-routes.js'

export async function registerIntelligenceRoutes(api: FastifyInstance): Promise<void> {
  await api.register(frontPageRoutes)
  await api.register(smartFolderRoutes)
  await api.register(ruleRoutes)
  await api.register(storyRoutes)
  await api.register(interestRoutes)
}
