# Oksskolten Spec — GitHub Trending

> [Back to Overview](./01_overview.md)

## Overview

Subscribe to a GitHub Trending board as a feed. Pasting a trending URL — `https://github.com/trending`, optionally narrowed by language (`/trending/rust`), period (`?since=weekly`) or spoken language (`?spoken_language_code=fr`) — creates one feed whose articles are the repositories on that board.

## Motivation

- **No such feed exists**: GitHub publishes no Atom endpoint and no API for trending. Pasting the page into Add Feed used to fall through discovery to the LLM selector bridge, which costs a model call to rediscover markup that is stable and known.
- **The board is a page, not a feed**: its markup — one `<article class="Box-row">` per repository, in rank order — has been stable for years, so reading it directly is cheaper and more predictable than inferring selectors.
- **One repository, one article**: ingestion dedupes on URL, so a repository that keeps trending stays a single article instead of arriving again every cycle.

## Scope

Repository boards only. `/trending/developers` lists people, its rows carry different markup, and it is rejected by the resolver.

## Design

### URL Recognition

`parseGithubTrendingUrl()` in `server/feeds/sources/github-trending.ts` reads the three dimensions of a board: the language path segment (kept percent-encoded, so `c%2B%2B` round-trips), `since`, and `spoken_language_code`. An absent or unknown `since` falls back to `daily`, which is what GitHub itself serves.

`githubTrendingFeedUrl()` spells `since` out in the canonical URL, so `/trending` and `/trending?since=daily` collapse to one feed and the same board cannot be subscribed to twice. The stored URL stays a page the reader can open.

`resolveFeedSource()` runs `resolveGithubTrendingFeed()` as its own stage, after GitHub stars and before the social resolver. A match short-circuits the discovery / RSS Bridge / CSS-selector pipeline and names the feed after its scope — `GitHub Trending (rust, this week)` — since there is no upstream feed title to discover.

### Fetching

`fetchAndParseRss()` routes trending URLs to `fetchGithubTrending()`, alongside the GitHub stars and Bluesky API URLs it already routes. These feeds have no RSS endpoint to fetch conditionally, so ETag / Last-Modified / content-hash caching does not apply and the result reports `notModified: false`.

The page is fetched through `fetchHtml()` — the same SSRF-checked path used elsewhere, with its FlareSolverr fallback — and parsed with JSDOM.

- **Rows**: `article.Box-row`. A row is a repository when its `h2` link points at `/owner/repo` and nothing deeper; the stargazer, fork and contributor links in the same row are not.
- **Empty boards**: a filter GitHub has no results for answers with a blankslate panel and yields an empty feed. Zero rows *without* a blankslate means the markup moved, which fails the fetch with an error that surfaces in `feeds.last_error` rather than leaving the feed silently empty.

### Item Shape

Each row becomes an `RssItem`: the title is `<owner>/<repo>`, the URL is the repository page, and the excerpt is the row's description followed by its language and the period's star count (`Widgets, but faster. — TypeScript · 1,234 stars this week`). From there the normal ingestion pipeline applies — the repository page is fetched and extracted like any other article, with the excerpt as fallback content.

The board carries no dates, so items are stamped a second apart from the fetch, the same pseudo-dating the CSS-selector bridge uses to keep rank order in the reader. A repository that trends again is not re-stamped: ingestion dedupes on URL, so each repository is one article, dated the first time it appeared on the board.

### Key Files

| File | Description |
|---|---|
| `server/feeds/sources/github-trending.ts` | URL parsing, canonical feed URL, page scraping |
| `server/feeds/resolve.ts` | `github-trending` resolver stage, before the social resolver |
| `server/feeds/routes.ts` | Translates the stage into create / re-detect SSE progress |
| `server/fetcher/rss/fetch.ts` | Routes trending URLs to the scraper instead of an RSS fetch |
