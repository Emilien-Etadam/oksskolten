import {
  countStaleArticlesByFeed,
  getArticlesNeedingRefresh,
  getExistingArticleUrls,
  markArticleRefreshAttempted,
  normalizeUrl,
  updateArticleContent,
  updateFeedError,
  updateFeedRateLimit,
  updateFeedCacheHeaders,
  updateFeedSchedule,
  type Feed,
} from '../db.js'

import { errorMessage } from '../fetcher/util.js'
import { convertHtmlToMarkdown, markdownToExcerpt, MIN_EXTRACTED_LENGTH } from '../fetcher/content.js'
import { fetchAndParseRss } from '../fetcher/rss/fetch.js'
import { type FetchRssResult, type RssItem, RateLimitError } from '../fetcher/rss/types.js'
import { isGoogleNewsUrl } from '../fetcher/google-news.js'
import { computeInterval, computeEmpiricalInterval, sqliteFuture, DEFAULT_INTERVAL } from '../fetcher/schedule.js'
import { isRemovedRedditPost } from '../fetcher/reddit.js'
import { logger } from '../logger.js'
import type { NewArticle } from './tasks.js'

const log = logger.child('fetcher')

/**
 * Replace garbage-extracted articles with the RSS excerpt when one is now
 * available. Some sites (thin SPAs like essay.ink) return so little body
 * HTML that Readability falls back to the OG title alone, leaving stored
 * `full_text` as just a handful of characters. The new-article path
 * already handles this via the `listingExcerpt` fallback in
 * `fetchArticleContent`, but articles saved before that fallback existed,
 * or saved when the RSS excerpt was temporarily missing, stay broken
 * indefinitely because the retry queue only picks up rows with
 * `last_error` set.
 *
 * Piggyback on every regular RSS fetch: for items still in the current
 * feed whose stored body is shorter than `MIN_EXTRACTED_LENGTH`, swap in
 * the markdown-converted RSS excerpt when it's larger than what's stored.
 */
const GOOGLE_NEWS_LINK_ONLY_ERROR = 'Stored body was the Google News link, not the article'

function refreshStaleArticles(feedId: number, rssItems: RssItem[]): void {
  const refreshCandidates = getArticlesNeedingRefresh(feedId, MIN_EXTRACTED_LENGTH)
  if (refreshCandidates.length === 0) return
  // Match RSS items against candidate articles using the same URL
  // normalization the rest of the DB layer uses. Without this, a RSS item
  // with a raw Unicode path won't line up with a stored article whose URL
  // is percent-encoded (or vice versa) and the article would incorrectly
  // be treated as rolled off the feed.
  const itemsByUrl = new Map(rssItems.map(i => [normalizeUrl(i.url), i]))
  const now = new Date().toISOString()
  for (const candidate of refreshCandidates) {
    const currentLen = (candidate.full_text ?? '').replace(/\s+/g, ' ').trim().length

    // A Google News description is only a link back to the wrapper, never a
    // body. Articles stored before that was taken into account hold exactly
    // that link as their text, with no error to put them in the retry queue.
    // Drop the fake body and set the error so the retry pass fetches the
    // publisher's page for real.
    if (isGoogleNewsUrl(candidate.url)) {
      if (candidate.full_text !== null) {
        updateArticleContent(candidate.id, {
          full_text: null,
          excerpt: null,
          summary: null,
          full_text_translated: null,
          translated_lang: null,
          last_error: GOOGLE_NEWS_LINK_ONLY_ERROR,
          last_refresh_attempt_at: now,
        })
        log.info({ url: candidate.url, prevLen: currentLen }, 'queued Google News article stored without a body for retry')
      } else {
        markArticleRefreshAttempted(candidate.id, now)
      }
      continue
    }

    const rssItem = itemsByUrl.get(normalizeUrl(candidate.url))
    const md = rssItem?.excerpt ? convertHtmlToMarkdown(rssItem.excerpt) : ''
    const mdLen = md.replace(/\s+/g, ' ').trim().length

    if (md && mdLen > currentLen) {
      updateArticleContent(candidate.id, {
        full_text: md,
        excerpt: markdownToExcerpt(md),
        // The old full_text was garbage, so any derived summary or
        // translation produced from it is also garbage. Clear them so
        // the UI / chat tools regenerate on next access.
        summary: null,
        full_text_translated: null,
        translated_lang: null,
        last_refresh_attempt_at: now,
      })
      log.info({ url: candidate.url, prevLen: currentLen, newLen: mdLen }, 'refreshed stale article with RSS excerpt')
    } else {
      // Couldn't improve this one (no RSS excerpt, or excerpt no longer in
      // the current feed). Record the attempt so the backoff window kicks
      // in and we don't keep bypassing the RSS HTTP cache for this feed
      // indefinitely. Use the lightweight helper so we don't trigger a
      // Meilisearch resync for a no-op update.
      markArticleRefreshAttempted(candidate.id, now)
    }
  }
}

export type FeedTasksResult =
  | { status: 'ok'; tasks: NewArticle[]; itemCount: number }
  | { status: 'not-modified' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string }

export async function collectFeedTasks(
  feed: Feed,
  opts?: { skipCache?: boolean },
): Promise<FeedTasksResult> {
  let rssResult: FetchRssResult
  try {
    // Bypass HTTP cache if this feed still has stale garbage-extracted
    // articles. RSS XML is often unchanged for old items, so a 304 / cache
    // hit would skip the refresh path and the broken articles would never
    // get a chance to be repaired.
    const skipCache = opts?.skipCache || countStaleArticlesByFeed(feed.id, MIN_EXTRACTED_LENGTH) > 0
    rssResult = await fetchAndParseRss(feed, { ...opts, skipCache })
    updateFeedError(feed.id, null)
    updateFeedCacheHeaders(feed.id, rssResult.etag, rssResult.lastModified, rssResult.contentHash)
  } catch (err) {
    if (err instanceof RateLimitError) {
      log.warn(`Feed ${feed.name}: ${err.message}`)
      updateFeedRateLimit(feed.id, err.retryAfterSeconds)
      return { status: 'rate-limited' }
    }
    const msg = errorMessage(err)
    log.error(`Feed ${feed.name}: ${msg}`)
    updateFeedError(feed.id, msg)
    return { status: 'error', message: msg }
  }

  if (rssResult.notModified) {
    // Reschedule using stored interval (or default)
    const interval = feed.check_interval ?? DEFAULT_INTERVAL
    updateFeedSchedule(feed.id, sqliteFuture(interval), interval)
    log.info(`Feed ${feed.name}: not modified (304)`)
    return { status: 'not-modified' }
  }

  // Compute and store adaptive interval
  {
    const empirical = computeEmpiricalInterval(rssResult.items)
    const interval = computeInterval(rssResult.httpCacheSeconds, rssResult.rssTtlSeconds, empirical)
    updateFeedSchedule(feed.id, sqliteFuture(interval), interval)
  }

  const urls = rssResult.items.map(i => i.url)
  const existing = getExistingArticleUrls(urls)
  refreshStaleArticles(feed.id, rssResult.items)

  const removedRedditPosts = rssResult.items.filter(item => isRemovedRedditPost(item.url, item.title))
  if (removedRedditPosts.length > 0) {
    log.info(`Feed ${feed.name}: skipping ${removedRedditPosts.length} removed Reddit post(s)`)
  }

  const tasks: NewArticle[] = rssResult.items
    // Reddit keeps removed posts in the feed with a placeholder title and a
    // removal notice for a body — nothing worth storing or reading.
    .filter(item => !existing.has(item.url) && !isRemovedRedditPost(item.url, item.title))
    .map(item => ({
      kind: 'new' as const,
      feed_id: feed.id,
      title: item.title,
      url: item.url,
      published_at: item.published_at,
      requires_js_challenge: !!feed.requires_js_challenge,
      excerpt: item.excerpt,
    }))

  return { status: 'ok', tasks, itemCount: rssResult.items.length }
}
