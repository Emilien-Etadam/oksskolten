import type { FastifyInstance } from 'fastify'
import { profileRoutes } from './profile-routes.js'
import { preferencesRoutes } from './preferences-routes.js'
import { imageStorageRoutes } from './image-storage-routes.js'
import { retentionRoutes } from './retention-routes.js'
import { aiSettingsRoutes } from '../ai/index.js'

export async function settingsRoutes(api: FastifyInstance): Promise<void> {
  await api.register(profileRoutes)
  await api.register(preferencesRoutes)
  await api.register(imageStorageRoutes)
  await api.register(retentionRoutes)
  await api.register(aiSettingsRoutes)   // from ../ai/index.js
}
