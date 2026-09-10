# 02 — `server/auth/`

Read `00-context.md` first. Commit 01 must be done.

## Goal

Authentication is the last feature still spread over the server root
(`auth.ts`, `authRoutes.ts`, `passkeyRoutes.ts`, `oauthRoutes.ts`),
`routes/` (`apiKeys.ts`) and `db/` (`apiKeys.ts`). Gather it under
`server/auth/`. **No behaviour change.**

## Moves (`git mv`, tests alongside)

| From | To |
|---|---|
| `server/auth.ts` (+ `auth.test.ts`) | `server/auth/guards.ts` (+ `guards.test.ts`) |
| `server/authRoutes.ts` (+ test) | `server/auth/routes.ts` |
| `server/passkeyRoutes.ts` (+ test) | `server/auth/passkey-routes.ts` |
| `server/oauthRoutes.ts` (+ test) | `server/auth/oauth-routes.ts` |
| `server/routes/apiKeys.ts` | `server/auth/api-key-routes.ts` |
| `server/apiKeyRoutes.test.ts` | `server/auth/api-key-routes.test.ts` |
| `server/db/apiKeys.ts` (+ test) | `server/auth/api-keys-db.ts` |

`server/api.ts` (one line) and `server/index.ts` stay.

## New file: `server/auth/index.ts`

- from `guards.ts`: `requireAuth`, `getAuthUser`, `requireWriteScope`,
  `getOrigin`, `getRpID`, `getCredentialCount`, `requireJson`.
- from `api-keys-db.ts`: `createApiKey`, `listApiKeys`, `deleteApiKey`,
  `validateApiKey`, `type ApiKey`, `type ApiKeyCreated`.
- `apiKeyRoutes` (for `server/routes/index.ts`, which registers it inside the
  authenticated `/api` scope: keep it there, it is not a public auth route).
- `registerAuthRoutes(app)`: registers `authRoutes`, `passkeyRoutes`,
  `oauthRoutes` in that order (today `server/index.ts` lines 149–151 and
  `server/__tests__/helpers/buildApp.ts` lines 15–16 — note buildApp registers
  only the first two; keep that difference: export the three plugins as well
  and let buildApp keep registering the two it does).

## Importers

- 18 non-test files import `…/auth.js` (`requireAuth`, `requireJson`,
  `getAuthUser`, …): `grep -rlE "from '(\./|\.\./)+auth\.js'" server` lists
  them. Each becomes `…/auth/index.js` at the right depth.
- `server/db/index.ts`: drop the two `apiKeys.js` export lines; consumers of
  those names (grep `createApiKey\|listApiKeys\|deleteApiKey\|validateApiKey`)
  import from `../auth/index.js`.
- `server/index.ts`: the three route imports → `registerAuthRoutes` from
  `./auth/index.js`; `server/__tests__/helpers/buildApp.ts`: `authRoutes`,
  `passkeyRoutes` from `../../auth/index.js`.
- `server/routes/index.ts`: `apiKeyRoutes` from `../auth/index.js`.
- Inside the moved files: `./oauthRoutes.js` → `./oauth-routes.js`
  (`routes.ts` and `passkey-routes.ts` import `isGitHubOAuthEnabled`),
  `./db.js` → `../db.js`, `./lib/*` → `../lib/*`, `../shared/*` → `../../shared/*`,
  `./db/apiKeys.js` → `./api-keys-db.js`. Test files: same depth shifts, plus
  their `__tests__/helpers` paths.
- No test mocks `auth.js` today (checked); recheck with grep after the move
  for any mock of the route modules.

## Acceptance

- `ls server/*.ts | grep -v test` → `api.ts db.ts fetcher.ts index.ts logger.ts paths.ts seed.ts`.
- `grep -rn "auth/" server --include=*.ts | grep -v "^server/auth/" | grep -v "auth/index.js"` → empty.
- Typecheck, lint, tests (count unchanged), build, lint-no-japanese green.

Commit: `refactor(auth): gather guards, auth routes, passkeys, OAuth and API keys under server/auth`.
