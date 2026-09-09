import type { FastifyInstance } from 'fastify'
import { getSetting, getRetentionStats, purgeExpiredArticles, getDb } from '../db.js'

export async function retentionRoutes(api: FastifyInstance): Promise<void> {
  // --- Retention policy ---

  function getRetentionDays(): { readDays: number; unreadDays: number } | null {
    const readDays = Number(getSetting('retention.read_days'))
    const unreadDays = Number(getSetting('retention.unread_days'))
    if (isNaN(readDays) || isNaN(unreadDays) || readDays < 1 || unreadDays < 1) return null
    return { readDays, unreadDays }
  }

  api.get('/api/settings/retention/stats', async (_request, reply) => {
    const days = getRetentionDays()
    if (!days) {
      reply.send({ readDays: 0, unreadDays: 0, readEligible: 0, unreadEligible: 0 })
      return
    }
    const stats = getRetentionStats(days.readDays, days.unreadDays)
    reply.send({ readDays: days.readDays, unreadDays: days.unreadDays, ...stats })
  })

  api.post('/api/settings/retention/purge', async (_request, reply) => {
    if (getSetting('retention.enabled') !== 'on') {
      reply.status(400).send({ error: 'Retention policy is not enabled' })
      return
    }
    const days = getRetentionDays()
    if (!days) {
      reply.send({ purged: 0 })
      return
    }
    const result = purgeExpiredArticles(days.readDays, days.unreadDays)

    // Checkpoint WAL after purge
    try {
      getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // non-critical
    }

    reply.send(result)
  })
}
