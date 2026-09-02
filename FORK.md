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

Crossing into another publication day stops on a full-screen divider naming that day
instead of landing directly on the article: the same gesture again continues, the
opposite one (or Escape) backs out. The keyboard-navigation context carries each
article's `published_at` for it, alongside the ids and URLs it already held, and
`useExtendArticleList` keeps those dates in step when it appends a window.

## Day separators in article lists

`src/components/article/day-separator.tsx` — article lists are grouped by
publication day, one `<section>` per day headed by its date (`Today`, `Yesterday`,
then the spelled-out day). The header sticks below the app header and the category
tabs, which now publish their height as `--category-tabs-height`; at 200+ articles a
day a rule that only appears at the rupture is never on screen, while a sticky header
tells you where you are the whole way down. Sections are what let a header unstick —
flat siblings would pile up at the same offset. Grid layouts stay flat with a
non-sticky rule, since sections would break the column flow.

`/likes` and `/history` are excluded: they are ordered by `liked_at` / `read_at`, so
publication days would not run in order there.

`formatRelativeDate` was counting rolling 24-hour windows, so two articles three
minutes apart could read `12 days ago` and `13 days ago` and straddle a separator
that (correctly) was not there. It now counts calendar days beyond today, sharing
`calendarDaysAgo` with the separators, and keeps minutes and hours within today.

The same module backs the reader's day divider, so a day is named identically in the
list and while paging through articles.

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

## A visible refresh

Nothing in the interface offered a fetch: it lived in the sidebar context menus
(right-click a feed or a category) and in pull-to-refresh, which only exists on
touch devices. `POST /api/admin/fetch-all` had been implemented server-side and
never called from the client.

`src/components/feed/refresh-button.tsx` puts an icon in the list header, in the
spacer `Header` already reserved on the right (new `rightSlot` prop, mounted from
`page-layout.tsx`). Its scope follows the route: one feed on `/feeds/:id`, a
category's enabled feeds on `/categories/:id`, and everywhere else the whole
lot through the admin endpoint — one request with server-side concurrency rather
than one per feed. Settings -> Feeds gets the same "all feeds" action as a
button next to `Add Feed`. `src/lib/feed-refresh.ts` reads the SSE stream and
sums how many new articles the run found.

## Denser list cards

`src/components/article/article-card.tsx` — in the list layout the title was
truncated to one line, which cut most Reddit and forum titles mid-sentence. It
now wraps in full. The thumbnail moves to the left of the text, goes from 64px
to 80px, and its fallback (the
site favicon, all most articles have) fills the box instead of sitting small in
the middle of it — the favicon is requested at `sz=64` and rendered with
`object-contain` inside a 6px inset, so an 80px box shows a 66px icon instead of
a 24px one.

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

## New-conversation composer on the chat tab

`src/components/chat/chat-new-conversation.tsx` (+ test) — replacing the
chat-first home screen with the front page left `/chat` with no way to start a
conversation: the tab only listed existing ones. The composer sits above the
conversation list with the same input box and suggestion chips the home screen
had (reusing `ChatInputArea` and the `/api/chat/suggestions` fallback).
Sending a message streams the new conversation in place (`ChatPanel`
variant=`full`) and swaps the URL to `/chat/:id` with `replaceState` — a real
navigation would remount the page and drop the stream. Re-navigating to `/chat`
(sidebar, command palette) returns to the list; to make that safe mid-stream,
`useChat`'s dead `abortRef` (never set) was wired into a stream-generation
guard so `reset()` actually detaches an in-flight stream instead of letting it
write into the next conversation. Mounted from `src/pages/chat-page.tsx`
(2-line insertion wrapping the list view).

## Reddit articles: comments, crossposts, and access

Reddit-hosted articles get their body from the post's JSON (`server/fetcher/reddit.ts`,
short-circuited in `server/fetcher/content.ts`), including the embedded parent of a
crosspost, and the top comments are rendered below the article
(`server/routes/comments.ts`, `src/components/article/article-comments.tsx`) with an
on-demand "translate comments" button.

Reddit markdown references uploaded images as plain links (a bare
`https://preview.redd.it/…` URL, or `[caption](…)`), which rendered as signed
URLs instead of pictures. `redditImageLinksToMarkdown`
(`shared/reddit-images.ts`) rewrites both forms to image syntax — applied to
the post body at fetch time, to comment bodies as they are served, and again
at render time in the reader so articles stored before the rewrite show their
pictures too. Text posts with inline images carry no `preview` field, so the
thumbnail (`og_image`) falls back to the first image in the body; thumbnails
of already-stored articles only change on a re-fetch (`og_image` is stored). The Markdown source view (`.md` URLs,
`article-raw-page.tsx`) appends the comment thread below the article —
replies nested as blockquotes — so an export carries the discussion too.

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
   Its per-page budget is `FLARESOLVERR_TIMEOUT_MS` (default 60s): a
   browser-based solver on a site that stalls it can outlast a fixed minute,
   and the request used to be cut off before any answer came back. Every
   failure path now logs its cause instead of returning a silent null.

## Crossposts are grouped inside an aggregator feed

Similarity detection skips same-feed candidates, because within one blog
"Weekly digest #12" and "#13" share almost every bigram without being the same
story. A Reddit multi breaks that assumption: a crosspost and its original
arrive in the same feed, under the same title, and were shown as two articles.

`comparableWithinFeed()` in `server/similarity.ts` lets same-feed candidates
through when both are Reddit posts from *different* subreddits — the crosspost
case — while a thread posted under the same title in the same subreddit every
day stays separate. `detectAndStoreSimilarArticles()` takes the article's URL
for it.

## A browser-shaped retry before the solver

Article fetches announce themselves as `RSSReader/1.0`, and sites behind a WAF
answer `403` on sight — a clipped Medium story stored nothing but
`fetchFullText: HTTP 403`. `fetchHtml()` now retries once with a browser
User-Agent (and the `Accept` headers that go with it) on `403` and `503` before
reaching for FlareSolverr, which is both slower and often not deployed. Other
statuses are answers rather than blocks and are not retried. The browser UA
moved to `server/fetcher/http.ts`, where the Reddit ladder now takes it from.

## Google News links resolve to the publisher

A Google News feed links to `news.google.com/rss/articles/<token>`, which holds
no article text: extraction found nothing and the reader showed the RSS snippet
alone. `server/fetcher/google-news.ts` resolves the wrapper before extraction —
decoding the token when it still embeds the URL (pre-2024 links), otherwise
following the redirect and reading the shell, then replaying the signed
`batchexecute` RPC the shell itself would have made — tokens minted since
mid-2024 are opaque and only resolve that way — and finally letting FlareSolverr
run the page's JavaScript. Failing all four it returns null and the pipeline
behaves exactly as before.

The stored `url` stays the wrapper: it is the RSS item's identity and the
deduplication key, and a browser resolves it anyway.

## Pages whose text lives elsewhere are followed once

Some URLs carry no article of their own. A Hugging Face Space, a document
viewer, a whitepaper reader: the page a reader saves is a shell of markup whose
words sit inside an iframe. `huggingface.co/spaces/AdithyaSK/rl-environments-guide`
is 25,891 characters of HTML holding 104 characters of text. Extraction returned
a title and nothing else, and the anti-bot solver could not help — rendering the
shell still leaves the text inside the frame.

`server/fetcher/embedded-content.ts` reads the outer HTML for the page's own
pointer to where its text lives, in order of how explicit it is: a meta refresh,
then `<link rel="amphtml">`, then the first iframe that is not hidden, declared
under 200px, or hosted by a player, ad network, code sandbox or social embed.
`fetchFullText()` follows that one URL when extraction came up short, parses it
directly — one hop, never recursing — and keeps the result only if it beats the
outer page and clears `MIN_EXTRACTED_LENGTH`. The hop uses the same
`DEFAULT_TIMEOUT` as any other article fetch: the frame *is* the article, and a
Hugging Face Space can serve several megabytes of HTML (or spend ten seconds
waking). A thin frame therefore still falls through to the solver, and a wrong
guess costs one fetch rather than a wrong article. If the hop fails and the
shell is still under `MIN_EXTRACTED_LENGTH`, the fetch throws rather than
keeping a handful of chrome characters as the body — that would lock an RSS
row out of the retry queue (`full_text IS NULL`). Clips with a body shorter
than `MIN_EXTRACTED_LENGTH` are retried as well.

For an iframe the outer page keeps naming the article: its title and og:image
win, since that is the URL the reader saved. A meta refresh or an AMP link is
the article's own page, so the target's own win.

Readability throws outright on a page with nothing to extract, which is exactly
what a shell page is, so `fetchFullText()` now holds that error while the
fallbacks run and rethrows it only if none of them find anything. Without that,
the emptiest pages — the ones this feature exists for — failed before reaching
it.

## The embedded video survives, and can be archived

The cleaning pipeline protects player iframes on purpose — `preClean` and
`postClean` both carry a video exception, with tests to match — and then
Turndown, which has a rule for tables and nothing else, dropped them at the
Markdown conversion, and the reader's sanitizer would have dropped them again.
A Siemens post with an embedded talk kept its caption and lost the video.

`shared/video.ts` holds one definition of which URLs are videos; the Turndown
rule in `server/fetcher/contentWorker.ts` writes the embed into the Markdown as
a poster linking to it, and `src/lib/video-card.ts` marks such a link as a play
card in the reader. That form needs nothing new anywhere else: the image
archiver already matches `![alt](url)`, so the thumbnail is archived with the
rest of the article, and `img-src` already allows https. An iframe would have
needed `frame-src`, which the CSP does not grant.

On top of that, `server/fetcher/article-videos.ts` archives the video itself —
the sibling of `article-images.ts`, and deliberately the same shape: requested
per article, processed in the background, served from this instance, deleted
with the article. It differs in the two ways size forces. It is never
automatic, since a video is three orders of magnitude larger than the images
beside it. And it cannot be fetched with a GET — a provider page serves a
player, not a file — so it shells out to `yt-dlp`, an external binary the
providers break every few months and which has to be kept updated. When it is
missing or fails, the article is left exactly as it was.

Serving one is not serving an image either: `<video>` seeks by asking for a byte
range, so `GET /api/articles/videos/:filename` answers `206`. The archived file
plays under `default-src 'self'` with no CSP change, which makes the archive
cheaper than the embed it replaces. Height and size ceilings (720p and 500 MB by
default) keep a download from filling the disk. See
[`82_feature_video_archive.md`](docs/spec/82_feature_video_archive.md).

## The lead image survives

WordPress-style themes — Hackaday is the reproducible case — emit the featured
image in the post's header region, outside the content block. The extraction
pipeline throws that region away wholesale: `stripHeavyTags` deletes every
`<header>…</header>` before the worker even parses the page, and Readability
keeps only the main text container. The same picture still arrives through
`og:image`, which is read from the meta tags before any cleaning — so the
article list showed a thumbnail that the article body did not contain.

`ensureLeadImage()` in `server/fetcher/markdown-utils.ts` closes the gap at the
end of `fetchArticleContent` (one insertion point in `server/fetcher.ts`): when
the extracted markdown has no image within its opening stretch, the og:image is
prepended as the hero. It never doubles a picture the body already carries —
URLs are compared by host + path, so CDN resize variants (`?w=400` vs `?w=800`)
count as the same image — and it stands down for generated social cards
(GitHub's per-page og banners), for Reddit posts, whose markdown
`fetchRedditPostContent` composes deliberately, and for bodies under
`MIN_EXTRACTED_LENGTH`, so a padded length cannot hide a failed extraction from
the stale-article repair loop. The prepended line is ordinary markdown, so the
image archiver stores the hero with the rest of the article.

## Removed Reddit posts are not ingested

Reddit keeps removed posts in its RSS feeds, with `[ Removed by Reddit ]` (or
`[deleted by user]`) as the title and the removal notice as the body. They were
being stored and shown like any article, translated placeholder title included.
`isRemovedRedditPost()` in `server/fetcher/reddit.ts` recognises them, and the
task builder in `server/fetcher.ts` drops them before the fetch phase. The check
is scoped to Reddit post URLs, so an ordinary article whose title mentions
removal is untouched.

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
- **Google News diagnosis**: `scripts/debug-google-news.ts <url>` walks the
  resolution strategies one at a time and prints what each saw — whether the
  token decodes, what the redirect returns, whether the shell carries the RPC
  signature — plus a slice of Google's HTML (`--dump-html` for all of it) to
  adjust the patterns against when a link stops resolving.
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

An `Add Feed` button in the section header opens the sidebar's own `FeedModal`,
which gained an `initialStep` prop so it can skip the add-something chooser and
land straight on feed creation (the back arrow is hidden when it does).

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
| `src/components/layout/page-layout.tsx` | +2 lines (import + `<BottomNav />`), +`rightSlot={<RefreshButton />}` on the list header |
| `src/components/layout/header.tsx` | +`rightSlot` prop, rendered in place of the list header's right spacer |
| `src/lib/i18n.ts` | +1 key (`article.markAsRead`) |

| `src/components/article/article-card.tsx` | `onMarkRead` prop + button in the 5 card variants; list-card title wraps, larger thumbnail and fallback favicon |
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
| `src/components/feed/feed-modal.tsx` | +`initialStep` prop (opens on a given step, hides the back arrow) |
| `src/components/article/article-list.tsx` | per-day sections in the render loop, publishes `articleDates` to the nav context |
| `src/lib/dateFormat.ts` | `formatRelativeDate` counts calendar days; +`calendarDaysAgo` |
| `server/fetcher.ts` | +1 import, removed Reddit posts filtered out of the new-article tasks, article URL passed to similarity detection, hero-image fallback step at the end of `fetchArticleContent` |
| `server/fetcher/markdown-utils.ts` | +`ensureLeadImage()` (og:image restored as the lead when extraction lost it) |
| `server/fetcher/content.ts` | +2 imports, Google News wrapper resolved at the top of `fetchFullText()`, embedded-content hop before the solver fallback |
| `server/fetcher/http.ts` | browser-UA retry on 403/503, +`BROWSER_USER_AGENT` (moved from `reddit.ts`) |
| `server/similarity.ts` | same-feed skip relaxed for cross-subreddit Reddit duplicates |
| `src/contexts/keyboard-navigation-context.tsx` | +`articleDates` (sessionStorage-backed, like ids and URLs) |
| `src/hooks/use-extend-article-list.ts` | carries `dates` through the extension payload |
| `src/lib/i18n.ts` | +35 keys (`settings.feeds*`), `feedError.httpError` placeholder fixed |
| `src/pages/chat-page.tsx` | +2 lines (import + `<ChatNewConversation>` wrapper around the list view) |
| `src/hooks/use-chat.ts` | dead `abortRef` replaced by a stream-generation guard; `reset()` detaches an in-flight stream |
| `src/hooks/use-chat.test.ts` | +1 test (reset detaches an in-flight stream) |
| `src/components/article/article-raw-page.tsx` | appends the Reddit comment thread to the `.md` source view |

`src/app.tsx` additionally has 2 lines adjusted and a small effect added (sidebar
auto-open respects the persisted collapse state).

Everything else is new files, so merges from upstream should stay conflict-free.
