import {
  getEnabledFeeds,
  getRetryArticles,
  getRetryStats,
  updateArticleContent,
  type Feed,
} from './db.js'

import { Semaphore, CONCURRENCY } from './fetcher/util.js'
import { type FetchProgressEvent, emitProgress, markFeedDone } from './fetcher/progress.js'
import { resumePendingAiTasks } from './fetcher/ai-queue.js'
import { sweepAutoArchiveFeeds } from './fetcher/article-images.js'
import { logger } from './logger.js'
import { collectFeedTasks } from './ingest/feed-loop.js'
import { processArticle } from './ingest/index.js'
import type { ArticleTask } from './ingest/tasks.js'

const log = logger.child('fetcher')

// --- Re-exports (preserve existing import sites) ---
export { normalizeDate } from './fetcher/util.js'
export { type FetchProgressEvent, fetchProgress, getFeedState } from './fetcher/progress.js'
export { discoverRssUrl } from './fetcher/rss.js'
export { detectLanguage, summarizeArticle, streamSummarizeArticle, translateArticle, streamTranslateArticle } from './fetcher/ai.js'
export type { AiTextResult, AiBillingMode } from './fetcher/ai.js'
export { fetchArticleContent, type FetchedContent, enrichArticle, clipContext } from './ingest/index.js'

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
