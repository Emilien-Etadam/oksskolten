# 02 — Extract the article pipeline and turn enrichment into steps

Read `00-context.md` first. Commit 01 must be done.

## Goal

Move the per-article work out of `server/fetcher.ts` into `server/ingest/`, and
replace the hard-coded enrichment calls in `processArticle` by an ordered list of
`EnrichStep`s. **No behaviour change**: same writes, same order, same fire-and-forget
for similarity.

## Where the code is today (`server/fetcher.ts`, after commit 01)

- `FetchedContent` + `fetchArticleContent` — the block that starts at the comment
  `// --- Article content fetching (shared by feed pipeline & clip) ---`.
- `maybeEnqueueAutoTranslate(articleId, fullText, lang)`.
- `processArticle(task): Promise<boolean>` — fetch, then:
  - `new`: `insertArticle`, then in this order `setArticleQuality(scoreArticleQuality(…))`,
    `scoreNewArticle`, `applyRulesToArticle`, `maybeEnqueueAutoTranslate`,
    `enqueueAiFilter`, `void detectAndStoreSimilarArticles(…)`; a failing
    `insertArticle` is caught and logged unless it is a `UNIQUE constraint failed`.
  - `retry`: `updateArticleContent`, then `setArticleQuality` only if `content.fullText`,
    then `maybeEnqueueAutoTranslate`.
  - returns `!!content.lastError || (retry && extractedLen < MIN_EXTRACTED_LENGTH)`.

## What to write

### `server/ingest/fetch-content.ts`

`FetchedContent` and `fetchArticleContent` moved **verbatim**, comments included.

### `server/ingest/steps/types.ts`

`ArticleContext` and `EnrichStep` exactly as given in `00-context.md`.

### One file per step in `server/ingest/steps/`

Each exports a single `const … : EnrichStep`. The `run` body is the call that
`processArticle` makes today, nothing more:

| file | name | appliesTo | run |
|---|---|---|---|
| `quality.ts` | `quality` | new, retry | `new`: always. `retry`: only if `ctx.content.fullText`. Calls `setArticleQuality(ctx.articleId, scoreArticleQuality({ title, text: content.fullText, url }).score)`. |
| `interests.ts` | `interests` | new | `scoreNewArticle(ctx.articleId, ctx.title)` |
| `rules.ts` | `rules` | new | `applyRulesToArticle(ctx.articleId, ctx.feedId, { title, url, content: content.fullText })` |
| `ai-queue.ts` | `ai-queue` | new, retry | the body of `maybeEnqueueAutoTranslate`, moved here (summarize when enabled and body present; translate when enabled, body present, lang known and ≠ target) |
| `ai-filter.ts` | `ai-filter` | new | `enqueueAiFilter(ctx.articleId, ctx.feedId)` |
| `similarity.ts` | `similarity` | new | `background: true`; `detectAndStoreSimilarArticles(ctx.articleId, ctx.title, ctx.feedId, ctx.publishedAt, ctx.url)` |

The `quality` step's retry condition is the only conditional; keep it inside the step.

### `server/ingest/steps/index.ts`

```ts
export const enrichSteps: EnrichStep[] = [quality, interests, rules, aiQueue, aiFilter, similarity]
```

This order is today's order for `new`. For `retry` the array filters down to
`quality, ai-queue`, which is also today's order.

### `server/ingest/pipeline.ts`

```ts
export async function enrichArticle(ctx: ArticleContext, steps = enrichSteps): Promise<void>
export async function processArticle(task: ArticleTask): Promise<boolean>
```

`enrichArticle`: for each step whose `appliesTo` is absent or includes `ctx.kind`:
if `background`, `void Promise.resolve(step.run(ctx)).catch(err => log.warn(…))`;
otherwise `await` it inside a try/catch that logs `{ step: step.name, articleId }`
and continues. (Today a throwing `scoreNewArticle` would abort the rest; treating it
as logged-and-continue is the one deliberate softening, mention it in the commit
body.)

`processArticle`: the same function as today, except the enrichment calls are
replaced by building an `ArticleContext` and calling `enrichArticle`. Keep the
`UNIQUE constraint failed` handling, the retry `updateArticleContent`, and the
return value byte-for-byte.

### `server/ingest/index.ts`

Re-export `processArticle`, `enrichArticle`, `fetchArticleContent`,
`type FetchedContent`, `collectFeedTasks`, the task types, `type ArticleContext`,
`type EnrichStep`.

### `server/fetcher.ts`

Import `processArticle` and `fetchArticleContent` from `./ingest/index.js`. Keep
exporting `fetchArticleContent` and `type FetchedContent` from here (routes and
tests import them from this path). Delete the moved code and the imports that only
it used. `fetchSingleFeed` and `fetchAllFeeds` do not change.

## Tests

- `server/ingest/pipeline.test.ts`: `enrichArticle` with fake steps — order,
  `appliesTo` filtering, a throwing step does not stop the next one, a `background`
  step is not awaited and its rejection is logged not thrown.
- `server/ingest/steps/*.test.ts`: one small test per step, mocking the wrapped
  module with `vi.mock` and asserting the call and its arguments for the kinds it
  applies to, and no call for the others. The `quality` step needs the
  retry-without-body case.
- `server/fetcher.test.ts` unmodified and green. It exercises `processArticle`
  end-to-end through `fetchAllFeeds` / `fetchSingleFeed`, which is the regression net
  for "no behaviour change".

## Acceptance

- `grep -c "scoreArticleQuality\|scoreNewArticle\|applyRulesToArticle\|enqueueAiFilter\|detectAndStoreSimilarArticles" server/fetcher.ts server/ingest/pipeline.ts` is 0 for both: those names now appear only inside `steps/`.
- `server/fetcher.ts` is under 250 lines.
- Typecheck, lint, server tests green.

Commit: `refactor(ingest): run article enrichment as an ordered list of steps`.
