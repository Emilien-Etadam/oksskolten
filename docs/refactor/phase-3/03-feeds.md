# 03 — `src/features/feeds/`

Read `00-context.md` first. Commits 01–02 must be done.

## Goal

Feed management in one place: the sidebar feed list, the add-feed modal and
its steps, the context menu, the AI-filter dialog, category tabs, the error
banner, the refresh button, smart folders, and the hooks and context only
they use. **No behaviour change.**

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `src/components/feed/*` (12 files + tests) | `src/features/feeds/components/` |
| `src/components/smart/*` (2 files) | `src/features/feeds/components/smart/` |
| `src/contexts/fetch-progress-context.tsx` | stays in `src/contexts/` (5 tests mock it by that path and `app.tsx` provides it; moving it buys nothing) |
| `src/hooks/use-feed-actions.ts` (+ test) | `src/features/feeds/hooks/` |
| `src/hooks/use-feed-drag-drop.ts` (+ test) | `src/features/feeds/hooks/` |
| `src/hooks/use-feed-selection.ts` | stays in `src/hooks/` (also used by `pages/settings`, which becomes `features/settings`) |
| `src/hooks/use-feed-bulk-actions.ts` | stays in `src/hooks/` (same reason) |
| `src/hooks/use-fetch-progress.ts` (+ test) | stays with its context in `src/hooks/` |
| `src/lib/feed-error.ts`, `src/lib/feed-refresh.ts` | stay in `src/lib/`: the settings diagnostics and management sections use them too (verified) |

## New file

`src/features/feeds/index.ts` exports what crosses the boundary: `FeedList`,
`FeedModal`, `CategoryTabs`, `RefreshButton`, `FeedErrorBanner`,
`SmartFolderDialog`, `SmartFolderList`, and whatever else grep finds imported
from `app.tsx`, `components/layout`, `features/reading` (the search dialog in
`components/ui` imports `SmartFolderDialog`).

## Acceptance

- `ls src/components/feed src/components/smart` → both missing.
- Outside the feature, only `@/features/feeds` is imported.
- Typecheck, lint, both vitest projects, `npm run build`, lint-no-japanese green; client test file count unchanged.

Commit: `refactor(client): gather the feeds feature under src/features/feeds`.
