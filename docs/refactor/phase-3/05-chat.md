# 05 — `src/features/chat/`

Read `00-context.md` first. Commits 01–04 must be done.

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `src/components/chat/*` (9 files + tests) | `src/features/chat/components/` |
| `src/pages/chat-page.tsx` | `src/features/chat/chat-page.tsx` |
| `src/hooks/use-chat.ts` (+ test) | stays in `src/hooks/`: `home-page.tsx` (now in `features/reading`) uses it too, so it is cross-feature |
| `src/hooks/use-chat-position.ts` | stays in `src/hooks/` (a preference hook read by `use-settings.ts`) |

`src/features/chat/index.ts` exports `ChatPage`, `ChatFab`, `ChatPanel`,
`ChatInlineTrigger` and whatever else `app.tsx`, `components/layout` or
`features/reading` (the article toolbar mounts `ChatInlineTrigger`) import.

After this commit `src/pages/` holds `login-page.tsx` and `setup-page.tsx`
only; `src/components/` holds `ui/`, `layout/`, `auth/` and
`command-palette.tsx`. Leave those as they are.

## Acceptance

- `ls src/components/chat src/pages/chat-page.tsx` → missing.
- `ls src/pages` → `login-page.tsx setup-page.tsx` only; `ls src/components` → `auth command-palette.test.tsx command-palette.tsx layout ui`.
- Outside the feature, only `@/features/chat` is imported.
- Typecheck, lint, both vitest projects, `npm run build`, lint-no-japanese green.

Commit: `refactor(client): gather the chat feature under src/features/chat`.
