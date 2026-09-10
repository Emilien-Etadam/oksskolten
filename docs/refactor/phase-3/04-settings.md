# 04 — `src/features/settings/`

Read `00-context.md` first. Commits 01–03 must be done.

## Goal

The settings page, its tabs and sections, the settings-only components, and
the preference hooks in one place. This is the largest bucket (about 6,700
lines). **No behaviour change.**

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `src/pages/settings-page.tsx` | `src/features/settings/settings-page.tsx` |
| `src/pages/settings/*.tsx` (tabs, theme dialog, theme section) | `src/features/settings/tabs/` |
| `src/pages/settings/sections/*.tsx` (13 files) | `src/features/settings/sections/` |
| `src/components/settings/*` (7 files + tests) | `src/features/settings/components/` |
| `src/hooks/use-settings.ts` (+ test) | `src/features/settings/hooks/use-settings.ts` — **only if** `app.tsx` does not import it; it does today (`useSettings` in `AppLayout`), so it **stays** in `src/hooks/` and this row is void. Verify. |
| preference hooks consumed only by `use-settings.ts` and the settings sections: `use-auto-summarize`, `use-auto-translate`, `use-auto-translate-scope`, `use-github-release-types`, `use-keybindings-setting`, `use-keyboard-nav-setting`, `use-highlight-theme`, `use-article-font`, `use-article-open-mode`, `use-category-unread-only`, `use-chat-position`, `use-internal-links`, `use-layout`, `use-show-feed-activity`, `use-show-thumbnails`, `use-unread-indicator`, `use-date-mode`, `use-dark-mode`, `use-theme`, `use-mascot`, `use-auto-mark-read` | they are consumed by `use-settings.ts`, which stays in `src/hooks/`. They therefore **stay in `src/hooks/`** too. Do not move them; a hook must not import upward from a feature. |

So the hook rows are mostly void: the move is the page, the tabs, the sections
and the components. `src/lib/theme-json.ts` and `src/data/themes.ts` stay
(shared rule).

## New file

`src/features/settings/index.ts` exports `SettingsPage` and anything else
`app.tsx` imports from the moved files (grep).

## Importers

`app.tsx` (lazy `SettingsPage`), `components/layout/sidebar-menu.tsx` if it
links to a tab, `features/feeds` if the diagnostics panel is opened from the
sidebar (grep `feed-diagnostics` and `FeedsTab`).

Tests: the sections' tests mock `lib/fetcher` and hooks by relative path;
recheck every `vi.mock`.

## Acceptance

- `ls src/pages/settings src/pages/settings-page.tsx src/components/settings` → all missing.
- Outside the feature, only `@/features/settings` is imported.
- Typecheck, lint, both vitest projects, `npm run build`, lint-no-japanese green; client test file count unchanged.

Commit: `refactor(client): gather the settings feature under src/features/settings`.
