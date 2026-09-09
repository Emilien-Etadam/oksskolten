import {
  getEnabledFeeds,
  getRetryArticles,
  getRetryStats,
  getSetting,
  insertArticle,
  setArticleQuality,
  updateArticleContent,
  type Feed,
} from './db.js'

import { Semaphore, CONCURRENCY, errorMessage } from './fetcher/util.js'
import { detectAndStoreSimilarArticles } from './similarity.js'
import { applyRulesToArticle } from './rules.js'
import { scoreArticleQuality } from './quality.js'
import { scoreNewArticle } from './interests.js'
import { type FetchProgressEvent, emitProgress, markFeedDone } from './fetcher/progress.js'
import { fetchFullText, isBotBlockPage, convertHtmlToMarkdown, markdownToExcerpt, ensureLeadImage, MIN_EXTRACTED_LENGTH } from './fetcher/content.js'
import { isGoogleNewsUrl } from './fetcher/google-news.js'
import { DEFAULT_LANGUAGE } from '../shared/lang.js'
import { detectLanguage } from './fetcher/ai.js'
import { enqueueAutoTranslate, enqueueAutoSummarize, enqueueAiFilter, isAutoTranslateEnabled, isAutoSummarizeEnabled, resumePendingAiTasks } from './fetcher/ai-queue.js'
import { sweepAutoArchiveFeeds } from './fetcher/article-images.js'
import { logger } from './logger.js'
import { collectFeedTasks } from './ingest/feed-loop.js'
import type { ArticleTask } from './ingest/tasks.js'

const log = logger.child('fetcher')

// --- Re-exports (preserve existing import sites) ---
export { normalizeDate } from './fetcher/util.js'
export { type FetchProgressEvent, fetchProgress, getFeedState } from './fetcher/progress.js'
export { discoverRssUrl } from './fetcher/rss.js'
export { detectLanguage, summarizeArticle, streamSummarizeArticle, translateArticle, streamTranslateArticle } from './fetcher/ai.js'
export type { AiTextResult, AiBillingMode } from './fetcher/ai.js'

// --- Article content fetching (shared by feed pipeline & clip) ---

export interface FetchedContent {
  fullText: string | null
  ogImage: string | null
  excerpt: string | null
  lang: string | null
  lastError: string | null
  /** Title extracted by fetchFullText (from OGP etc.) */
  title: string | null
}

export async function fetchArticleContent(
  url: string,
  options?: {
    requiresJsChallenge?: boolean
    /** CSS Bridge listing-page excerpt, used as fullText fallback */
    listingExcerpt?: string
    /** Existing article data for retry (skips fetch if a real body is already stored) */
    existingArticle?: { full_text: string | null; og_image: string | null; lang: string | null }
  },
): Promise<FetchedContent> {
  let fullText: string | null = null
  let ogImage: string | null = null
  let excerpt: string | null = null
  let lang: string | null = null
  let lastError: string | null = null
  let title: string | null = null

  const existing = options?.existingArticle

  // Step 1: Fetch full text (skip if retry article already has a real body).
  // A handful of shell chrome is not a body: it is what a Hugging Face Space
  // leaves behind when the iframe hop fails, and skipping the fetch would
  // freeze that chrome in place.
  const isAnchorLink = url.includes('#')
  const existingBodyLen = existing?.full_text?.replace(/\s+/g, ' ').trim().length ?? 0

  if (existing && existingBodyLen >= MIN_EXTRACTED_LENGTH) {
    fullText = existing.full_text
    ogImage = existing.og_image
  } else if (isAnchorLink && options?.listingExcerpt) {
    fullText = convertHtmlToMarkdown(options.listingExcerpt)
    excerpt = markdownToExcerpt(fullText)
  } else {
    try {
      const result = await fetchFullText(url, { requiresJsChallenge: options?.requiresJsChallenge })
      fullText = result.fullText
      ogImage = result.ogImage
      excerpt = result.excerpt
      title = result.title
    } catch (err) {
      lastError = `fetchFullText: ${errorMessage(err)}`
    }
  }

  // Fallback: use RSS inline content when page fetch failed, returned bot-block page,
  // or extracted text is too short (e.g. SPA sites where content is in display:none for SEO).
  // This is the last resort after fetchFullText and its internal FlareSolverr retry
  // (which also uses MIN_EXTRACTED_LENGTH) have both failed to produce enough content.
  //
  // Not for Google News items: their description is a link to the wrapper
  // plus the publisher's name. Storing that as the body would clear the
  // error and freeze the article, when a retry could still reach the page.
  if (options?.listingExcerpt && !isGoogleNewsUrl(url)) {
    const extractedLen = fullText?.replace(/\s+/g, ' ').trim().length ?? 0
    const shouldFallback = !fullText || isBotBlockPage(fullText) || extractedLen < MIN_EXTRACTED_LENGTH
    if (shouldFallback) {
      const md = convertHtmlToMarkdown(options.listingExcerpt)
      const mdLen = md.replace(/\s+/g, ' ').trim().length
      // Only use RSS content if it's more substantial than what we extracted
      if (mdLen > extractedLen) {
        log.info({ url, extractedLen, rssLen: mdLen }, 'using RSS feed content as fallback')
        fullText = md
        excerpt = markdownToExcerpt(md)
        lastError = null
      }
    }
  }

  // Step 2: Detect language (local, no API call)
  if (fullText && !(existing?.lang)) {
    lang = detectLanguage(fullText)
  } else if (existing) {
    lang = existing.lang
  }

  // Step 3: Hero-image fallback — restore a lead image the extraction lost.
  // Only for bodies that already pass the length bar: prepending a markdown
  // image inflates full_text length, which would otherwise mask a too-short
  // extraction from the stale-article repair loop (countStaleArticlesByFeed).
  if (fullText && fullText.replace(/\s+/g, ' ').trim().length >= MIN_EXTRACTED_LENGTH) {
    fullText = ensureLeadImage(fullText, ogImage, url)
  }

  return { fullText, ogImage, excerpt, lang, lastError, title }
}

// --- Article processing ---

function maybeEnqueueAutoTranslate(
  articleId: number,
  fullText: string | null,
  lang: string | null,
): void {
  if (fullText && isAutoSummarizeEnabled()) {
    enqueueAutoSummarize(articleId, fullText)
  }
  if (!isAutoTranslateEnabled() || !fullText || !lang || lang === 'unknown') return
  const targetLang = getSetting('translate.target_lang') || getSetting('general.language') || DEFAULT_LANGUAGE
  if (lang === targetLang) return
  enqueueAutoTranslate(articleId, fullText)
}

/** Returns true if the retry article still has an error after processing. */
async function processArticle(task: ArticleTask): Promise<boolean> {
  const articleUrl = task.kind === 'new' ? task.url : task.article.url

  const content = await fetchArticleContent(articleUrl, {
    requiresJsChallenge: task.kind === 'new' ? task.requires_js_challenge : undefined,
    listingExcerpt: task.kind === 'new' ? task.excerpt : undefined,
    existingArticle: task.kind === 'retry' ? task.article : undefined,
  })

  const effectiveLang = content.lang || (task.kind === 'retry' ? task.article.lang : null)

  // Persist
  if (task.kind === 'new') {
    try {
      const articleId = insertArticle({
        feed_id: task.feed_id,
        title: task.title,
        url: task.url,
        published_at: task.published_at,
        lang: effectiveLang,
        full_text: content.fullText,
        full_text_translated: null,
        summary: null,
        excerpt: content.excerpt,
        og_image: content.ogImage,
        last_error: content.lastError,
      })
      setArticleQuality(articleId, scoreArticleQuality({ title: task.title, text: content.fullText, url: task.url }).score)
      scoreNewArticle(articleId, task.title)
      applyRulesToArticle(articleId, task.feed_id, { title: task.title, url: task.url, content: content.fullText })
      maybeEnqueueAutoTranslate(articleId, content.fullText, effectiveLang)
      enqueueAiFilter(articleId, task.feed_id)
      // Fire-and-forget: detect similar articles asynchronously
      void detectAndStoreSimilarArticles(articleId, task.title, task.feed_id, task.published_at, task.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('UNIQUE constraint failed')) {
        log.warn(`insertArticle failed for ${task.url}: ${msg}`)
      }
    }
  } else {
    updateArticleContent(task.article.id, {
      lang: effectiveLang,
      full_text: content.fullText,
      excerpt: content.excerpt,
      og_image: content.ogImage,
      last_error: content.lastError,
    })
    // A repaired body changes the quality verdict
    if (content.fullText) {
      setArticleQuality(task.article.id, scoreArticleQuality({ title: task.article.title, text: content.fullText, url: task.article.url }).score)
    }
    maybeEnqueueAutoTranslate(task.article.id, content.fullText, effectiveLang)
  }
  const extractedLen = content.fullText?.replace(/\s+/g, ' ').trim().length ?? 0
  return !!content.lastError || (task.kind === 'retry' && extractedLen < MIN_EXTRACTED_LENGTH)
}

// --- Single feed fetch ---

export async function fetchSingleFeed(
  feed: Feed,
  onProgress?: (event: FetchProgressEvent) => void,
  opts?: { skipCache?: boolean },
): Promise<void> {
  const semaphore = new Semaphore(CONCURRENCY)

  const collected = await collectFeedTasks(feed, opts)
  switch (collected.status) {
    case 'rate-limited':
    case 'error':
    case 'not-modified':
      return
  }
  const tasks = collected.tasks

  if (tasks.length === 0) {
    log.info(`Feed ${feed.name}: no new articles`)
    void sweepAutoArchiveFeeds(feed.id)
    return
  }

  const total = tasks.length
  let fetched = 0

  const foundEvent: FetchProgressEvent = { type: 'feed-articles-found', feed_id: feed.id, total }
  emitProgress(foundEvent)
  onProgress?.(foundEvent)

  log.info(`Feed ${feed.name}: processing ${total} articles`)
  await Promise.all(
    tasks.map(task =>
      semaphore.run(async () => {
        try {
          await processArticle(task)
          if (task.kind === 'new') {
            fetched++
            const doneEvent: FetchProgressEvent = { type: 'article-done', feed_id: feed.id, fetched, total }
            emitProgress(doneEvent)
            onProgress?.(doneEvent)
          }
        } catch (err) {
          log.error('Article error:', err)
          if (task.kind === 'new') {
            fetched++
            const doneEvent: FetchProgressEvent = { type: 'article-done', feed_id: feed.id, fetched, total }
            emitProgress(doneEvent)
            onProgress?.(doneEvent)
          }
        }
      }),
    ),
  )

  const completeEvent: FetchProgressEvent = { type: 'feed-complete', feed_id: feed.id }
  markFeedDone(feed.id)
  emitProgress(completeEvent)
  onProgress?.(completeEvent)

  void sweepAutoArchiveFeeds(feed.id)
  log.info(`Feed ${feed.name}: done`)
}

// --- Main entry point ---

export async function fetchAllFeeds(
  onProgress?: (event: FetchProgressEvent) => void,
): Promise<void> {
  // Recover queued AI work that survived a restart or a failed attempt
  resumePendingAiTasks()
  const feeds = getEnabledFeeds()
  const semaphore = new Semaphore(CONCURRENCY)

  const allTasks: ArticleTask[] = []

  // Phase A: Fetch RSS for each feed and collect new articles (per-feed limit)
  // Track new article counts per feed for progress events
  const feedNewCounts = new Map<number, number>()

  await Promise.all(
    feeds.map(feed =>
      semaphore.run(async () => {
        const collected = await collectFeedTasks(feed)
        switch (collected.status) {
          case 'not-modified':
            feedNewCounts.set(feed.id, 0)
            return
          case 'ok':
            allTasks.push(...collected.tasks)
            feedNewCounts.set(feed.id, collected.tasks.length)
            return
          case 'rate-limited':
          case 'error':
            return
        }
      }),
    ),
  )

  // Phase B: Add retry candidates with backoff
  const retryStats = getRetryStats()
  if (retryStats.eligible > 0 || retryStats.backoff_waiting > 0 || retryStats.exceeded > 0) {
    log.info(`Retry: ${retryStats.eligible} eligible, ${retryStats.backoff_waiting} backoff-waiting, ${retryStats.exceeded} exceeded max attempts`)
  }
  const retryArticles = getRetryArticles()
  for (const article of retryArticles) {
    updateArticleContent(article.id, { last_retry_at: new Date().toISOString() })
    allTasks.push({ kind: 'retry', article })
  }

  if (allTasks.length === 0) {
    log.info('No articles to process')
    void sweepAutoArchiveFeeds()
    return
  }

  const newCount = allTasks.filter(t => t.kind === 'new').length
  const retryCount = allTasks.filter(t => t.kind === 'retry').length
  log.info(
    `Processing ${allTasks.length} articles (${newCount} new, ${retryCount} retry)`,
  )

  // Emit feed-articles-found for each feed with new articles
  for (const [feedId, count] of feedNewCounts) {
    if (count > 0) {
      const event: FetchProgressEvent = { type: 'feed-articles-found', feed_id: feedId, total: count }
      emitProgress(event)
      onProgress?.(event)
    }
  }

  // Phase C: Process each article with semaphore
  // Per-feed counters for progress (only count 'new' articles)
  const feedFetchedCounts = new Map<number, number>()
  const processingSemaphore = new Semaphore(CONCURRENCY)
  await Promise.all(
    allTasks.map(task =>
      processingSemaphore.run(async () => {
        let retryFailed = false
        try {
          retryFailed = await processArticle(task)
        } catch (err) {
          log.error('Article error:', err)
          retryFailed = true
          if (task.kind === 'retry') {
            const msg = err instanceof Error ? err.message : String(err)
            updateArticleContent(task.article.id, {
              last_error: msg,
            })
          }
        }
        // Single place where retry_count is incremented — covers both
        // the returned-error path and the thrown-exception path.
        if (task.kind === 'retry' && retryFailed) {
          updateArticleContent(task.article.id, {
            retry_count: (task.article.retry_count ?? 0) + 1,
          })
        }
        if (task.kind === 'new') {
          const feedId = task.feed_id
          const prev = feedFetchedCounts.get(feedId) ?? 0
          const fetched = prev + 1
          feedFetchedCounts.set(feedId, fetched)
          const total = feedNewCounts.get(feedId) ?? 0
          const event: FetchProgressEvent = { type: 'article-done', feed_id: feedId, fetched, total }
          emitProgress(event)
          onProgress?.(event)
        }
      }),
    ),
  )

  // Emit feed-complete for each feed
  for (const [feedId, count] of feedNewCounts) {
    if (count > 0) {
      markFeedDone(feedId)
      const event: FetchProgressEvent = { type: 'feed-complete', feed_id: feedId }
      emitProgress(event)
      onProgress?.(event)
    }
  }

  // Archive images for feeds flagged archive_images, now that this cycle's
  // articles are stored. Fire-and-forget: downloads must not hold up the batch.
  void sweepAutoArchiveFeeds()

  log.info('Batch complete')
}
