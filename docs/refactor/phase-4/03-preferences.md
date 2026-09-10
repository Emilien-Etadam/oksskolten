# 03 — `src/hooks/preferences/`

Read `00-context.md` first. Commits 01–02 must be done.

## Goal

`src/hooks/` holds 35 hooks, 21 of which are user-preference hooks that
`use-settings.ts` aggregates (16 built on `create-local-storage-hook`, plus
`use-dark-mode`, `use-theme`, `use-highlight-theme`, `use-article-font`,
`use-keybindings-setting`). Group them with their aggregator in a
`preferences/` subfolder so the shared hooks folder reads as what it is.
They stay shared (consumed by `app.tsx`, `components/ui`, `features/chat`,
`features/settings`); this is a grouping, not a feature move.
**No behaviour change.**

## Moves (`git mv`, tests alongside)

Into `src/hooks/preferences/`:

- `create-local-storage-hook.ts` (+ test)
- the 16 hooks that import it: `use-article-open-mode`, `use-auto-mark-read`,
  `use-auto-summarize`, `use-auto-translate-scope`, `use-auto-translate`,
  `use-category-unread-only`, `use-chat-position`, `use-date-mode`,
  `use-github-release-types`, `use-internal-links`, `use-keyboard-nav-setting`,
  `use-layout`, `use-mascot`, `use-show-feed-activity`, `use-show-thumbnails`,
  `use-unread-indicator` (each with its test where one exists)
- `use-dark-mode`, `use-theme`, `use-highlight-theme`, `use-article-font`,
  `use-keybindings-setting` (+ tests)
- `use-settings.ts` (+ test)

Stay in `src/hooks/`: `use-article-auto-refresh`, `use-chat`, `use-clip-feed-id`,
`use-escape-key`, `use-feed-bulk-actions`, `use-feed-selection`,
`use-fetch-progress`, `use-global-shortcuts`, `use-is-touch-device`,
`use-keyboard-navigation`, `use-scroll-restoration`, `use-swipe-drawer`.

Check `use-keybindings-setting.ts`: it imports `use-keyboard-navigation`
(which stays). That upward import from `preferences/` to `hooks/` is fine
(`../use-keyboard-navigation`); it is the same folder family.

## New file: `src/hooks/preferences/index.ts`

Re-exports every hook of the folder and its types (`Settings`,
`GithubReleaseTypes`, `AutoTranslateScope`, … — grep `export type` in the
moved files). Consumers outside the folder import `@/hooks/preferences`;
inside it, relative.

## Importers

- `src/app.tsx` line 5: `useSettings, type Settings` → `@/hooks/preferences`.
- `features/settings/sections/*` (use-settings, use-mascot, use-theme, …),
  `features/chat/*` (use-date-mode), `components/ui/*` (use-mascot),
  `features/reading/*` if any: grep `hooks/use-` across `src` and rewrite the
  hits that name a moved hook.
- Tests that mock a moved hook by path (there are single mocks of
  `use-theme`, `use-date-mode`, `use-dark-mode`, `use-highlight-theme`,
  `use-internal-links`, `use-unread-indicator`, `use-auto-mark-read`; find
  them with `grep -rn "vi.mock('.*use-" src`): the mocked path must be the
  path the component now imports, i.e. `@/hooks/preferences` (mock the barrel
  with `importOriginal` and override the one hook, as commit 05 of phase 3
  did for `@/features/chat`) or the hook module itself when the component
  imports it directly. Whichever it is, the stub must still intercept: a test
  whose mock stops intercepting keeps passing for the wrong reason, so for
  each rewritten mock, temporarily break the stub (return a wrong value) and
  confirm the test fails, then restore it.

## Acceptance

- `ls src/hooks | grep -v test | grep -v preferences | wc -l` → 12.
- `grep -rn "hooks/preferences/" src --include=*.ts --include=*.tsx | grep -v "^src/hooks/preferences/" | grep -v "hooks/preferences'"` → empty.
- Chunk list unchanged (these hooks were already in the main chunk).
- Typecheck, lint, tests (count unchanged), build, lint-no-japanese green.

Commit: `refactor(client): group the preference hooks with use-settings under src/hooks/preferences`.
