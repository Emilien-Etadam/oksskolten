import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth/index.js'
import { getSetting, upsertSetting, deleteSetting } from '../db.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import { GitBackupError } from './errors.js'
import { getForgejoConfig } from './forgejo.js'
import { listGitBackups, getGitBackup, deleteGitBackup } from './db.js'
import { addGitBackup, syncGitBackup, freezeGitBackup, startSyncAll } from './service.js'

const ConfigBody = z.object({
  forgejo_url: z.string().trim()
    .refine(v => v === '' || /^https?:\/\/[^\s/]+/.test(v), { message: 'forgejo_url must be an http(s) URL' })
    .optional(),
  forgejo_owner: z.string().trim().max(100).optional(),
})

const AddBody = z.object({
  url: z.string({ error: 'url is required' }).trim().min(1, 'url is required'),
})

/** Answer a GitBackupError with its own status; let anything else surface as a 500. */
async function handle<T>(reply: FastifyReply, run: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof GitBackupError) {
      reply.status(err.status).send({ error: err.message })
      return undefined
    }
    throw err
  }
}

export async function gitBackupRoutes(api: FastifyInstance): Promise<void> {
  // --- Forgejo connection (the token goes through /api/settings/api-keys/forgejo) ---

  api.get('/api/settings/git-backup', async (_request, reply) => {
    reply.send({
      forgejo_url: getSetting('git_backup.forgejo_url') ?? '',
      forgejo_owner: getSetting('git_backup.forgejo_owner') ?? '',
      token_configured: !!getSetting('git_backup.forgejo_token'),
    })
  })

  api.patch('/api/settings/git-backup', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(ConfigBody, request.body, reply)
    if (!body) return
    for (const key of ['forgejo_url', 'forgejo_owner'] as const) {
      const value = body[key]
      if (value === undefined) continue
      if (value === '') deleteSetting(`git_backup.${key}`)
      else upsertSetting(`git_backup.${key}`, key === 'forgejo_url' ? value.replace(/\/+$/, '') : value)
    }
    reply.send({ ok: true })
  })

  // --- Archived repositories ---

  api.get('/api/git-backups', async (_request, reply) => {
    const config = getForgejoConfig()
    reply.send({
      configured: !!config,
      forgejo_url: config?.url ?? null,
      backups: listGitBackups(),
    })
  })

  api.post('/api/git-backups', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(AddBody, request.body, reply)
    if (!body) return
    const backup = await handle(reply, () => addGitBackup(body.url))
    if (backup) reply.status(201).send(backup)
  })

  api.post('/api/git-backups/sync-all', async (_request, reply) => {
    const queued = await handle(reply, () => startSyncAll())
    if (queued !== undefined) reply.status(202).send({ queued })
  })

  api.post('/api/git-backups/:id/sync', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const backup = await handle(reply, () => syncGitBackup(params.id))
    if (backup) reply.send(backup)
  })

  // The reader has seen what a sync would lose and lets it go.
  api.post('/api/git-backups/:id/accept', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const backup = await handle(reply, () => syncGitBackup(params.id, { force: true }))
    if (backup) reply.send(backup)
  })

  api.post('/api/git-backups/:id/freeze', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const backup = await handle(reply, () => freezeGitBackup(params.id))
    if (backup) reply.send(backup)
  })

  // Removes the repository from the list only. The archive on Forgejo is
  // kept: deleting it from here would make a misclick unrecoverable.
  api.delete('/api/git-backups/:id', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    if (!getGitBackup(params.id)) {
      reply.status(404).send({ error: 'Git backup not found' })
      return
    }
    deleteGitBackup(params.id)
    reply.status(204).send()
  })
}
