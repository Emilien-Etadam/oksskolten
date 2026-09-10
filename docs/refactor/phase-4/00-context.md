# Phase 4 — Last tidy-up: `rss.ts`, `server/auth/`, preference hooks

Read this file before any numbered prompt. One prompt = one commit, in order,
each leaving the tree green. Phases 1–3 are done (`../phase-1` … `../phase-3`).
This phase is the last structural one: after it the remaining large files are
data (cleaner selectors, demo store, themes, i18n messages) or single-purpose.

## Branch

Create `refactor/phase-4` from `main` (head `ab4bd63` or later). The prompts are
on branch `claude/charming-turing-p0x6iq`:

```sh
git checkout -b refactor/phase-4 origin/main
git checkout origin/claude/charming-turing-p0x6iq -- docs/refactor/phase-4
git commit -m "docs: add the phase 4 refactor prompts"
```

Push every commit to `refactor/phase-4`; do not open a pull request.

## Rules (same as phases 2–3, restated)

- **Move with `git mv`**, test next to its module, no behaviour change, moved
  code verbatim including comments.
- **No shims.** Update importers and `vi.mock` paths. `server/fetcher.ts` and
  `server/db.ts` / `server/db/index.ts` remain the only re-export façades on the
  server; `server/db/articles.ts` and `server/routes/articles.ts` from phase 3
  too. Nothing else.
- **Server has no path alias**: relative imports with the `.js` suffix. Client
  uses `@/` for imports a move breaks.
- **Domain boundary**: outside a domain directory, import only its `index.ts`;
  the two sanctioned exceptions stand (`fetcher/rss` → `feeds/sources/*`,
  route-level `lazy()` → page module).
- **Tests**: never delete or weaken one; edits limited to import and mock paths,
  except where a prompt says a test file is split (then the test bodies move
  verbatim and the total test count is unchanged).
- Never the database schema, never `server/lib/cleaner/*`, never `src/lib/`.

## Commands

```sh
npx tsc --noEmit
npx eslint src/ server/ shared/
npx vitest run
npm run build
npx tsx scripts/lint-no-japanese.ts
```

Counts before phase 4: 179 test files, 2,589 tests (server 1,932). Chunk list
from `npm run build` (names without hashes): `appearance-tab`, `chat-page`,
`feeds-tab`, `front-page`, `index` ×2, `settings-page`, `stories-page`,
`workbox-window.prod.es5`. Neither changes.

## Commit conventions

One commit per prompt, English, conventional-commit style, body listing old →
new paths. No AI tool or model names in the commit.
