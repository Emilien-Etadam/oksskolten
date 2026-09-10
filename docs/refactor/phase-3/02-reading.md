# 02 — `src/features/reading/`

Read `00-context.md` first. Commit 01 must be done.

## Goal

Everything about reading articles in one place: the list and its cards, the
detail page and its toolbar, the front page, the home page, the stories page,
comments, swipe and keyboard navigation, and the hooks only they use.
**No behaviour change.**

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `src/components/article/*` (17 files + tests) | `src/features/reading/components/` |
| `src/pages/front-page.tsx` (+ test) | `src/features/reading/pages/front-page.tsx` |
| `src/pages/home-page.tsx` | `src/features/reading/pages/home-page.tsx` |
| `src/pages/stories-page.tsx` (+ test) | `src/features/reading/pages/stories-page.tsx` |
| `src/contexts/keyboard-navigation-context.tsx` | stays in `src/contexts/`: `app.tsx` line 17 provides it |
| `src/hooks/use-article-actions.ts` | `src/features/reading/hooks/` |
| `src/hooks/use-extend-article-list.ts` (+ test) | `src/features/reading/hooks/` |
| `src/hooks/use-rewrite-internal-links.ts` (+ test) | `src/features/reading/hooks/` |
| `src/hooks/use-summarize.ts` (+ test) | `src/features/reading/hooks/` |
| `src/hooks/use-translate.ts` (+ test) | `src/features/reading/hooks/` |
| `src/hooks/use-streaming-ai.ts` (+ test) | `src/features/reading/hooks/` (consumed by use-summarize / use-translate only; verify) |
| `src/hooks/use-metrics.ts` (+ test) | `src/features/reading/hooks/` (consumed by `components/article` only; verify) |
| `src/hooks/use-auto-mark-read.ts` (+ test) | stays in `src/hooks/` if `use-settings.ts` imports it (it does today: it is a preference hook, see 04) |

Hooks that stay in `src/hooks/` because two features or `app.tsx` use them
(verify each with grep): `use-clip-feed-id`, `use-is-touch-device`,
`use-keyboard-navigation` (also `pages/settings`), `use-scroll-restoration`,
`use-article-auto-refresh`, `use-swipe-drawer`, `use-escape-key`,
`use-global-shortcuts`, `create-local-storage-hook`.

`src/lib/readTracker.ts`, `markSeenWithQueue.ts`, `offlineQueue.ts`,
`video-card.ts`, `markdown.ts`, `sanitize.ts` stay in `src/lib/` (rule in
`00-context.md`).

## New file

`src/features/reading/index.ts` exports what `app.tsx`, `components/layout`
and other features import today: `ArticleList`, `ArticleDetail`,
`ArticleOverlay`, `ArticleRawPage`, `FrontPage`, `HomePage`, `StoriesPage`,
`DaySeparator` if used outside, plus the `ArticleListHandle` type. Check with
grep which names cross the boundary; export those, no more.

## Importers

`app.tsx` (lazy page imports, list/detail components), `components/layout/*`,
`components/feed/*` (mark-read button? category tabs?), `components/smart/*`.
Rewrite the broken imports with `@/features/reading` (the index) from outside
the feature, relative inside it.

Tests: recheck every `vi.mock` in moved tests (`lib/fetcher`, `lib/readTracker`,
`contexts/fetch-progress-context`, `swr`, `react-router-dom`, `app`) — paths
change depth by one or two.

## Acceptance

- `ls src/components/article` → missing.
- `grep -rn "features/reading/" src --include=*.ts --include=*.tsx | grep -v "^src/features/reading/" | grep -v "features/reading'"` → empty (outside the feature, only the index is imported).
- Typecheck, lint, both vitest projects, `npm run build`, lint-no-japanese green; client test file count unchanged (73).

Commit: `refactor(client): gather the reading feature under src/features/reading`.
