import { getSetting } from '../db.js'
import { getDb } from '../db/connection.js'
import { getArticleById, updateArticleContent, updateScore } from '../db/articles.js'
import { translateArticle, translateTitle, summarizeArticle } from './ai.js'
import { Semaphore } from './util.js'
import { logger } from '../logger.js'
import { DEFAULT_LANGUAGE } from '../../shared/lang.js'

const log = logger.child('ai-queue')

export type AiQueueTask = 'translate' | 'summarize'

interface QueueItem {
  articleId: number
  task: AiQueueTask
  targetLang: string
}

/** Minimum age of a pending marker before a resume pass retries it (acts as failure backoff) */
const RESUME_MIN_AGE_MS = 10 * 60 * 1000
/** Max items re-enqueued per resume pass to keep fetch cycles bounded */
const RESUME_BATCH_LIMIT = 50

const queue: QueueItem[] = []
const pending = new Set<string>()
let concurrencyLimit = 1
let semaphore = new Semaphore(1)
let draining = false

function pendingKey(task: AiQueueTask, articleId: number): string {
  return `${task}:${articleId}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function getTargetLang(): string {
  return getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
}

function getConcurrency(): number {
  const raw = Number(getSetting('reading.auto_translate_concurrency'))
  if (isNaN(raw) || raw < 1) return 1
  return Math.min(raw, 5)
}

function ensureSemaphore(): Semaphore {
  const max = getConcurrency()
  if (max !== concurrencyLimit) {
    concurrencyLimit = max
    semaphore = new Semaphore(max)
  }
  return semaphore
}

function markPending(task: AiQueueTask, articleId: number, value: string | null): void {
  updateArticleContent(articleId, task === 'translate'
    ? { translate_pending_at: value }
    : { summarize_pending_at: value })
}

async function processTranslate(item: QueueItem): Promise<void> {
  const article = getArticleById(item.articleId)
  if (!article?.full_text
    || (article.translated_lang === item.targetLang && article.full_text_translated)
    || article.lang === item.targetLang) {
    markPending('translate', item.articleId, null)
    return
  }

  const result = await translateArticle(article.full_text, { provider: 'vllm' })
  if (!result.fullTextTranslated.trim()) {
    log.warn(`auto-translate returned empty text for article ${item.articleId}, will retry later`)
    markPending('translate', item.articleId, nowIso())
    return
  }

  // Title translation is best-effort: a failure must not lose the body translation
  let titleTranslated = article.title_translated
  try {
    const t = await translateTitle(article.title, { provider: 'vllm' })
    if (t.titleTranslated.trim()) titleTranslated = t.titleTranslated
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`title translation failed for article ${item.articleId}: ${msg}`)
  }

  updateArticleContent(item.articleId, {
    full_text_translated: result.fullTextTranslated,
    translated_lang: item.targetLang,
    title_translated: titleTranslated,
    translate_pending_at: null,
  })
  updateScore(item.articleId)
  log.info(`auto-translate complete for article ${item.articleId} (${item.targetLang})`)
}

async function processSummarize(item: QueueItem): Promise<void> {
  const article = getArticleById(item.articleId)
  if (!article?.full_text || article.summary) {
    markPending('summarize', item.articleId, null)
    return
  }

  const result = await summarizeArticle(article.full_text, { provider: 'vllm' })
  if (!result.summary.trim()) {
    log.warn(`auto-summarize returned empty text for article ${item.articleId}, will retry later`)
    markPending('summarize', item.articleId, nowIso())
    return
  }

  updateArticleContent(item.articleId, {
    summary: result.summary,
    summarize_pending_at: null,
  })
  updateScore(item.articleId)
  log.info(`auto-summarize complete for article ${item.articleId}`)
}

async function processItem(item: QueueItem): Promise<void> {
  try {
    if (item.task === 'translate') {
      await processTranslate(item)
    } else {
      await processSummarize(item)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`auto-${item.task} failed for article ${item.articleId}: ${msg}`)
    // Refresh the marker so the next resume pass retries after the backoff window
    try {
      markPending(item.task, item.articleId, nowIso())
    } catch { /* article may have been deleted */ }
  } finally {
    pending.delete(pendingKey(item.task, item.articleId))
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  const sem = ensureSemaphore()
  try {
    while (queue.length > 0) {
      const item = queue.shift()!
      await sem.run(() => processItem(item))
    }
  } finally {
    draining = false
    if (queue.length > 0) void drainQueue()
  }
}

function enqueue(task: AiQueueTask, articleId: number, opts?: { skipMark?: boolean }): void {
  const key = pendingKey(task, articleId)
  if (pending.has(key)) return
  pending.add(key)
  if (!opts?.skipMark) {
    markPending(task, articleId, nowIso())
  }
  queue.push({ articleId, task, targetLang: getTargetLang() })
  void drainQueue()
}

export function enqueueAutoTranslate(articleId: number, fullText: string): void {
  if (!isAutoTranslateEnabled()) return
  if (!fullText?.trim()) return
  enqueue('translate', articleId)
}

export function enqueueAutoSummarize(articleId: number, fullText: string): void {
  if (!isAutoSummarizeEnabled()) return
  if (!fullText?.trim()) return
  enqueue('summarize', articleId)
}

export function isAutoTranslateEnabled(): boolean {
  return getSetting('reading.auto_translate') === 'on'
}

export function isAutoSummarizeEnabled(): boolean {
  return getSetting('reading.auto_summarize') === 'on'
}

/**
 * Re-enqueue articles whose pending markers survived a restart or a failed
 * attempt. Called at the start of every fetch cycle; only markers older than
 * the backoff window are retried, in bounded batches.
 */
export function resumePendingAiTasks(): void {
  const translateOn = isAutoTranslateEnabled()
  const summarizeOn = isAutoSummarizeEnabled()
  if (!translateOn && !summarizeOn) return

  const cutoff = new Date(Date.now() - RESUME_MIN_AGE_MS).toISOString()
  const rows = getDb().prepare(`
    SELECT id, translate_pending_at, summarize_pending_at
    FROM active_articles
    WHERE (translate_pending_at IS NOT NULL AND translate_pending_at < ?)
       OR (summarize_pending_at IS NOT NULL AND summarize_pending_at < ?)
    LIMIT ?
  `).all(cutoff, cutoff, RESUME_BATCH_LIMIT) as Array<{
    id: number
    translate_pending_at: string | null
    summarize_pending_at: string | null
  }>

  let resumed = 0
  for (const row of rows) {
    if (translateOn && row.translate_pending_at && row.translate_pending_at < cutoff) {
      enqueue('translate', row.id, { skipMark: true })
      resumed++
    }
    if (summarizeOn && row.summarize_pending_at && row.summarize_pending_at < cutoff) {
      enqueue('summarize', row.id, { skipMark: true })
      resumed++
    }
  }
  if (resumed > 0) {
    log.info(`resumed ${resumed} pending AI tasks`)
  }
}

/**
 * Fire-and-forget title translation, used after a manual translation so the
 * list title matches the translated article. Uses the configured provider.
 */
export function translateArticleTitle(articleId: number): void {
  void (async () => {
    try {
      const article = getArticleById(articleId)
      if (!article?.title) return
      const result = await translateTitle(article.title)
      if (result.titleTranslated.trim()) {
        updateArticleContent(articleId, { title_translated: result.titleTranslated })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`title translation failed for article ${articleId}: ${msg}`)
    }
  })()
}

/** @internal test helper */
export function _resetAiQueueForTests(): void {
  queue.length = 0
  pending.clear()
  concurrencyLimit = 1
  semaphore = new Semaphore(1)
  draining = false
}
