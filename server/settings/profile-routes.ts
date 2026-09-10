import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSetting, upsertSetting } from '../db.js'
import { requireJson, getAuthUser } from '../auth/index.js'
import { parseOrBadRequest } from '../lib/validation.js'

const ProfileBody = z.object({
  account_name: z.string().optional(),
  avatar_seed: z.string().nullable().optional(),
  language: z.enum(['ja', 'en', 'zh'], { error: 'language must be "ja", "en", or "zh"' }).optional(),
})

export async function profileRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/settings/profile', async (request, reply) => {
    const authEmail = getAuthUser(request) ?? 'localhost'
    let accountName = getSetting('profile.account_name')
    if (!accountName) {
      accountName = authEmail
      upsertSetting('profile.account_name', accountName)
    }
    const avatarSeed = getSetting('profile.avatar_seed') || null
    const language = getSetting('general.language') ?? null
    reply.send({ account_name: accountName, avatar_seed: avatarSeed, language, email: authEmail })
  })

  api.patch(
    '/api/settings/profile',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(ProfileBody, request.body, reply)
      if (!body) return
      if (body.account_name === undefined && body.avatar_seed === undefined && body.language === undefined) {
        reply.status(400).send({ error: 'No fields to update' })
        return
      }
      if (body.account_name !== undefined) {
        const name = body.account_name.trim()
        if (!name) {
          reply.status(400).send({ error: 'account_name must not be empty' })
          return
        }
        upsertSetting('profile.account_name', name)
      }
      if (body.avatar_seed !== undefined) {
        upsertSetting('profile.avatar_seed', body.avatar_seed || '')
      }
      if (body.language !== undefined) {
        upsertSetting('general.language', body.language)
      }
      const accountName = getSetting('profile.account_name')!
      const avatarSeed = getSetting('profile.avatar_seed') || null
      const language = getSetting('general.language') ?? null
      reply.send({ account_name: accountName, avatar_seed: avatarSeed, language })
    },
  )
}
