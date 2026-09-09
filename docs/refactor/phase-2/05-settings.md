# 05 — `server/settings/`, and the provider endpoints go to `server/ai/`

Read `00-context.md` first. Commits 01–04 must be done.

## Goal

`server/routes/settings.ts` (736 lines) holds five unrelated things. Split it
by concern into `server/settings/`, and move the AI-provider endpoints to the
AI domain. **No behaviour change**: same URLs, same validation, same responses.

## The file today (line numbers before any edit)

| Lines | Content | Goes to |
|---|---|---|
| 1–28 | imports | redistributed |
| 29–121 | `PREF_KEYS`, `PrefKey`, `PREF_ALLOWED`, `PROVIDER_MODEL_PAIRS` | `settings/preferences.ts` |
| 122–138 | `validateProviderModel` | `settings/preferences.ts` |
| 140–183 | `GET/PATCH /api/settings/profile` | `settings/profile-routes.ts` |
| 185–298 | `GET/PATCH/POST /api/settings/preferences`, `handlePrefsUpdate` | `settings/preferences-routes.ts` |
| 300–557 | image storage: get, patch, test, healthcheck | `settings/image-storage-routes.ts` |
| 559–591 | retention stats + purge | `settings/retention-routes.ts` |
| 593–735 | `PROVIDER_KEY_MAP`, api-keys get/set, google-translate and deepl usage, ollama and vllm models/status | `ai/settings-routes.ts` |

Move each block verbatim with its comments. Each `*-routes.ts` exports one
async Fastify plugin named after the block (`profileRoutes`, `preferencesRoutes`,
`imageStorageRoutes`, `retentionRoutes`, `aiSettingsRoutes`).

### `server/settings/preferences.ts`

Keep `PREF_KEYS` as one array in the same order (the `GET /api/settings/preferences`
response is built by iterating it), but group the entries with a comment per
domain: `// appearance`, `// reading`, `// AI tasks (chat / summary / translate)`,
`// providers (ollama / vllm)`, `// retention`, `// github`, `// videos`.
Same for `PREF_ALLOWED`. Export `PREF_KEYS`, `type PrefKey`, `PREF_ALLOWED`,
`PROVIDER_MODEL_PAIRS`, `validateProviderModel`.

### `server/settings/routes.ts`

```ts
export async function settingsRoutes(api: FastifyInstance): Promise<void> {
  await api.register(profileRoutes)
  await api.register(preferencesRoutes)
  await api.register(imageStorageRoutes)
  await api.register(retentionRoutes)
  await api.register(aiSettingsRoutes)   // from ../ai/index.js
}
```

Keep the name `settingsRoutes` so `server/routes/index.ts` changes only its
import path (`./settings.js` → `../settings/index.js`).

### `server/settings/index.ts`

Exports `settingsRoutes` and the `preferences.ts` names.

### `server/ai/settings-routes.ts`

The 593–735 block. Its imports: `getSetting`, `upsertSetting`, `deleteSetting`
from `../db.js`; `getMonthlyUsage`, `getDeeplMonthlyUsage` from
`./providers/translate/*.js` (intra-domain); `getModelValues` from
`../../shared/models.js`; `assertSafeUrl` from `../fetcher/ssrf.js`;
`requireJson`, `parseOrBadRequest` as today. Add `aiSettingsRoutes` to
`server/ai/index.ts`.

Watch the `PROVIDER_KEY_MAP` const: it is declared inside `settingsRoutes`
today (line 593, function scope). Keep it inside `aiSettingsRoutes`.

## Tests

`server/routes/settings.test.ts` (57 tests) → `git mv` to
`server/settings/routes.test.ts`, edits limited to import and mock paths (its
`vi.mock('../fetcher.js')` keeps the same depth; the `buildApp` helper path is
`../__tests__/helpers/buildApp.js` as before). It covers every block, so no
new tests are required; add one only if a block turns out uncovered (check the
`describe` names against the five blocks).

## Acceptance

- `server/routes/settings.ts` no longer exists.
- No file under `server/settings/` is over 300 lines.
- `grep -rn "PROVIDER_KEY_MAP\|/api/settings/api-keys\|ollama/models\|vllm/models" server --include=*.ts | grep -v test` → hits only in `server/ai/settings-routes.ts`.
- `curl`-level parity: the route list printed by `app.printRoutes()` (add a
  temporary `console.log` in a test, then remove it) is identical before and
  after for every `/api/settings/*` path.
- Typecheck, lint, server tests green; count unchanged from commit 04.

Commit: `refactor(settings): split settings routes by concern and move provider endpoints to server/ai`.
