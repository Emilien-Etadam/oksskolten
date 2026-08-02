# Fork Additions

This fork tracks [babarot/oksskolten](https://github.com/babarot/oksskolten) and keeps
divergence minimal: additions live in new files, with only tiny insertion points in
upstream files.

## Le Monde theme (pure add-on)

`custom-themes/le-monde.json` — an importable custom theme inspired by the Le Monde
newspaper app. No source changes; see `custom-themes/README.md`.

## Category tabs

`src/components/feed/category-tabs.tsx` — a newspaper-style horizontal section bar
above article lists (inbox + one tab per category, active tab underlined with the
accent color). Mounted from `ArticleListPage` in `src/app.tsx` (2-line insertion).

## Swipe between articles

`src/components/article/article-swipe-navigation.tsx` — on the article detail page,
swipe left/right (or press ArrowRight/ArrowLeft) to move to the next/previous article
of the last visited list. Reuses the existing keyboard-navigation context that powers
j/k zap navigation. Mounted from `src/components/article/article-detail.tsx`
(2-line insertion).

## Bottom tab bar

`src/components/layout/bottom-nav.tsx` — newspaper-app-style bottom bar with the main
destinations (Inbox, Search, Read Later, Chat) plus a Menu tab that opens the sidebar.
Shown when the sidebar is closed; hidden on the chat page. Mounted from
`src/components/layout/page-layout.tsx` (2-line insertion).

## Upstream files touched

| File | Change |
|---|---|
| `src/app.tsx` | +2 lines (import + `<CategoryTabs />`) |
| `src/components/article/article-detail.tsx` | +2 lines (import + `<ArticleSwipeNavigation />`) |
| `src/components/layout/page-layout.tsx` | +2 lines (import + `<BottomNav />`) |

Everything else is new files, so merges from upstream should stay conflict-free.
