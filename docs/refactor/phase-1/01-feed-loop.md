# 01 — Extract the feed loop (one copy) and fix the removed-Reddit gap

Read `00-context.md` first.

## Goal

`server/fetcher.ts` runs the same "RSS → list of new-article tasks" sequence twice:

- `fetchSingleFeed`, lines 322–437 (manual refresh from the UI, `/re-detect`)
- `fetchAllFeeds`, lines 438–596, "Phase A" block inside the per-feed semaphore

Extract that sequence into **one** function in a new file, make both callers use it,
and fix the one difference between the copies, which is a bug.

## The bug to fix

`fetchSingleFeed` drops Reddit posts whose body is a removal notice
(`isRemovedRedditPost`, lines 370–378). `fetchAllFeeds` does not (line 481:
`.filter(item => !existing.has(item.url))`). The cron therefore ingests the posts the
manual refresh refuses. After this commit both paths behave like `fetchSingleFeed`.

## What to write

### `server/ingest/tasks.ts`

Move the task types out of `server/fetcher.ts` (lines 229–245) verbatim and export
them:

```ts
export interface NewArticle { kind: 'new'; feed_id: number; title: string; url: string; published_at: string | null; requires_js_challenge?: boolean; excerpt?: string }
export interface RetryArticle { kind: 'retry'; article: Article }
export type ArticleTask = NewArticle | RetryArticle
export type TaskKind = ArticleTask['kind']
```

Keep the existing doc comments on the fields. (`ClipArticle` is added in commit 03,
not now.)

### `server/ingest/feed-loop.ts`

```ts
export type FeedTasksResult =
  | { status: 'ok'; tasks: NewArticle[]; itemCount: number }
  | { status: 'not-modified' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string }

export async function collectFeedTasks(
  feed: Feed,
  opts?: { skipCache?: boolean },
): Promise<FeedTasksResult>
```

Its body is the sequence both callers share today, in this exact order:

1. `skipCache = opts?.skipCache || countStaleArticlesByFeed(feed.id, MIN_EXTRACTED_LENGTH) > 0`
2. `fetchAndParseRss(feed, { ...opts, skipCache })`; on success
   `updateFeedError(feed.id, null)` then `updateFeedCacheHeaders(...)`.
   On `RateLimitError`: `log.warn`, `updateFeedRateLimit`, return `rate-limited`.
   On any other error: `log.error`, `updateFeedError(feed.id, msg)`, return `error`.
3. `notModified` → reschedule with the stored interval (`feed.check_interval ?? DEFAULT_INTERVAL`),
   `log.info(... not modified (304))`, return `not-modified`.
4. Adaptive interval: `computeEmpiricalInterval`, `computeInterval`, `updateFeedSchedule`.
5. `getExistingArticleUrls(urls)`, then `refreshStaleArticles(feed.id, rssResult.items)`.
   Move `refreshStaleArticles` (lines 65–128) and its constant
   `GOOGLE_NEWS_LINK_ONLY_ERROR` into this file verbatim; it is only used here.
6. Removed-Reddit filter with its `log.info` line, then the `.filter(...).map(...)`
   that builds `NewArticle` tasks. Both copies build the task the same way; keep it.

The log lines keep their current text; `server/fetcher.test.ts` asserts on some of
them.

### Callers

- `fetchSingleFeed`: replace the block from `let rssResult: FetchRssResult` (line 329)
  through the `.map(...)` that builds `tasks` (line 388) with one call to `collectFeedTasks(feed, opts)`
  and a `switch` on `status`. `rate-limited`, `error` and `not-modified` return
  early exactly as today (they already did the DB writes and logs inside the loop).
  `ok` with zero tasks keeps the "no new articles" log and the `sweepAutoArchiveFeeds`
  call. Everything from `const total = tasks.length` down is unchanged.
- `fetchAllFeeds`: replace the `try { … } catch` inside the Phase A semaphore
  (lines 455–494) with the same call. `not-modified` sets `feedNewCounts.set(feed.id, 0)`
  and returns, as today. `ok` pushes the tasks and sets the count. `rate-limited` and
  `error` just return (the writes and logs already happened).

Remove from `server/fetcher.ts` every import that only the moved code used.

## Tests

- `server/ingest/feed-loop.test.ts`: cover the four statuses and the stale-article
  refresh. Reuse the patterns of `server/fetcher.test.ts` (it mocks `feedsmith` and
  `./fetcher/flaresolverr.js` and uses `setupTestDb`); look at how it builds a feed
  and serves RSS before writing yours.
- Add to `server/fetcher.test.ts` two tests proving the fix, one through
  `fetchSingleFeed` and one through `fetchAllFeeds`: a feed whose RSS contains a
  removed Reddit post must not insert that post. `isRemovedRedditPost` lives in
  `server/fetcher/reddit.ts`; its test at `server/fetcher/reddit.test.ts` line 246
  shows a qualifying URL and title. Today only the predicate is unit-tested; neither
  entry point has a test for it, and the `fetchAllFeeds` one fails before your change.

## Acceptance

- `server/fetcher.ts` no longer contains `refreshStaleArticles`, the task interfaces,
  nor any call to `fetchAndParseRss`, `computeInterval`, `getExistingArticleUrls`,
  `isRemovedRedditPost`.
- `grep -n "isRemovedRedditPost" server/ingest/feed-loop.ts` shows exactly one
  filter site used by both entry points.
- Typecheck, lint and `vitest --project server` pass; the pre-existing 124 tests of
  `server/fetcher.test.ts` are unmodified.

Commit: `refactor(ingest): extract the feed loop shared by cron and manual refresh`
with a body that names the removed-Reddit fix.
