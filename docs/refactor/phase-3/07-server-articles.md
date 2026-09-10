# 07 — `server/db/articles.ts` and `server/routes/articles.ts` split

Read `00-context.md` first. Independent of 01–06 (server only); do it last so
the client commits do not interleave with it.

## Goal

The two remaining server files every feature edits. Split each by concern
behind a façade that keeps its import path, because ESM `./articles.js` must
resolve to a file, and 20+ modules and tests import or mock those paths.
**No behaviour change.**

## `server/db/articles.ts` (924 lines) → `server/db/articles/`

| Lines | Content | File |
|---|---|---|
| 12–90 | `normalizeUrl`, `buildMeiliDoc`, score constants, `scoreExpr`, `SCORED_ARTICLES_WHERE`, `updateScoreDb`, `syncScoreToSearch`, `updateScore`, `recalculateScores` | `scoring.ts` |
| 92–272, 636–746 | `getArticles`, `getArticleByUrl`, `getArticleById`, `getArticlesByIds`, `searchArticles` | `queries.ts` |
| 274–486 | `markArticleSeen`, `markArticlesSeen`, `markAllSeenByFeed`, `markArticleLiked`, `getLikeCount`, `markArticleBookmarked`, `getBookmarkCount`, `recordArticleRead`, `insertArticle`, `markArticleRefreshAttempted`, `addRuleBoost`, `setArticleQuality`, `setArticleInterestScore`, `updateArticleContent` | `mutations.ts` |
| 487–634 | `REFRESH_ATTEMPT_BACKOFF`, `getArticlesNeedingRefresh`, `countStaleArticlesByFeed`, `getExistingArticleUrls`, `BACKOFF_DEADLINE`, `getRetryArticles`, `getRetryStats`, `type RetryStats` | `retry.ts` |
| 747–780 | `getUnarchivedArticlesByFeed`, `markImagesArchived`, `clearImagesArchived`, `markVideosArchived`, `clearVideosArchived`, `deleteArticle` | `media.ts` |
| 781–end | `getReadingStats`, `getRetentionStats`, `purgeExpiredArticles` | `retention.ts` |

Move each block verbatim with its comments and the imports it needs. Private
helpers used by two files (`scoreExpr`, `normalizeUrl`, `buildMeiliDoc`) are
exported from `scoring.ts` and imported by the others; say in the commit body
which private names became exports.

`server/db/articles.ts` becomes re-exports only: every name it exports today
(list them first: `grep -oE "^export (async )?function [a-zA-Z]+|^export const [A-Z_]+|^export type [A-Za-z]+" server/db/articles.ts`)
re-exported from the six files. `server/db/index.ts` and `server/db.ts` do
not change. `server/db/articles.test.ts` stays where it is, unmodified.

## `server/routes/articles.ts` (665 lines) → `server/routes/articles/`

| Routes | File | Plugin |
|---|---|---|
| `GET /api/articles`, `GET /api/articles/search`, `GET /api/articles/by-url`, `GET /api/articles/:id/similar` | `read.ts` | `articleReadRoutes` |
| `PATCH :id/seen`, `PATCH :id/bookmark`, `PATCH :id/like`, `POST batch-seen`, `POST :id/read`, `DELETE :id` | `state.ts` | `articleStateRoutes` |
| `POST /api/articles/check-urls`, `POST /api/articles/from-url` with `clipFetchBudgetMs` and `clipLog` | `clip.ts` | `articleClipRoutes` |
| `POST :id/archive-images`, `POST :id/archive-video`, `GET images/:filename`, `GET videos/:filename` | `media.ts` | `articleMediaRoutes` |

Shared zod schemas and helpers at the top of the file (`ArticlesQuery`, the
`NumericIdParams` import, `parseOrBadRequest`, …) go to
`server/routes/articles/schemas.ts` when two files need them; otherwise into
the one file that uses them. Route registration order inside `articleRoutes`
today is the order the table lists; keep it.

`server/routes/articles.ts` becomes:

```ts
export async function articleRoutes(api: FastifyInstance): Promise<void> {
  await api.register(articleReadRoutes)
  await api.register(articleClipRoutes)
  await api.register(articleStateRoutes)
  await api.register(articleMediaRoutes)
}
```

(order = today's order of first route of each group: list/search/by-url,
check-urls/from-url, seen/…, archive-…; confirm against the file.)

`server/routes/articles.test.ts`, `clip-articles.test.ts`,
`image-storage.test.ts` stay where they are, unmodified: they mount the app
and mock `../fetcher.js`, `../ai/…`, `../fetcher/article-images.js`, none of
which move.

## Acceptance

- `server/db/articles.ts` and `server/routes/articles.ts` contain only
  `export`/`import` statements, comments, and (routes) the four-line plugin.
- Every name exported by `server/db/articles.ts` before the split is exported
  after (diff the two `grep -oE` lists).
- `app.printRoutes()` for `/api/articles*` identical before and after (same
  method as phase 2 commit 05).
- Typecheck, lint, server tests green, count unchanged (1,932).

Commit: `refactor(articles): split the article table module and the article routes by concern`.
