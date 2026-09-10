# 01 — `server/fetcher/rss.ts` split: fetch, parse, discovery

Read `00-context.md` first.

## Goal

`server/fetcher/rss.ts` (589 lines) holds three things: fetching a feed with
cache and rate-limit handling (ingestion), parsing feed XML into items
(ingestion), and discovering a feed URL from a site URL (feed management).
Split it along those lines and move discovery into the feeds domain, where its
only callers live. **No behaviour change.**

## The file today

| Lines | Content | Goes to |
|---|---|---|
| 1–20 | imports | redistributed |
| 22–57 | `RssItem`, `FetchRssResult`, `RateLimitError` | `server/fetcher/rss/types.ts` |
| 59–128 | `throwIfRateLimited`, `RSS_BRIDGE_URL`, `decodeHtmlEntities`, `extractRssFromFlareSolverr`, `extractXmlRoot` | with their callers (see rule below) |
| 130–278 | `fetchAndParseRss` | `server/fetcher/rss/fetch.ts` |
| 279–400 | `RSS_BRIDGE_ERROR_RE`, `cleanItems`, `parseRssXml` | `server/fetcher/rss/parse.ts` |
| 402–433 | `fetchFeedTitle` | `server/feeds/discovery.ts` |
| 434–end | `DiscoverCallbacks`, `discoverRssUrl` | `server/feeds/discovery.ts` |

Helper rule: a private helper goes into the file of its only caller. A helper
called from two of the new files is exported from the lower-level one
(`parse.ts` is lower than `fetch.ts`; `fetch.ts` and `parse.ts` are lower than
`discovery.ts`) and imported by the other. Grep each helper's call sites before
placing it; say in the commit body which helpers became exports.

Dependency direction: `feeds/discovery.ts` may import `fetcher/http`, `ssrf`,
`flaresolverr`, `rss/parse`, `rss/types`. `fetcher/rss/*` must not import
anything from `feeds/` except the already-sanctioned `feeds/sources/*`
(used by `fetch.ts` for the API-feed dispatch).

## Importers

- `server/ingest/feed-loop.ts` line 17: `fetchAndParseRss`, `RateLimitError`
  and the types → from `../fetcher/rss/fetch.js` and `../fetcher/rss/types.js`.
- `server/fetcher/css-bridge.ts`, `server/fetcher/schedule.ts`: `type RssItem`
  → `./rss/types.js`.
- `server/feeds/sources/social-search.ts`, `github-releases.ts`: `type RssItem`
  → `../../fetcher/rss/types.js`.
- `server/feeds/routes.ts` (line 25) and `server/feeds/resolve.ts` (line 1)
  import `discoverRssUrl` from `../fetcher.js` today. Change both to
  `./discovery.js` (intra-domain).
- `server/fetcher.ts` façade: `export { discoverRssUrl } from './feeds/discovery.js'`
  (keep the name on the façade: 13 test files mock `fetcher.js` with a
  `discoverRssUrl` key and must not start failing on an unknown export).
- Delete `server/fetcher/rss.ts` (no shim).

## Tests

- `server/fetcher/rss.test.ts` (672 lines) has two `describe` blocks:
  `fetchAndParseRss` (line 146) and `discoverRssUrl` (line 548), plus shared
  setup above line 146. Split it: the first block and the setup it needs →
  `server/fetcher/rss/fetch.test.ts`; the second block and the setup it needs →
  `server/feeds/discovery.test.ts`. Test bodies verbatim; duplicate the shared
  helpers rather than sharing a module (they are test fixtures). Mock paths:
  `vi.mock('./ssrf.js')` becomes `'../ssrf.js'` in `rss/fetch.test.ts` and
  `'../fetcher/ssrf.js'` in `feeds/discovery.test.ts`; `feedsmith` unchanged.
- `server/feeds/routes.test.ts` and `server/feeds/resolve.test.ts` mock
  `../fetcher.js` (routes) to stub `discoverRssUrl`. Once the routes import
  `./discovery.js`, that stub no longer intercepts: add
  `vi.mock('./discovery.js', …)` with the same stub in both files. Read each
  file's existing mock to keep the same return values.
- Total test count unchanged (2,589).

## Acceptance

- `ls server/fetcher/rss.ts` → missing; `ls server/fetcher/rss/` → `fetch.ts fetch.test.ts parse.ts types.ts`
  (plus `parse.test.ts` if you add one; not required).
- `grep -rn "fetcher/rss\.js\|'\./rss\.js'" server` → empty.
- `grep -rn "discoverRssUrl" server --include=*.ts | grep -v test | grep -v "feeds/\|fetcher.ts"` → empty.
- Typecheck, lint, tests (count unchanged), build, lint-no-japanese green.

Commit: `refactor(fetcher): split rss.ts into fetch, parse and types; move feed discovery to server/feeds`.
