import type { FastifyInstance } from 'fastify'
import { requireAuth, requireWriteScope, apiKeyRoutes, mediaCookieRoutes } from '../auth/index.js'
import { archivedMediaRoutes } from './articles/media.js'
import { registerFeedRoutes } from '../feeds/index.js'
import { articleRoutes } from './articles.js'
import { aiArticleRoutes } from '../ai/index.js'
import { settingsRoutes } from '../settings/index.js'
import { adminRoutes } from './admin.js'
import { statsRoutes } from './stats.js'
import { commentRoutes } from './comments.js'
import { registerIntelligenceRoutes } from '../intelligence/index.js'

export function registerApi(app: FastifyInstance): void {
  // Outside the authenticated scope below on purpose: archived images and
  // videos are fetched by the browser's own <img>/<video> loads, which send
  // no Authorization header. They carry the media cookie instead, which the
  // two routes here issue and clear.
  app.register(archivedMediaRoutes)
  mediaCookieRoutes(app)

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
