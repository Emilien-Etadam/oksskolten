# 04 — Reduce `server/fetcher.ts` to a façade, move the entry points

Read `00-context.md` first. Commits 01–03 must be done.

## Goal

After commit 02, `server/fetcher.ts` still owns `fetchSingleFeed` and
`fetchAllFeeds` plus a block of re-exports. Move the two entry points into
`server/ingest/` and leave `server/fetcher.ts` as re-exports only, so the file every
feature used to edit contains no logic at all.

**No behaviour change.**

## What to write

### `server/ingest/run.ts`

`fetchSingleFeed` and `fetchAllFeeds` moved verbatim from `server/fetcher.ts`,
together with their imports (`Semaphore`, `CONCURRENCY`, progress helpers,
`getEnabledFeeds`, `getRetryArticles`, `getRetryStats`, `updateArticleContent`,
`resumePendingAiTasks`, `sweepAutoArchiveFeeds`, …). Keep the section comments
(`// --- Single feed fetch ---`, `// --- Main entry point ---`, "Phase B", "Phase C").

### `server/ingest/index.ts`

Add `fetchSingleFeed` and `fetchAllFeeds` to the re-exports.

### `server/fetcher.ts`

The whole file becomes:

```ts
// Façade over the ingestion pipeline. Kept so import paths and test mocks
// (`vi.mock('../fetcher.js')`) stay stable; add logic under server/ingest/, not here.
export { fetchAllFeeds, fetchSingleFeed, fetchArticleContent, enrichArticle, clipContext } from './ingest/index.js'
export type { FetchedContent, ArticleTask, ArticleContext, EnrichStep } from './ingest/index.js'
export { normalizeDate } from './fetcher/util.js'
export { type FetchProgressEvent, fetchProgress, getFeedState } from './fetcher/progress.js'
export { discoverRssUrl } from './fetcher/rss.js'
export { detectLanguage, summarizeArticle, streamSummarizeArticle, translateArticle, streamTranslateArticle } from './fetcher/ai.js'
export type { AiTextResult, AiBillingMode } from './fetcher/ai.js'
```

Compare against the current re-export block before replacing it and keep every
name that is exported today; the list above is the expected result, not a licence
to drop something.

### `server/fetcher.test.ts`

Do not rename or split it in this commit. It keeps importing from `./fetcher.js`
and keeps passing; it is the end-to-end net for the whole pipeline.

### `docs/spec/30_ingestion.md`

Add a short "Code layout" subsection listing `server/ingest/*` and the step
contract, and stating that new enrichment goes in `server/ingest/steps/` plus one
line in `steps/index.ts`. Keep it under 30 lines.

## Acceptance

- `server/fetcher.ts` contains only `export` statements and comments (`grep -vE '^(export|//|\s*$)' server/fetcher.ts` prints nothing).
- Every `import … from '(../)*fetcher.js'` in `server/` still resolves; the 13 test
  files that `vi.mock` it pass unchanged.
- Typecheck, lint, server tests green.

Commit: `refactor(ingest): move the fetch entry points under server/ingest and keep fetcher.ts as a façade`.
