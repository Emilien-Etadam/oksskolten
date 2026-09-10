import type { FastifyInstance } from 'fastify'
import { articleReadRoutes } from './articles/read.js'
import { articleClipRoutes } from './articles/clip.js'
import { articleStateRoutes } from './articles/state.js'
import { articleMediaRoutes } from './articles/media.js'

export { parseByteRange } from './articles/media.js'

export async function articleRoutes(api: FastifyInstance): Promise<void> {
  await api.register(articleReadRoutes)
  await api.register(articleClipRoutes)
  await api.register(articleStateRoutes)
  await api.register(articleMediaRoutes)
}
