import type { FastifyInstance } from 'fastify'
import { requireAuth, requireWriteScope } from '../auth.js'
import { feedRoutes } from './feeds.js'
import { articleRoutes } from './articles.js'
import { categoryRoutes } from './categories.js'
import { settingsRoutes } from './settings.js'
import { adminRoutes } from './admin.js'
import { apiKeyRoutes } from './apiKeys.js'
import { statsRoutes } from './stats.js'
import { commentRoutes } from './comments.js'
import { frontPageRoutes } from './frontpage.js'
import { smartFolderRoutes } from './smart-folders.js'
import { ruleRoutes } from './rules.js'
import { storyRoutes } from './stories.js'
import { interestRoutes } from './interests.js'

export function registerApi(app: FastifyInstance): void {
  app.register(async function apiRoutes(api) {
    api.addHook('preHandler', requireAuth)
    api.addHook('preHandler', requireWriteScope)

    await api.register(feedRoutes)
    await api.register(articleRoutes)
    await api.register(categoryRoutes)
    await api.register(settingsRoutes)
    await api.register(adminRoutes)
    await api.register(apiKeyRoutes)
    await api.register(statsRoutes)
    await api.register(frontPageRoutes)
    await api.register(commentRoutes)
    await api.register(smartFolderRoutes)
    await api.register(ruleRoutes)
    await api.register(storyRoutes)
    await api.register(interestRoutes)
  })
}
