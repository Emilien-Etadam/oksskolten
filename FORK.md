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

## Persistent sidebar collapse

`src/lib/sidebar-collapsed.ts` — the existing collapse button in the sidebar header
now remembers its state across reloads (localStorage). Collapsed on desktop, the
bottom tab bar takes over navigation; the Menu tab reopens the sidebar on demand.
Wired via small insertions in `src/app.tsx`.

## Mark-as-read button

`src/components/article/mark-read-button.tsx` — a small check button on every unread
article card (all five layouts): mark as read without opening the article. Wired to
the list's existing instant-update + batched-server mechanism via an `onMarkRead`
prop threaded through `article-list.tsx` → `swipeable-article-card.tsx` →
`article-card.tsx`, plus one i18n key (`article.markAsRead`).

On touch devices, swiping an unread card to the right also marks it read (left swipe
still opens the article). The handled gesture stops propagation so it doesn't open
the sidebar drawer.

## Background AI pipeline (vLLM)

The auto-translate queue evolved into a persistent AI queue
(`server/fetcher/ai-queue.ts`, migration `0010_ai_pipeline.sql`):

- **Persistent**: queued work is marked in DB (`translate_pending_at`,
  `summarize_pending_at`) and resumed after restarts or failures, with a 10-minute
  backoff and bounded batches, at the start of every fetch cycle.
- **Translated titles**: the queue also translates article titles
  (`title_translated`), shown in every list card and in the reader's translated
  view. Manual translation triggers a best-effort title translation too.
- **Auto-summarize**: Settings → Reading → Auto-Summarize generates summaries on
  fetch via vLLM (`reading.auto_summarize`).

Category tabs show per-category unread counts, and the article card variants share
a common `CardMeta` row.

## Auto-translation on fetch (vLLM)

Settings → Reading → Auto-Translation. When enabled, every fetched article whose
detected language differs from the translation target language is queued and
translated in the background through the local vLLM provider (bounded concurrency,
`reading.auto_translate_concurrency`, default 1). Language detection uses franc-min
(ISO 639-3 → 639-1 mapped, `unknown` for short/undetectable text) instead of the
upstream ja/en heuristic. French is available as a translation target language.

A second setting, `reading.auto_translate_scope` (Settings → Reading, right below
the toggle), chooses what gets translated: `full` (default) translates the body
and the title, same as before; `titles` translates only the title — cheaper,
faster, and the only option that still helps once an article's body has failed
to extract. Completion is tracked per scope (`translated_lang` combined with
either `full_text_translated` or `title_translated`, depending which scope is
active when the check runs), so switching scope later picks up exactly the
missing piece rather than skipping it or redoing finished work.

The article list already showed `title_translated` unconditionally when present.
The reading view's title only followed the body's original/translated toggle
(`viewMode`), which never leaves `'original'` in `titles` scope since there's no
body translation to switch to — so the title silently stayed untranslated when
opening the article. `ArticleDetail` now shows the translated title whenever one
exists and no body translation is available to toggle against, and otherwise
keeps following `viewMode` exactly as before.

Key files: `server/fetcher/ai-queue.ts` (queue, `getAutoTranslateScope()`,
`processTranslate()`), `server/fetcher/ai.ts` (franc detection + provider
override), `migrations/0009_auto_translate.sql`, `migrations/0010_ai_pipeline.sql`
(`title_translated`), `src/hooks/use-auto-translate.ts`,
`src/hooks/use-auto-translate-scope.ts`, `src/components/article/article-detail.tsx`
(`showTranslatedTitle`).

## Front page (La Une)

`/` is a newspaper-style front page (`src/pages/front-page.tsx`,
`server/routes/frontpage.ts` + `server/db/frontpage.ts`): a hero article (highest
score, image preferred) followed by the top unread articles of each category,
reusing the magazine card variants. The chat-first home screen it replaces remains
available as the chat page (`/chat`). Note: `/` is not wired into demo mode.

## Reddit articles: comments, crossposts, and access

Reddit-hosted articles get their body from the post's JSON (`server/fetcher/reddit.ts`,
short-circuited in `server/fetcher/content.ts`), including the embedded parent of a
crosspost, and the top comments are rendered below the article
(`server/routes/comments.ts`, `src/components/article/article-comments.tsx`) with an
on-demand "translate comments" button.

Reddit blocks anonymous `.json` requests from many residential IPs ("You've been
blocked by network security"), so fetches escalate through a ladder, first match wins:

1. **Registered app OAuth** — `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`
   (client_credentials against `oauth.reddit.com`).
2. **Anonymous Android-app OAuth** — the technique used by
   [Redlib](https://github.com/redlib-org/redlib): request a `loid` token with the
   official Android client id and app-build User-Agent, then query
   `oauth.reddit.com`. Needs no account and no registered app, and is not subject to
   the anonymous-endpoint IP blocks. Failures back off for 10 minutes.
3. **Browser session cookie** — `REDDIT_COOKIE=reddit_session=…` copied from a
   logged-in browser.
4. **Anonymous ladder** — default UA, browser UA, then `old.reddit.com`.
5. **Anti-bot solver** — FlareSolverr or the API-compatible
   [Byparr](https://github.com/ThePhaseless/Byparr) via `FLARESOLVERR_URL`.

## Social searches as feeds

Adding a search or hashtag URL creates a feed from it
(`server/fetcher/social-search.ts`, resolved in `server/routes/feeds.ts` and
fetched in `server/fetcher/rss.ts`):

- **Bluesky custom feed** — paste `https://bsky.app/profile/<actor>/feed/<name>`,
  a community-curated topical feed. `app.bsky.feed.getFeed` serves these
  anonymously, so this is the account-free way to follow Bluesky by topic
  (search is not). Handles are resolved to DIDs to build the `at://` URI.
- **Bluesky profile** — paste `https://bsky.app/profile/<handle>`; Bluesky serves
  RSS at `/rss` and, unlike search, does so anonymously. Probed like the Mastodon
  candidate below.
- **Bluesky search** — paste `https://bsky.app/search?q=…` (the URL the web app
  produces, `sort` and `lang` included). Bluesky serves no RSS for searches, so
  `app.bsky.feed.searchPosts` is queried and its posts are converted to feed
  items, with titles derived from the opening line of the text. Search rejects
  unauthenticated requests (403 from the public AppView, while profiles and
  author feeds stay open), so it needs `BLUESKY_IDENTIFIER` plus
  `BLUESKY_APP_PASSWORD` — an app password from bsky.app Settings, not the
  account password. The session is cached for an hour and renewed once on 401.
- **Mastodon hashtag** — paste `https://<instance>/tags/<tag>`; Mastodon already
  serves RSS at `<tag>.rss`. Since ordinary sites use `/tags/…` paths too, the
  candidate is probed and only accepted when it actually returns a feed.

X/Twitter has no equivalent: it removed anonymous guest access in 2024, so no
account-free path exists.

## Per-feed AI relevance filter

Each feed can carry a criterion written by the reader in their own words
(`feeds.ai_filter`, set from the feed's context menu →
`src/components/feed/feed-ai-filter-dialog.tsx`). Every new article of such a
feed is queued for a relevance check on the local model
(`evaluateArticleRelevance` in `server/fetcher/ai.ts`, task `filter` in
`server/fetcher/ai-queue.ts`, forced provider `vllm`).

Rejected articles are not deleted: `articles.filtered_at` is stamped and the
list query hides them, so a bad criterion is reversible. The verdict is a single
word and anything other than a clear "no" keeps the article — an ambiguous model
answer must never swallow content. Failures leave `filter_pending_at` set, so
the usual 10-minute-backoff resume pass retries them. Unlike auto-translate and
auto-summarize, the filter has no global toggle: it runs exactly for the feeds
that define a criterion.

## Tooling

- **E2E smoke tests**: `npm run test:e2e` (Playwright) builds the app, boots the
  real server against a scratch DB (`.e2e-data/`), and checks the front page,
  the inbox → reader flow, and the mobile bottom bar. Set `PW_CHROMIUM_PATH` to
  reuse a preinstalled Chromium.
- **DB backup**: `scripts/backup-db.sh` snapshots the SQLite database with the
  online backup API (WAL-safe), gzip + rotation. See the header for a cron line.
- **CI**: the upstream `test.yaml` workflow uses no secrets and runs on push to
  main — enable GitHub Actions on the fork to validate every upstream sync.

## Upstream fixes

- **CSP inline scripts**: the strict `script-src 'self'` blocked the two inline
  bootstrap scripts in `index.html` (theme flash guard, boot error display).
  `server/index.ts` now computes their sha256 hashes from `dist/index.html` at
  startup and includes them in the CSP header.
- **Logo font**: the downloadable TeX Gyre Pagella files were rejected by
  Firefox's font sanitizer. The `font-logo` stack now uses local Palatino
  equivalents (`tailwind.config.ts`), and the font import was removed from
  `src/index.css`.
- **HTTP error message**: `feedError.httpError` used `{{code}}` placeholders
  while `t()` interpolates `${code}`, so the feed error banner rendered a
  literal `{{code}}` instead of the status. Fixed in all three locales.

## GitHub starred releases as a feed

`server/fetcher/github-releases.ts` — pasting `https://github.com/stars/<user>` (or
`https://github.com/<user>?tab=stars`) creates one feed carrying the releases of
every repository that account has starred. GitHub publishes a release feed per
repository but none spanning a user's stars, and the star list keeps moving, so
it is re-read on every cycle.

One GraphQL query returns 100 starred repositories together with their latest
releases, which is why this uses GraphQL rather than REST: over REST a 200-star
account would cost 200 requests per cycle.

Settings → Integration has a GitHub section with everything setup needs: a
token (saved to the DB through the same endpoint the LLM/translation provider
keys use, falling back to `GITHUB_TOKEN` if unset), the stars URL — paste and
click "Create feed" to call the same feed-creation endpoint the Add Feed
dialog uses — and the release/pre-release/tag mix (`github.release_types`).
See `docs/spec/86_feature_github_releases.md`.

`POST /api/feeds/:id/re-detect` (`server/routes/feeds.ts`) checks
`resolveGithubStarsFeed()` (and `resolveSocialSearchFeed()`) before falling
back to generic discovery, the same order feed creation already used. Without
this, re-detecting a GitHub-stars (or Bluesky/Mastodon) feed ran generic
discovery, correctly found no `<link>` on a stars page, and overwrote
`rss_url` with that nothing — permanently breaking an otherwise-working feed.
A feed already stuck this way self-heals the next time "Re-detect RSS" is
clicked on it.

## Extraction debugging + over-broad cleaner pattern

`scripts/debug-extract.ts` — replays the fetch/clean/extract phases for one URL
and reports where the article text is lost, then re-runs the real `parseHtml()`
with each cleaning stage disabled so the responsible stage names itself.

It was written to diagnose next.ink articles storing an empty `full_text` with
no `last_error`: the `'next-'` partial pattern (meant for next-article links)
matched `id="next-single-post"` and deleted the whole body. The pattern is now
spelled out as `next-post` / `next-article` / `next-story` / `nextprev`, and
`postClean()` rolls itself back when a pass leaves under 200 characters behind.
Both changes are upstream bugs, not fork-specific behaviour.

## Feed management table (Settings -> Feeds)

`src/pages/settings/feeds-tab.tsx` +
`src/pages/settings/sections/feed-management-section.tsx` — the settings tab
upstream ships as an empty "under development" placeholder (internal key
`viewer`, labelled *Feeds*) now holds a table of every subscription: article,
unread and per-week counts, last article date, and a status derived from the
data already returned by `GET /api/feeds` (`error`, `disabled`, `inactive` after
90 quiet days, `ok`). Rows are searchable by name or URL and filterable by
category and status; every column sorts.

Selection is checkbox-based with Shift + Click ranges, and the bulk bar reuses
`useFeedBulkActions` — the same hook behind the sidebar's multi-select — so move
to category, mark all read, fetch and delete behave identically in both places.
Two things are specific to the table: a *Re-enable* action (`PATCH
/api/feeds/:id` with `disabled: 0`, added to the shared hook as
`handleBulkEnable`) that only appears when the selection contains a disabled
feed, and the rule that bulk actions never touch a selected feed the current
filters hide. No new endpoint — the tab is frontend-only.

## Feed diagnostics panel (Settings -> Feeds)

`src/pages/settings/sections/feed-diagnostics-section.tsx` — above the table, a
"Needs attention" panel for feeds that are disabled or carrying a `last_error`.
Each card names the pipeline stage that failed, explains the cause in plain
words, shows the consecutive failure count, whether the feed goes through RSS
Bridge or sits behind bot protection, and keeps the raw error string one click
away. The remedies offered are the ones the classification suggests: re-detect
RSS (SSE, then a fetch), retry the fetch, and re-enable when disabled.

The classification and the re-detect SSE helper were lifted out of
`src/components/feed/feed-error-banner.tsx` into `src/lib/feed-error.ts` so the
panel and the article-list banner explain a failure the same way. `Retry all`
re-enables and re-fetches every listed feed but never re-detects — re-detection
can rewrite a feed's RSS URL, which is not a bulk operation.

## Upstream files touched

| File | Change |
|---|---|
| `src/app.tsx` | +2 lines (import + `<CategoryTabs />`) |
| `src/components/article/article-detail.tsx` | +2 lines (import + `<ArticleSwipeNavigation />`) |
| `src/components/layout/page-layout.tsx` | +2 lines (import + `<BottomNav />`) |
| `src/lib/i18n.ts` | +1 key (`article.markAsRead`) |

| `src/components/article/article-card.tsx` | `onMarkRead` prop + button in the 5 card variants |
| `src/components/article/swipeable-article-card.tsx` | `onMarkRead` pass-through |
| `src/components/article/article-list.tsx` | +1 line (`onMarkRead: markRead` in card props) |
| `server/index.ts` | CSP script-src hashes for inline bootstrap scripts |
| `tailwind.config.ts` + `src/index.css` | logo font swapped to local Palatino stack |
| `server/lib/cleaner/selectors.ts` | `'next-'` partial pattern narrowed to the next/prev link spellings |
| `server/lib/cleaner/index.ts` | `postClean()` rolls back a pass that empties the body |
| `server/fetcher/rss.ts` | +2 lines (import + GitHub stars branch in the API-feed dispatch) |
| `server/routes/feeds.ts` | +1 import, GitHub stars resolver branch before RSS discovery; same resolver check added to `/re-detect` |
| `server/routes/feeds.test.ts` | +2 tests: `/re-detect` on a GitHub stars feed |
| `server/routes/settings.ts` | +2 preference keys (`github.release_types`, `reading.auto_translate_scope`), `github` entry in `PROVIDER_KEY_MAP` |
| `src/hooks/use-settings.ts` | `github.release_types` and `reading.auto_translate_scope` threaded through the settings hook |
| `src/pages/settings/integration-tab.tsx` | +2 lines (import + `<GithubSection />`) |
| `src/pages/settings/sections/reading-section.tsx` | Translation Scope radio group, shown when Auto-Translation is on |
| `src/lib/i18n.ts` | +15 keys (`github.*`), +4 keys (`settings.autoTranslateScope*`) |
| `src/pages/settings-page.tsx` | placeholder for the `viewer` tab swapped for a lazy `<FeedsTab />` |
| `src/hooks/use-feed-bulk-actions.ts` | +`handleBulkEnable` (bulk re-enable of disabled feeds) |
| `src/components/feed/feed-error-banner.tsx` | `classifyError` / `reDetectSSE` moved to `src/lib/feed-error.ts` and imported back |
| `src/lib/i18n.ts` | +35 keys (`settings.feeds*`), `feedError.httpError` placeholder fixed |

`src/app.tsx` additionally has 2 lines adjusted and a small effect added (sidebar
auto-open respects the persisted collapse state).

Everything else is new files, so merges from upstream should stay conflict-free.
