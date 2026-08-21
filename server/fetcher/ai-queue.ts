import { getSetting } from '../db.js'
import { getDb } from '../db/connection.js'
import { getArticleById, updateArticleContent, updateScore } from '../db/articles.js'
import { getFeedById } from '../db/feeds.js'
import { translateArticle, translateTitle, summarizeArticle, evaluateArticleRelevance } from './ai.js'
import { Semaphore } from './util.js'
import { logger } from '../logger.js'
import { DEFAULT_LANGUAGE } from '../../shared/lang.js'
import type { ArticleDetail } from '../../shared/types.js'

const log = logger.child('ai-queue')

export type AiQueueTask = 'translate' | 'summarize' | 'filter'

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

export type AutoTranslateScope = 'full' | 'titles'

/**
 * Whether auto-translate does the full body ('full', the original behavior)
 * or only the title ('titles') — cheaper and faster, and the only option
 * that still helps once an article's body has failed to extract.
 */
export function getAutoTranslateScope(): AutoTranslateScope {
  return getSetting('reading.auto_translate_scope') === 'titles' ? 'titles' : 'full'
}

function ensureSemaphore(): Semaphore {
  const max = getConcurrency()
  if (max !== concurrencyLimit) {
    concurrencyLimit = max
    semaphore = new Semaphore(max)
  }
  return semaphore
}

const PENDING_COLUMN: Record<AiQueueTask, 'translate_pending_at' | 'summarize_pending_at' | 'filter_pending_at'> = {
  translate: 'translate_pending_at',
  summarize: 'summarize_pending_at',
  filter: 'filter_pending_at',
}

function markPending(task: AiQueueTask, articleId: number, value: string | null): void {
  updateArticleContent(articleId, { [PENDING_COLUMN[task]]: value })
}

/** Text the relevance check sees: enough to judge, short enough to stay cheap. */
const FILTER_TEXT_MAX_CHARS = 1500

async function processFilter(item: QueueItem): Promise<void> {
  const article = getArticleById(item.articleId)
  if (!article) return

  const criterion = article.feed_id ? getFeedById(article.feed_id)?.ai_filter : null
  if (!criterion?.trim() || article.filtered_at) {
    markPending('filter', item.articleId, null)
    return
  }

  const body = article.summary || article.full_text || article.excerpt || ''
  const text = `${article.title}\n\n${body}`.slice(0, FILTER_TEXT_MAX_CHARS)

  const { keep } = await evaluateArticleRelevance(text, criterion, { provider: 'vllm' })
  updateArticleContent(item.articleId, {
    filter_pending_at: null,
    ...(keep ? {} : { filtered_at: nowIso() }),
  })
  if (!keep) {
    log.info(`ai-filter hid article ${item.articleId} ("${article.title.slice(0, 60)}")`)
  }
}

/**
 * Translate only the title. Used when the scope setting is 'titles', and
 * whichever branch of processTranslate() runs, the completion state it
 * leaves behind (translated_lang + title_translated, full_text_translated
 * untouched) is what lets a later switch to 'full' scope detect the body
 * still needs translating, and a later switch back to 'titles' detect the
 * title is already done.
 */
async function translateTitleOnly(item: QueueItem, article: ArticleDetail): Promise<void> {
  const t = await translateTitle(article.title, { provider: 'vllm' })
  if (!t.titleTranslated.trim()) {
    log.warn(`auto-translate (title) returned empty text for article ${item.articleId}, will retry later`)
    markPending('translate', item.articleId, nowIso())
    return
  }

  updateArticleContent(item.articleId, {
    title_translated: t.titleTranslated,
    translated_lang: item.targetLang,
    translate_pending_at: null,
  })
  updateScore(item.articleId)
  log.info(`auto-translate (title only) complete for article ${item.articleId} (${item.targetLang})`)
}

async function processTranslate(item: QueueItem): Promise<void> {
  const article = getArticleById(item.articleId)
  if (!article?.full_text || article.lang === item.targetLang) {
    markPending('translate', item.articleId, null)
    return
  }

  const scope = getAutoTranslateScope()
  const alreadyDone = article.translated_lang === item.targetLang
    && (scope === 'titles' ? !!article.title_translated : !!article.full_text_translated)
  if (alreadyDone) {
    markPending('translate', item.articleId, null)
    return
  }

  if (scope === 'titles') {
    await translateTitleOnly(item, article)
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
    } else if (item.task === 'summarize') {
      await processSummarize(item)
    } else {
      await processFilter(item)
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

/**
 * Queue the relevance check for a new article. No-op unless its feed carries a
 * filter criterion.
 */
export function enqueueAiFilter(articleId: number, feedId: number): void {
  if (!getFeedById(feedId)?.ai_filter?.trim()) return
  enqueue('filter', articleId)
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

  const cutoff = new Date(Date.now() - RESUME_MIN_AGE_MS).toISOString()
  const rows = getDb().prepare(`
    SELECT id, translate_pending_at, summarize_pending_at, filter_pending_at
    FROM active_articles
    WHERE (translate_pending_at IS NOT NULL AND translate_pending_at < ?)
       OR (summarize_pending_at IS NOT NULL AND summarize_pending_at < ?)
       OR (filter_pending_at IS NOT NULL AND filter_pending_at < ?)
    LIMIT ?
  `).all(cutoff, cutoff, cutoff, RESUME_BATCH_LIMIT) as Array<{
    id: number
    translate_pending_at: string | null
    summarize_pending_at: string | null
    filter_pending_at: string | null
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
    // The filter has no global toggle: it runs whenever a feed defines a criterion
    if (row.filter_pending_at && row.filter_pending_at < cutoff) {
      enqueue('filter', row.id, { skipMark: true })
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
