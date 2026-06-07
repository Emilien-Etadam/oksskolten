import { getSetting } from '../db.js'
import { getArticleById, updateArticleContent, updateScore } from '../db/articles.js'
import { translateArticle } from './ai.js'
import { Semaphore } from './util.js'
import { logger } from '../logger.js'
import { DEFAULT_LANGUAGE } from '../../shared/lang.js'

const log = logger.child('translate-queue')

export interface TranslateQueueItem {
  articleId: number
  fullText: string
  targetLang: string
}

const queue: TranslateQueueItem[] = []
const pending = new Set<number>()
let concurrencyLimit = 1
let semaphore = new Semaphore(1)
let draining = false

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

async function processItem(item: TranslateQueueItem): Promise<void> {
  try {
    const article = getArticleById(item.articleId)
    if (!article?.full_text) return
    if (article.translated_lang === item.targetLang && article.full_text_translated) return
    if (article.lang === item.targetLang) return

    const result = await translateArticle(article.full_text, { provider: 'vllm' })
    updateArticleContent(item.articleId, {
      full_text_translated: result.fullTextTranslated,
      translated_lang: item.targetLang,
    })
    updateScore(item.articleId)
    log.info({ articleId: item.articleId, targetLang: item.targetLang }, 'auto-translate complete')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ articleId: item.articleId, err: msg }, 'auto-translate failed')
  } finally {
    pending.delete(item.articleId)
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

export function enqueueAutoTranslate(articleId: number, fullText: string): void {
  if (getSetting('reading.auto_translate') !== 'on') return
  if (!fullText?.trim()) return
  if (pending.has(articleId)) return

  const targetLang = getTargetLang()
  pending.add(articleId)
  queue.push({ articleId, fullText, targetLang })
  void drainQueue()
}

export function isAutoTranslateEnabled(): boolean {
  return getSetting('reading.auto_translate') === 'on'
}

/** @internal test helper */
export function _resetTranslateQueueForTests(): void {
  queue.length = 0
  pending.clear()
  concurrencyLimit = 1
  semaphore = new Semaphore(1)
  draining = false
}
