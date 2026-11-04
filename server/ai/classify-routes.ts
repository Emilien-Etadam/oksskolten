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
import { getReaderContext } from '../intelligence/journal-db.js'
import { suggestThemes } from './tasks.js'
import { FORMATS, MAX_THEMES, normalizeClassId, type ClassOption, type ClassificationCount, type ClassificationOverview } from '../../shared/classification.js'

const Theta = z.number().min(0).max(1)

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  model: z.string().max(200).optional(),
  formatTheta: Theta.optional(),
  themeTheta: Theta.optional(),
  hideCategories: z.boolean().optional(),
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

const SuggestBody = z.object({
  /** How many themes to ask for, "Other" excluded */
  count: z.number().int().min(3).max(MAX_THEMES - 1).optional(),
})

const SUGGEST_DEFAULT_COUNT = 18
/** Titles sent to the model: the latest per feed, so one busy feed cannot drown the rest */
const SUGGEST_TITLES = 300
const SUGGEST_PER_FEED = 20

function sampleTitles(): string[] {
  const rows = getDb().prepare(`
    SELECT title FROM (
      SELECT title, published_at,
        ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY published_at DESC) AS rank
      FROM active_articles
      WHERE filtered_at IS NULL AND title IS NOT NULL AND TRIM(title) != ''
    )
    WHERE rank <= ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(SUGGEST_PER_FEED, SUGGEST_TITLES) as Array<{ title: string }>
  return rows.map(r => r.title.replace(/\s+/g, ' ').trim().slice(0, 200))
}

/** Unique ids, at most MAX_THEMES - 1, then the current "Other" theme last. */
function finalizeSuggestion(suggested: Array<{ label: string; description: string }>, current: ClassOption[]): ClassOption[] {
  const other = current.find(th => th.id === 'OTHER') ?? { id: 'OTHER', label: 'Other', description: 'none of the above' }
  const seen = new Set<string>(['OTHER'])
  const out: ClassOption[] = []
  for (const th of suggested) {
    const id = normalizeClassId(th.label)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: th.label, description: th.description })
    if (out.length >= MAX_THEMES - 1) break
  }
  return out.length ? [...out, other] : []
}

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
      hideCategories: settings.enabled && settings.hideCategories,
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
      reply.send({ ok: true, result: await classifyArticle({ title: body.title, body: body.body, readerContext: getReaderContext }) })
    } catch (err) {
      reply.send({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // A finer theme list proposed from recent titles, nothing stored: the
  // reader edits it in the theme editor and saves it like a manual list
  api.post('/api/classification/suggest-themes', async (request, reply) => {
    const body = parseOrBadRequest(SuggestBody, request.body ?? {}, reply)
    if (!body) return
    const titles = sampleTitles()
    if (titles.length === 0) {
      reply.status(409).send({ error: 'No articles to learn themes from' })
      return
    }
    const current = getClassificationSettings().themes
    try {
      const result = await suggestThemes(
        titles,
        current.filter(th => th.id !== 'OTHER'),
        body.count ?? SUGGEST_DEFAULT_COUNT,
      )
      const themes = finalizeSuggestion(result.themes, current)
      if (themes.length === 0) {
        reply.status(502).send({ error: 'The model did not return a usable theme list' })
        return
      }
      reply.send({ themes, sampled: titles.length })
    } catch (err) {
      reply.status(502).send({ error: err instanceof Error ? err.message : String(err) })
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
