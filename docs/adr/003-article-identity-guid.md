# ADR-003: Article identity is the feed's guid, not the URL

## Status

Accepted

## Context

An article was identified by its URL alone: `articles.url TEXT NOT NULL UNIQUE`,
with `getExistingArticleUrls()` filtering the parsed feed items down to the
URLs we had never stored.

That holds only for feeds whose entries each have their own page. Some feeds
point several entries at one landing page and distinguish them by `<guid>`
alone. SOLIDWORKS Tech Alerts is the case that surfaced this: every release
note links to the same `subscription/downloads.html`, so after the first one
was stored, every later release note was dropped as a duplicate. The feed
stayed frozen on its oldest article, with no error anywhere — the items were
filtered out before reaching `insertArticle()`, and any that got through would
have hit the UNIQUE constraint, whose violations the pipeline swallows on
purpose.

RSS has an identifier for exactly this: `<guid>` (`<id>` in Atom,
`rdf:about` in RSS 1.0). We parsed it only as a URL fallback and never stored
it.

Keeping the URL constraint and making the stored URL artificially unique
(appending the guid as a fragment, for instance) was rejected: it puts a
synthetic URL in front of the user, in the article view and in every link out.

## Decision

Store the feed's identifier as `articles.guid` and make it the article
identity whenever the feed provides one. `UNIQUE (feed_id, guid)` — partial,
so guid-less rows stay out of it — replaces `UNIQUE (url)`
(`migrations/0018_article_guid.sql`, a table rebuild since SQLite cannot drop
a column constraint in place).

Dedup moves into the ingest layer, in `selectNewItems()`
(`server/ingest/dedup.ts`). URL still decides in three cases:

- the item carries no guid, which is the historical behaviour;
- the URL is already stored under **another** feed — guids are feed-specific,
  two feeds never agree on one, so cross-feed dedup stays on URL;
- the same URL **and** title is already stored under **this** feed.

That last case is what makes the change safe to deploy. Every article stored
before the migration has `guid IS NULL`, and a feed that regenerates its guids
on every build has no stable one; matching those on URL + title keeps them
from coming back as duplicates on the first pass. A row matched that way
adopts the item's guid (`setArticleGuid()`), so the following pass matches on
guid directly.

## Consequences

- Feeds that reuse one link across entries now keep every entry.
- `articles.url` is no longer unique. Nothing may rely on the constraint to
  prevent duplicates; `selectNewItems()` is the only thing standing between a
  feed and a duplicate article, and `getArticleByUrl()` returns one of
  possibly several rows.
- A feed publishing genuinely distinct entries under one URL *and* one title
  is kept once. Preferring that over duplicating an entire feed whenever a
  publisher regenerates its guids.
- A title edited upstream on an article stored before the migration (and not
  yet backfilled) reads as a new article, once.
- The migration rebuilds the `articles` table. On a large database it is the
  slowest migration in the project, and it runs with foreign keys disabled,
  as the runner already does for every migration file.
