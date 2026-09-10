# Phase 3 — Client by feature, i18n by domain, the last two server hot files

Read this file before any numbered prompt in this directory. One prompt = one
commit, in order, each leaving the tree green. Phases 1 and 2 are done: the
server is organised by domain under `server/ingest`, `intelligence`, `ai`,
`feeds`, `settings`.

## Branch

Create `refactor/phase-3` from `main` (head `5c572b2` or later). These prompts
are on branch `claude/charming-turing-p0x6iq`; bring them in first:

```sh
git checkout -b refactor/phase-3 origin/main
git checkout origin/claude/charming-turing-p0x6iq -- docs/refactor/phase-3
git commit -m "docs: add the phase 3 refactor prompts"
```

Push every commit to `refactor/phase-3`; do not open a pull request.

## Why

The client is laid out by kind (`components/`, `hooks/`, `pages/`, `contexts/`,
`lib/`), so a feature is spread over five directories and 44 hooks sit in one
folder. `src/lib/i18n.ts` is one 1,112-line dictionary of 729 keys. On the
server, `db/articles.ts` (924 lines) and `routes/articles.ts` (665 lines) are
the two remaining files every feature edits.

## Target layout (end of phase 3)

```
src/
  app.tsx, main.tsx, index.css, vite-env.d.ts
  i18n/
    index.ts            runtime: Locale, useI18n, translate, LocaleContext, isMessageKey, APP_NAME
    messages/
      index.ts          merges the domain files into one `dict`
      <domain>.ts       one file per key-prefix group (see 01)
  features/
    reading/            article list, cards, detail, overlay, front page, home page, stories page, comments, swipe/zap navigation + their hooks and context
    feeds/              feed list, modal, context menu, category tabs, error banner, smart folders + their hooks and context
    settings/           settings page, tabs, sections, settings components, use-settings and the preference hooks
    chat/               chat components, chat page, use-chat
  components/
    ui/                 shared primitives (unchanged)
    layout/             app shell: header, page layout, bottom nav, sidebar (unchanged)
    auth/               auth gate, error boundary (unchanged)
  hooks/                hooks used by more than one feature or by app.tsx / layout
  lib/                  shared libraries (unchanged: fetcher, markdown, sanitize, url, dateFormat, search, auth, demo/, …)
  contexts/             only what more than one feature uses (may end up empty)
  data/                 static data (unchanged)
  pages/                login, setup (auth pages; everything else moves into features/)
server/
  db/articles.ts        façade over db/articles/*.ts
  routes/articles.ts    façade over routes/articles/*.ts
```

## Rules for every commit

- **Move with `git mv`**, test file next to its module.
- **No behaviour change.** Same components, same props, same routes, same
  strings. Moving code is moving code.
- **Imports.** The `@/` alias maps to `src/` in `tsconfig.json`, `vite.config.ts`
  and therefore vitest. When a move breaks a relative import, rewrite it as
  `@/features/…`, `@/hooks/…`, `@/lib/…`. Do not rewrite imports the move did
  not break. Inside a feature, sibling imports stay relative. A route-level
  `lazy()` import targets the page module directly, never a feature barrel
  that is also imported statically; this is the one sanctioned deep import.
- **Shared vs feature.** A hook, context or lib used by exactly one feature
  moves into it. Used by two features, by `app.tsx` or by `components/layout`,
  it stays in `src/hooks/`, `src/contexts/`, `src/lib/`. Decide with
  `grep -rl "<name>" src --include=*.ts --include=*.tsx | grep -v test`, not
  by guessing; each prompt lists the expected outcome, grep is the authority.
- **`src/lib/` does not move.** `vite.config.ts` has a `demo-alias` plugin that
  swaps `src/lib/auth-shell.tsx`, `src/lib/fetcher.ts` and `src/lib/search.ts`
  for their `.demo` twins by absolute path; moving them breaks the demo build.
  No exception: nothing under `src/lib/` moves in phase 3.
- **Tests.** Never delete or weaken one. Edits to moved tests are limited to
  import and `vi.mock` paths. Client tests mock `lib/fetcher` (29 files),
  `contexts/fetch-progress-context` (5), `lib/readTracker` (5) and a few hooks
  by relative path: every one of those paths must be rechecked after a move
  (a `vi.mock` of a path that resolves to nothing mocks nothing, silently).
- **Do not touch** `server/` in prompts 01–06, nor `src/` in 07; never the
  database schema.

## Commands

```sh
npx tsc --noEmit
npx eslint src/ server/ shared/
npx vitest run                       # both projects: server and client
npm run build                        # vite build, catches the demo alias and lazy imports
npx tsx scripts/lint-no-japanese.ts  # Japanese text allowed only in i18n message files and tests
```

All five must pass before you commit. Counts before phase 3: server 101 files /
1,932 tests; client 73 test files. Neither goes down.

## Commit conventions

One commit per prompt, English, conventional-commit style
(`refactor(i18n): …`, `refactor(client): …`, `refactor(articles): …`). The body
lists old → new paths and names any import-path-only test edits. No AI tool or
model names in the commit.
