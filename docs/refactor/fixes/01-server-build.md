# Fix 01 — make the Docker server build pass and ship `aaguids.json`

Two pre-existing defects found while reviewing phase 4. Both sit in the
production server build that the `Dockerfile` runs:

    RUN npm run build && npx tsc -p server/tsconfig.build.json

Neither is a refactor: each commit changes one thing, and the second one
changes behaviour on purpose (documented below). Branch `fix/server-build`
from `main`, two commits, no pull request.

## Commit 1 — exclude tests from the server build

### Defect

`npx tsc -p server/tsconfig.build.json` exits non-zero on
`shared/markdown-links.test.ts(2,51): error TS2835` (an import without `.js`
extension, which the `NodeNext` resolution of the build config rejects). The
root `tsconfig.json` uses `bundler` resolution, so `tsc --noEmit` and Vitest
never see it. Every `*.test.ts` and `server/__tests__/**` file is also
compiled into `dist-server/`, which ships Vitest imports to production.

### Fix

Add an `exclude` to `server/tsconfig.build.json`:

```json
"exclude": [
  "../**/*.test.ts",
  "../server/__tests__/**"
]
```

Do not touch `shared/markdown-links.test.ts`: the extensionless import is
valid under the root config, and the test does not belong in the build.

### Acceptance

- `npx tsc -p server/tsconfig.build.json` exits 0 (verified: it does once
  the exclude is in place).
- `find dist-server -name '*.test.js' | wc -l` → 0, and
  `ls dist-server/server/__tests__` → missing.
- `ls dist-server/server/index.js` → present.
- Delete `dist-server/` afterwards; never commit it.

Commit: `build(server): exclude test files from the production tsc build`.

## Commit 2 — ship `aaguids.json` through the compiler

### Defect

`server/auth/passkey-routes.ts` reads `aaguids.json` at runtime with
`fs.readFileSync(path.join(import.meta.dirname, 'aaguids.json'))`. `tsc`
only emits files it compiles or imports, so the JSON never reaches
`dist-server/server/auth/`. In the Docker image the `catch` branch runs on
first use, logs "Failed to load aaguids.json" and every passkey gets
`authenticator_name: null`. Locally under `tsx` the file is found, which is
why nobody noticed.

### Fix

Replace the runtime read with a compile-time JSON import so the build owns
the asset. In `server/auth/passkey-routes.ts`:

- Remove `import fs from 'node:fs'` and `import path from 'node:path'`.
- Add, next to the other imports:
  `import aaguidData from './aaguids.json' with { type: 'json' }`
- Replace the `let aaguidMap … function loadAaguidMap()` block (lines 39–51
  on `main`) with:
  `const aaguidMap: Record<string, string> = aaguidData`
- In `resolveAuthenticatorName`, `loadAaguidMap()[aaguid]` → `aaguidMap[aaguid]`.
- `log` (the `logger.child('passkey')` at line 18) was only used by the
  removed `catch`; `noUnusedLocals` now rejects it. Remove `log` and the
  `logger` import. If `log` has another use you find, keep it.

Behaviour change, intended: the table loads eagerly at module import and
there is no longer a "file missing" fallback, because the compiler
guarantees the file. The root `tsconfig.json` already has
`resolveJsonModule: true`; `with { type: 'json' }` is required by `NodeNext`
and is supported by Node 22, `tsx` and Vitest (all verified on this repo).

Do not add a `COPY` of the JSON to the `Dockerfile`: the import makes it
unnecessary.

### Acceptance

- `grep -n "node:fs\|node:path\|loadAaguidMap\|logger" server/auth/passkey-routes.ts` → empty.
- `npx tsc -p server/tsconfig.build.json` exits 0 and
  `ls dist-server/server/auth/aaguids.json` → present. Delete `dist-server/` afterwards.
- `grep -n "aaguids" dist-server/server/auth/passkey-routes.js` shows the
  import with the `type: 'json'` attribute (check before deleting).
- `npx vitest run --project server server/auth/passkey-routes.test.ts` → 25 passed.
- Full checks green: `npx tsc --noEmit`, `npx eslint src/ server/ shared/`,
  `npx vitest run` (2,589 tests), `npm run build`,
  `npx tsx scripts/lint-no-japanese.ts`.

Commit: `fix(auth): import aaguids.json at build time so the Docker image ships it`.
Body: state the behaviour change (eager load, no runtime fallback) and why.
