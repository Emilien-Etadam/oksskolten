import { getDb } from '../../db/connection.js'
import { getSetting } from '../../db.js'
import { getArticleById } from '../../db/articles.js'
import { getClassificationSettings, resolveModel } from '../../ai/classify.js'
import { getVllmBaseUrl, getVllmApiKey } from '../../ai/providers/llm/vllm.js'
import { getReaderContext } from '../../intelligence/journal-db.js'
import { DEFAULT_IMPORTANCE_THETA } from '../../../shared/classification.js'
import { truncateChars } from '../../lib/text.js'
import type { BenchConfig } from './config.js'
import type { ArticleMeta, Label, ReadSettings, SampleFile } from './types.js'
import { rng, shuffle } from './util.js'

/**
 * Must run with DATABASE_URL pointing at the snapshot: every read below goes
 * through the production connection module.
 */

const EXCERPT_CHARS = 400

/** The settings production reads, as stored in the snapshot */
export function readSettings(): ReadSettings {
  const s = getClassificationSettings()
  return {
    vllmBaseUrl: getVllmBaseUrl(),
    baseUrlSetting: getSetting('vllm.base_url') ?? null,
    classifyModel: getSetting('classify.model') ?? null,
    summaryModel: getSetting('summary.model') ?? null,
    model: resolveModel(s),
    apiKeyPresent: !!getVllmApiKey(),
    formatTheta: s.formatTheta,
    themeTheta: s.themeTheta,
    importanceTheta: DEFAULT_IMPORTANCE_THETA,
    themes: s.themes,
  }
}

/**
 * Titles shown to the model as "more / fewer like" examples in the importance
 * question, for every theme and for the no-theme bucket (journal-db.ts).
 * An article among them would find its own answer in the question.
 */
function injectedTitles(themeIds: string[]): Set<string> {
  const titles = new Set<string>()
  for (const theme of [...themeIds, null]) {
    const ctx = getReaderContext(theme)
    for (const t of [...ctx.liked, ...ctx.disliked]) titles.add(t)
  }
  return titles
}

interface LabelRow {
  id: number
  title: string
  vote: number | null
  liked_at: string | null
  bookmarked_at: string | null
}

function labelOf(row: LabelRow): { label: Label; sources: string[] } {
  const sources: string[] = []
  if (row.vote !== null && row.vote > 0) sources.push('vote+1')
  if (row.liked_at) sources.push('liked')
  if (row.bookmarked_at) sources.push('bookmarked')
  const positive = sources.length > 0
  const negative = row.vote !== null && row.vote < 0
  if (negative) sources.push('vote-1')
  return { label: positive && negative ? 'conflict' : negative ? 'negative' : 'positive', sources }
}

function storedClassification(id: number): ArticleMeta['stored'] {
  let row: { format: string | null; theme: string | null; importance?: string | null; classified_at: string | null } | undefined
  try {
    row = getDb().prepare('SELECT format, theme, importance, classified_at FROM active_articles WHERE id = ?').get(id) as typeof row
  } catch {
    // Database older than migration 0022: no importance column
    row = getDb().prepare('SELECT format, theme, classified_at FROM active_articles WHERE id = ?').get(id) as typeof row
  }
  return {
    format: row?.format ?? null,
    theme: row?.theme ?? null,
    importance: row?.importance ?? null,
    classifiedAt: row?.classified_at ?? null,
  }
}

export function articleMeta(id: number, label: Label | null, sources: string[]): ArticleMeta | null {
  const a = getArticleById(id)
  if (!a) return null
  const body = (a.full_text || a.excerpt || a.summary || '').replace(/\s+/g, ' ').trim()
  return {
    id,
    title: a.title,
    feed: a.feed_name ?? null,
    url: a.url,
    excerpt: truncateChars(body, EXCERPT_CHARS),
    stored: storedClassification(id),
    label,
    labelSources: sources,
  }
}

export function buildSample(cfg: BenchConfig): SampleFile {
  const settings = readSettings()
  const size = cfg.trial ? cfg.trialSize : cfg.sampleSize
  const random = rng(cfg.seed)
  const injected = injectedTitles(settings.themes.map(t => t.id))

  // Articles hidden by a feed's AI filter are never classified in production
  const labeledRows = getDb().prepare(`
    SELECT a.id, a.title, jf.vote, a.liked_at, a.bookmarked_at
    FROM active_articles a
    LEFT JOIN journal_feedback jf ON jf.article_id = a.id
    WHERE a.filtered_at IS NULL
      AND (jf.vote IS NOT NULL OR a.liked_at IS NOT NULL OR a.bookmarked_at IS NOT NULL)
    ORDER BY a.id
  `).all() as LabelRow[]

  const labeledEligible = labeledRows.filter(r => !injected.has(r.title))
  const excludedLabeled = labeledRows.length - labeledEligible.length
  const labeled = shuffle(labeledEligible, random).slice(0, size)
  const taken = new Set(labeledRows.map(r => r.id))

  const poolRows = getDb().prepare(`
    SELECT id, title FROM active_articles
    WHERE classified_at IS NOT NULL AND filtered_at IS NULL
    ORDER BY id
  `).all() as Array<{ id: number; title: string }>
  const pool = poolRows.filter(r => !taken.has(r.id) && !injected.has(r.title))
  const excludedPool = poolRows.filter(r => !taken.has(r.id) && injected.has(r.title)).length
  const complement = shuffle(pool, random).slice(0, Math.max(0, size - labeled.length))

  const articles: ArticleMeta[] = []
  for (const row of labeled) {
    const { label, sources } = labelOf(row)
    const meta = articleMeta(row.id, label, sources)
    if (meta) articles.push(meta)
  }
  for (const row of complement) {
    const meta = articleMeta(row.id, null, [])
    if (meta) articles.push(meta)
  }

  return {
    createdAt: new Date().toISOString(),
    seed: cfg.seed,
    trial: cfg.trial,
    requested: size,
    settings,
    articles,
    counts: {
      labeledAvailable: labeledRows.length,
      labeledUsed: labeled.length,
      excludedAsInjectedExamples: excludedLabeled + excludedPool,
      injectedTitles: injected.size,
      complementPool: pool.length,
      complementUsed: complement.length,
    },
  }
}
