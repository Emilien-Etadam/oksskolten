import type { FastifyInstance } from 'fastify'
import { requireAuth, requireWriteScope } from '../auth.js'
import { registerFeedRoutes } from '../feeds/index.js'
import { articleRoutes } from './articles.js'
import { aiArticleRoutes } from '../ai/index.js'
import { settingsRoutes } from '../settings/index.js'
import { adminRoutes } from './admin.js'
import { apiKeyRoutes } from './apiKeys.js'
import { statsRoutes } from './stats.js'
import { commentRoutes } from './comments.js'
import { registerIntelligenceRoutes } from '../intelligence/index.js'

export function registerApi(app: FastifyInstance): void {
  app.register(async function apiRoutes(api) {
    api.addHook('preHandler', requireAuth)
    api.addHook('preHandler', requireWriteScope)

    await registerFeedRoutes(api)
    await api.register(articleRoutes)
    await api.register(aiArticleRoutes)
    await api.register(settingsRoutes)
    await api.register(adminRoutes)
    await api.register(apiKeyRoutes)
    await api.register(statsRoutes)
    await registerIntelligenceRoutes(api)
    await api.register(commentRoutes)
  })
}
