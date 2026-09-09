# 03 — Run clipped articles through the pipeline

Read `00-context.md` first. Commits 01 and 02 must be done.

## Goal

`POST /api/articles/from-url` in `server/routes/articles.ts` (handler registered at
line 324, body through line 450) fetches with `fetchArticleContent`, inserts the row itself, and stops. A
clipped article therefore never gets a quality score, an interest score, rules, the
AI queue (auto-translate / auto-summarize) or similarity detection.

After this commit the clip route inserts as before, then calls `enrichArticle` with
`kind: 'clip'`. **This is a deliberate behaviour change**; say so in the commit body.

What must **not** change: the fetch budget (`clipFetchBudgetMs`, default 20 s), the
early save with `content_pending: true` when the fetch outlives the budget, the
background continuation that fills the body in, the `force` / "already exists"
handling above the fetch, the response shapes. Read the whole handler and the
comments before editing; `server/routes/clip-articles.test.ts` (20 fork tests plus
upstream's) pins most of it.

## What to write

### `server/ingest/tasks.ts`

Add and export:

```ts
export interface ClipArticle { kind: 'clip'; feed_id: number; title: string; url: string; published_at: string }
export type ArticleTask = NewArticle | RetryArticle | ClipArticle
```

`processArticle` in `pipeline.ts` does not need to handle `'clip'`: the route keeps
its own insert because of the budget race. Make the `switch`/`if` on `task.kind` in
`processArticle` exhaustive so TypeScript flags a `clip` task reaching it (a
`never` check), and throw with a clear message.

### `server/ingest/pipeline.ts`

Export a small helper so the route does not assemble the context by hand:

```ts
export function clipContext(articleId: number, task: ClipArticle, content: FetchedContent | null, lang: string | null): ArticleContext
```

When `content` is null (fetch failed) it builds a `FetchedContent` with every field
null; steps already tolerate a missing body (quality on retry, ai-queue).

### Steps that apply to `clip`

Add `'clip'` to `appliesTo` of: `quality`, `interests`, `rules`, `ai-queue`,
`similarity`. Not `ai-filter`: the clip feed has no `ai_filter`, and the step would
only enqueue a no-op.

### `server/routes/articles.ts`

Import `enrichArticle` and `clipContext` from `../fetcher.js` (add both to the
façade's re-exports; the route's tests mock `../fetcher.js`, so check
`clip-articles.test.ts` and `articles.test.ts`: if they use `importOriginal`, the
new exports pass through; if they list exports explicitly, add the two as
pass-throughs to the real implementation).

Then, in the handler:

- **Early-save branch** (`if (!early)`): after `updateArticleContent(articleId, …)`
  in the background continuation, when `content` is present, call
  `await enrichArticle(clipContext(articleId, task, content, content.lang))`. When
  the fetch failed there is nothing to enrich.
- **Normal branch**: after `insertArticle`, call
  `await enrichArticle(clipContext(articleId, task, content, content?.lang ?? null))`
  before `getArticleById`.

`task` is `{ kind: 'clip', feed_id: clipFeed.id, title, url: body.url, published_at }`
using the same `title` and `published_at` values the insert used.

`enrichArticle` never throws (steps are caught individually), so the route's error
handling does not change.

## Tests

In `server/routes/clip-articles.test.ts` add:

- a clip that returns content within the budget gets a `quality_score` and, with a
  matching global rule present (`createFeedRule` in `server/db/feed-rules.ts`;
  `server/routes/rules.test.ts` shows one being created and applied), the rule's effect;
- a clip whose fetch outlives the budget gets enriched once the background fetch
  lands (extend the existing test `fills the article in when the background fetch
  finishes`, line 353).

Mock the AI queue as the file already does for images, so no provider is called.

## Acceptance

- `grep -n "enrichArticle" server/routes/articles.ts` shows two call sites.
- `server/fetcher.test.ts` and `server/routes/*.test.ts` green, typecheck, lint.

Commit: `feat(ingest): enrich clipped articles like fetched ones` with a body that
lists what a clip now receives (quality, interest, rules, auto-translate/summarize,
similarity) and what it still does not (AI filter).
