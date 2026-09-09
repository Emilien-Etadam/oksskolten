# Phase 2 — Server by domain: shared context

Read this file before any numbered prompt in this directory. One prompt = one
commit, in order, each leaving the tree green. Phase 1 (`../phase-1/`) is done:
`server/ingest/` exists and `server/fetcher.ts` is a re-export façade.

## Branch

Phase 2 runs on a branch named `refactor/phase-2`. Create it from `main` once
PR #14 is merged; if it is not merged yet, create it from
`claude/charming-turing-p0x6iq` (head `231202f` or later). Line numbers in the
prompts are those of that head. Push every commit to `refactor/phase-2`; do not
open a pull request.

## Why

The server is laid out by technical layer (`db/`, `routes/`, `fetcher/`) plus a
flat pile at the root (`rules.ts`, `quality.ts`, `interests.ts`, `similarity.ts`,
`opml.ts`, `rss-bridge.ts`, four `*Routes.ts`). A feature is spread over five
directories; `routes/articles.ts` (834 lines) and `routes/settings.ts` (736 lines)
absorb every new endpoint. Phase 2 regroups the server by domain so that a feature
is one directory with its routes, its logic, its tables and its tests.

## Target layout (end of phase 2)

```
server/
  ingest/          phase 1: feed loop, article pipeline, enrichment steps
  intelligence/    rules, quality, interests, similarity, trust, top stories, smart folders, front page
  ai/              AI tasks (summarize / translate / filter / language), queue, providers/, chat/, AI routes
  feeds/           feed CRUD, source resolution (discovery, RSS-Bridge, GitHub stars, social search), categories, OPML
  settings/        profile, preferences, image storage, retention
  db/              connection + migrations, core tables (articles, feeds, categories, settings, conversations, apiKeys), types
  fetcher/         page fetching and extraction: content, http, ssrf, rss parsing, css-bridge, images, videos, reddit, google-news, …
  routes/          index (registration), admin, apiKeys, stats, articles (non-AI), comments
  auth.ts, authRoutes.ts, passkeyRoutes.ts, oauthRoutes.ts, lib/, search/, logger.ts, paths.ts, seed.ts, index.ts
```

Every domain directory has:

- `index.ts` — its public surface. Other domains import **only** from it.
- `routes.ts` — one exported `register<Domain>Routes(api)` (or the existing
  plugin name when a prompt says to keep it) that `server/routes/index.ts` calls.

## Rules for every commit

- **Move with `git mv`** so history follows the file. Move a module's test file
  with it, keeping the `.test.ts` next to the module.
- **No behaviour change.** Same routes, same responses, same DB writes, same log
  lines. When a prompt splits a file, the pieces are the original code, verbatim,
  comments included.
- **No shims.** When a module moves, update every importer and every
  `vi.mock('…/old-path.js')` to the new path. The only re-export façades that
  stay are `server/fetcher.ts` and `server/db.ts` / `server/db/index.ts` (for the
  core tables). A prompt's acceptance section lists the `grep` that must come
  back empty.
- **Relative paths shift when a file moves.** Recheck every `import` and
  `vi.mock` in a moved file (`../db.js` may become `../db.js` or `../../db.js`;
  `./__tests__/helpers/testDb.js` becomes `../__tests__/helpers/testDb.js`, …).
  `npx tsc --noEmit` catches imports; vitest catches mocks (a mock whose path
  resolves to nothing silently mocks nothing and the test then hits the real
  module, so read failures carefully).
- **`server/db/` keeps the core tables only.** A table used by a single domain
  moves into that domain (feed rules, smart folders, similarities, trust, stories,
  front page query). `server/db/index.ts` stops re-exporting what moved;
  consumers import from the domain's `index.ts`.
- **Do not delete or weaken any existing test.** Moving a test file is fine;
  editing it is limited to import and mock paths.
- **Do not touch** `src/`, `shared/`, the database schema or migrations,
  `server/ingest/` beyond import paths, `server/fetcher/content.ts`, `http.ts`,
  `contentWorker.ts`, `server/lib/cleaner/*`.

## Commands

```sh
npx tsc --noEmit
npx eslint src/ server/ shared/
npx vitest run --project server
```

All three must pass before you commit. Test count before phase 2: 100 files,
1,924 tests on the server project. It must not go down.

## Commit conventions

One commit per prompt, in English, conventional-commit style
(`refactor(<domain>): …`). The body lists what moved where (old → new path) and
names any import-path-only edits to tests. No AI tool or model names in the
commit.
