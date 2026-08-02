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

## Hide-sidebar setting

`src/hooks/use-hide-sidebar.ts` + `src/pages/settings/sidebar-visibility-section.tsx` —
Settings → Appearance → Sidebar toggle. When hidden, the sidebar no longer opens
automatically on desktop and navigation happens through the bottom tab bar; the Menu
tab still opens the sidebar on demand. Wired via small insertions in `src/app.tsx`,
`src/pages/settings/appearance-tab.tsx`, and four new keys in `src/lib/i18n.ts`.

## Mark-as-read button

`src/components/article/mark-read-button.tsx` — a small check button on every unread
article card (all five layouts): mark as read without opening the article. Wired to
the list's existing instant-update + batched-server mechanism via an `onMarkRead`
prop threaded through `article-list.tsx` → `swipeable-article-card.tsx` →
`article-card.tsx`, plus one i18n key (`article.markAsRead`).

On touch devices, swiping an unread card to the right also marks it read (left swipe
still opens the article). The handled gesture stops propagation so it doesn't open
the sidebar drawer.

## Upstream fixes

- **CSP inline scripts**: the strict `script-src 'self'` blocked the two inline
  bootstrap scripts in `index.html` (theme flash guard, boot error display).
  `server/index.ts` now computes their sha256 hashes from `dist/index.html` at
  startup and includes them in the CSP header.
- **Logo font**: the downloadable TeX Gyre Pagella files were rejected by
  Firefox's font sanitizer. The `font-logo` stack now uses local Palatino
  equivalents (`tailwind.config.ts`), and the font import was removed from
  `src/index.css`.

## Upstream files touched

| File | Change |
|---|---|
| `src/app.tsx` | +2 lines (import + `<CategoryTabs />`) |
| `src/components/article/article-detail.tsx` | +2 lines (import + `<ArticleSwipeNavigation />`) |
| `src/components/layout/page-layout.tsx` | +2 lines (import + `<BottomNav />`) |
| `src/pages/settings/appearance-tab.tsx` | +4 lines (import + `<SidebarVisibilitySection />`) |
| `src/lib/i18n.ts` | +4 keys (`settings.hideSidebar*`) |

| `src/components/article/article-card.tsx` | `onMarkRead` prop + button in the 5 card variants |
| `src/components/article/swipeable-article-card.tsx` | `onMarkRead` pass-through |
| `src/components/article/article-list.tsx` | +1 line (`onMarkRead: markRead` in card props) |
| `server/index.ts` | CSP script-src hashes for inline bootstrap scripts |
| `tailwind.config.ts` + `src/index.css` | logo font swapped to local Palatino stack |

`src/app.tsx` additionally has 2 lines adjusted (sidebar auto-open respects the
hide-sidebar setting).

Everything else is new files, so merges from upstream should stay conflict-free.
