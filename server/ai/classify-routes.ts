import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../auth/index.js'
import { parseOrBadRequest } from '../lib/validation.js'
import { getDb } from '../db/connection.js'
import {
  classifyArticle,
  getClassificationSettings,
  saveClassificationSettings,
  sanitizeThemes,
} from './classify.js'
import { enqueueClassifyBackfill, countPendingClassify } from './queue.js'
import { FORMATS, MAX_THEMES, type ClassificationCount, type ClassificationOverview } from '../../shared/classification.js'

const Theta = z.number().min(0).max(1)

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  model: z.string().max(200).optional(),
  formatTheta: Theta.optional(),
  themeTheta: Theta.optional(),
  themes: z.array(z.object({
    id: z.string().max(40).optional(),
    label: z.string().max(60),
    description: z.string().max(300).optional(),
  })).min(1).max(MAX_THEMES).optional(),
})

const TestBody = z.object({
  title: z.string().min(1).max(500),
  body: z.string().max(10_000).optional(),
})

const BackfillBody = z.object({
  /** Forget every previous verdict first (after editing the theme list) */
  all: z.boolean().optional(),
})

function unreadCounts(column: 'format' | 'theme'): Map<string, number> {
  const rows = getDb().prepare(`
    SELECT ${column} AS id, COUNT(*) AS cnt
    FROM active_articles
    WHERE ${column} IS NOT NULL AND seen_at IS NULL AND filtered_at IS NULL
    GROUP BY ${column}
  `).all() as Array<{ id: string; cnt: number }>
  return new Map(rows.map(r => [r.id, r.cnt]))
}

function withCounts(options: Array<{ id: string; label: string }>, counts: Map<string, number>): ClassificationCount[] {
  return options.map(o => ({ id: o.id, label: o.label, unread_count: counts.get(o.id) ?? 0 }))
}

export async function classificationRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/classification', async (_request, reply) => {
    const settings = getClassificationSettings()
    const { unclassified } = getDb().prepare(`
      SELECT COUNT(*) AS unclassified FROM active_articles
      WHERE classified_at IS NULL AND filtered_at IS NULL
    `).get() as { unclassified: number }
    const overview: ClassificationOverview = {
      enabled: settings.enabled,
      formats: withCounts(FORMATS, unreadCounts('format')),
      themes: withCounts(settings.themes, unreadCounts('theme')),
      unclassified,
      pending: countPendingClassify(),
    }
    reply.send(overview)
  })

  api.get('/api/classification/settings', async (_request, reply) => {
    reply.send(getClassificationSettings())
  })

  api.patch('/api/classification/settings', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(SettingsBody, request.body, reply)
    if (!body) return
    let themes
    if (body.themes) {
      themes = sanitizeThemes(body.themes)
      if (!themes) {
        reply.status(400).send({ error: `Themes must have unique, non-empty ids (1-${MAX_THEMES})` })
        return
      }
    }
    saveClassificationSettings({ ...body, themes })
    reply.send(getClassificationSettings())
  })

  // One live classification, nothing stored: checks the server, the model
  // and that logprobs come back, with a text the reader picks
  api.post('/api/classification/test', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(TestBody, request.body, reply)
    if (!body) return
    try {
      reply.send({ ok: true, result: await classifyArticle({ title: body.title, body: body.body }) })
    } catch (err) {
      reply.send({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  api.post('/api/classification/backfill', async (request, reply) => {
    const body = parseOrBadRequest(BackfillBody, request.body ?? {}, reply)
    if (!body) return
    if (!getClassificationSettings().enabled) {
      reply.status(409).send({ error: 'Classification is disabled' })
      return
    }
    if (body.all) {
      getDb().prepare('UPDATE articles SET format = NULL, theme = NULL, classified_at = NULL WHERE id IN (SELECT id FROM active_articles)').run()
    }
    reply.send({ queued: enqueueClassifyBackfill() })
  })
}
