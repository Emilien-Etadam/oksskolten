# Phase 1 — Ingestion pipeline: shared context

Read this file before any of the numbered prompts in this directory. Each numbered
prompt is one commit. Do them in order; each one leaves the tree green.

## Why

`server/fetcher.ts` (596 lines) is the file every feature bolts onto. It holds two
copies of the feed loop (`fetchSingleFeed` for a manual refresh, `fetchAllFeeds` for
the cron) and one `processArticle` where enrichment is a hard-coded list of calls:
quality score, interest score, rules, AI queue, AI filter, similarity. Adding a
feature means editing this file in three places. The duplication has already cost
one bug: the cron path never filters removed Reddit posts (only the manual path does).

The clip endpoint (`POST /api/articles/from-url`) calls `fetchArticleContent` and then
inserts on its own, so clipped articles get none of the enrichment.

## Target layout (end of phase 1)

```
server/ingest/
  index.ts             public surface of the pipeline (what server/fetcher.ts re-exports)
  tasks.ts             ArticleTask = NewArticle | RetryArticle | ClipArticle
  feed-loop.ts         collectFeedTasks(feed, opts): RSS -> new-article tasks, ONE copy
  fetch-content.ts     fetchArticleContent (moved verbatim from server/fetcher.ts)
  pipeline.ts          processArticle(task) + enrichArticle(ctx): runs the steps
  steps/
    index.ts           the ordered list of steps
    quality.ts         wraps scoreArticleQuality
    interests.ts       wraps scoreNewArticle
    rules.ts           wraps applyRulesToArticle
    ai-queue.ts        wraps enqueueAutoTranslate / enqueueAutoSummarize
    ai-filter.ts       wraps enqueueAiFilter
    similarity.ts      wraps detectAndStoreSimilarArticles (background)
server/fetcher.ts      thin façade: re-exports from ./ingest and ./fetcher/*
```

`server/fetcher.ts` **stays**. Thirteen test files mock it by path
(`vi.mock('../fetcher.js')`) and six production files import from it. It becomes a
re-export file and nothing else. Do not delete it. Do not change what it exports.

The modules being wrapped (`server/rules.ts`, `server/quality.ts`,
`server/interests.ts`, `server/similarity.ts`, `server/fetcher/ai-queue.ts`,
`server/fetcher/article-images.ts`) **do not move** in phase 1. They also carry
route-facing logic (rule preview, interest islands, image archiving endpoints) and
will move with their routes in phase 2. Steps import them; steps do not copy them.

## The step contract

```ts
// server/ingest/steps/types.ts
import type { FetchedContent } from '../fetch-content.js'
import type { TaskKind } from '../tasks.js'

export interface ArticleContext {
  articleId: number
  kind: TaskKind                 // 'new' | 'retry' | 'clip'
  feedId: number
  title: string
  url: string
  publishedAt: string | null
  content: FetchedContent        // what the fetch produced for this run
  lang: string | null            // effective language after fallbacks
}

export interface EnrichStep {
  name: string
  /** Task kinds the step runs for. Omitted = every kind. */
  appliesTo?: TaskKind[]
  /**
   * true = fire-and-forget: the pipeline does not await it and logs a
   * rejection. Use only where today's code already does `void fn()`.
   */
  background?: boolean
  run(ctx: ArticleContext): void | Promise<void>
}
```

The pipeline runs the steps of `steps/index.ts` in array order. A step that throws
is logged with its name and does not stop the following steps. Steps hold no state
and read what they need from the context or from the settings table.

## Rules for every commit

- **No behaviour change unless the prompt says so.** Same DB writes, same log
  messages, same progress events, same order of operations. When you move code,
  move it verbatim, including comments.
- **Tests stay green.** `server/fetcher.test.ts` (124 tests) exercises the public
  exports of `server/fetcher.ts`. It must pass unmodified through commits 01–03.
  Extend it or add new test files; do not delete or weaken existing tests.
- **Every new module gets a test file next to it**, `*.test.ts`, using
  `setupTestDb` from `server/__tests__/helpers/testDb.ts` when it touches the DB.
- **Do not touch** `server/fetcher/content.ts`, `rss.ts`, `http.ts`,
  `contentWorker.ts`, `server/lib/cleaner/*`, anything under `src/`, or the
  database schema.
- **Imports** use the `.js` suffix (ESM, see existing files). Keep the
  `import type` / `type` qualifiers the codebase already uses.

## Commands

```sh
npx tsc --noEmit
npx eslint src/ server/ shared/
npx vitest run --project server
```

All three must pass before you commit. (`npm test` goes through `mise`; if `mise`
is not installed, the `npx vitest run` form above is equivalent.)

## Commit conventions

One commit per prompt, in English, conventional-commit style
(`refactor(ingest): …`, `fix(ingest): …`). The body says what moved where and
names any behaviour change explicitly. No AI tool or model names anywhere in the
commit.
