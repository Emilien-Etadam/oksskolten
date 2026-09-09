# 04 — One feed-source resolver for create and re-detect

Read `00-context.md` first. Commits 01–03 must be done.

## Goal

`server/feeds/routes.ts` resolves a URL to a feed source twice with the same
chain: GitHub stars page → social search / hashtag → RSS discovery → RSS-Bridge
→ CSS-selector bridge inferred by the LLM.

- `POST /api/feeds` (routes.ts, the block that starts at `const skipResolvers`
  and ends where `rssUrl` / `rssBridgeUrl` / `discoveredTitle` are settled,
  roughly lines 112–185 of the file before it moved). It skips the two
  resolvers when `discovered_rss_url` or `force_page_selector` is given, and
  emits `{ type: 'step', step, status, found }` SSE events.
- `POST /api/feeds/:id/re-detect` (roughly lines 331–370 before the move). It
  emits `{ type: 'stage', stage }` / `{ type: 'stage-done', stage, found }`
  events and never skips the resolvers.

This is the same shape as phase 1's duplicated feed loop, and it already bit
once: the resolver check was added to create-feed first and forgotten on
re-detect, which then overwrote a working GitHub-stars feed with an empty RSS
URL (see the comment above the re-detect block). Extract the chain once.

## What to write

### `server/feeds/resolve.ts`

```ts
export type ResolveStage = 'github-stars' | 'social' | 'rss-discovery' | 'rss-bridge' | 'css-selector'

export interface ResolveEvent {
  stage: ResolveStage
  status: 'start' | 'done' | 'skipped'
  found?: boolean
}

export interface ResolvedSource {
  rssUrl: string | null
  rssBridgeUrl: string | null
  /** Title the resolver learned, if any (GitHub stars, discovery) */
  title: string | null
}

export async function resolveFeedSource(
  url: string,
  opts: {
    /** Skip the GitHub-stars and social resolvers (create-feed with a discovered URL or forced selector) */
    skipResolvers?: boolean
    /** Extra options today's create-feed passes to discoverRssUrl */
    discover?: Parameters<typeof discoverRssUrl>[1]
    onEvent?: (event: ResolveEvent) => void
  },
): Promise<ResolvedSource>
```

The body is today's chain, in today's order, with today's early exits:
a GitHub-stars or social hit sets `rssUrl` and reports the remaining stages as
`skipped`; discovery runs otherwise; RSS-Bridge only when discovery found
nothing; the CSS bridge only when RSS-Bridge found nothing. Read both call sites
line by line before writing it: the create path has branches (`discovered_rss_url`,
`force_page_selector`, the discovery options) that re-detect does not, and the
extraction must keep every one of them. Where the two sites genuinely differ
(create honours `body.discovered_rss_url` before anything else), that logic
stays in the route and only the shared part moves.

### The two routes

Each becomes: build `opts`, call `resolveFeedSource`, and translate
`ResolveEvent`s into the SSE events it emits today. **The SSE payloads the
client receives must be byte-identical**: same `type`, same `step` / `stage`
names, same `status` / `found` values, same order. `feeds/routes.test.ts`
(36 tests) asserts on many of them and must pass unmodified. Read
`src/components/feed/feed-modal.tsx` and `src/lib/feed-error.ts` only to
confirm the event names the client expects; do not edit them.

## Tests

- `server/feeds/resolve.test.ts`: one test per stage outcome (GitHub hit, social
  hit, discovery hit, bridge hit, CSS-bridge hit, nothing found, `skipResolvers`),
  asserting the returned source and the exact event sequence. Mock the five
  resolver functions with `vi.mock` as `feeds/routes.test.ts` already does for
  `rss-bridge` and `fetcher.js`.
- `server/feeds/routes.test.ts`: unmodified.

## Acceptance

- `grep -c "resolveGithubStarsFeed\|resolveSocialSearchFeed\|discoverRssUrl(\|queryRssBridge\|inferCssSelectorBridge" server/feeds/routes.ts` → 0 (the chain lives in `resolve.ts` only; the `discover-title` endpoint's `discoverRssUrl` call for the title is the one allowed exception, keep it if it is separate).
- `grep -c "resolveFeedSource" server/feeds/routes.ts` → 2.
- Typecheck, lint, server tests green; count goes up by the new resolver tests.

Commit: `refactor(feeds): resolve a feed source once for create and re-detect`.
