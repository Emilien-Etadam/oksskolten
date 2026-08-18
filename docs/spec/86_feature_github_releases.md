# Oksskolten Spec — GitHub Starred Releases

> [Back to Overview](./01_overview.md)

## Overview

Subscribe to the releases of every repository a GitHub account has starred, as a single feed. Pasting a stars page — `https://github.com/stars/<user>` or `https://github.com/<user>?tab=stars` — creates one feed whose articles are the releases published across that account's stars.

## Motivation

- **No such feed exists**: GitHub serves an Atom feed of releases per repository (`/<owner>/<repo>/releases.atom`), but nothing spanning a user's stars. Starring is also not watching, so releases of starred repositories reach the user nowhere.
- **The star list moves**: Subscribing to each repository by hand goes stale the moment a repository is starred or unstarred. Reading the star list on every cycle keeps the feed in sync with no maintenance.
- **One feed, not hundreds**: A reader with 200 stars wants one line in the sidebar, and one feed's worth of unread counts, not 200.

## Scope

Releases of *starred* repositories only. Watched repositories, releases from an organisation, and repositories followed by other means are out of scope — the star list is the one signal this feature reads.

## Design

### URL Recognition

`resolveGithubStarsFeed()` in `server/fetcher/github-releases.ts` recognises the two forms GitHub itself produces and collapses both to the canonical `https://github.com/stars/<user>`. Storing one spelling means the same star list cannot be subscribed to twice, and the stored URL stays a page the reader can open.

`server/routes/feeds.ts` calls the resolver before RSS discovery, alongside the social-search resolver. A match short-circuits the discovery / RSS Bridge / CSS-selector pipeline and names the feed `GitHub Releases (<user>)`, since there is no upstream feed title to discover.

### Fetching

`fetchAndParseRss()` in `server/fetcher/rss.ts` routes stars URLs to `fetchGithubStarredReleases()` the same way it routes Bluesky API URLs — these feeds have no RSS endpoint to fetch conditionally, so ETag / Last-Modified / content-hash caching does not apply and the result reports `notModified: false`.

One GraphQL query returns a page of starred repositories *together with* their latest releases. This is the reason the feature uses GraphQL rather than REST: over REST the star list costs one request and each repository's releases costs another, so a 200-star account would issue 200 requests every cycle and be rate-limited within the hour. Over GraphQL the same account costs two requests.

- **Page size**: 100 repositories, GitHub's maximum.
- **Page cap**: 5 pages (500 repositories). Repositories are read newest-starred first, so the cut falls on the oldest stars. Exceeding the cap logs a warning naming what was skipped.
- **Entries per repository**: the 3 most recent. Older ones have already been ingested.

### Authentication

`GITHUB_TOKEN` is required — the GraphQL API rejects unauthenticated requests outright. A classic personal access token with no scopes reads public stars; `repo` is needed for stars on private repositories. A missing token fails the fetch with a message naming the variable, which surfaces in `feeds.last_error`.

### Release Types

The `github.release_types` setting (Settings → Reading) decides what counts as an entry:

| Value | Includes |
|---|---|
| `stable` (default) | Published, non-prerelease releases |
| `prerelease` | The above, plus betas and release candidates |
| `tags` | The above, plus tags — but only from repositories that publish no releases at all |

Drafts are never included. The tags restriction matters: repositories that publish releases tag every one of them, so including their tags would deliver every release twice. Only repositories that tag *instead of* releasing fall back to tags.

The GraphQL query omits the `refs` block entirely unless tags are wanted, since it roughly doubles the cost of the query.

### Item Shape

Each entry becomes an `RssItem`: the title is `<owner>/<repo> <release name>`, the URL is the release page (or `/releases/tag/<name>` for a tag), and the release body becomes the excerpt, truncated to 2000 characters. Items are sorted newest first so that the per-feed article cap keeps the most recent releases. From there the normal ingestion pipeline applies — the release page is fetched and extracted like any other article, with the excerpt as fallback content.

### Key Files

| File | Description |
|---|---|
| `server/fetcher/github-releases.ts` | URL parsing, GraphQL query, release/tag filtering |
| `server/fetcher/rss.ts` | Routes stars URLs to the GraphQL fetcher |
| `server/routes/feeds.ts` | Resolves a pasted stars URL before RSS discovery |
| `server/routes/settings.ts` | `github.release_types` preference key |
| `src/hooks/use-github-release-types.ts` | Client-side setting state |
| `src/pages/settings/sections/reading-section.tsx` | Settings control |
