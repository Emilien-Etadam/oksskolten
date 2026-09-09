# 03 — `server/feeds/` (move)

Read `00-context.md` first. Commits 01–02 must be done.

## Goal

Gather feed management and feed-source resolution into `server/feeds/`.
**No behaviour change.** The de-duplication of the resolver chain is the next
prompt, not this one.

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `server/routes/feeds.ts` (+ `.test.ts`) | `server/feeds/routes.ts` |
| `server/routes/categories.ts` | `server/feeds/categories-routes.ts` |
| `server/opml.ts` (+ `.test.ts`) | `server/feeds/opml.ts` |
| `server/rss-bridge.ts` (+ `.test.ts`) | `server/feeds/rss-bridge.ts` |
| `server/fetcher/github-releases.ts` (+ `.test.ts`) | `server/feeds/sources/github-releases.ts` |
| `server/fetcher/social-search.ts` (+ `.test.ts`) | `server/feeds/sources/social-search.ts` |

Stays where it is: `server/db/feeds.ts`, `server/db/categories.ts` (core tables),
`server/fetcher/rss.ts` (RSS fetching and parsing, used by the ingest loop),
`server/fetcher/css-bridge.ts` (parsing).

`github-releases.ts` and `social-search.ts` each carry both a resolver (turn a
pasted URL into a feed) and a fetcher (produce items for `fetcher/rss.ts`'s
API-feed dispatch). They move whole; splitting them is not part of phase 2.

## New files

### `server/feeds/routes.ts`

Is the moved `routes/feeds.ts`. Keep the exported plugin name `feedRoutes`.
Add at the bottom:

```ts
export async function registerFeedRoutes(api: FastifyInstance): Promise<void> {
  await api.register(feedRoutes)
  await api.register(categoryRoutes)
}
```

`server/routes/index.ts` registers `feedRoutes` first and `categoryRoutes`
third today (after `articleRoutes`). Registration order only matters for
plugin scoping, not URL matching here, but keep it identical anyway: call
`registerFeedRoutes` where `feedRoutes` was, and drop `categoryRoutes` from the
list. If `server/routes/feeds.test.ts` or `api.test.ts` asserts on route
ordering (unlikely; check), revert to registering the two separately.

### `server/feeds/index.ts`

- `registerFeedRoutes`, `feedRoutes`, `categoryRoutes`.
- from `sources/github-releases.ts`: `resolveGithubStarsFeed`, `RELEASE_TYPE_VALUES`
  and whatever `server/fetcher/rss.ts` imports from it (read its import line).
- from `sources/social-search.ts`: `resolveSocialSearchFeed` and whatever
  `fetcher/rss.ts` imports from it.
- from `rss-bridge.ts`: `queryRssBridge`, `inferCssSelectorBridge`.
- from `opml.ts`: the functions `routes.ts` imports.

## Importers to update

- `server/routes/index.ts`: see above.
- `server/fetcher/rss.ts`: `./github-releases.js` / `./social-search.js` →
  `../feeds/index.js`. (`fetcher/` importing from `feeds/` is the intended
  direction: ingestion consumes source definitions.)
- `server/routes/settings.ts`: `RELEASE_TYPE_VALUES` from `../feeds/index.js`.
- Inside `feeds/routes.ts`: `../fetcher/social-search.js` → `./index.js` is
  circular-ish; import from `./sources/social-search.js` and
  `./sources/github-releases.js` directly (intra-domain imports do not go
  through the index). `../rss-bridge.js` → `./rss-bridge.js`; `../opml.js` → `./opml.js`.
- `feeds/routes.test.ts` (was `routes/feeds.test.ts`): `vi.mock('../rss-bridge.js')`
  → `vi.mock('./rss-bridge.js')`; `vi.mock('../fetcher/article-images.js')` and
  `vi.mock('../fetcher.js')` keep their depth (still one level under `server/`).
- `feeds/rss-bridge.ts` (was at the root, now one level deeper): `./fetcher/*.js`
  → `../fetcher/*.js`; `./db.js` → `../db.js`; `./ai/index.js` → `../ai/index.js`;
  `./logger.js` → `../logger.js`; `../shared/*` → `../../shared/*`. Same for
  `opml.ts` and both test files.
- `feeds/sources/*.ts` (were under `fetcher/`, now two levels down): `../db.js`
  → `../../db.js`, `./http.js` → `../../fetcher/http.js`, `./ssrf.js` →
  `../../fetcher/ssrf.js`, etc. Read each import.
- `scripts/`: none import these modules (checked); confirm with grep.

Finish with `grep -rn "routes/feeds\|routes/categories\|from '.*opml\.js'\|rss-bridge\.js\|github-releases\.js\|social-search\.js" server scripts --include=*.ts`
and make sure every hit is inside `server/feeds/` or points at `feeds/index.js`.

## Acceptance

- `ls server/routes/feeds.ts server/routes/categories.ts server/opml.ts server/rss-bridge.ts server/fetcher/github-releases.ts server/fetcher/social-search.ts` → every path missing.
- Outside `server/feeds/`, the only `feeds/` import path is `feeds/index.js`.
- `server/feeds/routes.test.ts` passes with only mock-path edits (36 tests).
- Typecheck, lint, server tests green; count unchanged (1,924).

Commit: `refactor(feeds): gather feed routes, categories, OPML and source resolvers under server/feeds`.
